import { costOfTokens, estimateTokens, type TokenCounts } from './pricing';
import { decideSpend, SpendCapError, type SpendLedger } from './spend';
import { cents } from './money';

// The Flint seam. Quire code calls ModelGateway; the vendor SDK lives behind Flint.

export interface CompletionRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Cache the system prompt (manuscript context) across calls in one pass. */
  cacheSystem: boolean;
}

export interface Completion {
  text: string;
  model: string;
  tokens: TokenCounts;
}

export interface ModelGateway {
  readonly available: boolean;
  complete(request: CompletionRequest): Promise<Completion>;
}

interface FlintLike {
  generate(
    input: { system?: string; prompt?: string; cache?: { system?: boolean } },
    options?: { model?: string; maxTokens?: number; signal?: AbortSignal },
  ): Promise<{ text: string; usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number } }>;
}

export const MODEL_CALL_TIMEOUT_MS = 120_000;

/** A model API call the provider refused. Rate limits, timeouts and server errors are worth retrying; other 4xx are not. */
export class ModelRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModelRequestError';
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Turns a provider error like `400 {"error":{"message":"..."}}` into a status and a readable message. */
export function toModelRequestError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const { status, providerCode } = error as { status?: unknown; providerCode?: unknown };
  const leading = /^(\d{3}) /.exec(error.message)?.[1];
  const codeText = typeof status === 'number' ? String(status) : typeof providerCode === 'string' ? providerCode : leading;
  if (codeText === undefined || !/^\d{3}$/.test(codeText)) return error;
  // Flint repeats the payload ("400 {...}: 400 {...}"), so take the first quoted message instead of parsing the whole string.
  const quoted = /"message":"((?:[^"\\]|\\.)*)"/.exec(error.message)?.[1];
  let message = error.message;
  if (quoted !== undefined) {
    try {
      message = JSON.parse(`"${quoted}"`) as string;
    } catch {
      message = quoted;
    }
  }
  return new ModelRequestError(Number(codeText), message);
}

export async function createFlintGateway(apiKey: string | undefined, defaultModel: string): Promise<ModelGateway> {
  if (!apiKey) return unavailableGateway('no-key');
  let client: FlintLike;
  try {
    // Optional dependency: loaded lazily so the app runs rule-only where Flint isn't installed.
    const flintModule = await import('@flint/core');
    client = new flintModule.Flint({
      provider: new flintModule.AnthropicProvider({ apiKey }),
      defaultModel,
    }) as unknown as FlintLike;
  } catch (error) {
    return unavailableGateway(`flint-missing: ${(error as Error).message}`);
  }
  return {
    available: true,
    async complete(request) {
      const signal = AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS);
      const outcome = await client
        .generate(
          { system: request.system, prompt: request.prompt, cache: request.cacheSystem ? { system: true } : undefined },
          { model: request.model, maxTokens: request.maxTokens, signal },
        )
        .catch((error: unknown) => {
          throw toModelRequestError(error);
        });
      return { text: outcome.text, model: request.model, tokens: outcome.usage };
    },
  };
}

export function unavailableGateway(reason: string): ModelGateway {
  return {
    available: false,
    async complete() {
      throw new Error(`Model gateway unavailable (${reason})`);
    },
  };
}

/** Wraps a gateway with fail-closed spend enforcement and ledger writes. */
export function meteredGateway(
  gateway: ModelGateway,
  ledger: SpendLedger,
  scope: { accountId: string; bookId: string | null; purpose: string },
): ModelGateway {
  return {
    available: gateway.available,
    async complete(request) {
      const estimate = costOfTokens(request.model, {
        input: estimateTokens(request.system) + estimateTokens(request.prompt),
        output: request.maxTokens,
      });
      const decision = decideSpend(await ledger.snapshot(scope.accountId), estimate);
      if (!decision.allowed) throw new SpendCapError(decision);
      const completion = await gateway.complete(request);
      await ledger.record({
        ...scope,
        model: completion.model,
        costCents: cents(costOfTokens(completion.model, completion.tokens)),
      });
      return completion;
    },
  };
}
