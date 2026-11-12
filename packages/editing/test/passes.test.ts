import { describe, expect, it } from 'vitest';
import type { Manuscript, ModelGateway } from '@quire/core';
import { blockTexts, classifyModelEdit, dropDuplicateEdits, manuscriptForReview, runPass, unavailableForTest } from './helpers';

const manuscript: Manuscript = {
  title: 'T',
  author: 'A',
  chapters: [
    {
      id: 'c1',
      title: 'One',
      blocks: [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'She said "hello" -- then left... It was weird , and the the door shut.' }] },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'I recieved it. then nothing.' }] },
      ],
    },
  ],
};

const models = { cheap: 'claude-haiku-5-5', structural: 'claude-sonnet-5-5' };

describe('runPass rules', () => {
  it('copyedit fixes quotes, dashes, ellipses, spacing, and misspellings', async () => {
    const result = await runPass('copyedit', manuscript, unavailableForTest, models);
    const rules = result.edits.map((edit) => edit.rule);
    expect(rules).toEqual(expect.arrayContaining(['smart-quotes', 'em-dash', 'ellipsis', 'space-before-punctuation', 'misspelling']));
    expect(result.touch.aiRole).toBe('none');
    expect(result.modelSkippedReason).toBe('No model key configured');
  });

  it('proofread catches repeated words and lowercase sentence starts', async () => {
    const result = await runPass('proofread', manuscript, unavailableForTest, models);
    const fixes = result.edits.map((edit) => edit.after);
    expect(fixes.some((after) => after.includes('and the door'))).toBe(true);
    expect(fixes.some((after) => after.includes('. Then'))).toBe(true);
  });
});

describe('proofread rules', () => {
  const dialogue: Manuscript = {
    title: 'T',
    author: 'A',
    chapters: [{ id: 'c1', title: 'One', blocks: [{ kind: 'paragraph', id: 'p1', runs: [{ text: '"You locked up?" he asked. “Yes.” she said. Flour.  She left.' }] }] }],
  };

  // Regression: `?" he asked` was flagged as a lowercase sentence start and capitalized.
  it('leaves dialogue tags after a closing quote lowercase', async () => {
    const result = await runPass('proofread', dialogue, unavailableForTest, models);
    expect(result.edits.filter((edit) => edit.rule === 'sentence-case')).toEqual([]);
  });

  it('collapses a double space between sentences', async () => {
    const result = await runPass('proofread', dialogue, unavailableForTest, models);
    expect(result.edits.some((edit) => edit.rule === 'double-space' && edit.after.includes('Flour. She'))).toBe(true);
  });
});

describe('runPass model', () => {
  it('drops model edits whose "before" text is not in the manuscript', async () => {
    const gateway: ModelGateway = {
      available: true,
      async complete() {
        return {
          model: 'claude-haiku-5-5',
          tokens: { input: 10, output: 10 },
          text: JSON.stringify([
            { id: 'p2', before: 'I recieved it.', after: 'I received it.', reason: 'Spelling' },
            { id: 'p2', before: 'invented text', after: 'x', reason: 'bogus' },
            { id: 'missing', before: 'a', after: 'b', reason: 'bogus' },
          ]),
        };
      },
    };
    const result = await runPass('proofread', manuscript, gateway, models);
    const modelEdits = result.edits.filter((edit) => edit.source === 'model');
    expect(modelEdits).toHaveLength(1);
    expect(modelEdits[0]?.aiRole).toBe('assisted');
    expect(result.touch.aiRole).toBe('assisted');
  });

  it('labels structural notes generic unless the quote is verified', async () => {
    const gateway: ModelGateway = {
      available: true,
      async complete() {
        return {
          model: 'claude-sonnet-5-5',
          tokens: { input: 10, output: 10 },
          text: JSON.stringify([
            { chapter: 1, note: 'Opening stalls.', quote: 'I recieved it.' },
            { chapter: 1, note: 'Raise stakes.', quote: 'not in the book' },
            { chapter: null, note: 'Consider pacing.', quote: null },
          ]),
        };
      },
    };
    const result = await runPass('structural', manuscript, gateway, models);
    expect(result.notes.map((note) => note.specificity)).toEqual(['specific', 'generic', 'generic']);
  });
});

describe('classifyModelEdit', () => {
  it('treats a small fix as assisted', () => {
    expect(classifyModelEdit('its cold', "it's cold")).toBe('assisted');
  });
  it('treats new prose as generated', () => {
    const after = 'The rain came down hard, drumming against windows while the old house groaned under its weight and every shutter rattled like teeth in a skull that refused silence through the night.';
    expect(classifyModelEdit('It rained.', after)).toBe('generated');
  });
});

describe('manuscriptForReview', () => {
  it('does not repeat a chapter number the title already has', () => {
    // Regression: "Chapter 1: The Missing Loaf" reached the model as "Chapter 1: Chapter 1: ...", and it flagged the heading.
    const numbered: Manuscript = { ...manuscript, chapters: [{ ...manuscript.chapters[0]!, title: 'Chapter 1: The Missing Loaf' }, { ...manuscript.chapters[0]!, id: 'c2', title: 'The Key' }] };
    const review = manuscriptForReview(numbered);
    expect(review).toContain('## Chapter 1: The Missing Loaf\n');
    expect(review).not.toContain('Chapter 1: Chapter 1');
    expect(review).toContain('## Chapter 2: The Key\n');
  });
});

describe('dropDuplicateEdits', () => {
  const texts = blockTexts(manuscript);

  // Regression: copyedit's model and proofread's rule both proposed "the the" → "the", so the author reviewed it twice.
  it('drops a fix another edit already makes, whatever span it quotes', () => {
    const existing = [{ blockId: 'p1', before: 'the the door', after: 'the door' }];
    const candidates = [
      { blockId: 'p1', before: 'the the', after: 'the' },
      { blockId: 'p1', before: 'weird ,', after: 'weird,' },
      { blockId: 'p1', before: 'weird ,', after: 'weird,' },
    ];
    expect(dropDuplicateEdits(candidates, existing, texts)).toEqual([{ blockId: 'p1', before: 'weird ,', after: 'weird,' }]);
  });

  it('keeps edits it cannot place in the block', () => {
    const stale = { blockId: 'p1', before: 'not in the text', after: 'x' };
    expect(dropDuplicateEdits([stale], [stale], texts)).toEqual([stale]);
  });
});
