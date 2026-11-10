'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { wordDiff } from '@/lib/diff';
import type { DecideResult, Edit } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';

type Filter = 'all' | Edit['pass']['kind'];
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'copyedit', label: 'Copyedit' },
  { id: 'proofread', label: 'Proofread' },
  { id: 'structural', label: 'Structural' },
];

const ROLE_LABEL: Record<Edit['aiRole'], string> = { none: 'Rule', assisted: 'AI Assisted', generated: 'AI Generated' };

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="diff">
      {parts.map((part, index) =>
        part.kind === 'same' ? <span key={index}>{part.text}</span> : part.kind === 'removed' ? <del key={index}>{part.text}</del> : <ins key={index}>{part.text}</ins>,
      )}
    </p>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

export function EditsTab() {
  const { bookId, detail, reload, goTo } = useWorkspace();
  const edits = useResource<{ edits: Edit[] }>(`/books/${bookId}/edits?status=pending`);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(0);
  const [revising, setRevising] = useState<string | null>(null);
  const [tally, setTally] = useState({ accepted: 0, rejected: 0, stale: 0 });
  const action = useAction();

  const chapterTitles = useMemo(() => new Map(detail.manuscript?.chapters.map((chapter) => [chapter.id, chapter.title]) ?? []), [detail.manuscript]);
  const visible = useMemo(() => (edits.data?.edits ?? []).filter((edit) => filter === 'all' || edit.pass.kind === filter), [edits.data, filter]);
  const current = visible[Math.min(selected, visible.length - 1)];

  const decide = useCallback(
    async (decisions: Array<{ id: string; action: 'accept' | 'reject'; after?: string }>) => {
      if (decisions.length === 0) return;
      const ids = new Set(decisions.map((decision) => decision.id));
      await action.run(async () => {
        const result = await api.post<DecideResult>(`/books/${bookId}/edits/decide`, { decisions });
        setTally((previous) => ({ accepted: previous.accepted + result.accepted, rejected: previous.rejected + result.rejected, stale: previous.stale + result.stale }));
        if (edits.data) edits.setData({ edits: edits.data.edits.filter((edit) => !ids.has(edit.id)) });
        setRevising(null);
        await reload();
      });
    },
    [action, bookId, edits, reload],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey || action.busy) return;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, visible.length - 1));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
      } else if (event.key === 'a' && current) {
        void decide([{ id: current.id, action: 'accept' }]);
      } else if (event.key === 'r' && current) {
        void decide([{ id: current.id, action: 'reject' }]);
      } else if (event.key === 'e' && current) {
        event.preventDefault();
        setRevising(current.after);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible.length, current, decide, action.busy]);

  useEffect(() => {
    document.querySelector('.edit-queue [aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, filter]);

  if (edits.loading && !edits.data) return <div className="loading">Loading…</div>;

  const reviewed = tally.accepted + tally.rejected;
  if (visible.length === 0 && (edits.data?.edits.length ?? 0) === 0) {
    return (
      <div className="empty">
        <h2>{reviewed > 0 ? 'Queue Clear' : 'No Pending Edits'}</h2>
        {reviewed > 0 && (
          <p className="muted num">
            {tally.accepted} accepted · {tally.rejected} rejected{tally.stale > 0 && ` · ${tally.stale} stale`}
          </p>
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => goTo('manuscript')}>
            Run a Pass
          </button>
          <button type="button" className="btn btn-primary" onClick={() => goTo('compliance')}>
            Compliance
          </button>
        </div>
      </div>
    );
  }

  const ruleEdits = visible.filter((edit) => edit.aiRole === 'none');

  return (
    <div className="edits">
      <div className="edits-bar">
        <div className="segmented" role="radiogroup" aria-label="Filter by pass">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={filter === item.id}
              onClick={() => {
                setFilter(item.id);
                setSelected(0);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="muted small num">
          {visible.length} pending{reviewed > 0 && ` · ${reviewed} reviewed`}
        </span>
        <div className="btn-row edits-bulk">
          <button type="button" className="btn btn-small" disabled={ruleEdits.length === 0 || action.busy} onClick={() => void decide(ruleEdits.map((edit) => ({ id: edit.id, action: 'accept' })))}>
            Accept {ruleEdits.length} Rule Edits
          </button>
        </div>
      </div>
      {action.error && <div className="form-error">{action.error}</div>}
      {tally.stale > 0 && <div className="notice notice-gilt">{tally.stale} edits no longer matched the text and were skipped.</div>}

      <div className="edits-body">
        <ol className="edit-queue">
          {visible.map((edit, index) => (
            <li key={edit.id}>
              <button type="button" aria-current={edit.id === current?.id ? 'true' : undefined} onClick={() => setSelected(index)}>
                <span className="edit-queue-meta">
                  <span>{chapterTitles.get(edit.chapterId) ?? 'Chapter'}</span>
                  <span className={`role role-${edit.aiRole}`}>{ROLE_LABEL[edit.aiRole]}</span>
                </span>
                <span className="edit-queue-text">
                  <del>{edit.before.slice(0, 60)}</del>
                </span>
              </button>
            </li>
          ))}
        </ol>

        {current && (
          <div className="edit-card panel">
            <div className="panel-head">
              <span className="eyebrow">
                {chapterTitles.get(current.chapterId) ?? 'Chapter'} · {current.pass.kind}
              </span>
              <span className="btn-row">
                {current.rule && <span className="tag mono">{current.rule}</span>}
                <span className={`tag ${current.aiRole === 'none' ? '' : 'tag-gilt'}`}>{ROLE_LABEL[current.aiRole]}</span>
              </span>
            </div>
            <div className="panel-body stack">
              {revising === null ? (
                <Diff before={current.before} after={current.after} />
              ) : (
                <textarea className="textarea reader-font" rows={6} value={revising} onChange={(event) => setRevising(event.target.value)} autoFocus />
              )}
              <p className="edit-reason">{current.reason}</p>
              <p className="muted small">Source: {current.source}</p>
            </div>
            <div className="edit-actions">
              {revising === null ? (
                <>
                  <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void decide([{ id: current.id, action: 'accept' }])}>
                    Accept <span className="kbd">A</span>
                  </button>
                  <button type="button" className="btn" disabled={action.busy} onClick={() => void decide([{ id: current.id, action: 'reject' }])}>
                    Reject <span className="kbd">R</span>
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setRevising(current.after)}>
                    Revise <span className="kbd">E</span>
                  </button>
                  <span className="edit-keys muted small">
                    <span className="kbd">J</span> <span className="kbd">K</span> Move
                  </span>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" disabled={action.busy || !revising.trim()} onClick={() => void decide([{ id: current.id, action: 'accept', after: revising }])}>
                    Accept Revision
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setRevising(null)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
