import { type Manuscript, TRIM_SIZES, blockText } from '@quire/core';
import { KDP_MAX_PAGES, KDP_MIN_PAGES, type ExportOptions } from './options';

export type PreflightLevel = 'pass' | 'warn' | 'fail';
export interface PreflightCheck {
  id: string;
  label: string;
  level: PreflightLevel;
  detail: string;
}

// Characters outside the embedded Latin subset render as missing glyphs.
// eslint-disable-next-line no-control-regex -- the range starts at NUL on purpose: everything in Basic Latin is covered.
const OUTSIDE_LATIN_PATTERN = /[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/u;
const ISBN_13_PATTERN = /^97[89]\d{10}$/;

export function preflight(manuscript: Manuscript, options: ExportOptions, pageCount: number | null): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const trim = TRIM_SIZES[options.trim];
  checks.push({ id: 'trim', label: 'Trim Size', level: 'pass', detail: trim.label });

  if (pageCount !== null) {
    const level: PreflightLevel = pageCount < KDP_MIN_PAGES || pageCount > KDP_MAX_PAGES ? 'fail' : 'pass';
    checks.push({ id: 'pages', label: 'Page Count', level, detail: `${pageCount} pages (KDP allows ${KDP_MIN_PAGES}–${KDP_MAX_PAGES})` });
  }

  const offending = manuscript.chapters.flatMap((chapter) => chapter.blocks.map(blockText)).find((text) => OUTSIDE_LATIN_PATTERN.test(text));
  checks.push({
    id: 'glyphs',
    label: 'Font Coverage',
    level: offending ? 'warn' : 'pass',
    detail: offending ? 'Some characters fall outside the embedded font' : 'All characters covered by embedded EB Garamond',
  });

  const digits = options.isbn?.replace(/[^0-9]/g, '') ?? '';
  checks.push({
    id: 'isbn',
    label: 'ISBN',
    level: !options.isbn ? (options.target === 'ingramspark' ? 'fail' : 'warn') : ISBN_13_PATTERN.test(digits) ? 'pass' : 'fail',
    detail: !options.isbn
      ? options.target === 'ingramspark' ? 'IngramSpark requires your own ISBN' : 'KDP can assign a free ISBN'
      : ISBN_13_PATTERN.test(digits) ? options.isbn : 'Not a valid ISBN-13',
  });

  const emptyChapters = manuscript.chapters.filter((chapter) => chapter.blocks.length < 2).length;
  checks.push({
    id: 'chapters',
    label: 'Chapters',
    level: emptyChapters > 0 ? 'warn' : 'pass',
    detail: emptyChapters > 0 ? `${emptyChapters} near-empty chapters` : `${manuscript.chapters.length} chapters`,
  });
  return checks;
}
