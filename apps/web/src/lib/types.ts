// Response shapes from the Quire API, as JSON (dates arrive as ISO strings).
import type { BookStage, PassKind, TrimSize } from '@quire/core/stages';

export type PlanId = 'starter' | 'author' | 'press';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  spendCapCentsDaily: number;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  monthlyCents: number;
  activeBooks: number;
  spendCapCentsDaily: number;
  trackedKeywordsPerBook: number;
}

export interface BookSummary {
  id: string;
  title: string;
  subtitle: string | null;
  author: string;
  genre: string;
  stage: BookStage;
  trimSize: TrimSize;
  asin: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  manuscriptVersion: number | null;
  pendingEdits: number;
  openRecommendations: number;
}

export interface Blurb {
  hook: string;
  description: string;
  backCover: string;
}

export interface AuthorDeclarationEntry {
  used: boolean;
  extent: string | null;
  tool: string | null;
}

export interface AuthorDeclaration {
  textGeneratedOutsideQuire: AuthorDeclarationEntry;
  imagesGenerated: AuthorDeclarationEntry;
  translationGenerated: AuthorDeclarationEntry;
}

export interface Book extends Omit<BookSummary, 'wordCount' | 'manuscriptVersion' | 'pendingEdits' | 'openRecommendations'> {
  isbn: string | null;
  aboutAuthor: string | null;
  dedication: string | null;
  seriesStarter: boolean;
  blurb: Blurb | null;
  declaration: AuthorDeclaration | null;
}

export interface ChapterSummary {
  id: string;
  title: string;
  words: number;
}

export interface UploadRow {
  id: string;
  filename: string;
  format: string;
  bytes: number;
  createdAt: string;
}

export interface BookDetail {
  book: Book;
  manuscript: { version: number; chapters: ChapterSummary[] } | null;
  pendingEdits: number;
  openRecommendations: number;
  uploads: UploadRow[];
}

export interface Run {
  text: string;
  em?: boolean;
  strong?: boolean;
}

export type Block =
  | { kind: 'heading'; id: string; level: 2 | 3; runs: Run[] }
  | { kind: 'paragraph'; id: string; runs: Run[] }
  | { kind: 'quote'; id: string; runs: Run[] }
  | { kind: 'scene-break'; id: string };

export interface Chapter {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Manuscript {
  title: string;
  author: string;
  chapters: Chapter[];
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface StructuralNote {
  chapterId: string;
  note: string;
  specificity: 'specific' | 'generic';
  quote: string | null;
}

export interface Pass {
  id: string;
  kind: PassKind;
  status: JobStatus;
  manuscriptVersion: number;
  model: string | null;
  modelSkippedReason: string | null;
  notes: StructuralNote[] | null;
  costCents: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  _count: { edits: number };
}

export type EditStatus = 'pending' | 'accepted' | 'rejected';

export interface Edit {
  id: string;
  passId: string;
  chapterId: string;
  blockId: string;
  before: string;
  after: string;
  reason: string;
  rule: string | null;
  source: string;
  aiRole: 'none' | 'assisted' | 'generated';
  status: EditStatus;
  authorRevised: boolean;
  pass: { kind: PassKind };
}

export interface DecideResult {
  accepted: number;
  rejected: number;
  stale: number;
  version: number;
}

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DisclosureAnswer {
  category: 'text' | 'images' | 'translation';
  question: string;
  answer: 'Yes' | 'No';
  extent: string | null;
  tools: string[];
  basis: string;
}

export interface DisclosureReport {
  formVerifiedOn: string;
  answers: DisclosureAnswer[];
  assistedEdits: number;
  generatedEdits: number;
  generatedWords: number;
  notes: string[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  status: 'pass' | 'review' | 'confirm';
  detail: string;
  findings: Array<{ chapterId: string; blockId: string; excerpt: string }>;
}

export interface ComplianceView {
  report: {
    id: string;
    createdAt: string;
    disclosure: DisclosureReport;
    checklist: ChecklistItem[];
    confirmations: string[];
  } | null;
  velocity: { publishedLast24h: number; remaining: number; nextSlotAt: string | null; limit: number };
}

export interface KeywordScore {
  keyword: string;
  demand: number;
  competition: number;
  score: number;
  resultCount: number;
  topSalesPerDay: number;
  source: string;
}

export interface KeywordBox {
  index: number;
  text: string;
  phrases: string[];
}

export type CategoryFit = 'winnable' | 'stretch' | 'ghost' | 'crowded' | string;

export interface CategoryFitResult {
  path: string;
  bsrFirst: number;
  bsrTenth: number;
  fit: CategoryFit;
  salesForTopTen: number;
  salesForFirst: number;
}

export interface PricingRecommendation {
  format: 'ebook' | 'paperback';
  recommendedCents: number;
  royaltyCents: number;
  rationale: string;
  table: Array<{ priceCents: number; royaltyCents: number; note: string | null }>;
}

export type RecommendationPayload =
  | { kind: 'keywords'; boxes: KeywordBox[] }
  | { kind: 'categories'; categories: CategoryFitResult[] }
  | { kind: 'price-ebook'; pricing: PricingRecommendation }
  | { kind: 'price-paperback'; pricing: PricingRecommendation }
  | { kind: 'swap-keyword'; remove: string; add: string; boxIndex: number }
  | { kind: 'switch-category'; from: string | null; to: string }
  | { kind: 'raise-price'; format: 'ebook' | 'paperback'; fromCents: number; toCents: number };

export interface RecommendationOutcome {
  measuredAt: string;
  metric: 'keyword-rank' | 'bsr';
  beforeMedian: number | null;
  afterMedian: number | null;
  verdict: 'moved' | 'flat' | 'worse' | 'insufficient-data';
}

export interface Recommendation {
  id: string;
  kind: RecommendationPayload['kind'];
  payload: RecommendationPayload;
  rationale: string;
  dataSources: string[];
  status: 'open' | 'applied' | 'dismissed';
  createdAt: string;
  appliedAt: string | null;
  outcome: RecommendationOutcome | null;
}

export interface DiscoveryView {
  run: {
    result: {
      keywords: KeywordScore[];
      boxes: KeywordBox[];
      categories: CategoryFitResult[];
      compMedianPriceCents: number | null;
      sources: string[];
    };
    sources: string[];
    createdAt: string;
  } | null;
  recommendations: Recommendation[];
}

export interface MetadataVersion {
  id: string;
  version: number;
  title: string;
  subtitle: string | null;
  description: string;
  keywordBoxes: string[];
  categories: string[];
  ebookPriceCents: number | null;
  paperbackPriceCents: number | null;
  appliedAt: string | null;
  recommendationId: string | null;
  createdAt: string;
  recommendation?: { id: string; kind: string; rationale: string; outcome: RecommendationOutcome | null } | null;
}

export interface MetadataIssue {
  field: string;
  message: string;
}

export interface MetadataView {
  versions: MetadataVersion[];
  live: MetadataVersion | null;
  draft: MetadataVersion | null;
  issues: MetadataIssue[];
}

export interface RankView {
  provider: string;
  simulated: boolean;
  publishedAt: string | null;
  series: Array<{ keyword: string; points: Array<{ at: string; rank: number | null }> }>;
  bsr: Array<{ at: string; bsr: number | null }>;
  categories: Array<{ category: string; points: Array<{ at: string; rank: number }> }>;
  changes: Array<{ id: string; version: number; appliedAt: string; recommendationId: string | null }>;
  recommendations: Recommendation[];
}

export interface PreflightCheck {
  id: string;
  label: string;
  level: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface ExportRow {
  id: string;
  format: 'epub' | 'pdf';
  target: 'kdp' | 'ingramspark';
  trimSize: TrimSize;
  bytes: number;
  pageCount: number | null;
  preflight: PreflightCheck[];
  createdAt: string;
}

export interface UsageView {
  plan: PlanInfo;
  plans: PlanInfo[];
  todayCents: number;
  capCents: number;
  monthCents: number;
  daily: Array<{ day: string; costCents: number; calls: number }>;
  byPurpose: Array<{ purpose: string; costCents: number; calls: number }>;
  books: { used: number; limit: number };
  modelAvailable: boolean;
}
