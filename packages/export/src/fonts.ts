import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// EB Garamond (SIL Open Font License). Embedded in every PDF; KDP and IngramSpark reject unembedded fonts.
const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource/eb-garamond/package.json')), 'files');

export interface FontSet {
  regular: Buffer;
  italic: Buffer;
  bold: Buffer;
  boldItalic: Buffer;
}

let cached: FontSet | null = null;

export function bookFonts(): FontSet {
  cached ??= {
    regular: readFileSync(join(fontDir, 'eb-garamond-latin-400-normal.woff')),
    italic: readFileSync(join(fontDir, 'eb-garamond-latin-400-italic.woff')),
    bold: readFileSync(join(fontDir, 'eb-garamond-latin-700-normal.woff')),
    boldItalic: readFileSync(join(fontDir, 'eb-garamond-latin-700-italic.woff')),
  };
  return cached;
}
