/**
 * Every outside data source sits behind one of these interfaces so a source can be swapped
 * or combined without touching scoring. Providers return what they observed and say where it came from.
 */
export type Storefront = 'kindle' | 'books';

export interface KeywordSuggestions {
  prefix: string;
  suggestions: string[];
}

export interface KeywordSuggestionProvider {
  readonly name: string;
  suggest(prefix: string, storefront: Storefront): Promise<KeywordSuggestions>;
}

export interface CompetingTitle {
  title: string;
  authors: string[];
  bsr: number | null;
  reviews: number | null;
  priceCents: number | null;
}

export interface KeywordMarket {
  keyword: string;
  resultCount: number | null;
  topTitles: CompetingTitle[];
}

export interface MarketDataProvider {
  readonly name: string;
  market(keyword: string, storefront: Storefront): Promise<KeywordMarket>;
}

export interface CategoryThresholds {
  path: string;
  /** BSR of the #1 and #10 books in the category. */
  bsrFirst: number;
  bsrTenth: number;
}

export interface CategoryProvider {
  readonly name: string;
  /** queries run most specific first, with the genre last. */
  categories(queries: string[], storefront: Storefront): Promise<CategoryThresholds[]>;
}

export interface DiscoveryProviders {
  suggestions: KeywordSuggestionProvider;
  market: MarketDataProvider;
  categories: CategoryProvider;
}
