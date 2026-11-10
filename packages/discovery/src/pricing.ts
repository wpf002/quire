/**
 * KDP royalty math, US marketplace, in integer cents.
 * Ebook: 70% band from $2.99 to $9.99 (minus delivery at $0.15/MB); 35% outside it.
 * Paperback: since June 2025, 60% of list at $9.99 and above, 50% below, minus printing.
 * Printing, black ink: $2.30 flat for 24–108 pages; $1.00 + $0.012 per page for 110–828.
 */
export const EBOOK_70_MIN_CENTS = 299;
export const EBOOK_70_MAX_CENTS = 999;
export const EBOOK_DELIVERY_CENTS_PER_MB = 15;
export const PRINT_FULL_RATE_MIN_CENTS = 999;
const PRINT_RATE_FULL = 0.6;
const PRINT_RATE_REDUCED = 0.5;
const PRINT_FLAT_MAX_PAGES = 108;
const PRINT_FLAT_CENTS = 230;
const PRINT_FIXED_CENTS = 100;
const PRINT_PER_PAGE_CENTS = 1.2;

export function printCostCents(pages: number): number {
  return pages <= PRINT_FLAT_MAX_PAGES ? PRINT_FLAT_CENTS : Math.round(PRINT_FIXED_CENTS + PRINT_PER_PAGE_CENTS * pages);
}

export function ebookRoyaltyCents(priceCents: number, fileSizeMb: number): number {
  const inBand = priceCents >= EBOOK_70_MIN_CENTS && priceCents <= EBOOK_70_MAX_CENTS;
  if (!inBand) return Math.floor(priceCents * 0.35);
  return Math.max(0, Math.floor(priceCents * 0.7 - Math.ceil(fileSizeMb * EBOOK_DELIVERY_CENTS_PER_MB)));
}

export function paperbackRoyaltyCents(priceCents: number, pages: number): number {
  const rate = priceCents >= PRINT_FULL_RATE_MIN_CENTS ? PRINT_RATE_FULL : PRINT_RATE_REDUCED;
  return Math.floor(priceCents * rate - printCostCents(pages));
}

/** Lowest list price where the paperback royalty is positive. KDP enforces this as its minimum. */
export function minimumPaperbackCents(pages: number): number {
  const reduced = Math.ceil(printCostCents(pages) / PRINT_RATE_REDUCED);
  if (reduced < PRINT_FULL_RATE_MIN_CENTS) return reduced;
  return Math.max(PRINT_FULL_RATE_MIN_CENTS, Math.ceil(printCostCents(pages) / PRINT_RATE_FULL));
}

export interface PriceRow {
  priceCents: number;
  royaltyCents: number;
  note: string | null;
}

export interface PricingRecommendation {
  format: 'ebook' | 'paperback';
  recommendedCents: number;
  royaltyCents: number;
  rationale: string;
  table: PriceRow[];
}

const EBOOK_LADDER = [99, 299, 399, 499, 599, 799, 999, 1199];
const PAPERBACK_LADDER = [799, 899, 949, 999, 1199, 1299, 1499, 1699, 1999];

export function recommendEbookPrice(input: { compMedianCents: number | null; fileSizeMb: number; seriesStarter: boolean }): PricingRecommendation {
  const table = EBOOK_LADDER.map((priceCents) => ({
    priceCents,
    royaltyCents: ebookRoyaltyCents(priceCents, input.fileSizeMb),
    note: priceCents < EBOOK_70_MIN_CENTS || priceCents > EBOOK_70_MAX_CENTS ? '35% royalty' : null,
  }));
  const anchor = input.compMedianCents ?? 399;
  let recommended = Math.min(EBOOK_70_MAX_CENTS, Math.max(EBOOK_70_MIN_CENTS, nearestLadder(EBOOK_LADDER, anchor)));
  if (input.seriesStarter) recommended = EBOOK_70_MIN_CENTS;
  return {
    format: 'ebook',
    recommendedCents: recommended,
    royaltyCents: ebookRoyaltyCents(recommended, input.fileSizeMb),
    rationale: input.seriesStarter
      ? 'Series starter at the lowest 70% price to pull readers into later books.'
      : `Near the comp median${input.compMedianCents === null ? ' (no comps; genre default)' : ''}, inside the 70% band.`,
    table,
  };
}

export function recommendPaperbackPrice(input: { pages: number; compMedianCents: number | null }): PricingRecommendation {
  const floor = minimumPaperbackCents(input.pages);
  const table = PAPERBACK_LADDER.filter((priceCents) => priceCents >= floor).map((priceCents) => ({
    priceCents,
    royaltyCents: paperbackRoyaltyCents(priceCents, input.pages),
    note: priceCents < PRINT_FULL_RATE_MIN_CENTS ? '50% rate under $9.99' : null,
  }));
  let recommended = Math.max(floor, nearestLadder(PAPERBACK_LADDER, input.compMedianCents ?? 1299));
  let rationale = 'Near the comp median.';
  // Just under $9.99 earns less than $9.99 itself; never recommend the dead zone.
  if (recommended < PRINT_FULL_RATE_MIN_CENTS && paperbackRoyaltyCents(PRINT_FULL_RATE_MIN_CENTS, input.pages) > paperbackRoyaltyCents(recommended, input.pages)) {
    const gain = paperbackRoyaltyCents(PRINT_FULL_RATE_MIN_CENTS, input.pages) - paperbackRoyaltyCents(recommended, input.pages);
    recommended = PRINT_FULL_RATE_MIN_CENTS;
    rationale = `$9.99 clears the 50% tier and earns ${gain}¢ more per copy than the comp price.`;
  }
  return { format: 'paperback', recommendedCents: recommended, royaltyCents: paperbackRoyaltyCents(recommended, input.pages), rationale, table };
}

function nearestLadder(ladder: number[], target: number): number {
  return ladder.reduce((best, price) => (Math.abs(price - target) < Math.abs(best - target) ? price : best), ladder[0] ?? target);
}
