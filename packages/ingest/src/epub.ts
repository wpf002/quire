import { parse } from 'node-html-parser';
import type { Manuscript } from '@quire/core';
import { assertArchiveWithinLimits, readEntryText } from './archive';
import { ManuscriptBuilder } from './builder';
import { decodeEntities, feedHtml } from './html';
import { IngestError } from './limits';

export async function ingestEpub(buffer: Buffer, fallbackTitle: string): Promise<Manuscript> {
  const zip = await assertArchiveWithinLimits(buffer);
  const container = await readEntryText(zip, 'META-INF/container.xml');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new IngestError('EPUB is missing its package file');
  const opf = await readEntryText(zip, opfPath);
  if (!opf) throw new IngestError('EPUB package file is unreadable');

  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfDoc = parse(opf);
  const manifest = new Map<string, string>();
  for (const item of opfDoc.querySelectorAll('item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const properties = item.getAttribute('properties') ?? '';
    if (id && href && !properties.includes('nav')) manifest.set(id, href);
  }
  const title = decodeEntities(opfDoc.querySelector('dc\\:title')?.text ?? '');
  const author = decodeEntities(opfDoc.querySelector('dc\\:creator')?.text ?? '');

  const builder = new ManuscriptBuilder(fallbackTitle);
  for (const itemref of opfDoc.querySelectorAll('itemref')) {
    const href = manifest.get(itemref.getAttribute('idref') ?? '');
    if (!href) continue;
    const html = await readEntryText(zip, baseDir + decodeURIComponent(href));
    if (!html) continue;
    // Each spine document is its own chapter when it has no headings of its own.
    const document = parse(html);
    const hasHeading = document.querySelector('h1, h2') !== null;
    if (!hasHeading) builder.startChapter('');
    feedHtml(html, builder);
  }
  return builder.build({ title, author });
}
