import { z } from 'zod';
import {
  AMAZON_ORIGIN,
  type FetchHtml,
  bestsellerAsins,
  bestsellerListName,
  fetchAmazonPage,
  organicResults,
  parseBestSellersRank,
  parseCategoryLinks,
  searchResultCount,
} from './amazon-pages';
import { getJson } from './http';
import type {
  CategoryProvider,
  CategoryThresholds,
  KeywordMarket,
  KeywordSuggestionProvider,
  KeywordSuggestions,
  MarketDataProvider,
  Storefront,
} from './providers';

// Amazon's public search-box autocomplete for amazon.com. Same data a shopper sees while typing.
const COMPLETION_URL = 'https://completion.amazon.com/api/2017/suggestions';
const US_MARKETPLACE = 'ATVPDKIKX0DER';
const ALIAS: Record<Storefront, string> = { kindle: 'digital-text', books: 'stripbooks' };

const CompletionSchema = z.object({
  suggestions: z.array(z.object({ value: z.string() })).default([]),
});

export class AmazonAutocompleteProvider implements KeywordSuggestionProvider {
  readonly name = 'amazon-autocomplete';

  async suggest(prefix: string, storefront: Storefront): Promise<KeywordSuggestions> {
    const params = new URLSearchParams({
      mid: US_MARKETPLACE,
      alias: ALIAS[storefront],
      prefix,
      'suggestion-type': 'KEYWORD',
      'page-type': 'Search',
      'lop': 'en_US',
      'site-variant': 'desktop',
      'client-info': 'amazon-search-ui',
    });
    const body = CompletionSchema.parse(await getJson(this.name, `${COMPLETION_URL}?${params}`));
    return { prefix, suggestions: body.suggestions.map((suggestion) => suggestion.value.toLowerCase().trim()).filter(Boolean) };
  }
}

/** Pause between amazon.com page loads so a discovery run stays at a human browsing pace. */
const PAGE_GAP_MS = 2_500;
const SEARCH_INDEX: Record<Storefront, string> = { kindle: 'digital-text', books: 'stripbooks' };
const TOP_TITLES = 10;

/** Spaces page loads at least gapMs apart. One instance is shared by every provider that reads amazon.com pages. */
export class PacedPageFetcher {
  private lastRequestAt = 0;

  constructor(
    private readonly fetchHtml: FetchHtml = (url) => fetchAmazonPage('amazon-page', url),
    private readonly gapMs: number = PAGE_GAP_MS,
  ) {}

  async get(url: string): Promise<string> {
    const wait = this.lastRequestAt + this.gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    return this.fetchHtml(url);
  }
}

function searchUrl(query: string, storefront: Storefront): string {
  return `${AMAZON_ORIGIN}/s?${new URLSearchParams({ k: query, i: SEARCH_INDEX[storefront] })}`;
}

/**
 * Result count, titles, ratings and prices from the first amazon.com search page.
 * BSR isn't on search pages and one product page per title is too slow, so bsr is null here.
 */
export class AmazonMarketProvider implements MarketDataProvider {
  readonly name = 'amazon-search';

  constructor(private readonly pages: PacedPageFetcher = new PacedPageFetcher()) {}

  async market(keyword: string, storefront: Storefront): Promise<KeywordMarket> {
    const html = await this.pages.get(searchUrl(keyword, storefront));
    const topTitles = organicResults(html)
      .slice(0, TOP_TITLES)
      .map((result) => ({ title: result.title, bsr: null, reviews: result.reviews, priceCents: result.priceCents }));
    return { keyword, resultCount: searchResultCount(html), topTitles };
  }
}

/** Top results per query, and in total, whose product pages seed the category list. */
const SEED_BOOKS_PER_QUERY = 2;
const MAX_SEED_BOOKS = 4;
const MAX_CATEGORIES = 6;
/** The #10 book sets the bar for a top-10 slot. */
const TENTH_PLACE = 10;
const LIST_ROOT: Record<string, string> = { 'digital-text': 'Kindle Store › Kindle eBooks', books: 'Books' };
/** Bestseller stores that count for each storefront. Kindle books also list print-store categories. */
const STORES: Record<Storefront, string[]> = { kindle: ['digital-text', 'books'], books: ['books'] };

/**
 * Categories from the bestseller lists that the top books for the book's keywords rank in.
 * Lists more seed books share come first. For each list it reads the #1 and #10 books' overall BSR from their product pages.
 */
export class AmazonCategoryProvider implements CategoryProvider {
  readonly name = 'amazon-bestsellers';

  constructor(private readonly pages: PacedPageFetcher = new PacedPageFetcher()) {}

  async categories(queries: string[], storefront: Storefront): Promise<CategoryThresholds[]> {
    const productPages = new Map<string, string>();
    const productPage = async (asin: string) => {
      const cached = productPages.get(asin);
      if (cached !== undefined) return cached;
      const html = await this.pages.get(`${AMAZON_ORIGIN}/dp/${asin}`);
      productPages.set(asin, html);
      return html;
    };

    const seedAsins = new Set<string>();
    for (const query of queries) {
      if (seedAsins.size >= MAX_SEED_BOOKS) break;
      const results = organicResults(await this.pages.get(searchUrl(query, storefront)));
      for (const result of results.slice(0, SEED_BOOKS_PER_QUERY)) if (seedAsins.size < MAX_SEED_BOOKS) seedAsins.add(result.asin);
    }
    const lists = new Map<string, { store: string; node: string; name: string; seedBooks: number }>();
    for (const asin of seedAsins) {
      for (const link of parseCategoryLinks(await productPage(asin))) {
        if (!link.store || !link.node || !STORES[storefront].includes(link.store)) continue;
        const known = lists.get(link.node);
        if (known) known.seedBooks += 1;
        else lists.set(link.node, { store: link.store, node: link.node, name: link.category, seedBooks: 1 });
      }
    }
    const shared = [...lists.values()].sort((left, right) => right.seedBooks - left.seedBooks).slice(0, MAX_CATEGORIES);

    const thresholds: CategoryThresholds[] = [];
    for (const list of shared) {
      const listPage = await this.pages.get(`${AMAZON_ORIGIN}/gp/bestsellers/${list.store}/${list.node}`);
      const ranked = bestsellerAsins(listPage);
      if (ranked.length < TENTH_PLACE) continue;
      const bsrFirst = parseBestSellersRank(await productPage(ranked[0]!));
      const bsrTenth = parseBestSellersRank(await productPage(ranked[TENTH_PLACE - 1]!));
      if (bsrFirst === null || bsrTenth === null) continue;
      const name = bestsellerListName(listPage) ?? list.name;
      thresholds.push({ path: `${LIST_ROOT[list.store] ?? 'Books'} › ${name}`, bsrFirst, bsrTenth });
    }
    return thresholds;
  }
}
