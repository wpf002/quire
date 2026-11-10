import {
  type CategoryThresholds,
  type KeywordScore,
  type RecommendationPayload,
  PRINT_FULL_RATE_MIN_CENTS,
  categoryFit,
  estimateDailySales,
  paperbackRoyaltyCents,
} from '@quire/discovery';
import type { RankObservation } from './types';

export const UNRANKED_SWAP_DAYS = 14;
const DAY_MS = 86_400_000;
const MIN_OBSERVATIONS_FOR_SWAP = 10;

export interface ReoptimizeInput {
  now: Date;
  keywordBoxes: string[];
  /** Phrases inside each box, as packed. */
  boxPhrases: string[][];
  observations: RankObservation[];
  candidates: KeywordScore[];
  currentCategories: string[];
  categoryThresholds: CategoryThresholds[];
  currentBsr: number | null;
  paperback: { priceCents: number; pages: number } | null;
}

export interface Reoptimization {
  payload: RecommendationPayload;
  rationale: string;
}

/** Phrases that have sat outside the tracked depth for 14+ days with enough observations to say so. */
export function deadPhrases(observations: RankObservation[], phrases: string[], now: Date): string[] {
  const since = now.getTime() - UNRANKED_SWAP_DAYS * DAY_MS;
  return phrases.filter((phrase) => {
    const recent = observations.filter((observation) => observation.keyword === phrase && observation.observedAt.getTime() >= since);
    return recent.length >= MIN_OBSERVATIONS_FOR_SWAP && recent.every((observation) => observation.rank === null);
  });
}

export function reoptimize(input: ReoptimizeInput): Reoptimization[] {
  const results: Reoptimization[] = [];
  const allPhrases = input.boxPhrases.flat();
  const inUse = new Set(allPhrases.flatMap((phrase) => phrase.split(' ')));
  const spare = input.candidates
    .filter((candidate) => !allPhrases.includes(candidate.keyword) && !candidate.keyword.split(' ').every((word) => inUse.has(word)))
    .sort((left, right) => right.score - left.score);

  for (const phrase of deadPhrases(input.observations, allPhrases, input.now)) {
    const replacement = spare.shift();
    if (!replacement) break;
    const boxIndex = input.boxPhrases.findIndex((phrases) => phrases.includes(phrase));
    results.push({
      payload: { kind: 'swap-keyword', remove: phrase, add: replacement.keyword, boxIndex },
      rationale: `"${phrase}" hasn't ranked in the top 100 for ${UNRANKED_SWAP_DAYS} days. "${replacement.keyword}" scores ${replacement.score.toFixed(2)}.`,
    });
  }

  if (input.currentBsr !== null) {
    const sales = estimateDailySales(input.currentBsr);
    const fits = input.categoryThresholds.map((category) => categoryFit(category, sales));
    const opening = fits
      .filter((fit) => fit.fit === 'winnable' && !input.currentCategories.includes(fit.path))
      .sort((left, right) => right.salesForFirst - left.salesForFirst)[0];
    if (opening) {
      const weakest = fits.filter((fit) => input.currentCategories.includes(fit.path) && fit.fit !== 'winnable').sort((left, right) => right.salesForTopTen - left.salesForTopTen)[0];
      results.push({
        payload: { kind: 'switch-category', from: weakest?.path ?? null, to: opening.path },
        rationale: `At ~${sales.toFixed(1)} sales a day the book can hold the top 10 in ${opening.path} (needs ~${opening.salesForTopTen.toFixed(1)}).`,
      });
    }
  }

  if (input.paperback && input.paperback.priceCents < PRINT_FULL_RATE_MIN_CENTS) {
    const current = paperbackRoyaltyCents(input.paperback.priceCents, input.paperback.pages);
    const raised = paperbackRoyaltyCents(PRINT_FULL_RATE_MIN_CENTS, input.paperback.pages);
    if (raised > current) {
      results.push({
        payload: { kind: 'raise-price', format: 'paperback', fromCents: input.paperback.priceCents, toCents: PRINT_FULL_RATE_MIN_CENTS },
        rationale: `Paperback sits in the 50% tier. At $9.99 each copy earns ${raised - current}¢ more.`,
      });
    }
  }
  return results;
}
