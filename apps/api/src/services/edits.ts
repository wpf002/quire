import type { AppContext } from '../context';
import { badRequest } from '../errors';
import { applyChanges, requireManuscript, saveManuscript } from './manuscripts';

export interface EditDecision {
  id: string;
  action: 'accept' | 'reject';
  /** Author's own wording; accepting with this marks the edit author-revised. */
  after?: string;
}

export interface DecisionResult {
  accepted: string[];
  rejected: string[];
  /** Accepted edits whose text had already changed; left pending. */
  stale: string[];
  version: number | null;
}

/** Apply every accepted edit into one new manuscript version, so a bulk accept is one revision. */
export async function decideEdits(context: AppContext, bookId: string, decisions: EditDecision[]): Promise<DecisionResult> {
  const ids = decisions.map((decision) => decision.id);
  const edits = await context.prisma.edit.findMany({ where: { id: { in: ids }, bookId, status: 'pending' } });
  if (edits.length !== new Set(ids).size) throw badRequest('Some edits are not pending on this book');
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  const accepts = decisions.filter((decision) => decision.action === 'accept');
  const rejects = decisions.filter((decision) => decision.action === 'reject').map((decision) => decision.id);
  const now = context.clock();

  let version: number | null = null;
  let applied: string[] = [];
  let stale: string[] = [];
  if (accepts.length > 0) {
    const { manuscript } = await requireManuscript(context.prisma, bookId);
    const changes = accepts.map((decision) => {
      const edit = byId.get(decision.id)!;
      return { id: edit.id, blockId: edit.blockId, before: edit.before, after: decision.after ?? edit.after };
    });
    const outcome = applyChanges(manuscript, changes);
    applied = outcome.applied;
    stale = outcome.skipped;
    if (applied.length > 0) version = await saveManuscript(context.prisma, bookId, outcome.manuscript, `edits:${applied.length}`);
  }

  await context.prisma.$transaction([
    ...accepts
      .filter((decision) => applied.includes(decision.id))
      .map((decision) => {
        const edit = byId.get(decision.id)!;
        const revised = decision.after !== undefined && decision.after !== edit.after;
        return context.prisma.edit.update({ where: { id: edit.id }, data: { status: 'accepted', decidedAt: now, authorRevised: revised, after: decision.after ?? edit.after } });
      }),
    context.prisma.edit.updateMany({ where: { id: { in: rejects } }, data: { status: 'rejected', decidedAt: now } }),
  ]);
  return { accepted: applied, rejected: rejects, stale, version };
}
