import { describe, expect, it } from 'vitest';
import {
  type KeywordSuggestionProvider,
  SampleCategoryProvider,
  SampleMarketProvider,
  bsrForDailySales,
  categoryFit,
  demandScore,
  ebookRoyaltyCents,
  estimateDailySales,
  packKeywordBoxes,
  paperbackRoyaltyCents,
  printCostCents,
  recommendPaperbackPrice,
  runDiscovery,
  validateMetadata,
} from '../src';

describe('sales estimates', () => {
  it('hits the anchors and inverts', () => {
    expect(estimateDailySales(1_000)).toBeCloseTo(100);
    expect(estimateDailySales(100_000)).toBeCloseTo(1);
    expect(estimateDailySales(3_000)).toBeLessThan(100);
    expect(estimateDailySales(3_000)).toBeGreaterThan(15);
    expect(Math.abs(bsrForDailySales(15) - 10_000)).toBeLessThan(50);
  });
});

describe('pricing', () => {
  it('computes print cost tiers', () => {
    expect(printCostCents(100)).toBe(230);
    expect(printCostCents(300)).toBe(460);
  });

  it('shows $9.99 beats $9.49 under the 50% tier', () => {
    expect(paperbackRoyaltyCents(949, 300)).toBe(14);
    expect(paperbackRoyaltyCents(999, 300)).toBe(139);
  });

  it('never recommends a paperback price in the dead zone', () => {
    const recommendation = recommendPaperbackPrice({ pages: 300, compMedianCents: 949 });
    expect(recommendation.recommendedCents).toBe(999);
  });

  it('applies the 35% rate outside the ebook band', () => {
    expect(ebookRoyaltyCents(99, 1)).toBe(34);
    expect(ebookRoyaltyCents(399, 1)).toBe(264);
  });
});

describe('category fit', () => {
  it('labels ghost, winnable and crowded categories', () => {
    expect(categoryFit({ path: 'a', bsrFirst: 900_000, bsrTenth: 2_000_000 }, 3).fit).toBe('ghost');
    expect(categoryFit({ path: 'b', bsrFirst: 8_000, bsrTenth: 60_000 }, 3).fit).toBe('winnable');
    expect(categoryFit({ path: 'c', bsrFirst: 20, bsrTenth: 300 }, 3).fit).toBe('crowded');
  });
});

const fixedProvider: KeywordSuggestionProvider = {
  name: 'fixed',
  async suggest(prefix) {
    const all = ['cozy mystery', 'cozy mystery series', 'cozy mystery books', 'cozy mystery with cats'];
    return { prefix, suggestions: all.filter((value) => value.startsWith(prefix.trim())) };
  },
};

describe('keywords', () => {
  it('scores demand by the shortest prefix that surfaces a phrase', async () => {
    expect(await demandScore('cozy mystery', fixedProvider, 'kindle')).toBe(1);
    expect(await demandScore('haunted lighthouse romance', fixedProvider, 'kindle')).toBe(0);
  });

  it('packs boxes within 50 chars and skips title words and banned terms', () => {
    const boxes = packKeywordBoxes(
      [
        { keyword: 'cozy mystery with cats', score: 0.9, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' },
        { keyword: 'amateur sleuth bakery', score: 0.8, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' },
        { keyword: 'kindle unlimited mystery', score: 0.7, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' },
      ],
      'The Bakery Murders',
      'A Cozy Mystery',
    );
    const text = boxes.map((box) => box.text).join(' ');
    expect(text).toContain('cats');
    expect(text).not.toContain('bakery');
    expect(text).not.toContain('unlimited');
    expect(boxes).toHaveLength(7);
    expect(boxes.every((box) => box.text.length <= 50)).toBe(true);
  });

  it('flags over-length metadata', () => {
    expect(validateMetadata({ title: 't', subtitle: null, description: 'x'.repeat(4_001), keywords: ['a'.repeat(51)] })).toHaveLength(2);
  });
});

describe('runDiscovery', () => {
  it('produces ranked keywords, boxes and categories', async () => {
    const result = await runDiscovery(
      { title: 'Crumbs', subtitle: null, genre: 'Cozy Mystery', seeds: ['cozy mystery'], storefront: 'kindle', expectedDailySales: 3, candidateLimit: 10 },
      { suggestions: fixedProvider, market: new SampleMarketProvider(), categories: new SampleCategoryProvider() },
    );
    expect(result.keywords.length).toBeGreaterThan(1);
    expect(result.categories.length).toBeGreaterThan(0);
    expect(result.boxes[0]?.text.length).toBeGreaterThan(0);
    expect(result.sources).toContain('fixed');
  });
});
