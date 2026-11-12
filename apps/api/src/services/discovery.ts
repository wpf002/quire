import { estimatePrintPages, manuscriptWordCount, newId } from '@quire/core';
import {
  AmazonBlockedError,
  type DiscoveryResult,
  type RecommendationPayload,
  pickDraftCategories,
  recommendEbookPrice,
  recommendPaperbackPrice,
  runDiscovery,
} from '@quire/discovery';
import type { Blurb } from '@quire/editing';
import { z } from 'zod';
import type { AppContext } from '../context';
import { fromJson, toJson } from '../json';
import { enqueue } from '../queue';
import { deferForAmazonBlock } from './amazon-block';
import { advanceStage } from './books';
import { KDP_CATEGORY_SLOTS } from './metadata';
import { requireManuscript } from './manuscripts';

export const DiscoveryRequestSchema = z.object({
  seeds: z.array(z.string().trim().min(2).max(60)).min(1).max(8),
  storefront: z.enum(['kindle', 'books']).default('kindle'),
  expectedDailySales: z.number().positive().max(500).default(3),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;

const DiscoveryJobSchema = z.object({ bookId: z.string(), request: DiscoveryRequestSchema });
const CANDIDATE_LIMIT = 40;
// EPUB size estimate: ~6 bytes per word of XHTML plus fonts and packaging.
const EPUB_BYTES_PER_WORD = 6;
const EPUB_OVERHEAD_MB = 0.3;

export async function queueDiscovery(context: AppContext, userId: string, bookId: string, request: DiscoveryRequest): Promise<string> {
  return enqueue(context.prisma, 'discovery', { bookId, request }, userId);
}

export async function runDiscoveryJob(context: AppContext, payload: unknown): Promise<void> {
  const { bookId, request } = DiscoveryJobSchema.parse(payload);
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const { manuscript } = await requireManuscript(context.prisma, bookId);
  const result = await runDiscovery(
    { title: book.title, subtitle: book.subtitle, genre: book.genre, seeds: request.seeds, storefront: request.storefront, expectedDailySales: request.expectedDailySales, candidateLimit: CANDIDATE_LIMIT },
    context.discovery,
  ).catch((error: unknown) => {
    if (error instanceof AmazonBlockedError) throw deferForAmazonBlock(error.message);
    throw error;
  });
  const pages = estimatePrintPages(manuscript);
  const fileSizeMb = (manuscriptWordCount(manuscript) * EPUB_BYTES_PER_WORD) / 1_000_000 + EPUB_OVERHEAD_MB;
  const ebook = recommendEbookPrice({ compMedianCents: result.compMedianPriceCents, fileSizeMb, seriesStarter: book.seriesStarter });
  const paperback = recommendPaperbackPrice({ pages, compMedianCents: result.compMedianPriceCents });

  const pickedCategories = pickDraftCategories(result.categories, KDP_CATEGORY_SLOTS);
  const categories = pickedCategories.map((category) => category.path);
  const filledBoxes = result.boxes.filter((box) => box.text.length > 0).length;

  const payloads: Array<{ payload: RecommendationPayload; rationale: string }> = [
    { payload: { kind: 'keywords', boxes: result.boxes }, rationale: `${filledBoxes} of ${result.boxes.length} boxes packed from ${result.keywords.length} scored phrases.` },
    { payload: { kind: 'categories', categories: pickedCategories }, rationale: `Ranked for ~${request.expectedDailySales} sales a day.` },
    { payload: { kind: 'price-ebook', pricing: ebook }, rationale: ebook.rationale },
    { payload: { kind: 'price-paperback', pricing: paperback }, rationale: paperback.rationale },
  ];

  const live = await context.prisma.metadataVersion.findFirst({ where: { bookId, appliedAt: { not: null } }, orderBy: { version: 'desc' } });
  const latest = await context.prisma.metadataVersion.findFirst({ where: { bookId }, orderBy: { version: 'desc' }, select: { version: true } });
  const blurb = book.blurb ? fromJson<Blurb>(book.blurb) : null;

  await context.prisma.$transaction(async (tx) => {
    // A fresh run replaces open launch recommendations from the last run.
    await tx.recommendation.updateMany({ where: { bookId, status: 'open', kind: { in: ['keywords', 'categories', 'price-ebook', 'price-paperback'] } }, data: { status: 'dismissed' } });
    await tx.discoveryRun.create({ data: { id: newId('disc'), bookId, input: toJson(request), result: toJson(result), sources: result.sources } });
    await tx.recommendation.createMany({
      data: payloads.map((entry) => ({ id: newId('rec'), bookId, kind: entry.payload.kind, payload: toJson(entry.payload), rationale: entry.rationale, dataSources: result.sources })),
    });
    // Before publish the draft takes the recommendations directly; after publish it waits for the author to apply.
    if (!live) {
      await tx.metadataVersion.deleteMany({ where: { bookId, appliedAt: null } });
      await tx.metadataVersion.create({
        data: {
          id: newId('meta'),
          bookId,
          version: (latest?.version ?? 0) + 1,
          title: book.title,
          subtitle: book.subtitle,
          description: blurb?.description ?? '',
          keywordBoxes: result.boxes.map((box) => box.text),
          boxPhrases: toJson(result.boxes.map((box) => box.phrases)),
          categories,
          ebookPriceCents: ebook.recommendedCents,
          paperbackPriceCents: paperback.recommendedCents,
        },
      });
    }
  });
  await advanceStage(context.prisma, bookId, 'metadata');
}

export async function latestDiscovery(context: AppContext, bookId: string): Promise<{ result: DiscoveryResult; sources: string[]; createdAt: Date } | null> {
  const run = await context.prisma.discoveryRun.findFirst({ where: { bookId }, orderBy: { createdAt: 'desc' } });
  return run ? { result: fromJson<DiscoveryResult>(run.result), sources: run.sources, createdAt: run.createdAt } : null;
}
