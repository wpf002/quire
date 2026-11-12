import { ProviderError } from './http';

/** Fetching and parsing for public amazon.com pages. Shared by discovery and rank tracking. */
export const AMAZON_ORIGIN = 'https://www.amazon.com';
const REQUEST_TIMEOUT_MS = 15_000;
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html',
  'accept-language': 'en-US,en;q=0.9',
};

export type FetchHtml = (url: string) => Promise<string>;

/** Amazon served a captcha or robot check. Callers stop instead of recording bad data. */
export class AmazonBlockedError extends ProviderError {}

/** Captcha form, robot-check contact address, or the bot-manager "bm-verify" interstitial. */
const BLOCK_MARKERS = ['validateCaptcha', 'api-services-support@amazon.com', 'bm-verify='];

export function isBlockedPage(html: string): boolean {
  return BLOCK_MARKERS.some((marker) => html.includes(marker));
}

export async function fetchAmazonPage(provider: string, url: string): Promise<string> {
  const path = new URL(url).pathname;
  const response = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 503) throw new AmazonBlockedError(provider, `HTTP 503 for ${path}`);
  if (!response.ok) throw new ProviderError(provider, `HTTP ${response.status} for ${path}`);
  const html = await response.text();
  if (isBlockedPage(html)) throw new AmazonBlockedError(provider, `robot check on ${path}`);
  return html;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Overall Best Sellers Rank from a product page, e.g. "#6,640 in Kindle Store". Null when the page has none. */
export function parseBestSellersRank(html: string): number | null {
  const match = /Best Sellers Rank:?\s*#([\d,]+)\s+(?:Free\s+)?in\s/.exec(plainText(html));
  return match ? Number(match[1]!.replace(/,/g, '')) : null;
}

export interface CategoryRankLink {
  category: string;
  rank: number;
  /** Bestseller list the rank links to: "digital-text" (Kindle) or "books" (print). */
  store: string | null;
  node: string | null;
}

/** Sub-category ranks listed under the overall BSR, e.g. "#27 in Werewolf & Shifter Thrillers". */
export function parseCategoryLinks(html: string): CategoryRankLink[] {
  const list = /<ul[^>]*\bzg_hrsr\b[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  const ranks: CategoryRankLink[] = [];
  for (const item of list.match(/<li[\s\S]*?<\/li>/g) ?? []) {
    const match = /^#([\d,]+)\s+(?:Free\s+)?in\s+(.+)$/.exec(plainText(item));
    if (!match) continue;
    const link = /\/gp\/bestsellers\/([a-z-]+)\/(\d+)/.exec(item);
    ranks.push({ category: match[2]!, rank: Number(match[1]!.replace(/,/g, '')), store: link?.[1] ?? null, node: link?.[2] ?? null });
  }
  return ranks;
}

export function parseCategoryRanks(html: string): Array<{ category: string; rank: number }> {
  return parseCategoryLinks(html).map(({ category, rank }) => ({ category, rank }));
}

/** ASINs of a bestseller list page in rank order, from the list's embedded JSON. */
export function bestsellerAsins(html: string): string[] {
  const ranked: Array<{ asin: string; rank: number }> = [];
  // The attribute is HTML-escaped JSON: [{ id, metadataMap: { "render.zg.rank": "1" } }, ...].
  for (const match of html.matchAll(/data-client-recs-list="([^"]*)"/g)) {
    let entries: unknown;
    try {
      entries = JSON.parse(decodeEntities(match[1]!));
    } catch {
      throw new ProviderError('amazon-pages', 'bestseller list JSON did not parse');
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Array<{ id?: unknown; metadataMap?: Record<string, unknown> }>) {
      const rank = Number(entry.metadataMap?.['render.zg.rank']);
      if (typeof entry.id === 'string' && Number.isInteger(rank)) ranked.push({ asin: entry.id, rank });
    }
  }
  ranked.sort((left, right) => left.rank - right.rank);
  return [...new Set(ranked.map((entry) => entry.asin))];
}

/** List title from a bestseller page, e.g. "Werewolf & Shifter Thrillers". */
export function bestsellerListName(html: string): string | null {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const match = title ? /Best Sellers:\s*(?:Best\s+)?(.+)$/.exec(decodeEntities(title).trim()) : null;
  return match?.[1] ?? null;
}

export interface SearchResult {
  asin: string;
  title: string;
  reviews: number | null;
  priceCents: number | null;
  authors: string[];
}

/** Byline links point at an author page: /Name/e/ASIN or /stores/Name/author/ASIN. */
const AUTHOR_LINK = /<a[^>]*href="[^"]*\/(?:e|author)\/[A-Z0-9]{10}[^"]*"[^>]*>([^<]+)<\/a>/g;

/** Organic results on one search page, in order. Sponsored slots (AdHolder) are skipped. */
export function organicResults(html: string): SearchResult[] {
  const starts = [...html.matchAll(/<div[^>]*data-component-type="s-search-result"[^>]*>/g)];
  const results: SearchResult[] = [];
  starts.forEach((start, index) => {
    const tag = start[0];
    if (/class="[^"]*\bAdHolder\b/.test(tag)) return;
    const asin = /data-asin="([A-Z0-9]{10})"/.exec(tag)?.[1];
    if (!asin || results.some((result) => result.asin === asin)) return;
    const body = html.slice(start.index!, starts[index + 1]?.index ?? html.length);
    const title = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body)?.[1];
    const reviews = /aria-label="([\d,]+) ratings?"/.exec(body)?.[1];
    // Kindle Unlimited titles list "$0.00" before the purchase price.
    const prices = [...body.matchAll(/class="a-offscreen">\$([\d,]+\.\d{2})</g)].map((match) => Number(match[1]!.replace(/,/g, '')));
    const price = prices.find((amount) => amount > 0);
    results.push({
      asin,
      title: title ? plainText(title) : asin,
      reviews: reviews ? Number(reviews.replace(/,/g, '')) : null,
      priceCents: price === undefined ? null : Math.round(price * 100),
      authors: [...new Set([...body.matchAll(AUTHOR_LINK)].map((match) => plainText(match[1]!)))],
    });
  });
  return results;
}

export function organicAsins(html: string): string[] {
  return organicResults(html).map((result) => result.asin);
}

/** Total from "1-16 of over 3,000 results". Null when the page doesn't say. */
export function searchResultCount(html: string): number | null {
  const match = /of\s+(?:over\s+)?([\d,]+)\s+results/.exec(html);
  return match ? Number(match[1]!.replace(/,/g, '')) : null;
}

export function hasNextPage(html: string): boolean {
  return /class="s-pagination-item s-pagination-next(?![^"]*s-pagination-disabled)/.test(html);
}
