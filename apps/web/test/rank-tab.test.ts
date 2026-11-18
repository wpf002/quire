import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RankTab } from '../src/components/workspace/rank-tab';
import type { Job, RankView } from '../src/lib/types';

const resource = vi.hoisted(() => ({ view: null as unknown }));

vi.mock('@/lib/use-resource', () => ({
  useResource: () => ({ data: resource.view, error: null, loading: false, reload: async () => undefined, setData: () => undefined }),
}));
vi.mock('@/lib/use-action', () => ({
  useAction: () => ({ busy: false, error: null, run: async () => true, clear: () => undefined }),
}));
vi.mock('../src/components/workspace/context', () => ({
  useWorkspace: () => ({
    bookId: 'book_1',
    detail: { book: { publishedAt: '2026-11-01T00:00:00.000Z' } },
    reload: async () => undefined,
    goTo: () => undefined,
  }),
}));

const rankCheck = (overrides: Partial<Job>): Job => ({
  id: 'job_1',
  type: 'observe',
  status: 'done',
  attempts: 1,
  error: null,
  errorCode: null,
  runAt: '2026-11-16T18:45:00.000Z',
  createdAt: '2026-11-16T17:45:00.000Z',
  finishedAt: null,
  ...overrides,
});

const viewWith = (check: Job | null): RankView => ({
  provider: 'amazon',
  simulated: false,
  publishedAt: '2026-11-01T00:00:00.000Z',
  series: [],
  bsr: [],
  categories: [],
  changes: [],
  recommendations: [],
  rankCheck: check,
});

const renderTab = () => renderToStaticMarkup(createElement(RankTab));

describe('RankTab blocked notice', () => {
  beforeEach(() => {
    resource.view = viewWith(null);
  });

  // Regression: a requeued robot check vanished from the Rank tab once the page reloaded.
  it('shows the requeue time for a rank check Amazon blocked', () => {
    resource.view = viewWith(rankCheck({ status: 'queued', errorCode: 'amazon_blocked', attempts: 2 }));
    expect(renderTab()).toMatch(/form-error">Amazon Blocked\. Retry Later\. Requeued for \d/);
  });

  it('shows no notice after a clean rank check', () => {
    resource.view = viewWith(rankCheck({ status: 'done' }));
    expect(renderTab()).not.toContain('form-error');
  });
});
