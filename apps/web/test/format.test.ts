import { describe, expect, it } from 'vitest';
import { bytes, dollars, since } from '../src/lib/format';

describe('format', () => {
  it('formats cents as dollars', () => {
    expect(dollars(499)).toBe('$4.99');
  });

  it('formats byte sizes', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KB');
  });

  it('describes elapsed time', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(since('2026-11-10T11:30:00Z', now)).toBe('30m ago');
    expect(since('2026-11-08T12:00:00Z', now)).toBe('2d ago');
  });
});
