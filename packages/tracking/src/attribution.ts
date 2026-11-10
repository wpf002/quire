import type { RecommendationOutcome } from '@quire/discovery';
import { type BsrObservation, type RankObservation, TRACKED_DEPTH } from './types';

export const ATTRIBUTION_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const MIN_OBSERVATIONS_PER_WINDOW = 3;
// A change "moved" rank when the median improves by both of these.
const MOVED_MIN_RELATIVE = 0.2;
const MOVED_MIN_POSITIONS = 5;
const MOVED_MIN_BSR_RELATIVE = 0.2;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function windows<T extends { observedAt: Date }>(observations: T[], changeAt: Date, windowDays: number) {
  const start = changeAt.getTime() - windowDays * DAY_MS;
  const end = changeAt.getTime() + windowDays * DAY_MS;
  const before = observations.filter((observation) => observation.observedAt.getTime() >= start && observation.observedAt.getTime() < changeAt.getTime());
  const after = observations.filter((observation) => observation.observedAt.getTime() >= changeAt.getTime() && observation.observedAt.getTime() < end);
  return { before, after, complete: (now: Date) => now.getTime() >= end };
}

const effectiveRank = (rank: number | null) => rank ?? TRACKED_DEPTH + 1;

export function verdictForRank(beforeMedian: number, afterMedian: number): RecommendationOutcome['verdict'] {
  const improvement = beforeMedian - afterMedian;
  const relative = improvement / beforeMedian;
  if (improvement >= MOVED_MIN_POSITIONS && relative >= MOVED_MIN_RELATIVE) return 'moved';
  if (-improvement >= MOVED_MIN_POSITIONS && -relative >= MOVED_MIN_RELATIVE) return 'worse';
  return 'flat';
}

/** Compare median keyword rank in the 7 days before a metadata change to the 7 days after. */
export function attributeKeywordChange(
  observations: RankObservation[],
  keyword: string,
  changeAt: Date,
  now: Date,
  windowDays = ATTRIBUTION_WINDOW_DAYS,
): RecommendationOutcome | null {
  const relevant = observations.filter((observation) => observation.keyword === keyword);
  const { before, after, complete } = windows(relevant, changeAt, windowDays);
  if (!complete(now)) return null;
  const measuredAt = now.toISOString();
  if (after.length < MIN_OBSERVATIONS_PER_WINDOW) {
    return { measuredAt, metric: 'keyword-rank', beforeMedian: null, afterMedian: null, verdict: 'insufficient-data' };
  }
  // A newly added keyword has no before-window; treat it as unranked, which is what it was.
  const beforeMedian = before.length >= MIN_OBSERVATIONS_PER_WINDOW ? median(before.map((observation) => effectiveRank(observation.rank))) : TRACKED_DEPTH + 1;
  const afterMedian = median(after.map((observation) => effectiveRank(observation.rank)));
  return { measuredAt, metric: 'keyword-rank', beforeMedian, afterMedian, verdict: verdictForRank(beforeMedian, afterMedian) };
}

/** Same comparison on Best Seller Rank, for price and category changes. */
export function attributeBsrChange(observations: BsrObservation[], changeAt: Date, now: Date, windowDays = ATTRIBUTION_WINDOW_DAYS): RecommendationOutcome | null {
  const ranked = observations.filter((observation): observation is { observedAt: Date; bsr: number } => observation.bsr !== null);
  const { before, after, complete } = windows(ranked, changeAt, windowDays);
  if (!complete(now)) return null;
  const measuredAt = now.toISOString();
  if (before.length < MIN_OBSERVATIONS_PER_WINDOW || after.length < MIN_OBSERVATIONS_PER_WINDOW) {
    return { measuredAt, metric: 'bsr', beforeMedian: null, afterMedian: null, verdict: 'insufficient-data' };
  }
  const beforeMedian = median(before.map((observation) => observation.bsr));
  const afterMedian = median(after.map((observation) => observation.bsr));
  const relative = (beforeMedian - afterMedian) / beforeMedian;
  const verdict = relative >= MOVED_MIN_BSR_RELATIVE ? 'moved' : relative <= -MOVED_MIN_BSR_RELATIVE ? 'worse' : 'flat';
  return { measuredAt, metric: 'bsr', beforeMedian, afterMedian, verdict };
}
