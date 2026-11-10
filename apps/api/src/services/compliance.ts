import { type AuthorDeclaration, KDP_TITLES_PER_DAY, buildDisclosureReport, rightsChecklist, velocityStatus } from '@quire/compliance';
import { countWords, manuscriptWordCount, newId } from '@quire/core';
import type { ChecklistItem } from '@quire/compliance';
import type { AppContext } from '../context';
import { fromJson, toJson } from '../json';
import { advanceStage } from './books';
import { requireManuscript } from './manuscripts';

export const EMPTY_DECLARATION: AuthorDeclaration = {
  textGeneratedOutsideQuire: { used: false, extent: null, tool: null },
  imagesGenerated: { used: false, extent: null, tool: null },
  translationGenerated: { used: false, extent: null, tool: null },
};

export async function buildComplianceReport(context: AppContext, bookId: string) {
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const { manuscript } = await requireManuscript(context.prisma, bookId);
  const accepted = await context.prisma.edit.findMany({ where: { bookId, status: 'accepted' }, include: { pass: { select: { model: true } } } });
  const touches = accepted.map((edit) => ({
    blockId: edit.blockId,
    aiRole: edit.aiRole,
    model: edit.source === 'model' ? edit.pass.model : null,
    wordsAdded: edit.aiRole === 'generated' ? Math.max(0, countWords(edit.after) - countWords(edit.before)) : 0,
    authorRevised: edit.authorRevised,
  }));
  const declaration = book.declaration ? fromJson<AuthorDeclaration>(book.declaration) : EMPTY_DECLARATION;
  const disclosure = buildDisclosureReport(touches, declaration, manuscriptWordCount(manuscript));
  const checklist = rightsChecklist(manuscript);

  // Keep confirmations for items that still need them.
  const previous = await context.prisma.complianceReport.findFirst({ where: { bookId }, orderBy: { createdAt: 'desc' } });
  const stillConfirmable = new Set(checklist.filter((item) => item.status === 'confirm').map((item) => item.id));
  const confirmations = (previous?.confirmations ?? []).filter((id) => stillConfirmable.has(id));
  const report = await context.prisma.complianceReport.create({
    data: { id: newId('cmp'), bookId, disclosure: toJson(disclosure), checklist: toJson(checklist), confirmations },
  });
  await advanceStage(context.prisma, bookId, 'comply');
  return report;
}

export async function publishingVelocity(context: AppContext, userId: string) {
  const published = await context.prisma.book.findMany({ where: { userId, publishedAt: { not: null } }, select: { publishedAt: true } });
  const status = velocityStatus(
    published.map((book) => book.publishedAt!),
    context.clock(),
  );
  return { ...status, limit: KDP_TITLES_PER_DAY };
}

/** Items the author must confirm before export, minus those already confirmed. */
export function unconfirmedItems(checklist: ChecklistItem[], confirmations: string[]): ChecklistItem[] {
  return checklist.filter((item) => item.status === 'confirm' && !confirmations.includes(item.id));
}
