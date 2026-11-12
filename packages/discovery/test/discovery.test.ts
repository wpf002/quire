import { describe, expect, it } from 'vitest';
import {
  type KeywordSuggestionProvider,
  SampleCategoryProvider,
  SampleMarketProvider,
  bsrForDailySales,
  categoryFit,
  demandScore,
  keywordBoxText,
  ebookRoyaltyCents,
  estimateDailySales,
  expandSeeds,
  expansionPhrases,
  isUsableKeyword,
  namesAnAuthor,
  packKeywordBoxes,
  paperbackRoyaltyCents,
  pickDraftCategories,
  printCostCents,
  rankCategories,
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

  it('fills the draft with the least crowded lists when none are winnable', () => {
    // Regression: live Amazon lists were all crowded, so the draft shipped with zero categories.
    const lists = [
      { path: 'busy', bsrFirst: 2, bsrTenth: 547 },
      { path: 'easier', bsrFirst: 122, bsrTenth: 2_925 },
      { path: 'ghost', bsrFirst: 900_000, bsrTenth: 2_000_000 },
      { path: 'winnable', bsrFirst: 8_000, bsrTenth: 60_000 },
    ];
    expect(pickDraftCategories(rankCategories(lists, 3), 3).map((category) => category.path)).toEqual(['winnable', 'easier', 'busy']);
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

  it('tracks the full search phrase while the box holds only new words', () => {
    const boxes = packKeywordBoxes(
      [
        { keyword: 'fantasy romance', score: 0.9, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' },
        { keyword: 'dark fantasy romance', score: 0.8, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' },
      ],
      'The Salt Road',
      null,
    );
    expect(boxes[0]!.text).toBe('fantasy romance dark');
    expect(boxes[0]!.phrases).toEqual(['fantasy romance', 'dark fantasy romance']);
  });

  it('rebuilds box text from phrases without title words or repeats', () => {
    expect(keywordBoxText(['dark fantasy romance', 'salt flats fantasy'], 'The Salt Road', null)).toBe('dark fantasy romance flats');
  });

  it('backs long seeds off to their last two words and adds the genre', () => {
    expect(expansionPhrases(['Small Town Baker Sleuth', 'cozy mystery'], 'Cozy Mystery')).toEqual([
      'small town baker sleuth',
      'baker sleuth',
      'cozy mystery',
    ]);
  });

  it('drops free, box set, numbered and title-length suggestions', () => {
    expect(isUsableKeyword('cozy mystery with cats')).toBe(true);
    expect(isUsableKeyword('cozy mystery free')).toBe(false);
    expect(isUsableKeyword('cozy mystery box set')).toBe(false);
    expect(isUsableKeyword('cozy mystery book 1')).toBe(false);
    expect(isUsableKeyword('the case of the missing cupcake a cozy mystery')).toBe(false);
  });

  // Regression: a live run packed "prime reading", "unlimited" and "top 100" into the boxes, which KDP rejects.
  it('rejects Amazon program and format terms', () => {
    for (const phrase of ['cozy mystery prime reading', 'cozy mystery kindle unlimited', 'top 100 cozy mysteries', 'cozy mystery paperbacks']) {
      expect(isUsableKeyword(phrase)).toBe(false);
    }
  });

  // Regression: a live run kept "cozy mysteries michael connelly" and packed the name into a box.
  it('flags keywords that name an author from the top results', () => {
    const authors = ['Michael Connelly', 'K.M. Morgan', 'Cher'];
    expect(namesAnAuthor('cozy mysteries michael connelly', authors)).toBe(true);
    expect(namesAnAuthor('k m morgan cozy mystery', authors)).toBe(true);
    expect(namesAnAuthor('cozy mystery cherry pie', authors)).toBe(false);
    expect(namesAnAuthor('michaela connelly street', authors)).toBe(false);
  });

  it('expands with letter suffixes and interleaves phrases', async () => {
    const lettered: KeywordSuggestionProvider = {
      name: 'lettered',
      async suggest(prefix) {
        const match = /^(.*) ([a-z])$/.exec(prefix);
        if (!match) return { prefix, suggestions: [] };
        return { prefix, suggestions: [`${match[1]} ${match[2]}${match[2]}`, `${match[1]} free`] };
      },
    };
    const candidates = await expandSeeds(['baker sleuth'], lettered, 'kindle', 6, 'cozy mystery');
    expect(candidates).toEqual(['baker sleuth', 'cozy mystery', 'baker sleuth aa', 'cozy mystery aa', 'baker sleuth bb', 'cozy mystery bb']);
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
