import { type CategoryFitResult, categoryMatchesBook, rankCategories } from './categories';
import { type KeywordScore, bookTopics, combineScore, competitionScore, demandScore, describesBook, expandSeeds, fitsNiche, median, namesASeries, namesAnAuthor, nicheWords, titleTags, topicWords } from './keywords';
import { type KeywordBox, packKeywordBoxes } from './metadata';
import type { DiscoveryProviders, Storefront } from './providers';

/** The best keywords describe this book more closely than its genre does, so they seed the category search. */
const CATEGORY_KEYWORD_QUERIES = 2;
/**
 * Autocomplete returns far more phrases than we can score at a human page pace. The unscored rest
 * only fill keyword boxes the scored phrases leave empty, and cost no extra requests.
 */
const SUGGESTION_POOL_LIMIT = 300;

export interface DiscoveryInput {
  title: string;
  subtitle: string | null;
  genre: string;
  seeds: string[];
  storefront: Storefront;
  expectedDailySales: number;
  candidateLimit: number;
  /** Manuscript text. Without it, phrases aren't checked against what the book covers. */
  bookText?: string;
}

export interface DiscoveryResult {
  keywords: KeywordScore[];
  boxes: KeywordBox[];
  categories: CategoryFitResult[];
  compMedianPriceCents: number | null;
  sources: string[];
}

export async function runDiscovery(input: DiscoveryInput, providers: DiscoveryProviders): Promise<DiscoveryResult> {
  const niche = nicheWords(input.seeds, input.genre);
  const expanded = await expandSeeds(input.seeds, providers.suggestions, input.storefront, Math.max(input.candidateLimit, SUGGESTION_POOL_LIMIT), input.genre);
  const ownWords = topicWords([...input.seeds, input.genre, input.title, input.subtitle ?? ''].join(' '));
  const book = input.bookText === undefined ? null : bookTopics(input.bookText);
  const pool = expanded.filter((phrase) => fitsNiche(phrase, niche) && (book === null || describesBook(phrase, ownWords, book)));
  const candidates = pool.slice(0, input.candidateLimit);
  const keywords: KeywordScore[] = [];
  const compPrices: number[] = [];
  const authors = new Set<string>();
  const titles = new Set<string>();
  for (const keyword of candidates) {
    const [demand, market] = await Promise.all([
      demandScore(keyword, providers.suggestions, input.storefront),
      providers.market.market(keyword, input.storefront),
    ]);
    const { competition, topSalesPerDay } = competitionScore(market);
    market.topTitles.forEach((title) => {
      titles.add(title.title);
      title.authors.forEach((author) => authors.add(author));
    });
    compPrices.push(...market.topTitles.flatMap((title) => (title.priceCents === null ? [] : [title.priceCents])));
    keywords.push({
      keyword,
      demand,
      competition,
      score: combineScore(demand, competition),
      resultCount: market.resultCount,
      topSalesPerDay,
      source: `${providers.suggestions.name} + ${providers.market.name}`,
    });
  }
  const tags = titleTags(titles);
  const allowed = (phrase: string) => !namesAnAuthor(phrase, authors) && !namesASeries(phrase, tags, [...input.seeds, input.genre]);
  const usable = keywords.filter((score) => allowed(score.keyword)).sort((left, right) => right.score - left.score);
  const fallback = pool.slice(input.candidateLimit).filter(allowed);
  const categoryQueries = [...new Set([...usable.slice(0, CATEGORY_KEYWORD_QUERIES).map((score) => score.keyword), input.genre.toLowerCase()])];
  const foundCategories = await providers.categories.categories(categoryQueries, input.storefront);
  const matchingCategories = book === null ? foundCategories : foundCategories.filter((category) => categoryMatchesBook(category.path, ownWords, book));
  const categories = rankCategories(matchingCategories, input.expectedDailySales);
  return {
    keywords: usable,
    boxes: packKeywordBoxes(usable, input.title, input.subtitle, fallback),
    categories,
    compMedianPriceCents: compPrices.length > 0 ? Math.round(median(compPrices)) : null,
    sources: [...new Set([providers.suggestions.name, providers.market.name, providers.categories.name])],
  };
}
