import type { CategoryFitResult } from './categories';
import type { KeywordBox } from './metadata';
import type { PricingRecommendation } from './pricing';

export type RecommendationKind = 'keywords' | 'categories' | 'price-ebook' | 'price-paperback' | 'swap-keyword' | 'switch-category' | 'raise-price';

/** The measured result attached once tracking has before/after data. Null until then. */
export interface RecommendationOutcome {
  measuredAt: string;
  metric: 'keyword-rank' | 'bsr';
  beforeMedian: number | null;
  afterMedian: number | null;
  verdict: 'moved' | 'flat' | 'worse' | 'insufficient-data';
}

export type RecommendationPayload =
  | { kind: 'keywords'; boxes: KeywordBox[] }
  | { kind: 'categories'; categories: CategoryFitResult[] }
  | { kind: 'price-ebook' | 'price-paperback'; pricing: PricingRecommendation }
  | { kind: 'swap-keyword'; remove: string; add: string; boxIndex: number }
  | { kind: 'switch-category'; from: string | null; to: string }
  | { kind: 'raise-price'; format: 'paperback'; fromCents: number; toCents: number };

export interface Recommendation {
  payload: RecommendationPayload;
  rationale: string;
  /** Which providers produced the data, e.g. "amazon-autocomplete + sample". */
  dataSources: string[];
  createdAt: string;
  outcome: RecommendationOutcome | null;
}
