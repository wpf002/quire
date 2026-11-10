import PDFDocument from 'pdfkit';
import { type Block, type Manuscript, type Run, TRIM_SIZES, estimatePrintPages } from '@quire/core';
import { bookFonts } from './fonts';
import { type ExportOptions, POINTS_PER_INCH, gutterInches } from './options';

const BODY_SIZE = 11;
const LINE_GAP = 3.2;
const INDENT_IN = 0.3;
const VERTICAL_MARGIN_IN = 0.75;
const CHAPTER_DROP_RATIO = 0.28;
const FOLIO_SIZE = 9;

type FontName = 'regular' | 'italic' | 'bold' | 'boldItalic';

function fontFor(run: Run): FontName {
  if (run.em && run.strong) return 'boldItalic';
  if (run.em) return 'italic';
  if (run.strong) return 'bold';
  return 'regular';
}

export interface PdfResult {
  buffer: Buffer;
  pageCount: number;
  gutterInches: number;
}

export async function exportPdf(manuscript: Manuscript, options: ExportOptions): Promise<PdfResult> {
  const trim = TRIM_SIZES[options.trim];
  const gutter = gutterInches(options.target, estimatePrintPages(manuscript));
  const margins = {
    top: VERTICAL_MARGIN_IN * POINTS_PER_INCH,
    bottom: VERTICAL_MARGIN_IN * POINTS_PER_INCH,
    // Symmetric margins at the gutter width satisfy both inside and outside minimums on every page.
    left: gutter * POINTS_PER_INCH,
    right: gutter * POINTS_PER_INCH,
  };
  const doc = new PDFDocument({
    size: [trim.widthIn * POINTS_PER_INCH, trim.heightIn * POINTS_PER_INCH],
    margins,
    autoFirstPage: false,
    bufferPages: true,
    pdfVersion: '1.7',
    info: {
      Title: manuscript.title,
      Author: manuscript.author,
      Creator: 'Quire',
      Producer: 'Quire',
      CreationDate: options.modifiedAt,
      ModDate: options.modifiedAt,
    },
  });
  const fonts = bookFonts();
  for (const [name, data] of Object.entries(fonts)) doc.registerFont(name, data);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const unnumberedPages = new Set<number>();
  const width = doc.page ? doc.page.width : trim.widthIn * POINTS_PER_INCH;
  const textWidth = width - margins.left - margins.right;
  const pageHeight = trim.heightIn * POINTS_PER_INCH;

  const newPage = (numbered: boolean) => {
    doc.addPage();
    if (!numbered) unnumberedPages.add(doc.bufferedPageRange().count - 1);
  };

  // Title page
  newPage(false);
  doc.font('regular').fontSize(26).text(manuscript.title, margins.left, pageHeight * 0.3, { width: textWidth, align: 'center' });
  doc.moveDown(2).fontSize(14).text(manuscript.author, { width: textWidth, align: 'center' });

  // Copyright page
  newPage(false);
  const copyrightLines = [`Copyright © ${options.publicationYear} ${manuscript.author}`, 'All rights reserved.'];
  if (options.isbn) copyrightLines.push(`ISBN ${options.isbn}`);
  doc.font('regular').fontSize(9).text(copyrightLines.join('\n'), margins.left, pageHeight * 0.65, { width: textWidth, align: 'left', lineGap: 2 });

  if (options.dedication) {
    newPage(false);
    doc.font('italic').fontSize(12).text(options.dedication, margins.left, pageHeight * 0.3, { width: textWidth, align: 'center' });
  }

  for (const chapter of manuscript.chapters) {
    newPage(false);
    doc.font('regular').fontSize(18).text(chapter.title, margins.left, pageHeight * CHAPTER_DROP_RATIO, { width: textWidth, align: 'center' });
    doc.moveDown(2.5);
    let indentNext = false;
    for (const block of chapter.blocks) {
      indentNext = writeBlock(doc, block, { textWidth, left: margins.left, indent: indentNext });
    }
  }

  if (options.aboutAuthor) {
    newPage(false);
    doc.font('regular').fontSize(16).text('About the Author', margins.left, pageHeight * CHAPTER_DROP_RATIO, { width: textWidth, align: 'center' });
    doc.moveDown(2).font('regular').fontSize(BODY_SIZE).text(options.aboutAuthor, { width: textWidth, align: 'justify', lineGap: LINE_GAP });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    if (unnumberedPages.has(index)) continue;
    doc.switchToPage(index);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(FOLIO_SIZE).text(String(index + 1), margins.left, pageHeight - margins.bottom / 2 - FOLIO_SIZE / 2, {
      width: textWidth,
      align: 'center',
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  await finished;
  return { buffer: Buffer.concat(chunks), pageCount: range.count, gutterInches: gutter };
}

/** Writes one block. Returns whether the next paragraph should take a first-line indent. */
function writeBlock(doc: PDFKit.PDFDocument, block: Block, layout: { textWidth: number; left: number; indent: boolean }): boolean {
  if (block.kind === 'scene-break') {
    doc.moveDown(0.6).font('regular').fontSize(BODY_SIZE).text('*   *   *', layout.left, doc.y, { width: layout.textWidth, align: 'center' });
    doc.moveDown(0.6);
    return false;
  }
  if (block.kind === 'heading') {
    doc.moveDown(0.8);
    writeRuns(doc, block.runs.map((run) => ({ ...run, em: block.level === 3, strong: block.level === 2 })), {
      ...layout, fontSize: BODY_SIZE + (block.level === 2 ? 1 : 0), align: 'left', indent: false,
    });
    doc.moveDown(0.3);
    return false;
  }
  if (block.kind === 'quote') {
    doc.moveDown(0.4);
    writeRuns(doc, block.runs.map((run) => ({ ...run, em: !run.em })), {
      textWidth: layout.textWidth - 2 * INDENT_IN * POINTS_PER_INCH,
      left: layout.left + INDENT_IN * POINTS_PER_INCH,
      fontSize: BODY_SIZE - 0.5,
      align: 'justify',
      indent: false,
    });
    doc.moveDown(0.4);
    return false;
  }
  writeRuns(doc, block.runs, { ...layout, fontSize: BODY_SIZE, align: 'justify' });
  return true;
}

function writeRuns(
  doc: PDFKit.PDFDocument,
  runs: Run[],
  layout: { textWidth: number; left: number; indent: boolean; fontSize: number; align: 'justify' | 'left' },
): void {
  runs.forEach((run, index) => {
    const isFirst = index === 0;
    const isLast = index === runs.length - 1;
    doc.font(fontFor(run)).fontSize(layout.fontSize);
    const textOptions: PDFKit.Mixins.TextOptions = {
      width: layout.textWidth,
      align: layout.align,
      lineGap: LINE_GAP,
      continued: !isLast,
      indent: isFirst && layout.indent ? INDENT_IN * POINTS_PER_INCH : 0,
    };
    if (isFirst) doc.text(run.text, layout.left, doc.y, textOptions);
    else doc.text(run.text, textOptions);
  });
}
