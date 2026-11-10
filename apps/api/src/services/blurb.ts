import { meteredGateway } from '@quire/core';
import { generateBlurb } from '@quire/editing';
import { z } from 'zod';
import type { AppContext } from '../context';
import { conflict } from '../errors';
import { toJson } from '../json';
import { enqueue } from '../queue';
import { requireManuscript } from './manuscripts';
import { draftVersion } from './metadata';

const BlurbJobSchema = z.object({ bookId: z.string() });

export async function queueBlurb(context: AppContext, userId: string, bookId: string): Promise<string> {
  if (!context.gateway.available) throw conflict('Blurbs need a model key. Add ANTHROPIC_API_KEY or write the description by hand.');
  await requireManuscript(context.prisma, bookId);
  return enqueue(context.prisma, 'blurb', { bookId }, userId);
}

export async function runBlurbJob(context: AppContext, payload: unknown): Promise<void> {
  const { bookId } = BlurbJobSchema.parse(payload);
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const { manuscript } = await requireManuscript(context.prisma, bookId);
  const gateway = meteredGateway(context.gateway, context.ledger, { accountId: book.userId, bookId, purpose: 'blurb' });
  const blurb = await generateBlurb(manuscript, gateway, context.env.QUIRE_MODEL_CHEAP);
  await context.prisma.book.update({ where: { id: bookId }, data: { blurb: toJson(blurb) } });
  const draft = await draftVersion(context.prisma, bookId);
  if (draft && !draft.description.trim()) await context.prisma.metadataVersion.update({ where: { id: draft.id }, data: { description: blurb.description } });
}
