import { describe, expect, it } from 'vitest';
import { wordDiff } from '../src/lib/diff';

describe('wordDiff', () => {
  it('returns one same part for identical text', () => {
    expect(wordDiff('The salt road.', 'The salt road.')).toEqual([{ kind: 'same', text: 'The salt road.' }]);
  });

  it('marks a replaced word as removed then added', () => {
    expect(wordDiff('She walked quick home.', 'She walked quickly home.')).toEqual([
      { kind: 'same', text: 'She walked ' },
      { kind: 'removed', text: 'quick' },
      { kind: 'added', text: 'quickly' },
      { kind: 'same', text: ' home.' },
    ]);
  });

  it('rebuilds both sides from the parts', () => {
    const before = 'It was , he said, a long way.';
    const after = 'It was, he said, a very long way!';
    const parts = wordDiff(before, after);
    expect(parts.filter((part) => part.kind !== 'added').map((part) => part.text).join('')).toBe(before);
    expect(parts.filter((part) => part.kind !== 'removed').map((part) => part.text).join('')).toBe(after);
  });
});
