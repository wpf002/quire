import { type Manuscript, blockText } from '@quire/core';

export type CheckStatus = 'pass' | 'review' | 'confirm';
export interface ChecklistItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Locations the author should look at. */
  findings: Array<{ chapterId: string; blockId: string; excerpt: string }>;
}

const LONG_QUOTE_WORDS = 50;
const DUPLICATE_MIN_CHARS = 120;
const EXCERPT_CHARS = 90;
// Lines that read like lyrics or poetry quoted from someone else: short lines inside quote blocks.
const LYRIC_HINT = /\b(chorus|verse|lyrics|sang|singing)\b/i;
const QUOTED_SPAN = /[“"]([^”"]{40,})[”"]/g;
const TRADEMARKS = ['Coca-Cola', 'Kleenex', 'Xerox', 'Google', 'iPhone', 'Disney', 'Harry Potter', 'Star Wars', 'Marvel', 'Barbie', 'Lego'];

function excerpt(text: string): string {
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

/** Pre-export rights checklist. Automated checks flag spots to review; Quire can't decide rights questions for the author. */
export function rightsChecklist(manuscript: Manuscript): ChecklistItem[] {
  const blocks = manuscript.chapters.flatMap((chapter) => chapter.blocks.map((block) => ({ chapterId: chapter.id, block, text: blockText(block) })));

  const longQuotes = blocks.filter(({ block, text }) => {
    if (block.kind === 'quote') return text.split(/\s+/).length >= LONG_QUOTE_WORDS || LYRIC_HINT.test(text);
    return [...text.matchAll(QUOTED_SPAN)].some((match) => (match[1] ?? '').split(/\s+/).length >= LONG_QUOTE_WORDS);
  });

  const seen = new Map<string, string>();
  const duplicates = blocks.filter(({ block, text }) => {
    if (text.length < DUPLICATE_MIN_CHARS) return false;
    const key = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return true;
    seen.set(key, block.id);
    return false;
  });

  const trademarkPattern = new RegExp(`\\b(${TRADEMARKS.map((mark) => mark.replace(/[-]/g, '\\-')).join('|')})\\b`);
  const trademarks = blocks.filter(({ text }) => trademarkPattern.test(text));

  const toFindings = (list: typeof blocks) => list.slice(0, 20).map(({ chapterId, block, text }) => ({ chapterId, blockId: block.id, excerpt: excerpt(text) }));

  return [
    {
      id: 'ownership',
      label: 'You Hold the Rights',
      status: 'confirm',
      detail: 'You wrote this book or hold publishing rights to every part of it.',
      findings: [],
    },
    {
      id: 'quotations',
      label: 'Quoted Material',
      status: longQuotes.length > 0 ? 'review' : 'pass',
      detail: longQuotes.length > 0 ? `${longQuotes.length} long quotations or possible lyrics. Song lyrics almost always need a license.` : 'No long quotations found.',
      findings: toFindings(longQuotes),
    },
    {
      id: 'duplicates',
      label: 'Repeated Passages',
      status: duplicates.length > 0 ? 'review' : 'pass',
      detail: duplicates.length > 0 ? `${duplicates.length} paragraphs appear more than once. KDP flags duplicated content.` : 'No repeated paragraphs.',
      findings: toFindings(duplicates),
    },
    {
      id: 'trademarks',
      label: 'Trademarks',
      status: trademarks.length > 0 ? 'review' : 'pass',
      detail: trademarks.length > 0 ? `${trademarks.length} passages name a trademark. Passing mentions are fine. Titles, covers and keywords are not.` : 'No common trademarks found.',
      findings: toFindings(trademarks),
    },
    {
      id: 'public-domain',
      label: 'Public Domain Content',
      status: 'confirm',
      detail: 'If the book is mostly public domain text, it needs a differentiated edition (annotations, translation, illustrations) or KDP may block it.',
      findings: [],
    },
    {
      id: 'originality',
      label: 'Web Originality',
      status: 'confirm',
      detail: "Quire doesn't compare your text against the web. Run a plagiarism checker if any part came from outside sources.",
      findings: [],
    },
  ];
}
