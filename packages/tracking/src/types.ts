export interface RankObservation {
  keyword: string;
  observedAt: Date;
  /** Position in search results; null when the book isn't in the tracked depth. */
  rank: number | null;
}

export interface BsrObservation {
  observedAt: Date;
  bsr: number | null;
}

/** The live metadata a rank provider is checking against. */
export interface TrackedMetadata {
  bookId: string;
  title: string;
  keywordBoxes: string[];
  categories: string[];
  appliedAt: Date;
}

export interface RankSnapshot {
  observedAt: Date;
  bsr: number | null;
  ranks: Array<{ keyword: string; rank: number | null }>;
}

export interface RankProvider {
  readonly name: string;
  observe(metadata: TrackedMetadata, keywords: string[], at: Date): Promise<RankSnapshot>;
}

/** How deep the tracker reads search results. Unranked counts as one past this. */
export const TRACKED_DEPTH = 100;
export const MAX_TRACKED_KEYWORDS = 500;
