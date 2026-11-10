import type { AppContext } from '../context';
import { startOfUtcDay } from '../ledger';
import { PLANS } from '../plans';

const USAGE_DAYS = 30;
const DAY_MS = 86_400_000;

export async function usageSummary(context: AppContext, userId: string) {
  const now = context.clock();
  const today = startOfUtcDay(now);
  const since = new Date(today.getTime() - (USAGE_DAYS - 1) * DAY_MS);
  const [user, entries, books] = await Promise.all([
    context.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    context.prisma.spendEntry.findMany({ where: { userId, createdAt: { gte: since } }, select: { costCents: true, createdAt: true, purpose: true, model: true } }),
    context.prisma.book.count({ where: { userId } }),
  ]);
  const daily = Array.from({ length: USAGE_DAYS }, (_, index) => ({ day: new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10), costCents: 0, calls: 0 }));
  const byPurpose = new Map<string, { purpose: string; costCents: number; calls: number }>();
  for (const entry of entries) {
    const slot = daily[Math.floor((startOfUtcDay(entry.createdAt).getTime() - since.getTime()) / DAY_MS)];
    if (slot) {
      slot.costCents += entry.costCents;
      slot.calls += 1;
    }
    const bucket = byPurpose.get(entry.purpose) ?? { purpose: entry.purpose, costCents: 0, calls: 0 };
    bucket.costCents += entry.costCents;
    bucket.calls += 1;
    byPurpose.set(entry.purpose, bucket);
  }
  const plan = PLANS[user.plan];
  return {
    plan,
    plans: Object.values(PLANS),
    todayCents: daily.at(-1)?.costCents ?? 0,
    capCents: user.spendCapCentsDaily,
    monthCents: entries.reduce((sum, entry) => sum + entry.costCents, 0),
    daily,
    byPurpose: [...byPurpose.values()].sort((left, right) => right.costCents - left.costCents),
    books: { used: books, limit: plan.activeBooks },
    modelAvailable: context.gateway.available,
  };
}
