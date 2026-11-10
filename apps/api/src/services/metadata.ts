import { newId } from '@quire/core';
import { keywordBoxText, type MetadataIssue, type RecommendationPayload, validateMetadata } from '@quire/discovery';
import type { MetadataVersion, PrismaClient } from '@quire/db';
import { MAX_TRACKED_KEYWORDS } from '@quire/tracking';
import { z } from 'zod';
import type { AppContext } from '../context';
import { badRequest, conflict } from '../errors';
import { fromJson, toJson } from '../json';
import { PLANS } from '../plans';
import { advanceStage } from './books';
import { publishingVelocity } from './compliance';

export const DraftPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(4_000).optional(),
  keywordBoxes: z.array(z.string().max(50)).max(7).optional(),
  categories: z.array(z.string().max(200)).max(3).optional(),
  ebookPriceCents: z.number().int().min(99).max(20_000).nullable().optional(),
  paperbackPriceCents: z.number().int().min(99).max(25_000).nullable().optional(),
});

export const phrasesOf = (version: MetadataVersion): string[][] => fromJson<string[][]>(version.boxPhrases);

export async function liveVersion(prisma: PrismaClient, bookId: string, at?: Date): Promise<MetadataVersion | null> {
  return prisma.metadataVersion.findFirst({
    where: { bookId, appliedAt: at ? { not: null, lte: at } : { not: null } },
    orderBy: [{ appliedAt: 'desc' }, { version: 'desc' }],
  });
}

export async function draftVersion(prisma: PrismaClient, bookId: string): Promise<MetadataVersion | null> {
  return prisma.metadataVersion.findFirst({ where: { bookId, appliedAt: null }, orderBy: { version: 'desc' } });
}

export function issuesFor(version: MetadataVersion): MetadataIssue[] {
  return validateMetadata({ title: version.title, subtitle: version.subtitle, description: version.description, keywords: version.keywordBoxes });
}

async function nextVersionNumber(prisma: PrismaClient, bookId: string): Promise<number> {
  const latest = await prisma.metadataVersion.findFirst({ where: { bookId }, orderBy: { version: 'desc' }, select: { version: true } });
  return (latest?.version ?? 0) + 1;
}

function copyFields(version: MetadataVersion) {
  return {
    title: version.title,
    subtitle: version.subtitle,
    description: version.description,
    keywordBoxes: [...version.keywordBoxes],
    boxPhrases: toJson(phrasesOf(version)),
    categories: [...version.categories],
    ebookPriceCents: version.ebookPriceCents,
    paperbackPriceCents: version.paperbackPriceCents,
  };
}

export async function patchDraft(context: AppContext, bookId: string, patch: z.infer<typeof DraftPatchSchema>): Promise<MetadataVersion> {
  let draft = await draftVersion(context.prisma, bookId);
  if (!draft) {
    const live = await liveVersion(context.prisma, bookId);
    const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    const base = live
      ? copyFields(live)
      : { title: book.title, subtitle: book.subtitle, description: '', keywordBoxes: [], boxPhrases: toJson([]), categories: [], ebookPriceCents: null, paperbackPriceCents: null };
    draft = await context.prisma.metadataVersion.create({ data: { id: newId('meta'), bookId, version: await nextVersionNumber(context.prisma, bookId), ...base } });
  }
  const phrases = phrasesOf(draft);
  // A hand-edited box is tracked as one phrase; untouched boxes keep their packed phrases.
  const boxPhrases = patch.keywordBoxes?.map((text, index) => (draft!.keywordBoxes[index] === text ? (phrases[index] ?? [text]) : text.trim() ? [text.trim()] : []));
  return context.prisma.metadataVersion.update({
    where: { id: draft.id },
    data: { ...patch, ...(boxPhrases ? { boxPhrases: toJson(boxPhrases) } : {}) },
  });
}

async function syncTrackedKeywords(context: AppContext, bookId: string, userPlan: keyof typeof PLANS, version: MetadataVersion): Promise<void> {
  const limit = Math.min(PLANS[userPlan].trackedKeywordsPerBook, MAX_TRACKED_KEYWORDS);
  const phrases = [...new Set(phrasesOf(version).flat())];
  const existing = await context.prisma.trackedKeyword.findMany({ where: { bookId } });
  const activeCount = existing.filter((keyword) => keyword.active).length;
  const known = new Set(existing.map((keyword) => keyword.keyword));
  const fresh = phrases.filter((phrase) => !known.has(phrase)).slice(0, Math.max(0, limit - activeCount));
  await context.prisma.trackedKeyword.createMany({ data: fresh.map((keyword) => ({ id: newId('kw'), bookId, keyword })), skipDuplicates: true });
  await context.prisma.trackedKeyword.updateMany({ where: { bookId, keyword: { in: phrases } }, data: { active: true } });
}

/** Make the draft the live listing. The first apply is the publish. */
export async function applyDraft(context: AppContext, userId: string, bookId: string, asin: string | null): Promise<MetadataVersion> {
  const draft = await draftVersion(context.prisma, bookId);
  if (!draft) throw badRequest('No metadata draft to apply');
  const errors = issuesFor(draft);
  if (errors.length > 0) throw badRequest(errors[0]!.message);
  if (!draft.description.trim()) throw badRequest('Add a description before publishing');
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId }, include: { user: { select: { plan: true } } } });
  const firstPublish = book.publishedAt === null;
  if (firstPublish) {
    const velocity = await publishingVelocity(context, userId);
    if (velocity.remaining === 0) throw conflict(`KDP allows ${velocity.limit} new titles a day. Next slot ${velocity.nextSlotAt?.toISOString()}`);
  }
  const now = context.clock();
  const applied = await context.prisma.$transaction(async (tx) => {
    const version = await tx.metadataVersion.update({ where: { id: draft.id }, data: { appliedAt: now } });
    await tx.book.update({ where: { id: bookId }, data: { ...(firstPublish ? { publishedAt: now } : {}), ...(asin ? { asin } : {}) } });
    if (firstPublish) {
      await tx.recommendation.updateMany({ where: { bookId, status: 'open', kind: { in: ['keywords', 'categories', 'price-ebook', 'price-paperback'] } }, data: { status: 'applied', appliedAt: now } });
    }
    return version;
  });
  await syncTrackedKeywords(context, bookId, book.user.plan, applied);
  await advanceStage(context.prisma, bookId, 'track');
  return applied;
}

function applyPayload(version: MetadataVersion, payload: RecommendationPayload) {
  const fields = copyFields(version);
  const phrases = phrasesOf(version);
  switch (payload.kind) {
    case 'swap-keyword': {
      const box = phrases[payload.boxIndex];
      if (!box) throw badRequest('Keyword box no longer exists');
      const nextBox = box.map((phrase) => (phrase === payload.remove ? payload.add : phrase));
      phrases[payload.boxIndex] = nextBox;
      fields.keywordBoxes[payload.boxIndex] = keywordBoxText(nextBox, version.title, version.subtitle);
      fields.boxPhrases = toJson(phrases);
      return fields;
    }
    case 'switch-category': {
      const without = fields.categories.filter((category) => category !== payload.from);
      fields.categories = [...without, payload.to].slice(-3);
      return fields;
    }
    case 'raise-price':
      fields.paperbackPriceCents = payload.toCents;
      return fields;
    default:
      throw badRequest('This recommendation is applied by publishing the draft');
  }
}

export const KDP_CATEGORY_SLOTS = 3;
type LaunchPayload = Extract<RecommendationPayload, { kind: 'keywords' | 'categories' | 'price-ebook' | 'price-paperback' }>;

function isLaunchPayload(payload: RecommendationPayload): payload is LaunchPayload {
  return payload.kind === 'keywords' || payload.kind === 'categories' || payload.kind === 'price-ebook' || payload.kind === 'price-paperback';
}

function launchPatch(payload: LaunchPayload): z.infer<typeof DraftPatchSchema> {
  switch (payload.kind) {
    case 'keywords':
      return { keywordBoxes: payload.boxes.map((box) => box.text) };
    case 'categories':
      return { categories: payload.categories.slice(0, KDP_CATEGORY_SLOTS).map((category) => category.path) };
    case 'price-ebook':
      return { ebookPriceCents: payload.pricing.recommendedCents };
    case 'price-paperback':
      return { paperbackPriceCents: payload.pricing.recommendedCents };
  }
}

/** Launch recommendations (keywords, categories, prices) edit the draft. They go live when the draft is published. */
async function applyLaunchRecommendation(context: AppContext, bookId: string, recommendationId: string, payload: LaunchPayload): Promise<MetadataVersion> {
  const draft = await patchDraft(context, bookId, launchPatch(payload));
  const updated =
    payload.kind === 'keywords'
      ? await context.prisma.metadataVersion.update({ where: { id: draft.id }, data: { boxPhrases: toJson(payload.boxes.map((box) => box.phrases)) } })
      : draft;
  await context.prisma.recommendation.update({ where: { id: recommendationId }, data: { status: 'applied', appliedAt: context.clock() } });
  return updated;
}

/** Apply a recommendation. Re-optimizations become a new live version, linked to the recommendation so its outcome can be measured. */
export async function applyRecommendation(context: AppContext, bookId: string, recommendationId: string) {
  const recommendation = await context.prisma.recommendation.findFirst({ where: { id: recommendationId, bookId } });
  if (!recommendation) throw badRequest('Recommendation not found');
  if (recommendation.status !== 'open') throw conflict('Recommendation already decided');
  const payload = fromJson<RecommendationPayload>(recommendation.payload);
  if (isLaunchPayload(payload)) return applyLaunchRecommendation(context, bookId, recommendationId, payload);
  const live = await liveVersion(context.prisma, bookId);
  if (!live) throw conflict('Publish the book before applying re-optimizations');
  const fields = applyPayload(live, payload);
  const now = context.clock();
  const book = await context.prisma.book.findUniqueOrThrow({ where: { id: bookId }, include: { user: { select: { plan: true } } } });
  const version = await context.prisma.$transaction(async (tx) => {
    await tx.recommendation.update({ where: { id: recommendationId }, data: { status: 'applied', appliedAt: now } });
    return tx.metadataVersion.create({
      data: { id: newId('meta'), bookId, version: await nextVersionNumber(context.prisma, bookId), ...fields, appliedAt: now, recommendationId },
    });
  });
  await syncTrackedKeywords(context, bookId, book.user.plan, version);
  return version;
}
