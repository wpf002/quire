import type { FastifyInstance } from 'fastify';
import { type ChecklistItem, type DisclosureReport } from '@quire/compliance';
import { EXPORT_TARGETS, PASS_KINDS, TRIM_SIZES } from '@quire/core';
import { z } from 'zod';
import { requireUser } from '../auth';
import type { AppContext } from '../context';
import { conflict, notFound } from '../errors';
import { idParam, parseWith } from '../http';
import { fromJson } from '../json';
import { loadOwnedBook } from '../services/books';
import { queueBlurb } from '../services/blurb';
import { buildComplianceReport, publishingVelocity } from '../services/compliance';
import { DiscoveryRequestSchema, latestDiscovery, queueDiscovery } from '../services/discovery';
import { decideEdits } from '../services/edits';
import { createExport, downloadName } from '../services/exports';
import { DraftPatchSchema, applyDraft, applyRecommendation, draftVersion, issuesFor, patchDraft } from '../services/metadata';
import { queuePass } from '../services/passes';
import { MAX_SIMULATED_DAYS, queueRankCheck, simulateDays } from '../services/tracking';

const PassSchema = z.object({ kind: z.enum(PASS_KINDS) });
const DecisionsSchema = z.object({
  decisions: z.array(z.object({ id: z.string(), action: z.enum(['accept', 'reject']), after: z.string().max(20_000).optional() })).min(1).max(500),
});
const ConfirmSchema = z.object({ itemIds: z.array(z.string()).max(200), confirmed: z.boolean().default(true) });
const PublishSchema = z.object({ asin: z.string().trim().max(20).nullable().default(null) });
const SimulateSchema = z.object({ days: z.number().int().min(1).max(MAX_SIMULATED_DAYS) });
const ExportSchema = z.object({
  format: z.enum(['epub', 'pdf']),
  target: z.enum(EXPORT_TARGETS).default('kdp'),
  trimSize: z.enum(Object.keys(TRIM_SIZES) as [keyof typeof TRIM_SIZES]).optional(),
});
const RecParams = z.object({ id: z.string(), recId: z.string() });

export function workflowRoutes(app: FastifyInstance, context: AppContext): void {
  const owned = async (request: Parameters<typeof requireUser>[1]) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    return { user, book };
  };

  app.post('/books/:id/passes', async (request, reply) => {
    const { user, book } = await owned(request);
    const { kind } = parseWith(PassSchema, request.body);
    return reply.code(202).send(await queuePass(context, user.id, book.id, kind));
  });

  app.get('/books/:id/passes', async (request) => {
    const { book } = await owned(request);
    const passes = await context.prisma.pass.findMany({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { edits: true } } } });
    return { passes };
  });

  app.get('/books/:id/edits', async (request) => {
    const { book } = await owned(request);
    const query = parseWith(z.object({ status: z.enum(['pending', 'accepted', 'rejected']).optional() }), request.query);
    const edits = await context.prisma.edit.findMany({
      where: { bookId: book.id, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ chapterId: 'asc' }, { blockId: 'asc' }],
      include: { pass: { select: { kind: true } } },
    });
    return { edits };
  });

  app.post('/books/:id/edits/decide', async (request) => {
    const { book } = await owned(request);
    const { decisions } = parseWith(DecisionsSchema, request.body);
    return decideEdits(context, book.id, decisions);
  });

  app.post('/books/:id/blurb', async (request, reply) => {
    const { user, book } = await owned(request);
    return reply.code(202).send({ jobId: await queueBlurb(context, user.id, book.id) });
  });

  app.post('/books/:id/compliance', async (request, reply) => {
    const { book } = await owned(request);
    const report = await buildComplianceReport(context, book.id);
    return reply.code(201).send({ reportId: report.id });
  });

  app.get('/books/:id/compliance', async (request) => {
    const { user, book } = await owned(request);
    const report = await context.prisma.complianceReport.findFirst({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' } });
    const velocity = await publishingVelocity(context, user.id);
    if (!report) return { report: null, velocity };
    return {
      report: {
        id: report.id,
        createdAt: report.createdAt,
        disclosure: fromJson<DisclosureReport>(report.disclosure),
        checklist: fromJson<ChecklistItem[]>(report.checklist),
        confirmations: report.confirmations,
      },
      velocity,
    };
  });

  app.post('/books/:id/compliance/confirm', async (request) => {
    const { book } = await owned(request);
    const body = parseWith(ConfirmSchema, request.body);
    const report = await context.prisma.complianceReport.findFirst({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' } });
    if (!report) throw conflict('Run the compliance check first');
    const confirmable = new Set(fromJson<ChecklistItem[]>(report.checklist).filter((item) => item.status === 'confirm').map((item) => item.id));
    const current = new Set(report.confirmations);
    for (const id of body.itemIds) {
      if (!confirmable.has(id)) continue;
      if (body.confirmed) current.add(id);
      else current.delete(id);
    }
    const updated = await context.prisma.complianceReport.update({ where: { id: report.id }, data: { confirmations: [...current] } });
    return { confirmations: updated.confirmations };
  });

  app.post('/books/:id/discovery', async (request, reply) => {
    const { user, book } = await owned(request);
    const body = parseWith(DiscoveryRequestSchema, request.body);
    return reply.code(202).send({ jobId: await queueDiscovery(context, user.id, book.id, body) });
  });

  app.get('/books/:id/discovery', async (request) => {
    const { book } = await owned(request);
    const [run, recommendations] = await Promise.all([
      latestDiscovery(context, book.id),
      context.prisma.recommendation.findMany({ where: { bookId: book.id, kind: { in: ['keywords', 'categories', 'price-ebook', 'price-paperback'] } }, orderBy: { createdAt: 'desc' }, take: 4 }),
    ]);
    return { run, recommendations };
  });

  app.get('/books/:id/metadata', async (request) => {
    const { book } = await owned(request);
    const versions = await context.prisma.metadataVersion.findMany({ where: { bookId: book.id }, orderBy: { version: 'desc' }, include: { recommendation: { select: { id: true, kind: true, rationale: true, outcome: true } } } });
    const live = versions.find((version) => version.appliedAt !== null) ?? null;
    const draft = await draftVersion(context.prisma, book.id);
    return { versions, live, draft, issues: draft ? issuesFor(draft) : [] };
  });

  app.patch('/books/:id/metadata/draft', async (request) => {
    const { book } = await owned(request);
    const patch = parseWith(DraftPatchSchema, request.body);
    const draft = await patchDraft(context, book.id, patch);
    return { draft, issues: issuesFor(draft) };
  });

  app.post('/books/:id/metadata/publish', async (request) => {
    const { user, book } = await owned(request);
    const { asin } = parseWith(PublishSchema, request.body ?? {});
    const live = await applyDraft(context, user.id, book.id, asin);
    // First publish: take a baseline reading now instead of waiting for the daily sweep.
    const rankCheckJobId = book.publishedAt ? null : await queueRankCheck(context, book.id, user.id);
    return { live, rankCheckJobId };
  });

  app.post('/books/:id/recommendations/:recId/apply', async (request) => {
    const { book } = await owned(request);
    const { recId } = parseWith(RecParams, request.params);
    return { live: await applyRecommendation(context, book.id, recId) };
  });

  app.post('/books/:id/recommendations/:recId/dismiss', async (request) => {
    const { book } = await owned(request);
    const { recId } = parseWith(RecParams, request.params);
    const result = await context.prisma.recommendation.updateMany({ where: { id: recId, bookId: book.id, status: 'open' }, data: { status: 'dismissed' } });
    if (result.count === 0) throw notFound('Open recommendation');
    return { ok: true };
  });

  app.get('/books/:id/rank', async (request) => {
    const { book } = await owned(request);
    const [keywords, ranks, bsr, versions, recommendations, categoryRanks] = await Promise.all([
      context.prisma.trackedKeyword.findMany({ where: { bookId: book.id, active: true }, orderBy: { createdAt: 'asc' } }),
      context.prisma.rankObservation.findMany({ where: { bookId: book.id, provider: context.ranks.name }, orderBy: { observedAt: 'asc' }, select: { keyword: true, rank: true, observedAt: true } }),
      context.prisma.bsrObservation.findMany({ where: { bookId: book.id, provider: context.ranks.name }, orderBy: { observedAt: 'asc' }, select: { bsr: true, observedAt: true, provider: true } }),
      context.prisma.metadataVersion.findMany({ where: { bookId: book.id, appliedAt: { not: null } }, orderBy: { appliedAt: 'asc' }, select: { id: true, version: true, appliedAt: true, recommendationId: true } }),
      context.prisma.recommendation.findMany({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' } }),
      context.prisma.categoryRankObservation.findMany({ where: { bookId: book.id, provider: context.ranks.name }, orderBy: { observedAt: 'asc' }, select: { category: true, rank: true, observedAt: true } }),
    ]);
    const categoryNames = [...new Set(categoryRanks.map((entry) => entry.category))];
    const categories = categoryNames.map((category) => ({
      category,
      points: categoryRanks.filter((entry) => entry.category === category).map((entry) => ({ at: entry.observedAt, rank: entry.rank })),
    }));
    const series = keywords.map((keyword) => ({
      keyword: keyword.keyword,
      points: ranks.filter((rank) => rank.keyword === keyword.keyword).map((rank) => ({ at: rank.observedAt, rank: rank.rank })),
    }));
    return {
      provider: bsr.at(-1)?.provider ?? context.ranks.name,
      simulated: context.ranks.supportsBackfill,
      publishedAt: book.publishedAt,
      series,
      bsr: bsr.map((point) => ({ at: point.observedAt, bsr: point.bsr })),
      categories,
      changes: versions,
      recommendations,
    };
  });

  app.post('/books/:id/rank/simulate', async (request) => {
    const { book } = await owned(request);
    const { days } = parseWith(SimulateSchema, request.body);
    return simulateDays(context, book.id, days);
  });

  app.post('/books/:id/rank/check', async (request, reply) => {
    const { user, book } = await owned(request);
    if (!book.publishedAt) throw conflict('Publish the listing before checking ranks');
    const jobId = await queueRankCheck(context, book.id, user.id);
    return reply.code(202).send({ jobId });
  });

  app.post('/books/:id/exports', async (request, reply) => {
    const { book } = await owned(request);
    const body = parseWith(ExportSchema, request.body);
    const created = await createExport(context, book.id, body.format, body.target, body.trimSize ?? (book.trimSize as keyof typeof TRIM_SIZES));
    return reply.code(201).send({ export: created });
  });

  app.get('/books/:id/exports', async (request) => {
    const { book } = await owned(request);
    const exports = await context.prisma.export.findMany({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' }, take: 20, omit: { storagePath: true } });
    return { exports };
  });

  app.get('/books/:id/exports/:exportId/download', async (request, reply) => {
    const { book } = await owned(request);
    const { exportId } = parseWith(z.object({ id: z.string(), exportId: z.string() }), request.params);
    const record = await context.prisma.export.findFirst({ where: { id: exportId, bookId: book.id } });
    if (!record) throw notFound('Export');
    const buffer = await context.storage.get(record.storagePath);
    return reply
      .header('Content-Type', record.format === 'pdf' ? 'application/pdf' : 'application/epub+zip')
      .header('Content-Disposition', `attachment; filename="${downloadName(book.title, record.format, record.target)}"`)
      .send(buffer);
  });

  app.get('/jobs/:id', async (request) => {
    const { user } = await requireUser(context, request);
    const job = await context.prisma.job.findFirst({ where: { id: idParam(request), userId: user.id }, select: { id: true, type: true, status: true, attempts: true, error: true, errorCode: true, runAt: true, createdAt: true, finishedAt: true } });
    if (!job) throw notFound('Job');
    return { job };
  });
}
