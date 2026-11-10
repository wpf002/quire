import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { manuscriptWordCount } from '@quire/core';
import { detectFormat, ingestEpub, ingestManuscript, ingestMarkdown, IngestError } from '../src';

const SAMPLE = `# Chapter One

It was a *quiet* morning. The kettle **screamed** anyway.

* * *

She left at noon.

# Chapter Two

> A letter, unsigned.

Nobody answered.
`;

describe('ingestMarkdown', () => {
  it('splits chapters on level-one headings and keeps marks', () => {
    const manuscript = ingestMarkdown(SAMPLE, 'Fallback');
    expect(manuscript.chapters.map((chapter) => chapter.title)).toEqual(['Chapter One', 'Chapter Two']);
    const first = manuscript.chapters[0]!;
    expect(first.blocks.map((block) => block.kind)).toEqual(['paragraph', 'scene-break', 'paragraph']);
    const runs = first.blocks[0]!.kind === 'paragraph' ? first.blocks[0]!.runs : [];
    expect(runs).toContainEqual({ text: 'quiet', em: true });
    expect(runs).toContainEqual({ text: 'screamed', strong: true });
    expect(manuscript.chapters[1]!.blocks[0]!.kind).toBe('quote');
  });

  it('detects plain "Chapter 3" lines as chapter starts', () => {
    const manuscript = ingestMarkdown('Chapter 1\n\nOne.\n\nChapter 2\n\nTwo.', 'Book');
    expect(manuscript.chapters).toHaveLength(2);
    expect(manuscriptWordCount(manuscript)).toBe(2);
  });
});

describe('ingestEpub', () => {
  it('reads the spine in order', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
    zip.file(
      'OEBPS/content.opf',
      `<package><metadata><dc:title>The Test</dc:title><dc:creator>A. Writer</dc:creator></metadata>
       <manifest><item id="c2" href="two.xhtml"/><item id="c1" href="one.xhtml"/></manifest>
       <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    );
    zip.file('OEBPS/one.xhtml', '<html><body><h1>First</h1><p>Alpha &amp; beta.</p></body></html>');
    zip.file('OEBPS/two.xhtml', '<html><body><h1>Second</h1><p>Gamma.</p></body></html>');
    const manuscript = await ingestEpub(await zip.generateAsync({ type: 'nodebuffer' }), 'x');
    expect(manuscript.title).toBe('The Test');
    expect(manuscript.author).toBe('A. Writer');
    expect(manuscript.chapters.map((chapter) => chapter.title)).toEqual(['First', 'Second']);
  });

  it('rejects archives with traversal paths', async () => {
    const zip = new JSZip();
    zip.file('../evil.txt', 'x');
    await expect(ingestEpub(await zip.generateAsync({ type: 'nodebuffer' }), 'x')).rejects.toBeInstanceOf(IngestError);
  });
});

describe('detectFormat', () => {
  it('refuses a docx extension on a non-zip file', () => {
    expect(() => detectFormat('book.docx', Buffer.from('hello'))).toThrow(IngestError);
  });
  it('rejects empty uploads', async () => {
    await expect(ingestManuscript('empty.md', Buffer.from('   '))).rejects.toBeInstanceOf(IngestError);
  });
});
