import { type Cents, cents } from './money';

export type SpendDecision =
  | { allowed: true; remainingCents: Cents }
  | { allowed: false; reason: 'account-cap' | 'platform-cap'; capCents: Cents; spentCents: Cents };

export interface SpendSnapshot {
  accountSpentCents: Cents;
  accountCapCents: Cents;
  platformSpentCents: Cents;
  platformCapCents: Cents;
}

/**
 * Decides whether a call costing `estimateCents` may run. Fails closed: a call that would cross
 * either cap is refused before it is sent, so caps hold even when the estimate is exact.
 */
export function decideSpend(snapshot: SpendSnapshot, estimateCents: Cents): SpendDecision {
  if (snapshot.platformSpentCents + estimateCents > snapshot.platformCapCents) {
    return { allowed: false, reason: 'platform-cap', capCents: snapshot.platformCapCents, spentCents: snapshot.platformSpentCents };
  }
  if (snapshot.accountSpentCents + estimateCents > snapshot.accountCapCents) {
    return { allowed: false, reason: 'account-cap', capCents: snapshot.accountCapCents, spentCents: snapshot.accountSpentCents };
  }
  const remaining = Math.min(
    snapshot.accountCapCents - snapshot.accountSpentCents - estimateCents,
    snapshot.platformCapCents - snapshot.platformSpentCents - estimateCents,
  );
  return { allowed: true, remainingCents: cents(remaining) };
}

/** Ledger the gateway writes through. Implemented by the API against Postgres. */
export interface SpendLedger {
  snapshot(accountId: string): Promise<SpendSnapshot>;
  record(entry: { accountId: string; bookId: string | null; purpose: string; model: string; costCents: Cents }): Promise<void>;
}

export class SpendCapError extends Error {
  constructor(readonly decision: Extract<SpendDecision, { allowed: false }>) {
    super(decision.reason === 'platform-cap' ? 'Platform spend cap reached' : 'Account spend cap reached');
    this.name = 'SpendCapError';
  }
}
