import { hostname } from 'node:os';
import type { PrismaClient } from '@quire/db';
import { newId } from '@quire/core';
import type { FastifyBaseLogger } from 'fastify';
import { toJson } from './json';

export type JobType = 'pass' | 'discovery' | 'blurb' | 'sweep';
const RETRY_BASE_MS = 5_000;
const POLL_MS = 1_000;
const STALE_LOCK_MS = 15 * 60_000;

export async function enqueue(prisma: PrismaClient, type: JobType, payload: unknown, userId: string | null, runAt = new Date()): Promise<string> {
  const id = newId('job');
  await prisma.job.create({ data: { id, type, payload: toJson(payload), userId, runAt } });
  return id;
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/** Claim one due job. SKIP LOCKED lets several workers poll the same table without double-running a job. */
export async function claimJob(prisma: PrismaClient, workerId: string): Promise<ClaimedJob | null> {
  // Prisma stores DateTime as UTC in zoneless columns. Read them as UTC so the session TimeZone can't skew the comparison.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET status = 'running', "lockedAt" = (${now}::timestamptz AT TIME ZONE 'UTC'), "lockedBy" = ${workerId}, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'queued' AND ("runAt" AT TIME ZONE 'UTC') <= ${now}::timestamptz) OR (status = 'running' AND ("lockedAt" AT TIME ZONE 'UTC') < ${staleBefore}::timestamptz)
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, "maxAttempts"`;
  return rows[0] ?? null;
}

export type JobHandler = (payload: unknown, job: { id: string; attempt: number; final: boolean }) => Promise<void>;

export class Worker {
  private running = false;
  private current: Promise<void> | null = null;
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly handlers: Record<JobType, JobHandler>,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.current;
  }

  /** Run every due job once. Used by tests and the CLI. */
  async drain(): Promise<number> {
    let count = 0;
    while (await this.runOne()) count += 1;
    return count;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const attempt = this.runOne().catch((error: unknown) => {
        this.log.error({ err: error }, 'worker loop error');
        return false;
      });
      this.current = attempt.then(() => undefined);
      const ran = await attempt;
      if (!ran && this.running) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  private async runOne(): Promise<boolean> {
    const job = await claimJob(this.prisma, this.workerId);
    if (!job) return false;
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const handler = this.handlers[job.type as JobType];
    const final = job.attempts >= job.maxAttempts;
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      log.info('job started');
      await handler(job.payload, { id: job.id, attempt: job.attempts, final });
      await this.prisma.job.update({ where: { id: job.id }, data: { status: 'done', finishedAt: new Date(), error: null } });
      log.info('job done');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, 'job failed');
      await this.prisma.job.update({
        where: { id: job.id },
        data: final
          ? { status: 'failed', finishedAt: new Date(), error: message }
          : { status: 'queued', error: message, runAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (job.attempts - 1)) },
      });
    }
    return true;
  }
}
