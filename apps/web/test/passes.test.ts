import { describe, expect, it } from 'vitest';
import { currentStructuralPass } from '../src/lib/passes';
import type { Pass } from '../src/lib/types';

function structuralPass(id: string, createdAt: string): Pass {
  return {
    id,
    kind: 'structural',
    status: 'done',
    manuscriptVersion: 1,
    model: 'model',
    modelSkippedReason: null,
    notes: [{ note: 'Tighten the opening.', quote: null, chapterId: 'ch_1', specificity: 'generic' }],
    costCents: 0,
    error: null,
    createdAt,
    finishedAt: createdAt,
    _count: { edits: 0 },
  };
}

describe('currentStructuralPass', () => {
  // Regression: replacing the file kept showing notes that quoted the old manuscript.
  it('ignores structural notes from before the latest upload', () => {
    const passes = [structuralPass('pass_old', '2026-11-16T10:00:00Z')];
    expect(currentStructuralPass(passes, '2026-11-16T11:00:00Z')).toBeUndefined();
    expect(currentStructuralPass(passes, '2026-11-16T09:00:00Z')?.id).toBe('pass_old');
    expect(currentStructuralPass(passes, undefined)?.id).toBe('pass_old');
  });
});
