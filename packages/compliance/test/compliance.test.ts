import { describe, expect, it } from 'vitest';
import type { Manuscript } from '@quire/core';
import { type AuthorDeclaration, buildDisclosureReport, rightsChecklist, velocityStatus } from '../src';

const none = { used: false, extent: null, tool: null };
const declaration: AuthorDeclaration = { textGeneratedOutsideQuire: none, imagesGenerated: none, translationGenerated: none };

describe('buildDisclosureReport', () => {
  it('answers No for text when only assisted edits were accepted', () => {
    const report = buildDisclosureReport(
      [{ blockId: 'b1', aiRole: 'assisted', model: 'claude-haiku-5-5', wordsAdded: 2, authorRevised: false }],
      declaration,
      50_000,
    );
    expect(report.answers.find((answer) => answer.category === 'text')?.answer).toBe('No');
    expect(report.assistedEdits).toBe(1);
  });

  it('maps generated passages to a KDP extent option and names the tool', () => {
    const report = buildDisclosureReport(
      [{ blockId: 'b1', aiRole: 'generated', model: 'claude-sonnet-5-5', wordsAdded: 300, authorRevised: false }],
      declaration,
      50_000,
    );
    const text = report.answers.find((answer) => answer.category === 'text');
    expect(text?.answer).toBe('Yes');
    expect(text?.extent).toBe('Some sections, with minimal or no editing');
    expect(text?.tools).toEqual(['Claude (Anthropic)']);
  });

  it('takes the broader extent when the author declares outside use', () => {
    const report = buildDisclosureReport(
      [{ blockId: 'b1', aiRole: 'generated', model: 'claude-sonnet-5-5', wordsAdded: 300, authorRevised: true }],
      { ...declaration, textGeneratedOutsideQuire: { used: true, extent: 'Entire work, with extensive editing', tool: 'ChatGPT' } },
      50_000,
    );
    const text = report.answers.find((answer) => answer.category === 'text');
    expect(text?.extent).toBe('Entire work, with extensive editing');
    expect(text?.tools).toContain('ChatGPT');
  });
});

describe('rightsChecklist', () => {
  it('flags repeated paragraphs and long quotes', () => {
    const repeated = 'She walked the length of the pier twice before deciding that the boat was not coming back for her, not today and not ever.';
    const manuscript: Manuscript = {
      title: 'T',
      author: 'A',
      chapters: [
        {
          id: 'c1',
          title: 'One',
          blocks: [
            { kind: 'paragraph', id: 'p1', runs: [{ text: repeated }] },
            { kind: 'paragraph', id: 'p2', runs: [{ text: repeated }] },
            { kind: 'quote', id: 'q1', runs: [{ text: 'And she sang the chorus again, loud.' }] },
          ],
        },
      ],
    };
    const items = rightsChecklist(manuscript);
    expect(items.find((item) => item.id === 'duplicates')?.findings[0]?.blockId).toBe('p2');
    expect(items.find((item) => item.id === 'quotations')?.status).toBe('review');
  });
});

describe('velocityStatus', () => {
  it('blocks a fourth title inside 24 hours', () => {
    const now = new Date('2026-05-01T12:00:00Z');
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
    const status = velocityStatus([hoursAgo(1), hoursAgo(5), hoursAgo(20), hoursAgo(30)], now);
    expect(status.remaining).toBe(0);
    expect(status.nextSlotAt?.toISOString()).toBe('2026-05-01T16:00:00.000Z');
  });
});
