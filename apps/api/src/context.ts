import type { ModelGateway } from '@quire/core';
import type { PrismaClient } from '@quire/db';
import type { DiscoveryProviders } from '@quire/discovery';
import type { RankProvider } from '@quire/tracking';
import type { Env } from './env';
import type { PrismaSpendLedger } from './ledger';
import type { FileStorage } from './storage';

export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  storage: FileStorage;
  ledger: PrismaSpendLedger;
  /** Unmetered gateway; services wrap it per call with meteredGateway. */
  gateway: ModelGateway;
  discovery: DiscoveryProviders;
  ranks: RankProvider & { supportsBackfill: boolean };
  clock: () => Date;
}
