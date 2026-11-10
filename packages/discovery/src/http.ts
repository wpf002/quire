const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 400;

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

/** GET JSON with a timeout and exponential backoff on network errors and 5xx/429. */
export async function getJson(provider: string, url: string, options: { timeoutMs?: number; retries?: number } = {}): Promise<unknown> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Quire/1.0)' },
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new ProviderError(provider, `HTTP ${response.status}`);
        continue;
      }
      if (!response.ok) throw new ProviderError(provider, `HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError && !error.message.includes('HTTP 5') && !error.message.includes('429')) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError(provider, 'request failed');
}
