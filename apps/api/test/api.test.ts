import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { AppContext } from '../src/context';
import { Worker } from '../src/queue';
import { runBlurbJob } from '../src/services/blurb';
import { runDiscoveryJob } from '../src/services/discovery';
import { runPassJob } from '../src/services/passes';
import { runObserveJob, sweepAll } from '../src/services/tracking';
import { RecordingGateway, SAMPLE_MANUSCRIPT, TestClient, resetDatabase, testContext } from './helpers';

let context: AppContext;
let app: FastifyInstance;
let worker: Worker;
let gateway: RecordingGateway;

beforeAll(async () => {
  gateway = new RecordingGateway();
  context = await testContext({ gateway });
  app = await buildApp(context, { logger: false });
  worker = new Worker(
    context.prisma,
    {
      pass: (payload, job) => runPassJob(context, payload, job.final),
      discovery: (payload) => runDiscoveryJob(context, payload),
      blurb: (payload) => runBlurbJob(context, payload),
      observe: async (payload) => runObserveJob(context, payload),
      sweep: async () => {
        await sweepAll(context);
      },
    },
    app.log,
  );
});

beforeEach(async () => {
  await resetDatabase(context);
  gateway.calls = [];
});

afterAll(async () => {
  await app.close();
  await context.prisma.$disconnect();
});

async function newBook(client: TestClient) {
  const created = await client.request('POST', '/books', { title: 'The Salt Road', author: 'Test Author', genre: 'literary fiction' });
  expect(created.status).toBe(201);
  return String((created.json().book as { id: string }).id);
}

describe('auth', () => {
  it('rejects mutating requests without the CSRF header', async () => {
    const client = new TestClient(app);
    await client.signup('csrf@example.test');
    const blocked = await client.request('POST', '/books', { title: 'X', author: 'Y' }, { csrf: false });
    expect(blocked.status).toBe(403);
    const allowed = await client.request('POST', '/books', { title: 'X', author: 'Y' });
    expect(allowed.status).toBe(201);
  });

  it('requires a session and hides other users’ books', async () => {
    const owner = new TestClient(app);
    await owner.signup('owner@example.test');
    const bookId = await newBook(owner);
    const stranger = new TestClient(app);
    expect((await stranger.request('GET', `/books/${bookId}`)).status).toBe(401);
    await stranger.signup('stranger@example.test');
    expect((await stranger.request('GET', `/books/${bookId}`)).status).toBe(404);
  });

  it('enforces the plan book limit', async () => {
    const client = new TestClient(app);
    await client.signup('limit@example.test');
    await newBook(client);
    const second = await client.request('POST', '/books', { title: 'Two', author: 'Y' });
    expect(second.status).toBe(402);
  });
});

describe('spend caps', () => {
  it('skips the model when the account cap is zero and still returns rule edits', async () => {
    const client = new TestClient(app);
    await client.signup('cap@example.test');
    expect((await client.request('PATCH', '/account', { spendCapCentsDaily: 0 })).status).toBe(200);
    const bookId = await newBook(client);
    expect((await client.upload(`/books/${bookId}/upload`, 'salt-road.md', SAMPLE_MANUSCRIPT)).status).toBe(201);
    expect((await client.request('POST', `/books/${bookId}/passes`, { kind: 'copyedit' })).status).toBe(202);
    await worker.drain();

    expect(gateway.calls).toHaveLength(0);
    const passes = (await client.request('GET', `/books/${bookId}/passes`)).json().passes as Array<{ status: string; model: string | null; costCents: number }>;
    expect(passes[0]).toMatchObject({ status: 'done', model: null, costCents: 0 });
    const edits = (await client.request('GET', `/books/${bookId}/edits?status=pending`)).json().edits as unknown[];
    expect(edits.length).toBeGreaterThan(0);
    expect(await context.prisma.spendEntry.count()).toBe(0);
  });

  it('refuses a cap above the plan ceiling', async () => {
    const client = new TestClient(app);
    await client.signup('ceiling@example.test');
    expect((await client.request('PATCH', '/account', { spendCapCentsDaily: 100_000 })).status).toBe(400);
  });
});

describe('self-serve flow', () => {
  it('runs upload → pass → compliance → metadata → export → publish → track → re-optimize', async () => {
    const client = new TestClient(app);
    await client.signup('flow@example.test');
    const bookId = await newBook(client);

    expect((await client.upload(`/books/${bookId}/upload`, 'salt-road.md', SAMPLE_MANUSCRIPT)).status).toBe(201);
    await client.request('POST', `/books/${bookId}/passes`, { kind: 'copyedit' });
    await worker.drain();

    const edits = (await client.request('GET', `/books/${bookId}/edits?status=pending`)).json().edits as Array<{ id: string }>;
    const decided = (await client.request('POST', `/books/${bookId}/edits/decide`, { decisions: edits.map((edit) => ({ id: edit.id, action: 'accept' })) })).json();
    expect((decided.accepted as string[]).length).toBeGreaterThan(0);
    expect(decided.version).toBe(2);

    // Export is blocked until compliance runs.
    expect((await client.request('POST', `/books/${bookId}/exports`, { format: 'epub' })).status).toBe(409);
    expect((await client.request('POST', `/books/${bookId}/compliance`)).status).toBe(201);
    const compliance = (await client.request('GET', `/books/${bookId}/compliance`)).json();
    const report = compliance.report as { checklist: Array<{ id: string; status: string }>; disclosure: { kdpAnswers: unknown } };
    const toConfirm = report.checklist.filter((item) => item.status === 'confirm').map((item) => item.id);
    if (toConfirm.length > 0) await client.request('POST', `/books/${bookId}/compliance/confirm`, { itemIds: toConfirm });

    expect((await client.request('POST', `/books/${bookId}/discovery`, { seeds: ['desert novel', 'salt road'], storefront: 'kindle', expectedDailySales: 3 })).status).toBe(202);
    await worker.drain();
    const metadata = (await client.request('GET', `/books/${bookId}/metadata`)).json();
    const draft = metadata.draft as { keywordBoxes: string[]; categories: string[] };
    expect(draft.keywordBoxes.length).toBe(7);
    expect(draft.categories.length).toBeGreaterThan(0);

    // Regression: applying a launch rec before publish edits the draft instead of failing with 409.
    const discovery = (await client.request('GET', `/books/${bookId}/discovery`)).json();
    const ebookRec = (discovery.recommendations as Array<{ id: string; kind: string; payload: { pricing: { recommendedCents: number } } }>).find((rec) => rec.kind === 'price-ebook')!;
    await client.request('PATCH', `/books/${bookId}/metadata/draft`, { ebookPriceCents: 199 });
    expect((await client.request('POST', `/books/${bookId}/recommendations/${ebookRec.id}/apply`)).status).toBe(200);
    const afterApply = (await client.request('GET', `/books/${bookId}/metadata`)).json().draft as { ebookPriceCents: number };
    expect(afterApply.ebookPriceCents).toBe(ebookRec.payload.pricing.recommendedCents);

    const patched = await client.request('PATCH', `/books/${bookId}/metadata/draft`, { description: 'A caravan crosses the salt flats.' });
    expect(patched.status).toBe(200);

    const exported = await client.request('POST', `/books/${bookId}/exports`, { format: 'epub' });
    expect(exported.status).toBe(201);
    const exportId = (exported.json().export as { id: string }).id;
    // Regression: a short manuscript must not fail the print page minimum on an EPUB.
    const preflightIds = (exported.json().export as { preflight: Array<{ id: string }> }).preflight.map((check) => check.id);
    expect(preflightIds).not.toContain('pages');
    const download = await client.request('GET', `/books/${bookId}/exports/${exportId}/download`);
    expect(download.status).toBe(200);
    expect(download.raw.headers['content-disposition']).toBe('attachment; filename="the-salt-road-kdp.epub"');

    const published = await client.request('POST', `/books/${bookId}/metadata/publish`, { asin: 'B0TEST0001' });
    expect(published.status).toBe(200);
    // First publish queues a baseline rank check; a second Check Now while it's queued reuses that job.
    const rankCheckJobId = published.json().rankCheckJobId as string;
    expect(rankCheckJobId).toEqual(expect.any(String));
    const checkNow = await client.request('POST', `/books/${bookId}/rank/check`);
    expect(checkNow.status).toBe(202);
    expect(checkNow.json().jobId).toBe(rankCheckJobId);
    await worker.drain();
    const checked = (await client.request('GET', `/jobs/${rankCheckJobId}`)).json().job as { status: string };
    expect(checked.status).toBe('done');
    const baseline = (await client.request('GET', `/books/${bookId}/rank`)).json();
    expect((baseline.bsr as unknown[]).length).toBe(1);

    const simulation = await client.request('POST', `/books/${bookId}/rank/simulate`, { days: 30 });
    expect(simulation.json()).toMatchObject({ observed: expect.any(Number) });
    const simulated = simulation.json();
    expect(simulated.observed).toBeGreaterThanOrEqual(30);

    const rank = (await client.request('GET', `/books/${bookId}/rank`)).json();
    expect((rank.series as unknown[]).length).toBeGreaterThan(0);
    expect((rank.bsr as unknown[]).length).toBeGreaterThanOrEqual(30);
    // Regression: a re-check must not duplicate an open rec (JSONB key order broke the dedupe).
    const openBefore = (rank.recommendations as Array<{ status: string }>).filter((rec) => rec.status === 'open').length;
    const recheck = await client.request('POST', `/books/${bookId}/rank/check`);
    expect(recheck.status).toBe(202);
    await worker.drain();
    const rechecked = (await client.request('GET', `/books/${bookId}/rank`)).json();
    expect((rechecked.recommendations as Array<{ status: string }>).filter((rec) => rec.status === 'open').length).toBe(openBefore);
    // Regression: rows from another provider (a live Amazon check on a sample book) must not join the chart.
    const foreignDay = new Date(Date.UTC(2020, 0, 1));
    await context.prisma.bsrObservation.create({ data: { id: 'bsr_foreign', bookId, bsr: 459, provider: 'amazon-page', observedAt: foreignDay } });
    await context.prisma.rankObservation.create({ data: { id: 'rank_foreign', bookId, keyword: 'foreign', rank: null, provider: 'amazon-page', observedAt: foreignDay } });
    const isolated = (await client.request('GET', `/books/${bookId}/rank`)).json();
    expect((isolated.bsr as Array<{ bsr: number }>).some((point) => point.bsr === 459)).toBe(false);
    expect(isolated.bsr as unknown[]).toHaveLength((rechecked.bsr as unknown[]).length);
    const categories = rank.categories as Array<{ category: string; points: unknown[] }>;
    expect(categories.length).toBeGreaterThan(0);
    expect(categories[0]!.points.length).toBeGreaterThanOrEqual(30);
    const launch = (rank.recommendations as Array<{ kind: string; status: string; outcome: unknown }>).filter((rec) => rec.kind === 'keywords');
    expect(launch[0]?.status).toBe('applied');
    expect(launch[0]?.outcome).not.toBeNull();

    const open = (rank.recommendations as Array<{ id: string; status: string; kind: string }>).filter((rec) => rec.status === 'open');
    expect(open.length).toBeGreaterThan(0);
    const applied = await client.request('POST', `/books/${bookId}/recommendations/${open[0]!.id}/apply`);
    expect(applied.status).toBe(200);
    const versions = (await client.request('GET', `/books/${bookId}/metadata`)).json().versions as Array<{ recommendationId: string | null }>;
    expect(versions.some((version) => version.recommendationId === open[0]!.id)).toBe(true);

    const book = (await client.request('GET', `/books/${bookId}`)).json().book as { stage: string };
    expect(book.stage).toBe('track');
  });
});
