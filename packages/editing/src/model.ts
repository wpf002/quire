import { z } from 'zod';
import { type Manuscript, type ModelGateway, blockText, isTextBlock } from '@quire/core';
import { classifyModelEdit } from './classify';
import type { EditProposal, StructuralNote } from './types';

export const PARAGRAPHS_PER_CALL = 40;
export const EDIT_MAX_TOKENS = 4_000;
export const STRUCTURAL_MAX_TOKENS = 6_000;
/** ~150k tokens of manuscript; longer books are sampled by chapter. */
export const STRUCTURAL_MAX_CHARS = 600_000;

const EditListSchema = z.array(z.object({ id: z.string(), before: z.string().min(1), after: z.string(), reason: z.string() }));
const NoteListSchema = z.array(z.object({ chapter: z.number().int().nullable(), note: z.string().min(1), quote: z.string().nullable() }));

const COPYEDIT_SYSTEM = `You are a line copyeditor for fiction and nonfiction. Fix grammar, punctuation, usage, consistency, and clarity errors.
Never rewrite voice, never add content, never change meaning. Leave dialect and intentional fragments alone.
Return only a JSON array: [{"id": "<paragraph id>", "before": "<exact substring>", "after": "<replacement>", "reason": "<under 8 words>"}].
"before" must be copied exactly from the paragraph and be as short as possible while unique. Return [] when nothing needs fixing.`;

const PROOFREAD_SYSTEM = `You are a proofreader. Catch typos, missing or doubled words, wrong homophones, and punctuation slips only.
Do not make style or grammar preferences. Same JSON format: [{"id","before","after","reason"}]. Return [] when clean.`;

const STRUCTURAL_SYSTEM = `You are a developmental editor. Give at most 12 structural notes on pacing, stakes, character arcs, POV, and chapter order.
Each note must point at a chapter number and, wherever possible, quote a short exact passage (under 20 words) that shows the problem.
Return only JSON: [{"chapter": <1-based number or null>, "note": "<one or two sentences>", "quote": "<exact passage or null>"}].`;

export function extractJson(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Model reply had no JSON array');
  return JSON.parse(text.slice(start, end + 1));
}

export async function modelLineEdits(
  manuscript: Manuscript,
  gateway: ModelGateway,
  options: { model: string; kind: 'copyedit' | 'proofread' },
): Promise<EditProposal[]> {
  const paragraphs = manuscript.chapters.flatMap((chapter) =>
    chapter.blocks.filter(isTextBlock).map((block) => ({ chapterId: chapter.id, id: block.id, text: blockText(block) })),
  );
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const edits: EditProposal[] = [];
  for (let offset = 0; offset < paragraphs.length; offset += PARAGRAPHS_PER_CALL) {
    const batch = paragraphs.slice(offset, offset + PARAGRAPHS_PER_CALL);
    const completion = await gateway.complete({
      model: options.model,
      system: options.kind === 'copyedit' ? COPYEDIT_SYSTEM : PROOFREAD_SYSTEM,
      prompt: JSON.stringify(batch.map(({ id, text }) => ({ id, text }))),
      maxTokens: EDIT_MAX_TOKENS,
      cacheSystem: true,
    });
    const parsed = EditListSchema.safeParse(extractJson(completion.text));
    if (!parsed.success) throw new Error(`Model returned malformed edits: ${parsed.error.message}`);
    for (const edit of parsed.data) {
      const paragraph = byId.get(edit.id);
      // Drop anything that doesn't match the manuscript verbatim. The model doesn't get to invent text to replace.
      if (!paragraph || !paragraph.text.includes(edit.before) || edit.before === edit.after) continue;
      edits.push({
        chapterId: paragraph.chapterId, blockId: edit.id, before: edit.before, after: edit.after,
        reason: edit.reason, rule: null, source: 'model', aiRole: classifyModelEdit(edit.before, edit.after),
      });
    }
  }
  return edits;
}

export function manuscriptForReview(manuscript: Manuscript): string {
  const parts: string[] = [];
  let length = 0;
  manuscript.chapters.forEach((chapter, index) => {
    const body = chapter.blocks.map(blockText).filter(Boolean).join('\n');
    const section = `\n## Chapter ${index + 1}: ${chapter.title}\n${body}`;
    const room = STRUCTURAL_MAX_CHARS - length;
    if (room <= 0) return;
    const clipped = section.length > room ? `${section.slice(0, room)}\n[chapter truncated]` : section;
    parts.push(clipped);
    length += clipped.length;
  });
  return parts.join('\n');
}

export async function modelStructuralNotes(
  manuscript: Manuscript,
  gateway: ModelGateway,
  options: { model: string },
): Promise<StructuralNote[]> {
  const fullText = manuscriptForReview(manuscript);
  const completion = await gateway.complete({
    model: options.model,
    system: `${STRUCTURAL_SYSTEM}\n\nManuscript "${manuscript.title}":\n${fullText}`,
    prompt: 'Give your structural notes.',
    maxTokens: STRUCTURAL_MAX_TOKENS,
    cacheSystem: true,
  });
  const parsed = NoteListSchema.safeParse(extractJson(completion.text));
  if (!parsed.success) throw new Error(`Model returned malformed notes: ${parsed.error.message}`);
  return parsed.data.map((note) => labelNote(note, manuscript, fullText));
}

function labelNote(
  note: { chapter: number | null; note: string; quote: string | null },
  manuscript: Manuscript,
  fullText: string,
): StructuralNote {
  const chapter = note.chapter !== null ? manuscript.chapters[note.chapter - 1] : undefined;
  const quoteVerified = note.quote !== null && note.quote.length > 0 && fullText.includes(note.quote);
  return {
    chapterId: chapter?.id ?? null,
    note: note.note,
    specificity: quoteVerified && chapter ? 'specific' : 'generic',
    quote: quoteVerified ? note.quote : null,
  };
}
