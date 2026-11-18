import { describe, expect, it } from 'vitest';
import {
  type CategoryProvider,
  type KeywordSuggestionProvider,
  type MarketDataProvider,
  SampleCategoryProvider,
  SampleMarketProvider,
  SampleSuggestionProvider,
  bsrForDailySales,
  categoryFit,
  demandScore,
  describesBook,
  keywordBoxText,
  ebookRoyaltyCents,
  estimateDailySales,
  expandSeeds,
  expansionPhrases,
  fitsNiche,
  isUsableKeyword,
  namesASeries,
  namesAnAuthor,
  nicheWords,
  packKeywordBoxes,
  paperbackRoyaltyCents,
  pickDraftCategories,
  printCostCents,
  rankCategories,
  recommendPaperbackPrice,
  runDiscovery,
  titleTags,
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
    // Regression: "cozy bakery mystery" alone autocompleted to five phrases, all made of subtitle words, and filled one box.
    expect(expansionPhrases(['cozy bakery mystery'], 'Mystery')).toEqual(['cozy bakery mystery', 'bakery mystery', 'cozy mystery', 'mystery']);
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
  it('rejects autocomplete store labels but keeps punctuated search phrases', () => {
    expect(isUsableKeyword('cozy mystery kindle+')).toBe(false);
    expect(isUsableKeyword("baker's cozy mystery")).toBe(true);
    expect(isUsableKeyword('crafts & hobbies mystery')).toBe(true);
  });

  it('flags keywords that name an author from the top results', () => {
    const authors = ['Michael Connelly', 'K.M. Morgan', 'Cher'];
    expect(namesAnAuthor('cozy mysteries michael connelly', authors)).toBe(true);
    expect(namesAnAuthor('k m morgan cozy mystery', authors)).toBe(true);
    expect(namesAnAuthor('cozy mystery cherry pie', authors)).toBe(false);
    expect(namesAnAuthor('michaela connelly street', authors)).toBe(false);
  });

  // Regression: a live run packed "nora blackwell", "lexy baker" and "ivy creek" (other books' series) into the boxes.
  it('flags keywords that name a series from the top result titles', () => {
    const tags = titleTags(['Fudge and Fatality (A Lexy Baker Cozy Mystery Book 3)', 'Murder at the Mill: Ivy Creek Cozy Mystery Book 5', 'Quilted to Death']);
    const own = ['small town baker sleuth', 'cozy mystery'];
    expect(namesASeries('lexy baker cozy mystery series', tags, own)).toBe(true);
    expect(namesASeries('ivy creek cozy mystery series', tags, own)).toBe(true);
    expect(namesASeries('quilting cozy mystery series', tags, own)).toBe(false);
    expect(namesASeries('cozy mystery london england', tags, own)).toBe(false);
    expect(namesASeries('small town baker cozy mystery', ['A Small Town Baker Mystery'], own)).toBe(false);
  });

  // Regression: a live run scored "mystery at nightshade farm" and "mystery at seagrave hall", which are other books' titles.
  it('flags keywords that repeat a top result title', () => {
    const tags = titleTags(['Mystery at Nightshade Farm', 'Mystery at Seagrave Hall: A Cozy Mystery (Hall Mysteries Book 1)']);
    expect(namesASeries('mystery at nightshade farm', tags, ['mystery'])).toBe(true);
    expect(namesASeries('mystery at seagrave hall', tags, ['mystery'])).toBe(true);
    expect(namesASeries('mystery at the bakery', tags, ['mystery'])).toBe(false);
  });

  // Regression: a live run left boxes 6 and 7 empty once the scored phrases ran out of new words.
  it('fills boxes the scored phrases leave empty from unscored suggestions', () => {
    const scored = [{ keyword: 'cozy mystery with cats', score: 0.9, demand: 1, competition: 0.2, resultCount: 1, topSalesPerDay: 1, source: 's' }];
    const fallback = ['cozy mystery halloween', 'cozy mystery christmas', 'cozy mystery cats', 'cozy mystery scotland'];
    const boxes = packKeywordBoxes(scored, 'Crumbs', null, fallback);
    expect(boxes[0]!.phrases).toEqual(['cozy mystery with cats', 'cozy mystery halloween', 'cozy mystery christmas', 'cozy mystery scotland']);
    expect(boxes[0]!.text).toBe('cozy mystery cats halloween christmas scotland');
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

// Regression: seeding "cozy bakery mystery, mystery" packed "graphic novels kids", "national parks" and "manga" from the bare genre.
describe('niche filter', () => {
  it('keeps phrases that share a seed word beyond the genre', () => {
    const niche = nicheWords(['cozy bakery mystery', 'mystery'], 'Mystery');
    expect([...niche].sort()).toEqual(['bakery', 'cozy']);
    expect(fitsNiche('cozy bakery mysteries', niche)).toBe(true);
    expect(fitsNiche('bakeries mystery series', niche)).toBe(true);
    expect(fitsNiche('mystery graphic novels for kids 9-12', niche)).toBe(false);
    expect(fitsNiche('mystery ranch forager', niche)).toBe(false);
  });

  it('keeps every phrase when the seeds only restate the genre', () => {
    const niche = nicheWords(['mystery books'], 'Mystery');
    expect(niche.size).toBe(0);
    expect(fitsNiche('mystery comics', niche)).toBe(true);
  });

  it('keeps phrases whose extra topics appear in the manuscript', () => {
    const own = new Set(['cozy', 'bakery', 'mystery', 'proving', 'drawer']);
    const book = new Set(['dough', 'oven', 'halloween', 'maggie']);
    expect(describesBook('cozy mystery halloween', own, book)).toBe(true);
    expect(describesBook('cozy bakery mystery series', own, book)).toBe(true);
    expect(describesBook('cozy mysteries in egypt', own, book)).toBe(false);
    expect(describesBook('quilting cozy mystery series', own, book)).toBe(false);  });

  it('treats series as a stop word after plural stemming', () => {
    expect([...nicheWords(['mystery series'], 'Mystery')]).toEqual([]);
  });

  it('scores and queries categories only with phrases the manuscript supports', async () => {
    const suggestions: KeywordSuggestionProvider = {
      name: 'topics',
      async suggest(prefix) {
        const all = ['cozy mystery horses', 'cozy mystery quilting', 'cozy mystery halloween', 'cozy bakery mystery books'];
        return { prefix, suggestions: all.filter((value) => value.startsWith(prefix.trim())) };
      },
    };
    const result = await runDiscovery(
      {
        title: 'The Proving Drawer', subtitle: 'A Cozy Bakery Mystery', genre: 'Mystery', seeds: ['cozy bakery mystery'],
        storefront: 'kindle', expectedDailySales: 3, candidateLimit: 10, bookText: 'Maggie pulled the Halloween loaves from the oven.',
      },
      { suggestions, market: new SampleMarketProvider(), categories: new SampleCategoryProvider() },
    );
    const phrases = [...result.keywords.map((score) => score.keyword), ...result.boxes.flatMap((box) => box.phrases)];
    expect(phrases).toContain('cozy mystery halloween');
    expect(phrases).not.toContain('cozy mystery horses');
    expect(phrases).not.toContain('cozy mystery quilting');
  });

  it('drops category lists for subjects the book does not have', async () => {
    const paths = [
      'Kindle Store › Kindle eBooks › Mystery',
      'Books › Witch & Wizard Mysteries',
      'Books › Cozy Culinary Mysteries',
      'Kindle Store › Kindle eBooks › Cozy Animal Mystery',
    ];
    const categories: CategoryProvider = {
      name: 'fixed',
      async categories() {
        return paths.map((path) => ({ path, bsrFirst: 100, bsrTenth: 1_000 }));
      },
    };
    const input = { title: 'The Proving Drawer', subtitle: null, genre: 'Mystery', seeds: ['cozy mystery'], storefront: 'kindle' as const, expectedDailySales: 3, candidateLimit: 1 };
    const providers = { suggestions: new SampleSuggestionProvider(), market: new SampleMarketProvider(), categories };

    const checked = await runDiscovery({ ...input, bookText: 'Maggie looked up from the dough. She had baked twelve loaves.' }, providers);
    expect(checked.categories.map((category) => category.path).sort()).toEqual(['Books › Cozy Culinary Mysteries', 'Kindle Store › Kindle eBooks › Mystery']);

    const unchecked = await runDiscovery(input, providers);
    expect(unchecked.categories).toHaveLength(paths.length);
  });

  it('drops off-niche suggestions before scoring', async () => {
    const mixed: KeywordSuggestionProvider = {
      name: 'mixed',
      async suggest(prefix) {
        const all = ['mystery comics', 'mystery bakery cozy', 'mystery guest', 'mystery cozy cats'];
        return { prefix, suggestions: all.filter((value) => value.startsWith(prefix.trim())) };
      },
    };
    const result = await runDiscovery(
      { title: 'Crumbs', subtitle: null, genre: 'Mystery', seeds: ['cozy bakery mystery', 'mystery'], storefront: 'kindle', expectedDailySales: 3, candidateLimit: 10 },
      { suggestions: mixed, market: new SampleMarketProvider(), categories: new SampleCategoryProvider() },
    );
    const phrases = result.keywords.map((score) => score.keyword);
    expect(phrases).toContain('mystery bakery cozy');
    expect(phrases).not.toContain('mystery comics');
    expect(phrases).not.toContain('mystery guest');
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

  it('keeps unscored fallback phrases that name a top-result author out of the boxes', async () => {
    const suggestions: KeywordSuggestionProvider = {
      name: 'pool',
      async suggest(prefix) {
        const all = ['cozy mystery cats', 'cozy mystery jen pitts', 'cozy mystery bakery'];
        return { prefix, suggestions: all.filter((value) => value.startsWith(prefix.trim())) };
      },
    };
    const market: MarketDataProvider = {
      name: 'byline',
      async market(keyword) {
        return { keyword, resultCount: 2_000, topTitles: [{ title: 'Crumbs & Clues', authors: ['Jen Pitts'], bsr: null, reviews: 40, priceCents: 299 }] };
      },
    };
    const result = await runDiscovery(
      { title: 'Crumbs', subtitle: null, genre: 'Cozy Mystery', seeds: ['cozy mystery'], storefront: 'kindle', expectedDailySales: 3, candidateLimit: 1 },
      { suggestions, market, categories: new SampleCategoryProvider() },
    );
    const boxed = result.boxes.flatMap((box) => box.phrases);
    expect(boxed).not.toContain('cozy mystery jen pitts');
    expect(boxed.some((phrase) => phrase !== result.keywords[0]?.keyword)).toBe(true);
  });
});
