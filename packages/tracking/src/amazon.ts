import { type RankProvider, type RankSnapshot, TRACKED_DEPTH, type TrackedMetadata } from './types';

const AMAZON_ORIGIN = 'https://www.amazon.com';
const KINDLE_SEARCH_INDEX = 'digital-text';
const REQUEST_TIMEOUT_MS = 15_000;
/** Pause between page loads so a daily sweep stays at a human browsing pace. */
const REQUEST_GAP_MS = 2_500;
/** About 16 organic results per page, so 7 pages covers TRACKED_DEPTH. */
const MAX_SEARCH_PAGES = Math.ceil(TRACKED_DEPTH / 16);
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html',
  'accept-language': 'en-US,en;q=0.9',
};

export class RankProviderError extends Error {
  constructor(message: string) {
    super(`amazon-page: ${message}`);
    this.name = 'RankProviderError';
  }
}

/** Amazon served a captcha or robot check. The sweep stops for the day instead of recording bad data. */
export class RankProviderBlockedError extends RankProviderError {}

export type FetchHtml = (url: string) => Promise<string>;

export function isBlockedPage(html: string): boolean {
  return html.includes('validateCaptcha') || html.includes('api-services-support@amazon.com');
}

/** Overall Best Sellers Rank from a product page, e.g. "#6,640 in Kindle Store". Null when the page has none. */
export function parseBestSellersRank(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const match = /Best Sellers Rank:?\s*#([\d,]+)\s+(?:Free\s+)?in\s/.exec(text);
  return match ? Number(match[1]!.replace(/,/g, '')) : null;
}

/** ASINs of the organic results on one search page, in order. Sponsored slots (AdHolder) are skipped. */
export function organicAsins(html: string): string[] {
  const asins: string[] = [];
  for (const tag of html.match(/<div[^>]*data-component-type="s-search-result"[^>]*>/g) ?? []) {
    if (/class="[^"]*\bAdHolder\b/.test(tag)) continue;
    const asin = /data-asin="([A-Z0-9]{10})"/.exec(tag)?.[1];
    if (asin && !asins.includes(asin)) asins.push(asin);
  }
  return asins;
}

function hasNextPage(html: string): boolean {
  return /class="s-pagination-item s-pagination-next(?![^"]*s-pagination-disabled)/.test(html);
}

export async function fetchAmazonHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 503) throw new RankProviderBlockedError(`HTTP 503 for ${new URL(url).pathname}`);
  if (!response.ok) throw new RankProviderError(`HTTP ${response.status} for ${new URL(url).pathname}`);
  const html = await response.text();
  if (isBlockedPage(html)) throw new RankProviderBlockedError(`robot check on ${new URL(url).pathname}`);
  return html;
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
    const bsr = parseBestSellersRank(await this.fetchHtml(`${AMAZON_ORIGIN}/dp/${asin}`));
    const ranks: RankSnapshot['ranks'] = [];
    for (const keyword of keywords) ranks.push({ keyword, rank: await this.keywordRank(asin, keyword) });
    return { observedAt: at, bsr, ranks };
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
