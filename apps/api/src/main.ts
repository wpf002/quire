import { createFlintGateway } from '@quire/core';
import { createPrisma } from '@quire/db';
import { providersFromConfig } from '@quire/discovery';
import { SampleRankProvider } from '@quire/tracking';
import { buildApp } from './app';
import type { AppContext } from './context';
import { loadEnv } from './env';
import { PrismaSpendLedger } from './ledger';
import { Worker, enqueue } from './queue';
import { runBlurbJob } from './services/blurb';
import { runDiscoveryJob } from './services/discovery';
import { runPassJob } from './services/passes';
import { sweepAll } from './services/tracking';
import { FileStorage } from './storage';

const SWEEP_CHECK_MS = 3_600_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrisma(env.DATABASE_URL);
  const clock = () => new Date();
  const context: AppContext = {
    env,
    prisma,
    clock,
    storage: new FileStorage(env.QUIRE_STORAGE_DIR),
    ledger: new PrismaSpendLedger(prisma, env.QUIRE_PLATFORM_SPEND_CAP_CENTS_DAILY, clock),
    gateway: await createFlintGateway(env.ANTHROPIC_API_KEY, env.QUIRE_MODEL_CHEAP),
    discovery: providersFromConfig(env.QUIRE_DISCOVERY_PROVIDERS),
    ranks: Object.assign(new SampleRankProvider(), { supportsBackfill: true }),
  };
  const app = await buildApp(context);

  const worker = new Worker(
    prisma,
    {
      pass: (payload, job) => runPassJob(context, payload, job.final),
      discovery: (payload) => runDiscoveryJob(context, payload),
      blurb: (payload) => runBlurbJob(context, payload),
      sweep: async () => {
        const swept = await sweepAll(context);
        app.log.info({ swept }, 'daily sweep done');
      },
    },
    app.log,
  );

  // One sweep job per UTC day; the hourly check only enqueues when today's is missing.
  const scheduleSweep = async () => {
    const today = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    const existing = await prisma.job.findFirst({ where: { type: 'sweep', createdAt: { gte: today } } });
    if (!existing) await enqueue(prisma, 'sweep', {}, null);
  };
  let sweepTimer: NodeJS.Timeout | null = null;
  if (env.QUIRE_WORKER === 'on') {
    worker.start();
    await scheduleSweep();
    sweepTimer = setInterval(() => {
      scheduleSweep().catch((error: unknown) => app.log.error({ err: error }, 'sweep scheduling failed'));
    }, SWEEP_CHECK_MS);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    if (sweepTimer) clearInterval(sweepTimer);
    await app.close();
    await worker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.QUIRE_API_PORT, host: '0.0.0.0' });
  app.log.info({ model: context.gateway.available, providers: env.QUIRE_DISCOVERY_PROVIDERS }, 'api ready');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
