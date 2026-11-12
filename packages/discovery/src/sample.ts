import { createHash } from 'node:crypto';
import type {
  CategoryProvider,
  CategoryThresholds,
  KeywordMarket,
  KeywordSuggestionProvider,
  KeywordSuggestions,
  MarketDataProvider,
  Storefront,
} from './providers';

/**
 * Deterministic stand-in data, seeded from the input string. Used in tests, in local
 * development without network, and for market data until a licensed source is configured.
 * Every result from here is labeled "sample" in the UI.
 */
function seeded(input: string): () => number {
  let state = createHash('sha256').update(input).digest().readUInt32BE(0);
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const MODIFIERS = ['books', 'for women', 'series', 'kindle unlimited', 'small town', 'standalone', 'clean', 'box set', 'new release', 'bestseller'];

export class SampleSuggestionProvider implements KeywordSuggestionProvider {
  readonly name = 'sample';
  async suggest(prefix: string): Promise<KeywordSuggestions> {
    const random = seeded(prefix);
    const count = 4 + Math.floor(random() * 6);
    const suggestions = MODIFIERS.slice(0, count).map((modifier) => `${prefix.trim()} ${modifier}`);
    return { prefix, suggestions };
  }
}

export class SampleMarketProvider implements MarketDataProvider {
  readonly name = 'sample';
  async market(keyword: string): Promise<KeywordMarket> {
    const random = seeded(`market:${keyword}`);
    const resultCount = Math.round(200 + random() * 60_000);
    const topTitles = Array.from({ length: 10 }, (_, index) => ({
      title: `${keyword} title ${index + 1}`,
      authors: [`Author ${index + 1}`],
      bsr: Math.round(500 * 10 ** (random() * 3.2)),
      reviews: Math.round(random() * 4_000),
      priceCents: [299, 399, 499, 999][Math.floor(random() * 4)] ?? 399,
    }));
    return { keyword, resultCount, topTitles };
  }
}

export class SampleCategoryProvider implements CategoryProvider {
  readonly name = 'sample';
  async categories(queries: string[], storefront: Storefront): Promise<CategoryThresholds[]> {
    const genre = queries.at(-1) ?? 'Fiction';
    const random = seeded(`categories:${genre}:${storefront}`);
    const root = storefront === 'kindle' ? 'Kindle Store › Kindle eBooks' : 'Books';
    const leaves = ['Contemporary', 'Small Town & Rural', 'Holidays', 'Series', 'Clean & Wholesome', 'Women’s Fiction', 'Literary', 'Short Reads'];
    return leaves.map((leaf) => {
      const bsrFirst = Math.round(50 * 10 ** (random() * 4.2));
      return { path: `${root} › ${genre} › ${leaf}`, bsrFirst, bsrTenth: Math.round(bsrFirst * (2 + random() * 12)) };
    });
  }
}
