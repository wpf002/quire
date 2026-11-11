import { estimatePrintPages, newId } from '@quire/core';
import type { RecommendationOutcome, RecommendationPayload } from '@quire/discovery';
import { median } from '@quire/discovery';
import { type Book, Prisma, type Recommendation } from '@quire/db';
import { type RankObservation, RankProviderBlockedError, RankProviderError, attributeBsrChange, attributeKeywordChange, reoptimize, verdictForRank } from '@quire/tracking';
import type { AppContext } from '../context';
import { conflict } from '../errors';
import { fromJson, toJson } from '../json';
import { latestDiscovery } from './discovery';
import { latestManuscript } from './manuscripts';
import { liveVersion, phrasesOf } from './metadata';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 60;
export const MAX_SIMULATED_DAYS = 30;

export const utcDay = (at: Date) => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);

/** Record one day's ranks for a book, using the listing that was live that day. Idempotent per day. */
export async function observeDay(context: AppContext, book: Book, at: Date): Promise<boolean> {
  const day = utcDay(at);
  const live = await liveVersion(context.prisma, book.id, at);
  if (!live || !book.publishedAt) return false;
  const already = await context.prisma.bsrObservation.findUnique({ where: { bookId_observedAt: { bookId: book.id, observedAt: day } } });
  if (already) return false;
  const keywords = await context.prisma.trackedKeyword.findMany({ where: { bookId: book.id, active: true, createdAt: { lte: at } }, select: { keyword: true } });
  // Ranking momentum dates from launch, not from each later metadata edit.
  const snapshot = await context.ranks.observe(
    { bookId: book.id, asin: book.asin, title: book.title, keywordBoxes: live.keywordBoxes, categories: live.categories, appliedAt: book.publishedAt },
    keywords.map((keyword) => keyword.keyword),
    day,
  );
  await context.prisma.$transaction([
    context.prisma.rankObservation.createMany({
      data: snapshot.ranks.map((entry) => ({ id: newId('rank'), bookId: book.id, keyword: entry.keyword, rank: entry.rank, provider: context.ranks.name, observedAt: day })),
      skipDuplicates: true,
    }),
    context.prisma.bsrObservation.create({ data: { id: newId('bsr'), bookId: book.id, bsr: snapshot.bsr, provider: context.ranks.name, observedAt: day } }),
  ]);
  return true;
}

function combineOutcomes(outcomes: RecommendationOutcome[], measuredAt: string): RecommendationOutcome {
  const measured = outcomes.filter((outcome) => outcome.beforeMedian !== null && outcome.afterMedian !== null);
  if (measured.length === 0) return { measuredAt, metric: 'keyword-rank', beforeMedian: null, afterMedian: null, verdict: 'insufficient-data' };
  const beforeMedian = median(measured.map((outcome) => outcome.beforeMedian!));
  const afterMedian = median(measured.map((outcome) => outcome.afterMedian!));
  return { measuredAt, metric: 'keyword-rank', beforeMedian, afterMedian, verdict: verdictForRank(beforeMedian, afterMedian) };
}

function outcomeFor(recommendation: Recommendation, ranks: RankObservation[], bsr: Array<{ observedAt: Date; bsr: number | null }>, now: Date): RecommendationOutcome | null {
  const payload = fromJson<RecommendationPayload>(recommendation.payload);
  const changeAt = recommendation.appliedAt!;
  switch (payload.kind) {
    case 'swap-keyword':
      return attributeKeywordChange(ranks, payload.add, changeAt, now);
    case 'keywords': {
      const phrases = payload.boxes.flatMap((box) => box.phrases);
      const outcomes = phrases.map((phrase) => attributeKeywordChange(ranks, phrase, changeAt, now));
      if (outcomes.some((outcome) => outcome === null)) return null;
      return combineOutcomes(outcomes as RecommendationOutcome[], now.toISOString());
    }
    default:
      return attributeBsrChange(bsr, changeAt, now);
  }
}

/** Write measured outcomes into the slot each applied recommendation was stored with. */
export async function attributeOutcomes(context: AppContext, bookId: string, now: Date): Promise<number> {
  const pending = await context.prisma.recommendation.findMany({ where: { bookId, status: 'applied', outcome: { equals: Prisma.AnyNull }, appliedAt: { not: null } } });
  if (pending.length === 0) return 0;
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  const [ranks, bsr] = await Promise.all([
    context.prisma.rankObservation.findMany({ where: { bookId, observedAt: { gte: since } }, select: { keyword: true, rank: true, observedAt: true } }),
    context.prisma.bsrObservation.findMany({ where: { bookId, observedAt: { gte: since } }, select: { bsr: true, observedAt: true } }),
  ]);
  let written = 0;
  for (const recommendation of pending) {
    const outcome = outcomeFor(recommendation, ranks, bsr, now);
    if (!outcome) continue;
    await context.prisma.recommendation.update({ where: { id: recommendation.id }, data: { outcome: toJson(outcome), outcomeAt: now } });
    written += 1;
  }
  return written;
}

const payloadKey = (payload: RecommendationPayload) => JSON.stringify(payload);

/** Turn tracked ranks into new recommendations. Never repeats one the author already saw. */
export async function generateReoptimizations(context: AppContext, bookId: string, now: Date): Promise<number> {
  const live = await liveVersion(context.prisma, bookId);
  const discovery = await latestDiscovery(context, bookId);
  if (!live || !discovery) return 0;
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  const [observations, latestBsr, manuscript, seen] = await Promise.all([
    context.prisma.rankObservation.findMany({ where: { bookId, observedAt: { gte: since } }, select: { keyword: true, rank: true, observedAt: true } }),
    context.prisma.bsrObservation.findFirst({ where: { bookId, bsr: { not: null } }, orderBy: { observedAt: 'desc' } }),
    latestManuscript(context.prisma, bookId),
    context.prisma.recommendation.findMany({ where: { bookId }, select: { payload: true } }),
  ]);
  const seenKeys = new Set(seen.map((row) => payloadKey(fromJson<RecommendationPayload>(row.payload))));
  const results = reoptimize({
    now,
    keywordBoxes: live.keywordBoxes,
    boxPhrases: phrasesOf(live),
    observations,
    candidates: discovery.result.keywords,
    currentCategories: live.categories,
    categoryThresholds: discovery.result.categories,
    currentBsr: latestBsr?.bsr ?? null,
    paperback: live.paperbackPriceCents && manuscript ? { priceCents: live.paperbackPriceCents, pages: estimatePrintPages(manuscript.manuscript) } : null,
  }).filter((result) => !seenKeys.has(payloadKey(result.payload)));
  if (results.length === 0) return 0;
  await context.prisma.recommendation.createMany({
    data: results.map((result) => ({
      id: newId('rec'),
      bookId,
      kind: result.payload.kind,
      payload: toJson(result.payload),
      rationale: result.rationale,
      dataSources: [`rank:${context.ranks.name}`, ...discovery.sources],
    })),
  });
  return results.length;
}

/** One book's daily pass: observe, measure, recommend. */
export async function sweepBook(context: AppContext, book: Book, now: Date) {
  const observed = await observeDay(context, book, now);
  const outcomes = await attributeOutcomes(context, book.id, now);
  const recommendations = await generateReoptimizations(context, book.id, now);
  return { observed, outcomes, recommendations };
}

export interface SweepFailure {
  bookId: string;
  error: string;
}

/** Sweep every published book. One book's provider failure is reported, not fatal; a robot check stops the run. */
export async function sweepAll(context: AppContext): Promise<{ swept: number; failed: SweepFailure[] }> {
  const now = context.clock();
  const books = await context.prisma.book.findMany({ where: { publishedAt: { not: null } } });
  const failed: SweepFailure[] = [];
  let swept = 0;
  for (const book of books) {
    try {
      await sweepBook(context, book, now);
      swept += 1;
    } catch (error) {
      if (!(error instanceof RankProviderError)) throw error;
      failed.push({ bookId: book.id, error: error.message });
      if (error instanceof RankProviderBlockedError) break;
    }
  }
  return { swept, failed };
}

/**
 * Sample provider only: move this book's history back `days` and fill the gap with
 * simulated observations, so the loop can be exercised without waiting weeks.
 */
export async function simulateDays(context: AppContext, bookId: string, days: number) {
  if (!context.ranks.supportsBackfill) throw conflict('Simulation needs the sample rank provider');
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  if (!book.publishedAt) throw conflict('Publish the book first');
  await context.prisma.$transaction([
    context.prisma.$executeRaw`UPDATE "Book" SET "publishedAt" = "publishedAt" - make_interval(days => ${days}::int) WHERE id = ${bookId}`,
    context.prisma.$executeRaw`UPDATE "MetadataVersion" SET "appliedAt" = "appliedAt" - make_interval(days => ${days}::int) WHERE "bookId" = ${bookId} AND "appliedAt" IS NOT NULL`,
    context.prisma.$executeRaw`UPDATE "Recommendation" SET "appliedAt" = "appliedAt" - make_interval(days => ${days}::int), "createdAt" = "createdAt" - make_interval(days => ${days}::int) WHERE "bookId" = ${bookId}`,
    context.prisma.$executeRaw`UPDATE "TrackedKeyword" SET "createdAt" = "createdAt" - make_interval(days => ${days}::int) WHERE "bookId" = ${bookId}`,
    context.prisma.$executeRaw`UPDATE "RankObservation" SET "observedAt" = "observedAt" - make_interval(days => ${days}::int) WHERE "bookId" = ${bookId}`,
    context.prisma.$executeRaw`UPDATE "BsrObservation" SET "observedAt" = "observedAt" - make_interval(days => ${days}::int) WHERE "bookId" = ${bookId}`,
  ]);
  const shifted = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
  const now = context.clock();
  let observed = 0;
  for (let at = utcDay(shifted.publishedAt!).getTime() + DAY_MS - 1; at <= now.getTime(); at += DAY_MS) {
    if (await observeDay(context, shifted, new Date(at))) observed += 1;
  }
  if (await observeDay(context, shifted, now)) observed += 1;
  const outcomes = await attributeOutcomes(context, bookId, now);
  const recommendations = await generateReoptimizations(context, bookId, now);
  return { observed, outcomes, recommendations };
}
