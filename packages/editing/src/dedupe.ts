import { type Manuscript, blockText } from '@quire/core';

export interface EditSpan {
  blockId: string;
  before: string;
  after: string;
}

/** The block text after one edit, or null when the edit's "before" isn't in the block. */
function blockAfterEdit(text: string, edit: EditSpan): string | null {
  const at = text.indexOf(edit.before);
  if (at < 0) return null;
  return text.slice(0, at) + edit.after + text.slice(at + edit.before.length);
}

export function blockTexts(manuscript: Manuscript): Map<string, string> {
  return new Map(manuscript.chapters.flatMap((chapter) => chapter.blocks.map((block) => [block.id, blockText(block)] as const)));
}

/**
 * Drop candidates that make the same change as an existing edit or an earlier candidate.
 * Two edits match when they leave the block with the same text, so "the the oven" → "the oven"
 * and "the the" → "the" count as one fix. Edits that can't be applied to the block are kept.
 */
export function dropDuplicateEdits<T extends EditSpan>(candidates: T[], existing: EditSpan[], texts: Map<string, string>): T[] {
  const seen = new Set<string>();
  const outcome = (edit: EditSpan): string | null => {
    const text = texts.get(edit.blockId);
    if (text === undefined) return null;
    const result = blockAfterEdit(text, edit);
    return result === null ? null : `${edit.blockId}\u0000${result}`;
  };
  for (const edit of existing) {
    const key = outcome(edit);
    if (key) seen.add(key);
  }
  return candidates.filter((edit) => {
    const key = outcome(edit);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
