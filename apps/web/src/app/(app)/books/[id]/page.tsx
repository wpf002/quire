'use client';

import { BOOK_STAGES, type BookStage, TRIM_SIZES } from '@quire/core/stages';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useMemo } from 'react';
import { STAGE_LABELS, stageIndex } from '@/components/stage-strip';
import { ComplianceTab } from '@/components/workspace/compliance-tab';
import { type TabId, WorkspaceContext } from '@/components/workspace/context';
import { EditsTab } from '@/components/workspace/edits-tab';
import { ExportTab } from '@/components/workspace/export-tab';
import { ManuscriptTab } from '@/components/workspace/manuscript-tab';
import { MetadataTab } from '@/components/workspace/metadata-tab';
import { RankTab } from '@/components/workspace/rank-tab';
import { count } from '@/lib/format';
import type { BookDetail } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'manuscript', label: 'Manuscript' },
  { id: 'edits', label: 'Edits' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'export', label: 'Export' },
  { id: 'rank', label: 'Rank' },
];

const STAGE_TAB: Record<BookStage, TabId> = {
  upload: 'manuscript',
  edit: 'edits',
  comply: 'compliance',
  metadata: 'metadata',
  export: 'export',
  publish: 'metadata',
  track: 'rank',
};

const isTab = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value);

function Stepper({ stage, onSelect }: { stage: BookStage; onSelect: (tab: TabId) => void }) {
  const current = stageIndex(stage);
  return (
    <ol className="stepper">
      {BOOK_STAGES.map((name, index) => (
        <li key={name} className={index < current ? 'done' : index === current ? 'current' : undefined}>
          <button type="button" onClick={() => onSelect(STAGE_TAB[name])}>
            <span className="num">{String(index + 1).padStart(2, '0')}</span>
            {STAGE_LABELS[name]}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Workspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const bookId = params.id;
  const resource = useResource<BookDetail>(`/books/${bookId}`);
  const detail = resource.data;
  const requested = search.get('tab');
  const tab: TabId = isTab(requested) ? requested : detail ? STAGE_TAB[detail.book.stage] : 'manuscript';

  const goTo = useCallback((next: TabId) => router.replace(`/books/${bookId}?tab=${next}`, { scroll: false }), [router, bookId]);
  const value = useMemo(() => (detail ? { bookId, detail, reload: resource.reload, goTo } : null), [bookId, detail, resource.reload, goTo]);

  if (resource.error && !detail) return <div className="page"><div className="form-error">{resource.error}</div></div>;
  if (!value || !detail) return <div className="page loading">Loading…</div>;

  const { book } = detail;
  const words = detail.manuscript?.chapters.reduce((sum, chapter) => sum + chapter.words, 0) ?? 0;

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="page workspace">
        <header className="book-head">
          <div className="book-title">
            <span className="eyebrow">
              {book.genre || 'Book'} · {TRIM_SIZES[book.trimSize].label}
              {words > 0 && ` · ${count(words)} words`}
            </span>
            <h1>{book.title}</h1>
            {book.subtitle && <p className="book-subtitle">{book.subtitle}</p>}
            <p className="muted">by {book.author}</p>
          </div>
          <Stepper stage={book.stage} onSelect={goTo} />
        </header>
        <nav className="tabs" role="tablist" aria-label="Book sections">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => goTo(item.id)}>
              {item.label}
              {item.id === 'edits' && detail.pendingEdits > 0 && <span className="tab-count num">{detail.pendingEdits}</span>}
              {item.id === 'rank' && detail.openRecommendations > 0 && <span className="tab-count accent num">{detail.openRecommendations}</span>}
            </button>
          ))}
        </nav>
        <section role="tabpanel" className="tab-panel">
          {tab === 'manuscript' && <ManuscriptTab />}
          {tab === 'edits' && <EditsTab />}
          {tab === 'compliance' && <ComplianceTab />}
          {tab === 'metadata' && <MetadataTab />}
          {tab === 'export' && <ExportTab />}
          {tab === 'rank' && <RankTab />}
        </section>
      </div>
    </WorkspaceContext.Provider>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="page loading">Loading…</div>}>
      <Workspace />
    </Suspense>
  );
}
