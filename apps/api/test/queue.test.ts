import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import { ModelRequestError, toModelRequestError } from '@quire/core';
import { DeferJobError, claimJob, enqueue, failureUpdate } from '../src/queue';
import { resetDatabase, testContext } from './helpers';

let context: AppContext;

beforeAll(async () => {
  context = await testContext();
});
beforeEach(async () => {
  await resetDatabase(context);
});
afterAll(async () => {
  await context.prisma.$disconnect();
});

describe('job queue', () => {
  // Regression: comparing zoneless UTC columns to now() skewed by the session TimeZone, so jobs never ran west of UTC.
  it('claims a due job regardless of the database session time zone', async () => {
    await context.prisma.$executeRawUnsafe(`SET TIME ZONE 'America/Los_Angeles'`);
    const id = await enqueue(context.prisma, 'sweep', {}, null);
    const claimed = await claimJob(context.prisma, 'test');
    expect(claimed?.id).toBe(id);
    const job = await context.prisma.job.findUniqueOrThrow({ where: { id } });
    expect(Math.abs(job.lockedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('leaves future jobs alone and never hands one job to two workers', async () => {
    await enqueue(context.prisma, 'sweep', {}, null, new Date(Date.now() + 3_600_000));
    expect(await claimJob(context.prisma, 'a')).toBeNull();
    await enqueue(context.prisma, 'sweep', {}, null);
    const [first, second] = await Promise.all([claimJob(context.prisma, 'a'), claimJob(context.prisma, 'b')]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});

describe('job failure policy', () => {
  const now = new Date('2026-11-12T12:00:00Z');

  // Regression: a robot check used to retry in 5s, which only extends Amazon's block.
  it('requeues a deferred job after its delay with its code', () => {
    const update = failureUpdate(new DeferJobError('amazon_blocked', 30 * 60_000, 'robot check'), 1, false, now);
    expect(update).toEqual({ status: 'queued', error: 'robot check', errorCode: 'amazon_blocked', runAt: new Date('2026-11-12T12:30:00Z') });
  });

  it('fails a deferred job on its last attempt and keeps the code', () => {
    expect(failureUpdate(new DeferJobError('amazon_blocked', 1_000, 'robot check'), 3, true, now)).toMatchObject({ status: 'failed', errorCode: 'amazon_blocked' });
  });

  // Regression: a "credit balance too low" 400 was retried three times and shown to the author as raw JSON.
  it('fails a refused model request at once with the provider message', () => {
    const refused = toModelRequestError(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low."}}'));
    expect(refused).toBeInstanceOf(ModelRequestError);
    expect(failureUpdate(refused, 1, false, now)).toEqual({ status: 'failed', finishedAt: now, error: 'Your credit balance is too low.', errorCode: null });
  });

  it('retries a rate-limited model request', () => {
    expect(failureUpdate(new ModelRequestError(429, 'slow down'), 1, false, now)).toMatchObject({ status: 'queued' });
  });

  it('backs ordinary errors off exponentially', () => {
    expect(failureUpdate(new Error('boom'), 2, false, now)).toEqual({ status: 'queued', error: 'boom', errorCode: null, runAt: new Date('2026-11-12T12:00:10Z') });
  });
});
