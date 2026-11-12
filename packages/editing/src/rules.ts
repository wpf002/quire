import { type Chapter, type Manuscript, blockText, isTextBlock } from '@quire/core';
import type { EditProposal } from './types';

export interface TextRule {
  id: string;
  reason: string;
  /** Returns [before, after] fragments, each `before` unique enough to locate in the block. */
  find(text: string): Array<[string, string]>;
}

const CONTEXT_CHARS = 12;

/** Grows a match with surrounding context so the replacement targets one spot. */
function withContext(text: string, index: number, length: number, replacement: string): [string, string] {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(text.length, index + length + CONTEXT_CHARS);
  const before = text.slice(start, end);
  const after = text.slice(start, index) + replacement + text.slice(index + length, end);
  return [before, after];
}

function regexRule(id: string, reason: string, pattern: RegExp, replace: (match: RegExpExecArray) => string | null): TextRule {
  return {
    id,
    reason,
    find(text) {
      const found: Array<[string, string]> = [];
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const replacement = replace(match);
        if (replacement !== null && replacement !== match[0]) found.push(withContext(text, match.index, match[0].length, replacement));
        if (match[0].length === 0) regex.lastIndex += 1;
      }
      return found;
    },
  };
}

function curlQuotes(text: string): string {
  return text
    .replace(/(^|[\s([{—–-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/(^|[\s([{—–-])'/g, '$1‘')
    .replace(/'/g, '’');
}

const COMMON_MISSPELLINGS: Record<string, string> = {
  recieve: 'receive', recieved: 'received', seperate: 'separate', definately: 'definitely', occured: 'occurred',
  untill: 'until', wierd: 'weird', accomodate: 'accommodate', acheive: 'achieve', beleive: 'believe',
  calender: 'calendar', concious: 'conscious', embarass: 'embarrass', existance: 'existence', goverment: 'government',
  independant: 'independent', occassion: 'occasion', persistant: 'persistent', posession: 'possession',
  refered: 'referred', succesful: 'successful', tommorow: 'tomorrow', truely: 'truly', alot: 'a lot',
};

export const COPYEDIT_RULES: TextRule[] = [
  {
    id: 'smart-quotes',
    reason: 'Straight quotes to typographic quotes',
    find(text) {
      if (!/["']/.test(text)) return [];
      return [[text, curlQuotes(text)]];
    },
  },
  regexRule('em-dash', 'Double hyphen to em dash', /\s?--\s?/, () => '—'),
  regexRule('ellipsis', 'Three periods to an ellipsis', /\.\s?\.\s?\./, () => '…'),
  regexRule('space-before-punctuation', 'Space before punctuation', /(\p{L}) +([,.;:!?])/u, (match) => `${match[1]}${match[2]}`),
  regexRule('misspelling', 'Common misspelling', /\b[a-z]+\b/i, (match) => {
    const fix = COMMON_MISSPELLINGS[match[0].toLowerCase()];
    if (!fix) return null;
    return match[0][0] === match[0][0]?.toUpperCase() ? fix[0]!.toUpperCase() + fix.slice(1) : fix;
  }),
];

export const PROOFREAD_RULES: TextRule[] = [
  regexRule('repeated-word', 'Repeated word', /\b(\p{L}+)\s+\1\b/iu, (match) => {
    const word = match[1] ?? '';
    // "had had" and "that that" are often intended.
    if (['had', 'that'].includes(word.toLowerCase())) return null;
    return word;
  }),
  // After a closing quote the next word is usually a dialogue tag ("Ready?" he asked), so only bare punctuation counts.
  regexRule('sentence-case', 'Sentence starts lowercase', /([.!?]\s+)([a-z])/, (match) => `${match[1]}${match[2]!.toUpperCase()}`),
  regexRule('double-space', 'Extra space between words', /(\S) {2,}(?=\S)/, (match) => `${match[1]} `),
  regexRule('missing-space', 'Missing space after punctuation', /([a-z][,;])([A-Za-z])/, (match) => `${match[1]} ${match[2]}`),
];

export function applyRules(manuscript: Manuscript, rules: TextRule[]): { edits: EditProposal[]; blocksExamined: number } {
  const edits: EditProposal[] = [];
  let blocksExamined = 0;
  for (const chapter of manuscript.chapters) edits.push(...rulesForChapter(chapter, rules, () => (blocksExamined += 1)));
  return { edits, blocksExamined };
}

function rulesForChapter(chapter: Chapter, rules: TextRule[], onBlock: () => void): EditProposal[] {
  const edits: EditProposal[] = [];
  for (const block of chapter.blocks) {
    if (!isTextBlock(block)) continue;
    onBlock();
    const text = blockText(block);
    for (const rule of rules) {
      for (const [before, after] of rule.find(text)) {
        edits.push({
          chapterId: chapter.id, blockId: block.id, before, after,
          reason: rule.reason, rule: rule.id, source: 'rule', aiRole: 'none',
        });
      }
    }
  }
  return dedupeOverlapping(edits);
}

/** Keeps the first edit per overlapping span so accepting one never invalidates another silently. */
function dedupeOverlapping(edits: EditProposal[]): EditProposal[] {
  const seen = new Set<string>();
  return edits.filter((edit) => {
    const key = `${edit.blockId}:${edit.before}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
