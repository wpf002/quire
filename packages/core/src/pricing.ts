import { type Cents, centsFromUsd } from './money';

// Vendor list prices, USD per million tokens. Update when the vendor changes pricing.
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

const HAIKU_PRICE: ModelPrice = { inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1, cacheWritePerMillion: 1.25 };
const SONNET_PRICE: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 };
const OPUS_PRICE: ModelPrice = { inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 };

export function priceForModel(model: string): ModelPrice {
  if (model.includes('haiku')) return HAIKU_PRICE;
  if (model.includes('opus')) return OPUS_PRICE;
  // Unknown models price as Sonnet so the cap errs toward stopping early.
  return SONNET_PRICE;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const TOKENS_PER_MILLION = 1_000_000;

export function costOfTokens(model: string, tokens: TokenCounts): Cents {
  const price = priceForModel(model);
  const usd =
    (tokens.input * price.inputPerMillion +
      tokens.output * price.outputPerMillion +
      (tokens.cacheRead ?? 0) * price.cacheReadPerMillion +
      (tokens.cacheWrite ?? 0) * price.cacheWritePerMillion) /
    TOKENS_PER_MILLION;
  return centsFromUsd(usd);
}

/** Rough English token estimate. Used only for pre-flight cap checks, never for billing. */
export const CHARS_PER_TOKEN = 4;
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
