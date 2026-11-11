import { createHash } from 'node:crypto';
import { type RankProvider, type RankSnapshot, TRACKED_DEPTH, type TrackedMetadata } from './types';

const DAY_MS = 86_400_000;
const CATEGORY_SEPARATOR = /\s[›>]\s/;

function unit(input: string): number {
  return createHash('sha256').update(input).digest().readUInt32BE(0) / 2 ** 32;
}

/**
 * Deterministic rank simulator. Keywords present in the live metadata climb toward a
 * per-keyword floor over ~10 days after the metadata was applied; absent keywords stay unranked.
 * Labeled "sample" everywhere it appears. Use it to exercise the loop, never to judge a book.
 */
export class SampleRankProvider implements RankProvider {
  readonly name = 'sample';

  async observe(metadata: TrackedMetadata, keywords: string[], at: Date): Promise<RankSnapshot> {
    const day = Math.floor(at.getTime() / DAY_MS);
    const daysLive = Math.max(0, (at.getTime() - metadata.appliedAt.getTime()) / DAY_MS);
    const indexed = metadata.keywordBoxes.join(' ').toLowerCase() + ' ' + metadata.title.toLowerCase();
    const ranks = keywords.map((keyword) => {
      const words = keyword.toLowerCase().split(' ');
      const present = words.every((word) => indexed.includes(word));
      const affinity = unit(`${metadata.bookId}:${keyword}`);
      if (!present || affinity < 0.25) return { keyword, rank: null };
      const floor = 2 + Math.round(affinity * 40);
      const ramp = Math.min(1, daysLive / 10);
      const noise = Math.round((unit(`${keyword}:${day}`) - 0.5) * 6);
      const rank = Math.round(TRACKED_DEPTH - (TRACKED_DEPTH - floor) * ramp) + noise;
      return { keyword, rank: rank > TRACKED_DEPTH ? null : Math.max(1, rank) };
    });
    const bsrBase = 20_000 + unit(metadata.bookId) * 300_000;
    const bsr = Math.round(bsrBase * (1 - 0.4 * Math.min(1, daysLive / 14)) * (0.85 + 0.3 * unit(`bsr:${metadata.bookId}:${day}`)));
    // A leaf category holds a slice of the store, so its rank is the BSR divided by a per-category factor.
    const categoryRanks = metadata.categories.map((path) => {
      const category = path.split(CATEGORY_SEPARATOR).at(-1) ?? path;
      return { category, rank: Math.max(1, Math.round(bsr / (150 + unit(`cat:${path}`) * 1_500))) };
    });
    return { observedAt: at, bsr, ranks, categoryRanks };
  }
}
