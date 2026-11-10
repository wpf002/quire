import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import { claimJob, enqueue } from '../src/queue';
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
