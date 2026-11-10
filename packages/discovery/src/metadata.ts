import type { KeywordScore } from './keywords';

export const KDP_KEYWORD_BOXES = 7;
export const KDP_KEYWORD_BOX_CHARS = 50;
export const KDP_DESCRIPTION_CHARS = 4_000;
export const KDP_TITLE_SUBTITLE_CHARS = 200;

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'with', 'book', 'books', 'novel', 'kindle', 'ebook']);
// Terms KDP rejects in keyword boxes: other authors' names, sales claims, and Amazon program names.
const BANNED_TERMS = ['bestseller', 'best seller', 'free', 'kindle unlimited', 'new release', 'on sale', 'amazon'];

export interface KeywordBox {
  index: number;
  text: string;
  phrases: string[];
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9’']+/).filter(Boolean);
}

/**
 * Pack scored phrases into 7 boxes of 50 characters. Words already in the title or subtitle
 * are dropped (Amazon indexes those already), banned terms are skipped, and no word repeats.
 */
export function packKeywordBoxes(scored: KeywordScore[], title: string, subtitle: string | null): KeywordBox[] {
  const covered = new Set(words(`${title} ${subtitle ?? ''}`).filter((word) => !STOP_WORDS.has(word)));
  const used = new Set<string>();
  const packed: Array<{ keyword: string; fragment: string }> = [];
  for (const { keyword } of [...scored].sort((left, right) => right.score - left.score)) {
    if (BANNED_TERMS.some((term) => keyword.includes(term))) continue;
    const fresh = words(keyword).filter((word) => !covered.has(word) && !used.has(word) && !STOP_WORDS.has(word));
    if (fresh.length === 0) continue;
    const fragment = fresh.join(' ');
    if (fragment.length > KDP_KEYWORD_BOX_CHARS) continue;
    fresh.forEach((word) => used.add(word));
    packed.push({ keyword, fragment });
  }

  // Box text holds only the new words. Phrases keep the full search phrase, which is what gets rank-tracked.
  const boxes: KeywordBox[] = Array.from({ length: KDP_KEYWORD_BOXES }, (_, index) => ({ index, text: '', phrases: [] }));
  for (const { keyword, fragment } of packed) {
    const box = boxes.find((candidate) => (candidate.text ? candidate.text.length + 1 : 0) + fragment.length <= KDP_KEYWORD_BOX_CHARS);
    if (!box) break;
    box.text = box.text ? `${box.text} ${fragment}` : fragment;
    box.phrases.push(keyword);
  }
  return boxes;
}

/** Rebuild one box's text from its phrases: unique words not already in the title or subtitle, cut to 50 characters. */
export function keywordBoxText(phrases: string[], title: string, subtitle: string | null): string {
  const covered = new Set(words(`${title} ${subtitle ?? ''}`));
  const unique = [...new Set(phrases.flatMap(words))].filter((word) => !covered.has(word) && !STOP_WORDS.has(word));
  let text = '';
  for (const word of unique) {
    const next = text ? `${text} ${word}` : word;
    if (next.length > KDP_KEYWORD_BOX_CHARS) break;
    text = next;
  }
  return text;
}

export interface MetadataIssue {
  field: 'title' | 'subtitle' | 'description' | 'keywords';
  message: string;
}

export function validateMetadata(input: { title: string; subtitle: string | null; description: string; keywords: string[] }): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  if (`${input.title}${input.subtitle ?? ''}`.length > KDP_TITLE_SUBTITLE_CHARS) issues.push({ field: 'title', message: 'Title and subtitle exceed 200 characters' });
  if (input.subtitle && BANNED_TERMS.some((term) => input.subtitle!.toLowerCase().includes(term))) issues.push({ field: 'subtitle', message: 'Subtitle contains a term KDP rejects' });
  if (input.description.length > KDP_DESCRIPTION_CHARS) issues.push({ field: 'description', message: 'Description exceeds 4,000 characters' });
  if (input.keywords.length > KDP_KEYWORD_BOXES) issues.push({ field: 'keywords', message: 'More than 7 keyword boxes' });
  input.keywords.forEach((keyword, index) => {
    if (keyword.length > KDP_KEYWORD_BOX_CHARS) issues.push({ field: 'keywords', message: `Box ${index + 1} exceeds 50 characters` });
    if (BANNED_TERMS.some((term) => keyword.toLowerCase().includes(term))) issues.push({ field: 'keywords', message: `Box ${index + 1} contains a term KDP rejects` });
  });
  return issues;
}
