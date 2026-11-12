import { type PassKind, meteredGateway, newId } from '@quire/core';
import { blockTexts, dropDuplicateEdits, runPass } from '@quire/editing';
import { z } from 'zod';
import type { AppContext } from '../context';
import { toJson } from '../json';
import { enqueue } from '../queue';
import { advanceStage } from './books';
import { CountingLedger } from './counting-ledger';
import { requireManuscript } from './manuscripts';

export const PassJobSchema = z.object({ passId: z.string() });

export async function queuePass(context: AppContext, userId: string, bookId: string, kind: PassKind) {
  const { version } = await requireManuscript(context.prisma, bookId);
  const pass = await context.prisma.pass.create({ data: { id: newId('pass'), bookId, kind, manuscriptVersion: version } });
  const jobId = await enqueue(context.prisma, 'pass', { passId: pass.id }, userId);
  return { pass, jobId };
}

export async function runPassJob(context: AppContext, payload: unknown, final: boolean): Promise<void> {
  const { passId } = PassJobSchema.parse(payload);
  const pass = await context.prisma.pass.findUniqueOrThrow({ where: { id: passId }, include: { book: { select: { userId: true } } } });
  await context.prisma.pass.update({ where: { id: passId }, data: { status: 'running' } });
  try {
    const { manuscript } = await requireManuscript(context.prisma, pass.bookId, pass.manuscriptVersion);
    const ledger = new CountingLedger(context.ledger);
    const gateway = meteredGateway(context.gateway, ledger, { accountId: pass.book.userId, bookId: pass.bookId, purpose: `pass:${pass.kind}` });
    const result = await runPass(pass.kind, manuscript, gateway, { cheap: context.env.QUIRE_MODEL_CHEAP, structural: context.env.QUIRE_MODEL_STRUCTURAL });
    // Copyedit and proofread overlap, and a rule and the model can flag the same typo. The author reviews each fix once.
    const pending = await context.prisma.edit.findMany({ where: { bookId: pass.bookId, status: 'pending' }, select: { blockId: true, before: true, after: true } });
    const edits = dropDuplicateEdits(result.edits, pending, blockTexts(manuscript));
    await context.prisma.$transaction([
      context.prisma.edit.createMany({
        data: edits.map((edit) => ({
          id: newId('edit'),
          passId,
          bookId: pass.bookId,
          chapterId: edit.chapterId,
          blockId: edit.blockId,
          before: edit.before,
          after: edit.after,
          reason: edit.reason,
          rule: edit.rule,
          source: edit.source,
          aiRole: edit.aiRole,
        })),
      }),
      context.prisma.pass.update({
        where: { id: passId },
        data: {
          status: 'done',
          model: result.model,
          modelSkippedReason: result.modelSkippedReason,
          touch: toJson(result.touch),
          notes: toJson(result.notes),
          costCents: ledger.totalCents,
          finishedAt: context.clock(),
          error: null,
        },
      }),
    ]);
    await advanceStage(context.prisma, pass.bookId, 'edit');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.prisma.pass.update({ where: { id: passId }, data: final ? { status: 'failed', error: message, finishedAt: context.clock() } : { status: 'queued', error: message } });
    throw error;
  }
}
