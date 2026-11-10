import { type Block, type Chapter, type Manuscript, type Run, newId, runsText } from '@quire/core';
import { IngestError, MAX_BLOCKS, MAX_CHAPTERS } from './limits';

const SCENE_BREAK_PATTERN = /^\s*(?:\*\s*){3,}$|^\s*#\s*$|^\s*(?:~\s*){3,}$|^\s*(?:—|-){3,}\s*$/;
const CHAPTER_LINE_PATTERN = /^\s*(chapter|part|prologue|epilogue|interlude)\b/i;

/** Accumulates blocks into chapters. Shared by every format so splitting rules stay identical. */
export class ManuscriptBuilder {
  private readonly chapters: Chapter[] = [];
  private current: Chapter | null = null;
  private blockCount = 0;

  constructor(private readonly fallbackTitle: string) {}

  startChapter(title: string): void {
    if (this.chapters.length >= MAX_CHAPTERS) throw new IngestError(`More than ${MAX_CHAPTERS} chapters`);
    this.current = { id: newId('ch'), title: title.trim() || `Chapter ${this.chapters.length + 1}`, blocks: [] };
    this.chapters.push(this.current);
  }

  addHeading(level: number, runs: Run[]): void {
    const text = runsText(runs).trim();
    if (!text) return;
    if (level <= 1 || (level === 2 && CHAPTER_LINE_PATTERN.test(text) && !this.hasLevelOneChapters)) {
      this.startChapter(text);
      return;
    }
    this.push({ kind: 'heading', id: newId('b'), level: level === 2 ? 2 : 3, runs: normalizeRuns(runs) });
  }

  private hasLevelOneChapters = false;
  markLevelOneChapters(): void {
    this.hasLevelOneChapters = true;
  }

  addParagraph(runs: Run[], kind: 'paragraph' | 'quote' = 'paragraph'): void {
    const normalized = normalizeRuns(runs);
    const text = runsText(normalized);
    if (!text.trim()) return;
    if (SCENE_BREAK_PATTERN.test(text)) {
      this.addSceneBreak();
      return;
    }
    // Manuscripts written without heading styles still mark chapters with a short "Chapter 3" line.
    if (kind === 'paragraph' && text.length < 80 && CHAPTER_LINE_PATTERN.test(text) && !/[.!?]["”’]?$/.test(text.trim())) {
      this.startChapter(text);
      return;
    }
    this.push({ kind, id: newId('b'), runs: normalized });
  }

  addSceneBreak(): void {
    const last = this.current?.blocks.at(-1);
    if (!last || last.kind === 'scene-break') return;
    this.push({ kind: 'scene-break', id: newId('b') });
  }

  private push(block: Block): void {
    this.blockCount += 1;
    if (this.blockCount > MAX_BLOCKS) throw new IngestError(`More than ${MAX_BLOCKS} paragraphs`);
    if (!this.current) this.startChapter(this.chapters.length === 0 ? 'Opening' : '');
    this.current?.blocks.push(block);
  }

  build(meta: { title?: string; author?: string }): Manuscript {
    const chapters = this.chapters
      .map((chapter) => ({ ...chapter, blocks: trimSceneBreaks(chapter.blocks) }))
      .filter((chapter) => chapter.blocks.length > 0);
    if (chapters.length === 0) throw new IngestError('No readable text found');
    return { title: meta.title?.trim() || this.fallbackTitle, author: meta.author?.trim() || '', chapters };
  }
}

function trimSceneBreaks(blocks: Block[]): Block[] {
  let start = 0;
  let end = blocks.length;
  while (start < end && blocks[start]?.kind === 'scene-break') start += 1;
  while (end > start && blocks[end - 1]?.kind === 'scene-break') end -= 1;
  return blocks.slice(start, end);
}

/** Collapses whitespace and merges adjacent runs with identical marks. */
export function normalizeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    const text = run.text.replace(/[\t\r\n\u00A0]+/g, ' ');
    if (!text) continue;
    const previous = merged.at(-1);
    if (previous && Boolean(previous.em) === Boolean(run.em) && Boolean(previous.strong) === Boolean(run.strong)) {
      previous.text += text;
    } else {
      merged.push({ text, ...(run.em ? { em: true } : {}), ...(run.strong ? { strong: true } : {}) });
    }
  }
  const first = merged[0];
  if (first) first.text = first.text.replace(/^ +/, '');
  const last = merged.at(-1);
  if (last) last.text = last.text.replace(/ +$/, '');
  for (const run of merged) run.text = run.text.replace(/ {2,}/g, ' ');
  return merged.filter((run) => run.text.length > 0);
}
