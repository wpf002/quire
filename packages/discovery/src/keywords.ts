import type { KeywordMarket, KeywordSuggestionProvider, Storefront } from './providers';
import { estimateDailySales } from './sales';

export interface KeywordScore {
  keyword: string;
  /** 0–1. How readily Amazon suggests the phrase: shown at a shorter prefix means more shoppers type it. */
  demand: number;
  /** 0–1. Higher means stronger books already rank for it. */
  competition: number;
  score: number;
  resultCount: number | null;
  topSalesPerDay: number | null;
  source: string;
}

const MIN_PREFIX = 3;
const MAX_PREFIX_STEPS = 5;
const SATURATED_RESULT_COUNT = 50_000;
const STRONG_COMPETITOR_SALES = 60;
/** Median ratings of the top results at which a keyword counts as fully contested. */
const STRONG_COMPETITOR_REVIEWS = 1_000;
const NEUTRAL_STRENGTH = 0.5;

/** Find the shortest prefix at which Amazon suggests the keyword. */
export async function demandScore(keyword: string, provider: KeywordSuggestionProvider, storefront: Storefront): Promise<number> {
  const normalized = keyword.toLowerCase().trim();
  const lengths = prefixLengths(normalized.length);
  for (const [index, length] of lengths.entries()) {
    const { suggestions } = await provider.suggest(normalized.slice(0, length), storefront);
    if (suggestions.includes(normalized)) return 1 - index / lengths.length;
  }
  return 0;
}

function prefixLengths(total: number): number[] {
  if (total <= MIN_PREFIX) return [total];
  const step = Math.max(1, Math.ceil((total - MIN_PREFIX) / (MAX_PREFIX_STEPS - 1)));
  const lengths: number[] = [];
  for (let length = MIN_PREFIX; length < total; length += step) lengths.push(length);
  lengths.push(total);
  return lengths;
}

/** Search pages carry ratings but no BSR, so ratings stand in for competitor strength there. */
function reviewStrength(market: KeywordMarket): number {
  const reviews = market.topTitles.map((title) => title.reviews).filter((count): count is number => count !== null);
  return reviews.length > 0 ? Math.min(1, median(reviews) / STRONG_COMPETITOR_REVIEWS) : NEUTRAL_STRENGTH;
}

export function competitionScore(market: KeywordMarket): { competition: number; topSalesPerDay: number | null } {
  const ranked = market.topTitles.map((title) => title.bsr).filter((bsr): bsr is number => bsr !== null);
  const topSalesPerDay = ranked.length > 0 ? median(ranked.map(estimateDailySales)) : null;
  const strength = topSalesPerDay === null ? reviewStrength(market) : Math.min(1, topSalesPerDay / STRONG_COMPETITOR_SALES);
  const crowding = market.resultCount === null ? 0.5 : Math.min(1, Math.log10(Math.max(1, market.resultCount)) / Math.log10(SATURATED_RESULT_COUNT));
  return { competition: 0.6 * strength + 0.4 * crowding, topSalesPerDay };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function combineScore(demand: number, competition: number): number {
  return Math.round(100 * demand * (1 - 0.7 * competition)) / 100;
}

/** Expand seed phrases into candidate keywords using the suggestion provider. */
export async function expandSeeds(seeds: string[], provider: KeywordSuggestionProvider, storefront: Storefront, limit: number): Promise<string[]> {
  const found = new Set<string>();
  for (const seed of seeds) {
    const normalized = seed.toLowerCase().trim();
    if (normalized) found.add(normalized);
    const { suggestions } = await provider.suggest(`${normalized} `, storefront);
    for (const suggestion of suggestions) found.add(suggestion);
    if (found.size >= limit) break;
  }
  return [...found].slice(0, limit);
}
