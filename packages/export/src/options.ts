import type { ExportTarget, TrimSize } from '@quire/core';

export interface ExportOptions {
  target: ExportTarget;
  trim: TrimSize;
  /** Used for the copyright page and OPF dates. Passed in so output is deterministic. */
  publicationYear: number;
  modifiedAt: Date;
  isbn: string | null;
  aboutAuthor: string | null;
  dedication: string | null;
}

export const POINTS_PER_INCH = 72;

// KDP paperback minimum inside (gutter) margins by page count, no bleed. kdp.amazon.com "Set trim size, bleed, and margins".
const KDP_GUTTER_BY_PAGES: Array<[maxPages: number, inches: number]> = [
  [150, 0.375],
  [300, 0.5],
  [500, 0.625],
  [700, 0.75],
  [828, 0.875],
];
export const KDP_MIN_PAGES = 24;
export const KDP_MAX_PAGES = 828;
export const KDP_MIN_OUTSIDE_MARGIN_IN = 0.25;
// IngramSpark asks for at least 0.5 in on every side; we add the same gutter steps on top.
export const INGRAM_MIN_MARGIN_IN = 0.5;
/** Comfortable reading margin; minimums are a floor, not a target. */
export const COMFORT_MARGIN_IN = 0.625;

export function gutterInches(target: ExportTarget, pageCount: number): number {
  const kdpGutter = KDP_GUTTER_BY_PAGES.find(([maxPages]) => pageCount <= maxPages)?.[1] ?? 0.875;
  const minimum = target === 'ingramspark' ? Math.max(INGRAM_MIN_MARGIN_IN, kdpGutter + 0.125) : kdpGutter;
  return Math.max(minimum, COMFORT_MARGIN_IN);
}
