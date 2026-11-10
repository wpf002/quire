import type { Manuscript } from '@quire/core';
import { ingestDocx } from './docx';
import { ingestEpub } from './epub';
import { ingestMarkdown } from './markdown';
import { IngestError, MAX_UPLOAD_BYTES } from './limits';

export { IngestError, MAX_UPLOAD_BYTES } from './limits';
export { ingestDocx, ingestEpub, ingestMarkdown };

export const SUPPORTED_FORMATS = ['docx', 'epub', 'md'] as const;
export type ManuscriptFormat = (typeof SUPPORTED_FORMATS)[number];

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function detectFormat(filename: string, buffer: Buffer): ManuscriptFormat {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const isZip = ZIP_MAGIC.every((byte, index) => buffer[index] === byte);
  if (extension === 'docx' && isZip) return 'docx';
  if (extension === 'epub' && isZip) return 'epub';
  if ((extension === 'md' || extension === 'markdown' || extension === 'txt') && !isZip) return 'md';
  throw new IngestError('Upload a .docx, .epub, or .md file');
}

export async function ingestManuscript(filename: string, buffer: Buffer): Promise<Manuscript> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new IngestError('File is larger than 25 MB');
  const format = detectFormat(filename, buffer);
  const fallbackTitle = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
  if (format === 'docx') return ingestDocx(buffer, fallbackTitle);
  if (format === 'epub') return ingestEpub(buffer, fallbackTitle);
  return ingestMarkdown(buffer.toString('utf8'), fallbackTitle);
}
