import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { Manuscript } from '@quire/core';
import { exportEpub, exportPdf, gutterInches, preflight, type ExportOptions } from '../src';

const manuscript: Manuscript = {
  title: 'The <Quiet> House',
  author: 'Ana & Bo',
  chapters: Array.from({ length: 3 }, (_, chapterIndex) => ({
    id: `c${chapterIndex}`,
    title: `Chapter ${chapterIndex + 1}`,
    blocks: [
      ...Array.from({ length: 30 }, (_, index) => ({
        kind: 'paragraph' as const,
        id: `p${chapterIndex}-${index}`,
        runs: [{ text: 'The house was quiet and the rain kept on. ' }, { text: 'Nobody', em: true }, { text: ' came to the door that night.' }],
      })),
      { kind: 'scene-break' as const, id: `s${chapterIndex}` },
      { kind: 'quote' as const, id: `q${chapterIndex}`, runs: [{ text: 'A letter, unsigned.' }] },
    ],
  })),
};

const options: ExportOptions = {
  target: 'kdp',
  trim: '6x9',
  publicationYear: 2026,
  modifiedAt: new Date('2026-01-01T00:00:00Z'),
  isbn: null,
  aboutAuthor: 'Writes in a cabin.',
  dedication: null,
};

describe('exportEpub', () => {
  it('stores mimetype first and uncompressed, and escapes metadata', async () => {
    const buffer = await exportEpub(manuscript, options);
    expect(buffer.subarray(30, 38).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(buffer);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('The &lt;Quiet&gt; House');
    expect(opf).toContain('Ana &amp; Bo');
    expect(Object.keys(zip.files)).toContain('OEBPS/chapter-003.xhtml');
  });

  it('is deterministic', async () => {
    const first = await exportEpub(manuscript, options);
    const second = await exportEpub(manuscript, options);
    expect(first.equals(second)).toBe(true);
  });
});

describe('exportPdf', () => {
  it('produces a multi-page PDF with embedded fonts', async () => {
    const result = await exportPdf(manuscript, options);
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.pageCount).toBeGreaterThan(4);
    expect(result.buffer.toString('latin1')).toContain('/FontFile');
  }, 20_000);
});

describe('gutterInches', () => {
  it('grows with page count and never drops below the comfort margin', () => {
    expect(gutterInches('kdp', 100)).toBe(0.625);
    expect(gutterInches('kdp', 650)).toBe(0.75);
    expect(gutterInches('ingramspark', 800)).toBe(1);
  });
});

describe('preflight', () => {
  it('fails IngramSpark without an ISBN and flags short books', () => {
    const checks = preflight(manuscript, { ...options, target: 'ingramspark' }, 12);
    expect(checks.find((check) => check.id === 'isbn')?.level).toBe('fail');
    expect(checks.find((check) => check.id === 'pages')?.level).toBe('fail');
  });
});
