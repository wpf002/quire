import {
  AMAZON_ORIGIN,
  AmazonBlockedError,
  type FetchHtml,
  fetchAmazonPage,
  hasNextPage,
  organicAsins,
  parseBestSellersRank,
  parseCategoryRanks,
} from '@quire/discovery';
import { type RankProvider, type RankSnapshot, TRACKED_DEPTH, type TrackedMetadata } from './types';

export { type FetchHtml, isBlockedPage, organicAsins, parseBestSellersRank, parseCategoryRanks } from '@quire/discovery';

const KINDLE_SEARCH_INDEX = 'digital-text';
/** Pause between page loads so a daily sweep stays at a human browsing pace. */
const REQUEST_GAP_MS = 2_500;
/** About 16 organic results per page, so 7 pages covers TRACKED_DEPTH. */
const MAX_SEARCH_PAGES = Math.ceil(TRACKED_DEPTH / 16);

export class RankProviderError extends Error {
  constructor(message: string) {
    super(`amazon-page: ${message}`);
    this.name = 'RankProviderError';
  }
}

/** Amazon served a captcha or robot check. The sweep stops for the day instead of recording bad data. */
export class RankProviderBlockedError extends RankProviderError {}

export async function fetchAmazonHtml(url: string): Promise<string> {
  try {
    return await fetchAmazonPage('amazon-page', url);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/^amazon-page: /, '');
    if (error instanceof AmazonBlockedError) throw new RankProviderBlockedError(reason);
    throw new RankProviderError(reason);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads public amazon.com pages: the product page for BSR, Kindle search pages for keyword rank.
 * No proxies, no captcha handling. A robot check aborts the observation so no day is recorded with bad data.
 */
export class AmazonPageRankProvider implements RankProvider {
  readonly name = 'amazon-page';

  constructor(
    private readonly fetchHtml: FetchHtml = fetchAmazonHtml,
    private readonly gapMs: number = REQUEST_GAP_MS,
  ) {}

  async observe(metadata: TrackedMetadata, keywords: string[], at: Date): Promise<RankSnapshot> {
    const asin = metadata.asin;
    if (!asin) throw new RankProviderError(`book ${metadata.bookId} has no ASIN`);
    const productPage = await this.fetchHtml(`${AMAZON_ORIGIN}/dp/${asin}`);
    const ranks: RankSnapshot['ranks'] = [];
    for (const keyword of keywords) ranks.push({ keyword, rank: await this.keywordRank(asin, keyword) });
    return { observedAt: at, bsr: parseBestSellersRank(productPage), ranks, categoryRanks: parseCategoryRanks(productPage) };
  }

  /** Organic position of the ASIN for a keyword, or null when it's not in the first TRACKED_DEPTH results. */
  async keywordRank(asin: string, keyword: string): Promise<number | null> {
    let seen = 0;
    for (let page = 1; page <= MAX_SEARCH_PAGES && seen < TRACKED_DEPTH; page += 1) {
      await sleep(this.gapMs);
      const params = new URLSearchParams({ k: keyword, i: KINDLE_SEARCH_INDEX, page: String(page) });
      const html = await this.fetchHtml(`${AMAZON_ORIGIN}/s?${params}`);
      const asins = organicAsins(html);
      const index = asins.indexOf(asin);
      if (index >= 0) {
        const rank = seen + index + 1;
        return rank <= TRACKED_DEPTH ? rank : null;
      }
      seen += asins.length;
      if (asins.length === 0 || !hasNextPage(html)) break;
    }
    return null;
  }
}
