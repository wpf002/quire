import { describe, expect, it } from 'vitest';
import { AmazonPageRankProvider, RankProviderBlockedError, RankProviderError, isBlockedPage, organicAsins, parseBestSellersRank } from '../src';

// Markup shapes copied from live amazon.com pages (Nov 2026), trimmed to what the parsers read.
const result = (asin: string, sponsored = false) =>
  `<div role="listitem" data-asin="${asin}" data-index="3" data-component-type="s-search-result" class="sg-col-20-of-24 s-result-item s-asin${sponsored ? ' AdHolder' : ''} sg-col"><h2>${asin}</h2></div>`;
const NEXT = '<a class="s-pagination-item s-pagination-next s-pagination-button s-pagination-separator" href="/s?page=2">Next</a>';
const LAST = '<span class="s-pagination-item s-pagination-next s-pagination-disabled ">Next</span>';
const searchPage = (asins: string[], next = true, sponsored: string[] = []) => `${sponsored.map((asin) => result(asin, true)).join('')}${asins.map((asin) => result(asin)).join('')}${next ? NEXT : LAST}`;
const asinRange = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(10 - prefix.length, '0')}`);

const PRODUCT_PAGE = `<li><span class="a-list-item"><span class="a-text-bold"> Best Sellers Rank: </span> #6,640 in Kindle Store (<a href='/gp/bestsellers/digital-text'>See Top 100 in Kindle Store</a>) <ul class="a-unordered-list zg_hrsr"><li><span class="a-list-item"> #27 in <a href='/gp/bestsellers/books/9536079011'>Werewolf &amp; Shifter Thrillers</a></span></li></ul></span></li>`;
const ROBOT_CHECK = '<form method="get" action="/errors/validateCaptcha"><input type="hidden" name="amzn"></form>';

const MINE = 'B0MINE0001';
const metadata = { bookId: 'book-1', asin: MINE, title: 'Crumbs', keywordBoxes: [], categories: [], appliedAt: new Date('2026-11-01') };

function fakeAmazon(pages: Record<string, string>) {
  const requested: string[] = [];
  const fetchHtml = async (url: string) => {
    const parsed = new URL(url);
    const key = parsed.pathname === '/s' ? `${parsed.searchParams.get('k')}#${parsed.searchParams.get('page')}` : parsed.pathname;
    requested.push(key);
    const html = pages[key];
    if (html === undefined) throw new Error(`unexpected request ${key}`);
    if (isBlockedPage(html)) throw new RankProviderBlockedError('robot check');
    return html;
  };
  return { provider: new AmazonPageRankProvider(fetchHtml, 0), requested };
}

describe('parseBestSellersRank', () => {
  it('reads the overall rank, not a sub-category rank', () => {
    expect(parseBestSellersRank(PRODUCT_PAGE)).toBe(6640);
  });
  it('returns null for a page without a rank', () => {
    expect(parseBestSellersRank('<div>Product details</div>')).toBeNull();
  });
});

describe('organicAsins', () => {
  it('skips sponsored slots and keeps page order', () => {
    expect(organicAsins(searchPage(['B0AAAAAAA1', 'B0AAAAAAA2'], true, ['B0SPONSOR1']))).toEqual(['B0AAAAAAA1', 'B0AAAAAAA2']);
  });
});

describe('AmazonPageRankProvider', () => {
  it('counts organic position across pages', async () => {
    const { provider, requested } = fakeAmazon({
      [`/dp/${MINE}`]: PRODUCT_PAGE,
      'cozy mystery#1': searchPage(asinRange('P1', 16), true, [MINE]),
      'cozy mystery#2': searchPage([...asinRange('P2', 4), MINE]),
    });
    const snapshot = await provider.observe(metadata, ['cozy mystery'], new Date('2026-11-10'));
    expect(snapshot).toMatchObject({ bsr: 6640, ranks: [{ keyword: 'cozy mystery', rank: 21 }] });
    expect(requested).toEqual([`/dp/${MINE}`, 'cozy mystery#1', 'cozy mystery#2']);
  });

  it('reports unranked when results run out', async () => {
    const { provider } = fakeAmazon({ [`/dp/${MINE}`]: PRODUCT_PAGE, 'bakery sleuth#1': searchPage(asinRange('P1', 5), false) });
    const snapshot = await provider.observe(metadata, ['bakery sleuth'], new Date('2026-11-10'));
    expect(snapshot.ranks).toEqual([{ keyword: 'bakery sleuth', rank: null }]);
  });

  it('fails the observation on a robot check instead of recording unranked', async () => {
    const { provider } = fakeAmazon({ [`/dp/${MINE}`]: PRODUCT_PAGE, 'cozy mystery#1': ROBOT_CHECK });
    await expect(provider.observe(metadata, ['cozy mystery'], new Date('2026-11-10'))).rejects.toBeInstanceOf(RankProviderBlockedError);
  });

  it('needs an ASIN', async () => {
    const { provider } = fakeAmazon({});
    await expect(provider.observe({ ...metadata, asin: null }, [], new Date('2026-11-10'))).rejects.toBeInstanceOf(RankProviderError);
  });
});
