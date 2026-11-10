import { type SpendLedger, type SpendSnapshot, cents } from '@quire/core';
import type { PrismaClient } from '@quire/db';
import { newId } from '@quire/core';

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Spend caps read the ledger at call time, so concurrent jobs see each other's spend. */
export class PrismaSpendLedger implements SpendLedger {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly platformCapCents: number,
    private readonly clock: () => Date,
  ) {}

  async snapshot(accountId: string): Promise<SpendSnapshot> {
    const since = startOfUtcDay(this.clock());
    const [user, account, platform] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: accountId }, select: { spendCapCentsDaily: true } }),
      this.prisma.spendEntry.aggregate({ where: { userId: accountId, createdAt: { gte: since } }, _sum: { costCents: true } }),
      this.prisma.spendEntry.aggregate({ where: { createdAt: { gte: since } }, _sum: { costCents: true } }),
    ]);
    return {
      accountSpentCents: cents(account._sum.costCents ?? 0),
      accountCapCents: cents(user.spendCapCentsDaily),
      platformSpentCents: cents(platform._sum.costCents ?? 0),
      platformCapCents: cents(this.platformCapCents),
    };
  }

  async record(entry: { accountId: string; bookId: string | null; purpose: string; model: string; costCents: number }): Promise<void> {
    await this.prisma.spendEntry.create({
      data: { id: newId('spend'), userId: entry.accountId, bookId: entry.bookId, purpose: entry.purpose, model: entry.model, costCents: entry.costCents },
    });
  }
}
