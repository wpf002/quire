import { z } from 'zod';

// The canonical document model. Every ingest format lands here; every pass and export reads from here.

export const RunSchema = z.object({
  text: z.string(),
  em: z.boolean().optional(),
  strong: z.boolean().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), id: z.string(), level: z.union([z.literal(2), z.literal(3)]), runs: z.array(RunSchema) }),
  z.object({ kind: z.literal('paragraph'), id: z.string(), runs: z.array(RunSchema) }),
  z.object({ kind: z.literal('quote'), id: z.string(), runs: z.array(RunSchema) }),
  z.object({ kind: z.literal('scene-break'), id: z.string() }),
]);
export type Block = z.infer<typeof BlockSchema>;
export type TextBlock = Extract<Block, { runs: Run[] }>;

export const ChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  blocks: z.array(BlockSchema),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ManuscriptSchema = z.object({
  title: z.string(),
  author: z.string(),
  chapters: z.array(ChapterSchema),
});
export type Manuscript = z.infer<typeof ManuscriptSchema>;

export function isTextBlock(block: Block): block is TextBlock {
  return block.kind !== 'scene-break';
}

export function runsText(runs: Run[]): string {
  return runs.map((run) => run.text).join('');
}

export function blockText(block: Block): string {
  return isTextBlock(block) ? runsText(block.runs) : '';
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

export function manuscriptWordCount(manuscript: Manuscript): number {
  let total = 0;
  for (const chapter of manuscript.chapters) {
    for (const block of chapter.blocks) total += countWords(blockText(block));
  }
  return total;
}

export function findBlock(manuscript: Manuscript, blockId: string): { chapter: Chapter; block: Block } | null {
  for (const chapter of manuscript.chapters) {
    const block = chapter.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { chapter, block };
  }
  return null;
}

/** Context kept on each side of a change when relocating it after nearby text changed. */
const MIN_RELOCATE_CONTEXT = 4;

/** Maps curly quotes to straight ones. Keeps length, so indexes still line up with the original text. */
function straightenQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) count += 1;
  return count;
}

/**
 * Finds where `before` → `after` applies in `text`. Uses the exact `before` when present. Otherwise
 * an accepted neighbour may have changed its context, so it ignores quote style, trims the context
 * down to the changed characters plus MIN_RELOCATE_CONTEXT on each side, and requires one match.
 */
export function locateChange(text: string, before: string, after: string): { start: number; end: number; replacement: string } | null {
  const exact = text.indexOf(before);
  if (exact >= 0) return { start: exact, end: exact + before.length, replacement: after };
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const core = before.slice(prefix, before.length - suffix);
  const replacement = after.slice(prefix, after.length - suffix);
  const searchText = straightenQuotes(text);
  for (let context = Math.max(prefix, suffix); context >= MIN_RELOCATE_CONTEXT; context -= 1) {
    const left = before.slice(prefix - Math.min(context, prefix), prefix);
    const right = before.slice(before.length - suffix, before.length - suffix + Math.min(context, suffix));
    const needle = straightenQuotes(left + core + right);
    const matches = countOccurrences(searchText, needle);
    if (matches > 1) return null;
    if (matches === 1) {
      const start = searchText.indexOf(needle) + left.length;
      return { start, end: start + core.length, replacement };
    }
  }
  return null;
}

function splice(text: string, location: { start: number; end: number; replacement: string }): string {
  return text.slice(0, location.start) + location.replacement + text.slice(location.end);
}

/**
 * Replaces `before` with `after` inside a block. Keeps formatting when the match sits inside one run;
 * otherwise flattens the block to a single plain run so the text is still correct.
 */
export function replaceInBlock(block: TextBlock, before: string, after: string): TextBlock | null {
  for (const [runIndex, run] of block.runs.entries()) {
    const location = locateChange(run.text, before, after);
    if (location) return { ...block, runs: block.runs.map((other, index) => (index === runIndex ? { ...other, text: splice(other.text, location) } : other)) };
  }
  const flat = runsText(block.runs);
  const location = locateChange(flat, before, after);
  if (!location) return null;
  return { ...block, runs: [{ text: splice(flat, location) }] };
}

/** Estimated 6x9 print page count at ~300 words per page plus chapter openers. */
export const WORDS_PER_PRINT_PAGE = 300;
export function estimatePrintPages(manuscript: Manuscript): number {
  const bodyPages = Math.ceil(manuscriptWordCount(manuscript) / WORDS_PER_PRINT_PAGE);
  const frontMatterPages = 4;
  return bodyPages + manuscript.chapters.length + frontMatterPages;
}
