import { describe, expect, it } from 'vitest';
import {
  AmazonBlockedError,
  AmazonCategoryProvider,
  AmazonMarketProvider,
  PacedPageFetcher,
  bestsellerAsins,
  bestsellerListName,
  competitionScore,
  isBlockedPage,
  organicResults,
  parseCategoryLinks,
  searchResultCount,
} from '../src';

// Markup shapes copied from live amazon.com pages (Nov 2026), trimmed to what the parsers read.
const searchResult = (asin: string, title: string, ratings: number, price: string, sponsored = false) =>
  `<div role="listitem" data-asin="${asin}" data-component-type="s-search-result" class="s-result-item s-asin${sponsored ? ' AdHolder' : ''}">` +
  `<h2 aria-label="${title}" class="a-size-medium"><span>${title}</span></h2>` +
  `<a aria-label="${ratings.toLocaleString('en-US')} ratings" href="#"></a><span class="a-price"><span class="a-offscreen">$0.00</span></span>` +
  `<span class="a-price"><span class="a-offscreen">$${price}</span></span></div>`;
const searchPage = (results: string[]) =>
  `<span>1-16 of over 3,000 results for <span>"cozy mystery"</span></span>${results.join('')}`;

const productPage = (bsr: string, categories: Array<[string, string, string, string]> = []) =>
  `<li><span class="a-list-item"><span class="a-text-bold"> Best Sellers Rank: </span> #${bsr} in Kindle Store (<a href='/gp/bestsellers/digital-text/ref=pd_zg_ts_digital-text'>See Top 100 in Kindle Store</a>) ` +
  `<ul class="a-unordered-list a-nostyle a-vertical zg_hrsr">${categories
    .map(([rank, store, node, name]) => `<li><span class="a-list-item"> #${rank} in <a href='/gp/bestsellers/${store}/${node}/ref=pd_zg_hrsr_${store}'>${name}</a></span></li>`)
    .join('')}</ul></span></li>`;

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const listPage = (name: string, asins: string[]) => {
  const recs = asins.map((id, index) => ({ id, metadataMap: { 'render.zg.rank': String(index + 1) } }));
  // Amazon splits the list across two attributes and the second starts mid-list.
  return `<title>Amazon Best Sellers: Best ${escapeAttribute(name)}</title>` +
    `<div data-client-recs-list="${escapeAttribute(JSON.stringify(recs.slice(5)))}"></div>` +
    `<div data-client-recs-list="${escapeAttribute(JSON.stringify(recs.slice(0, 5)))}"></div>`;
};
const asinRange = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(10 - prefix.length, '0')}`);

function fakePages(pages: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = new PacedPageFetcher(async (url) => {
    const parsed = new URL(url);
    const key = parsed.pathname === '/s' ? `search:${parsed.searchParams.get('k')}:${parsed.searchParams.get('i')}` : parsed.pathname;
    requested.push(key);
    const html = pages[key];
    if (html === undefined) throw new Error(`unexpected request ${key}`);
    if (isBlockedPage(html)) throw new AmazonBlockedError('amazon-page', 'robot check');
    return html;
  }, 0);
  return { fetcher, requested };
}

describe('amazon page parsers', () => {
  it('reads organic results with ratings and price, skipping sponsored slots', () => {
    const html = searchPage([searchResult('B0SPONSOR1', 'Ad', 5, '0.99', true), searchResult('B0AAAAAAA1', 'Crumbs &amp; Clues', 1567, '4.99')]);
    expect(organicResults(html)).toEqual([{ asin: 'B0AAAAAAA1', title: 'Crumbs & Clues', reviews: 1567, priceCents: 499 }]);
    expect(searchResultCount(html)).toBe(3000);
  });

  it('reads category links with their bestseller node', () => {
    expect(parseCategoryLinks(productPage('390', [['1', 'books', '9536079011', 'Werewolf & Shifter Thrillers']]))).toEqual([
      { category: 'Werewolf & Shifter Thrillers', rank: 1, store: 'books', node: '9536079011' },
    ]);
  });

  it('orders a bestseller list by its rank field, not attribute order', () => {
    const html = listPage('Cozy Culinary Mysteries', asinRange('L', 8));
    expect(bestsellerAsins(html)).toEqual(asinRange('L', 8));
    expect(bestsellerListName(html)).toBe('Cozy Culinary Mysteries');
  });
});

describe('AmazonMarketProvider', () => {
  it('returns result count and the top organic titles', async () => {
    const { fetcher } = fakePages({ 'search:cozy mystery:digital-text': searchPage([searchResult('B0AAAAAAA1', 'One', 12, '2.99')]) });
    const market = await new AmazonMarketProvider(fetcher).market('cozy mystery', 'kindle');
    expect(market).toEqual({ keyword: 'cozy mystery', resultCount: 3000, topTitles: [{ title: 'One', bsr: null, reviews: 12, priceCents: 299 }] });
  });

  it('scores competition from ratings when there is no BSR', () => {
    const weak = competitionScore({ keyword: 'k', resultCount: 3000, topTitles: [{ title: 'a', bsr: null, reviews: 10, priceCents: null }] });
    const strong = competitionScore({ keyword: 'k', resultCount: 3000, topTitles: [{ title: 'a', bsr: null, reviews: 5000, priceCents: null }] });
    expect(strong.competition).toBeGreaterThan(weak.competition);
  });
});

describe('AmazonCategoryProvider', () => {
  const listed = asinRange('L', 12);

  it('reads #1 and #10 BSR for each list the top genre books rank in', async () => {
    const { fetcher, requested } = fakePages({
      'search:cozy mystery:digital-text': searchPage([searchResult('B0SEED0001', 'Seed', 40, '3.99')]),
      '/dp/B0SEED0001': productPage('5,120', [
        ['4', 'digital-text', '6190492011', 'Cozy Culinary Mysteries'],
        ['9', 'books', '9999', 'Print Only'],
        ['2', 'digital-text', '1111', 'Thin List'],
      ]),
      '/gp/bestsellers/digital-text/6190492011': listPage('Cozy Culinary Mysteries', listed),
      '/gp/bestsellers/books/9999': listPage('Print Only', listed),
      '/gp/bestsellers/digital-text/1111': listPage('Thin List', asinRange('T', 4)),
      [`/dp/${listed[0]}`]: productPage('88'),
      [`/dp/${listed[9]}`]: productPage('1,904'),
    });
    const categories = await new AmazonCategoryProvider(fetcher).categories(['cozy mystery'], 'kindle');
    expect(categories).toEqual([
      { path: 'Kindle Store › Kindle eBooks › Cozy Culinary Mysteries', bsrFirst: 88, bsrTenth: 1904 },
      { path: 'Books › Print Only', bsrFirst: 88, bsrTenth: 1904 },
    ]);
    // Product pages are cached across lists, so the shared #1 and #10 load once.
    expect(requested.filter((key) => key === `/dp/${listed[0]}`)).toHaveLength(1);
  });

  it('seeds from each query and ranks lists shared by more seed books first', async () => {
    const { fetcher } = fakePages({
      'search:baker sleuth:digital-text': searchPage([searchResult('B0SEED0001', 'One', 40, '3.99')]),
      'search:cozy mystery:digital-text': searchPage([searchResult('B0SEED0002', 'Two', 40, '3.99')]),
      '/dp/B0SEED0001': productPage('5,120', [
        ['4', 'digital-text', '2222', 'Only One'],
        ['6', 'digital-text', '3333', 'Shared'],
      ]),
      '/dp/B0SEED0002': productPage('7,000', [['8', 'digital-text', '3333', 'Shared']]),
      '/gp/bestsellers/digital-text/2222': listPage('Only One', listed),
      '/gp/bestsellers/digital-text/3333': listPage('Shared', listed),
      [`/dp/${listed[0]}`]: productPage('88'),
      [`/dp/${listed[9]}`]: productPage('1,904'),
    });
    const categories = await new AmazonCategoryProvider(fetcher).categories(['baker sleuth', 'cozy mystery'], 'kindle');
    expect(categories.map((category) => category.path)).toEqual(['Kindle Store › Kindle eBooks › Shared', 'Kindle Store › Kindle eBooks › Only One']);
  });

  it('skips Kindle-store lists for the print storefront', async () => {
    const { fetcher } = fakePages({
      'search:cozy mystery:stripbooks': searchPage([searchResult('B0SEED0001', 'Seed', 40, '3.99')]),
      '/dp/B0SEED0001': productPage('5,120', [['4', 'digital-text', '6190492011', 'Cozy Culinary Mysteries']]),
    });
    expect(await new AmazonCategoryProvider(fetcher).categories(['cozy mystery'], 'books')).toEqual([]);
  });

  it('treats the bot-manager interstitial as a block', () => {
    // Regression: this page has no results, so it used to read as zero competition and no categories.
    expect(isBlockedPage(`<meta http-equiv="refresh" content="5; URL='/s?k=cozy&amp;bm-verify=AAQAAAAO'">`)).toBe(true);
  });

  it('stops on a robot check', async () => {
    const { fetcher } = fakePages({ 'search:cozy mystery:digital-text': '<form action="/errors/validateCaptcha"></form>' });
    await expect(new AmazonCategoryProvider(fetcher).categories(['cozy mystery'], 'kindle')).rejects.toBeInstanceOf(AmazonBlockedError);
  });
});
