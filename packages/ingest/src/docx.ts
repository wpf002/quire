import mammoth from 'mammoth';
import type { Manuscript } from '@quire/core';
import { ManuscriptBuilder } from './builder';
import { feedHtml } from './html';
import { assertArchiveWithinLimits } from './archive';

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Chapter Title'] => h1:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
];

export async function ingestDocx(buffer: Buffer, fallbackTitle: string): Promise<Manuscript> {
  await assertArchiveWithinLimits(buffer);
  const result = await mammoth.convertToHtml(
    { buffer },
    { styleMap: STYLE_MAP, convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
  );
  const builder = new ManuscriptBuilder(fallbackTitle);
  feedHtml(result.value, builder);
  return builder.build({});
}
