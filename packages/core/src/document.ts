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

/**
 * Replaces `before` with `after` inside a block. Keeps formatting when the match sits inside one run;
 * otherwise flattens the block to a single plain run so the text is still correct.
 */
export function replaceInBlock(block: TextBlock, before: string, after: string): TextBlock | null {
  const runIndex = block.runs.findIndex((run) => run.text.includes(before));
  if (runIndex >= 0) {
    const runs = block.runs.map((run, index) =>
      index === runIndex ? { ...run, text: run.text.replace(before, after) } : run,
    );
    return { ...block, runs };
  }
  const flat = runsText(block.runs);
  if (!flat.includes(before)) return null;
  return { ...block, runs: [{ text: flat.replace(before, after) }] };
}

/** Estimated 6x9 print page count at ~300 words per page plus chapter openers. */
export const WORDS_PER_PRINT_PAGE = 300;
export function estimatePrintPages(manuscript: Manuscript): number {
  const bodyPages = Math.ceil(manuscriptWordCount(manuscript) / WORDS_PER_PRINT_PAGE);
  const frontMatterPages = 4;
  return bodyPages + manuscript.chapters.length + frontMatterPages;
}
