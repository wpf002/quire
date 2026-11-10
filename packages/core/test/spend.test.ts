import { describe, expect, it } from 'vitest';
import { cents, decideSpend, meteredGateway, SpendCapError, type SpendLedger, type SpendSnapshot } from '../src';

const snapshot = (overrides: Partial<Record<keyof SpendSnapshot, number>> = {}): SpendSnapshot => ({
  accountSpentCents: cents(overrides.accountSpentCents ?? 0),
  accountCapCents: cents(overrides.accountCapCents ?? 500),
  platformSpentCents: cents(overrides.platformSpentCents ?? 0),
  platformCapCents: cents(overrides.platformCapCents ?? 2000),
});

describe('decideSpend', () => {
  it('allows a call under both caps', () => {
    expect(decideSpend(snapshot(), cents(100))).toEqual({ allowed: true, remainingCents: 400 });
  });

  it('refuses a call that would land exactly past the account cap', () => {
    const decision = decideSpend(snapshot({ accountSpentCents: 450 }), cents(51));
    expect(decision).toMatchObject({ allowed: false, reason: 'account-cap' });
  });

  it('allows a call that lands exactly on the cap', () => {
    expect(decideSpend(snapshot({ accountSpentCents: 450 }), cents(50)).allowed).toBe(true);
  });

  it('checks the platform cap before the account cap', () => {
    const decision = decideSpend(snapshot({ platformSpentCents: 1999 }), cents(5));
    expect(decision).toMatchObject({ allowed: false, reason: 'platform-cap' });
  });
});

describe('meteredGateway', () => {
  function fakeLedger(spent: number): SpendLedger & { records: number[] } {
    const records: number[] = [];
    return {
      records,
      async snapshot() {
        return snapshot({ accountSpentCents: spent + records.reduce((a, b) => a + b, 0) });
      },
      async record(entry) {
        records.push(entry.costCents);
      },
    };
  }
  const gateway = {
    available: true,
    calls: 0,
    async complete() {
      this.calls += 1;
      return { text: 'ok', model: 'claude-haiku-5-5', tokens: { input: 1_000_000, output: 0 } };
    },
  };

  it('never sends the request once the cap is reached', async () => {
    const ledger = fakeLedger(500);
    const metered = meteredGateway(gateway, ledger, { accountId: 'a', bookId: null, purpose: 'test' });
    const before = gateway.calls;
    await expect(
      metered.complete({ model: 'claude-haiku-5-5', system: '', prompt: 'x', maxTokens: 10, cacheSystem: false }),
    ).rejects.toBeInstanceOf(SpendCapError);
    expect(gateway.calls).toBe(before);
    expect(ledger.records).toEqual([]);
  });

  it('records the real cost after a call', async () => {
    const ledger = fakeLedger(0);
    const metered = meteredGateway(gateway, ledger, { accountId: 'a', bookId: null, purpose: 'test' });
    await metered.complete({ model: 'claude-haiku-5-5', system: '', prompt: 'x', maxTokens: 10, cacheSystem: false });
    expect(ledger.records).toEqual([100]);
  });
});
