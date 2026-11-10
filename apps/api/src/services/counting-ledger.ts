import type { SpendLedger } from '@quire/core';

/** Passes through to the real ledger and totals what one job spent. */
export class CountingLedger implements SpendLedger {
  totalCents = 0;
  constructor(private readonly inner: SpendLedger) {}
  snapshot(accountId: string) {
    return this.inner.snapshot(accountId);
  }
  async record(entry: Parameters<SpendLedger['record']>[0]): Promise<void> {
    await this.inner.record(entry);
    this.totalCents += entry.costCents;
  }
}
