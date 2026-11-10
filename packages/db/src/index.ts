import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
