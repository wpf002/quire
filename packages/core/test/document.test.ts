import { describe, expect, it } from 'vitest';
import { countWords, formatCents, cents, centsFromUsd, replaceInBlock } from '../src';

describe('countWords', () => {
  it('counts contractions and hyphenated words once', () => {
    expect(countWords("She didn't see the well-worn path.")).toBe(6);
  });
});

describe('money', () => {
  it('formats cents', () => {
    expect(formatCents(cents(123456))).toBe('$1,234.56');
    expect(formatCents(cents(-5))).toBe('-$0.05');
  });
  it('rounds usd up to the next cent', () => {
    expect(centsFromUsd(0.001)).toBe(1);
    expect(centsFromUsd(0.1)).toBe(10);
  });
  it('rejects fractional cents', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
  });
});

describe('replaceInBlock', () => {
  it('keeps run formatting when the match is inside one run', () => {
    const block = { kind: 'paragraph' as const, id: 'b', runs: [{ text: 'Hello ' }, { text: 'wrold', em: true }] };
    expect(replaceInBlock(block, 'wrold', 'world')?.runs).toEqual([{ text: 'Hello ' }, { text: 'world', em: true }]);
  });
  it('flattens when the match spans runs', () => {
    const block = { kind: 'paragraph' as const, id: 'b', runs: [{ text: 'Hel' }, { text: 'lo there' }] };
    expect(replaceInBlock(block, 'Hello', 'Hi')?.runs).toEqual([{ text: 'Hi there' }]);
  });
  // Regression: accepting a smart-quote fix changed the context of a misspelling fix beside it, so it went stale.
  it('relocates a change whose context an accepted neighbour changed', () => {
    const block = { kind: 'paragraph' as const, id: 'b', runs: [{ text: '“Did you recieve the flour?”' }] };
    expect(replaceInBlock(block, '"Did you recieve the flou', '"Did you receive the flou')?.runs).toEqual([{ text: '“Did you receive the flour?”' }]);
  });
  it('refuses to relocate when the trimmed match is ambiguous', () => {
    const block = { kind: 'paragraph' as const, id: 'b', runs: [{ text: 'a teh bakery, b teh bakery' }] };
    expect(replaceInBlock(block, 'x teh bakery', 'x the bakery')).toBeNull();
  });
  it('returns null when the text is gone', () => {
    const block = { kind: 'paragraph' as const, id: 'b', runs: [{ text: 'abc' }] };
    expect(replaceInBlock(block, 'xyz', 'q')).toBeNull();
  });
});
