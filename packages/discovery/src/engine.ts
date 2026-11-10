import { type CategoryFitResult, rankCategories } from './categories';
import { type KeywordScore, combineScore, competitionScore, demandScore, expandSeeds, median } from './keywords';
import { type KeywordBox, packKeywordBoxes } from './metadata';
import type { DiscoveryProviders, Storefront } from './providers';

export interface DiscoveryInput {
  title: string;
  subtitle: string | null;
  genre: string;
  seeds: string[];
  storefront: Storefront;
  expectedDailySales: number;
  candidateLimit: number;
}

export interface DiscoveryResult {
  keywords: KeywordScore[];
  boxes: KeywordBox[];
  categories: CategoryFitResult[];
  compMedianPriceCents: number | null;
  sources: string[];
}

export async function runDiscovery(input: DiscoveryInput, providers: DiscoveryProviders): Promise<DiscoveryResult> {
  const candidates = await expandSeeds(input.seeds, providers.suggestions, input.storefront, input.candidateLimit);
  const keywords: KeywordScore[] = [];
  const compPrices: number[] = [];
  for (const keyword of candidates) {
    const [demand, market] = await Promise.all([
      demandScore(keyword, providers.suggestions, input.storefront),
      providers.market.market(keyword, input.storefront),
    ]);
    const { competition, topSalesPerDay } = competitionScore(market);
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
  keywords.sort((left, right) => right.score - left.score);
  const categories = rankCategories(await providers.categories.categories(input.genre, input.storefront), input.expectedDailySales);
  return {
    keywords,
    boxes: packKeywordBoxes(keywords, input.title, input.subtitle),
    categories,
    compMedianPriceCents: compPrices.length > 0 ? Math.round(median(compPrices)) : null,
    sources: [...new Set([providers.suggestions.name, providers.market.name, providers.categories.name])],
  };
}
