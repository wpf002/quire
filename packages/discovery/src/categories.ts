import type { CategoryThresholds } from './providers';
import { estimateDailySales } from './sales';

export type CategoryFit = 'winnable' | 'stretch' | 'crowded' | 'ghost';

export interface CategoryFitResult extends CategoryThresholds {
  fit: CategoryFit;
  /** Estimated sales per day needed to hold the #10 spot. */
  salesForTopTen: number;
  /** Estimated sales per day of the #1 book. */
  salesForFirst: number;
}

// A category whose #1 book sells under this per day gets no shopper traffic; ranking there is invisible.
const GHOST_FIRST_SALES = 0.5;
const STRETCH_MULTIPLIER = 3;

export function categoryFit(category: CategoryThresholds, expectedDailySales: number): CategoryFitResult {
  const salesForTopTen = estimateDailySales(category.bsrTenth);
  const salesForFirst = estimateDailySales(category.bsrFirst);
  let fit: CategoryFit;
  if (salesForFirst < GHOST_FIRST_SALES) fit = 'ghost';
  else if (salesForTopTen <= expectedDailySales) fit = 'winnable';
  else if (salesForTopTen <= expectedDailySales * STRETCH_MULTIPLIER) fit = 'stretch';
  else fit = 'crowded';
  return { ...category, fit, salesForTopTen, salesForFirst };
}

const FIT_ORDER: Record<CategoryFit, number> = { winnable: 0, stretch: 1, crowded: 2, ghost: 3 };

/** Winnable first; within a fit, the category with the most traffic first. */
export function rankCategories(categories: CategoryThresholds[], expectedDailySales: number): CategoryFitResult[] {
  return categories
    .map((category) => categoryFit(category, expectedDailySales))
    .sort((left, right) => FIT_ORDER[left.fit] - FIT_ORDER[right.fit] || right.salesForFirst - left.salesForFirst);
}
