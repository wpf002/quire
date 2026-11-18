import { topicWords } from './keywords';
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

/** A manuscript rarely says "culinary" or "animal", so each list subject names the words that show a book has it. */
const LIST_SUBJECTS = [
  {
    listWords: topicWords('culinary food foods cooking'),
    evidence: topicWords('culinary food cook cooks cooked cooking chef recipe bakery baker bake baked baking dough bread loaf loaves pastry cake cafe restaurant kitchen'),
  },
  {
    listWords: topicWords('animal animals pet pets cat cats dog dogs'),
    evidence: topicWords('animal pet cat kitten dog puppy horse veterinarian'),
  },
  {
    listWords: topicWords('witch witches wizard wizards warlock paranormal supernatural magic magical'),
    evidence: topicWords('witch witches wizard warlock coven spell spells magic magical paranormal supernatural ghost ghosts vampire'),
  },
  {
    listWords: topicWords('craft crafts hobby hobbies'),
    evidence: topicWords('craft crafts hobby quilt quilting knit knitting sew sewing crochet scrapbook pottery yarn'),
  },
  {
    listWords: topicWords('holiday holidays christmas'),
    evidence: topicWords('holiday holidays christmas halloween thanksgiving easter hanukkah'),
  },
];

/** A list named for a subject fits only a book with that subject. Lists that name none, like "Mystery", always fit. */
export function categoryMatchesBook(path: string, bookWords: Set<string>): boolean {
  const listName = topicWords(path.split('›').at(-1) ?? path);
  return LIST_SUBJECTS.every(
    ({ listWords, evidence }) => ![...listName].some((word) => listWords.has(word)) || [...evidence].some((word) => bookWords.has(word)),
  );
}

const FIT_ORDER: Record<CategoryFit, number> = { winnable: 0, stretch: 1, crowded: 2, ghost: 3 };

/** Winnable first; within a fit, the category with the most traffic first. */
export function rankCategories(categories: CategoryThresholds[], expectedDailySales: number): CategoryFitResult[] {
  return categories
    .map((category) => categoryFit(category, expectedDailySales))
    .sort((left, right) => FIT_ORDER[left.fit] - FIT_ORDER[right.fit] || right.salesForFirst - left.salesForFirst);
}

/**
 * Categories for the KDP draft. Winnable and stretch lists first. KDP still needs categories when every
 * list is crowded (the usual case for big-genre lists), so the rest fill with the easiest #10 spots.
 * Ghost lists never fill a slot.
 */
export function pickDraftCategories(ranked: CategoryFitResult[], slots: number): CategoryFitResult[] {
  const reachable = ranked.filter((category) => category.fit === 'winnable' || category.fit === 'stretch');
  const crowded = ranked.filter((category) => category.fit === 'crowded').sort((left, right) => left.salesForTopTen - right.salesForTopTen);
  return [...reachable, ...crowded].slice(0, slots);
}
