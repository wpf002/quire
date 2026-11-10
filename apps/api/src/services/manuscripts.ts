import { type Manuscript, ManuscriptSchema, isTextBlock, manuscriptWordCount, newId, replaceInBlock } from '@quire/core';
import type { PrismaClient } from '@quire/db';
import { badRequest } from '../errors';
import { toJson } from '../json';

export interface VersionedManuscript {
  version: number;
  manuscript: Manuscript;
}

export async function latestManuscript(prisma: PrismaClient, bookId: string): Promise<VersionedManuscript | null> {
  const row = await prisma.manuscriptVersion.findFirst({ where: { bookId }, orderBy: { version: 'desc' } });
  if (!row) return null;
  return { version: row.version, manuscript: ManuscriptSchema.parse(row.content) };
}

export async function requireManuscript(prisma: PrismaClient, bookId: string, version?: number): Promise<VersionedManuscript> {
  if (version === undefined) {
    const latest = await latestManuscript(prisma, bookId);
    if (!latest) throw badRequest('Upload a manuscript first');
    return latest;
  }
  const row = await prisma.manuscriptVersion.findUnique({ where: { bookId_version: { bookId, version } } });
  if (!row) throw badRequest(`Manuscript version ${version} not found`);
  return { version: row.version, manuscript: ManuscriptSchema.parse(row.content) };
}

export async function saveManuscript(prisma: PrismaClient, bookId: string, manuscript: Manuscript, source: string): Promise<number> {
  const latest = await prisma.manuscriptVersion.findFirst({ where: { bookId }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (latest?.version ?? 0) + 1;
  await prisma.manuscriptVersion.create({
    data: { id: newId('msv'), bookId, version, content: toJson(manuscript), wordCount: manuscriptWordCount(manuscript), source },
  });
  return version;
}

export interface TextChange {
  id: string;
  blockId: string;
  before: string;
  after: string;
}

/** Apply text changes to a copy. Changes whose `before` text no longer exists are returned as skipped. */
export function applyChanges(manuscript: Manuscript, changes: TextChange[]): { manuscript: Manuscript; applied: string[]; skipped: string[] } {
  const next = structuredClone(manuscript);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const change of changes) {
    let done = false;
    for (const chapter of next.chapters) {
      const index = chapter.blocks.findIndex((block) => block.id === change.blockId);
      const block = chapter.blocks[index];
      if (!block || !isTextBlock(block)) continue;
      const replaced = replaceInBlock(block, change.before, change.after);
      if (replaced) {
        chapter.blocks[index] = replaced;
        done = true;
      }
      break;
    }
    (done ? applied : skipped).push(change.id);
  }
  return { manuscript: next, applied, skipped };
}
