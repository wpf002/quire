import { type ExportTarget, type TrimSize, newId } from '@quire/core';
import { type ChecklistItem } from '@quire/compliance';
import { type ExportOptions, exportEpub, exportPdf, preflight } from '@quire/export';
import { estimatePrintPages } from '@quire/core';
import type { AppContext } from '../context';
import { conflict } from '../errors';
import { fromJson, toJson } from '../json';
import { advanceStage } from './books';
import { unconfirmedItems } from './compliance';
import { requireManuscript } from './manuscripts';

export type ExportFormat = 'epub' | 'pdf';

export async function createExport(context: AppContext, bookId: string, format: ExportFormat, target: ExportTarget, trim: TrimSize) {
  const report = await context.prisma.complianceReport.findFirst({ where: { bookId }, orderBy: { createdAt: 'desc' } });
  if (!report) throw conflict('Run the compliance check before exporting');
  const open = unconfirmedItems(fromJson<ChecklistItem[]>(report.checklist), report.confirmations);
  if (open.length > 0) throw conflict(`Confirm ${open.length} rights ${open.length === 1 ? 'item' : 'items'} before exporting`);

  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const { manuscript } = await requireManuscript(context.prisma, bookId);
  const now = context.clock();
  const options: ExportOptions = {
    target,
    trim,
    publicationYear: (book.publishedAt ?? now).getUTCFullYear(),
    modifiedAt: now,
    isbn: book.isbn,
    aboutAuthor: book.aboutAuthor,
    dedication: book.dedication,
  };
  let buffer: Buffer;
  let pageCount: number | null = null;
  if (format === 'pdf') {
    const pdf = await exportPdf(manuscript, options);
    buffer = pdf.buffer;
    pageCount = pdf.pageCount;
  } else {
    buffer = await exportEpub(manuscript, options);
  }
  const checks = preflight(manuscript, options, pageCount ?? estimatePrintPages(manuscript));
  const id = newId('exp');
  const storagePath = await context.storage.put(`exports/${bookId}/${id}.${format}`, buffer);
  const row = await context.prisma.export.create({
    data: { id, bookId, format, target, trimSize: trim, storagePath, bytes: buffer.length, pageCount, preflight: toJson(checks) },
  });
  await advanceStage(context.prisma, bookId, 'export');
  return row;
}

/** Download names come from the title, reduced to safe characters. */
export function downloadName(title: string, format: string, target: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'book';
  return `${slug}-${target}.${format}`;
}
