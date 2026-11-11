import { describe, expect, it } from 'vitest';
import type { KeywordScore } from '@quire/discovery';
import { type RankObservation, SampleRankProvider, attributeKeywordChange, deadPhrases, reoptimize, verdictForRank } from '../src';

const DAY = 86_400_000;
const start = new Date('2026-03-01T00:00:00Z');
const dayAt = (offset: number) => new Date(start.getTime() + offset * DAY);

function series(keyword: string, ranks: Array<number | null>, from = 0): RankObservation[] {
  return ranks.map((rank, index) => ({ keyword, rank, observedAt: dayAt(from + index) }));
}

describe('verdictForRank', () => {
  it('requires both 20% and 5 positions to call it moved', () => {
    expect(verdictForRank(40, 30)).toBe('moved');
    expect(verdictForRank(8, 5)).toBe('flat');
    expect(verdictForRank(100, 96)).toBe('flat');
    expect(verdictForRank(20, 35)).toBe('worse');
  });
});

describe('attributeKeywordChange', () => {
  const observations = series('cozy mystery', [60, 62, 58, 61, 59, 60, 63, 40, 35, 30, 28, 27, 25, 24]);
  it('waits for the after window to finish', () => {
    expect(attributeKeywordChange(observations, 'cozy mystery', dayAt(7), dayAt(10))).toBeNull();
  });
  it('reports the before/after medians once complete', () => {
    const outcome = attributeKeywordChange(observations, 'cozy mystery', dayAt(7), dayAt(14));
    expect(outcome?.beforeMedian).toBe(60);
    expect(outcome?.afterMedian).toBe(28);
    expect(outcome?.verdict).toBe('moved');
  });
});

const candidate = (keyword: string, score: number): KeywordScore => ({ keyword, score, demand: 1, competition: 0, resultCount: 1, topSalesPerDay: 1, source: 's' });

describe('reoptimize', () => {
  const now = dayAt(20);
  const observations = [...series('dead phrase', Array(16).fill(null), 4), ...series('live phrase', Array(16).fill(12), 4)];

  it('finds phrases unranked for 14 days', () => {
    expect(deadPhrases(observations, ['dead phrase', 'live phrase'], now)).toEqual(['dead phrase']);
  });

  it('recommends a swap, a winnable category and a price raise', () => {
    const results = reoptimize({
      now,
      keywordBoxes: ['dead phrase live phrase'],
      boxPhrases: [['dead phrase', 'live phrase']],
      observations,
      candidates: [candidate('lighthouse sleuth', 0.8), candidate('live phrase', 0.9)],
      currentCategories: ['Books › Mystery › Cozy'],
      categoryThresholds: [
        { path: 'Books › Mystery › Cozy', bsrFirst: 50, bsrTenth: 400 },
        { path: 'Books › Mystery › Culinary', bsrFirst: 9_000, bsrTenth: 70_000 },
      ],
      currentBsr: 30_000,
      paperback: { priceCents: 899, pages: 280 },
    });
    expect(results.map((result) => result.payload.kind)).toEqual(['swap-keyword', 'switch-category', 'raise-price']);
    expect(results[0]?.payload).toMatchObject({ remove: 'dead phrase', add: 'lighthouse sleuth', boxIndex: 0 });
    expect(results[1]?.payload).toMatchObject({ from: 'Books › Mystery › Cozy', to: 'Books › Mystery › Culinary' });
  });
});

describe('SampleRankProvider', () => {
  it('ranks keywords that are in the metadata and improves them over time', async () => {
    const provider = new SampleRankProvider();
    const metadata = { bookId: 'book-1', asin: null, title: 'Crumbs', keywordBoxes: ['cozy mystery cats', 'amateur sleuth bakery'], categories: [], appliedAt: start };
    const keywords = ['cozy mystery', 'amateur sleuth', 'cats', 'bakery', 'space opera'];
    const early = await provider.observe(metadata, keywords, dayAt(1));
    const late = await provider.observe(metadata, keywords, dayAt(12));
    expect(late.ranks.find((rank) => rank.keyword === 'space opera')?.rank).toBeNull();
    const improved = late.ranks.filter((rank, index) => rank.rank !== null && (early.ranks[index]?.rank ?? 101) > rank.rank);
    expect(improved.length).toBeGreaterThan(0);
  });
});
