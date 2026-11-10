'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { day, moment } from '@/lib/format';
import type { AuthorDeclaration, AuthorDeclarationEntry, ChecklistItem, ComplianceView, DisclosureAnswer } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';

const KDP_EXTENT_OPTIONS = [
  'Entire work, with minimal or no editing',
  'Entire work, with extensive editing',
  'Some sections, with minimal or no editing',
  'Some sections, with extensive editing',
] as const;

const DECLARATION_FIELDS: Array<{ key: keyof AuthorDeclaration; label: string }> = [
  { key: 'textGeneratedOutsideQuire', label: 'Text From Other AI Tools' },
  { key: 'imagesGenerated', label: 'AI-Generated Images' },
  { key: 'translationGenerated', label: 'AI Translation' },
];

const CATEGORY_LABEL: Record<DisclosureAnswer['category'], string> = { text: 'Text', images: 'Images', translation: 'Translation' };
const STATUS_LABEL: Record<ChecklistItem['status'], string> = { pass: 'Pass', review: 'Review', confirm: 'Confirm' };
const STATUS_TAG: Record<ChecklistItem['status'], string> = { pass: 'tag-ok', review: 'tag-gilt', confirm: 'tag-accent' };
const COPY_RESET_MS = 1500;
const EMPTY_ENTRY: AuthorDeclarationEntry = { used: false, extent: null, tool: null };
const EMPTY_DECLARATION: AuthorDeclaration = { textGeneratedOutsideQuire: EMPTY_ENTRY, imagesGenerated: EMPTY_ENTRY, translationGenerated: EMPTY_ENTRY };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      setFailed(true);
    }
  }
  return (
    <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy()}>
      {failed ? 'Copy Blocked' : copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function answerText(answer: DisclosureAnswer): string {
  return [answer.answer, answer.extent, answer.tools.length > 0 ? answer.tools.join(', ') : null].filter(Boolean).join(' · ');
}

function Disclosure({ view }: { view: NonNullable<ComplianceView['report']> }) {
  const { disclosure } = view;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>KDP AI Disclosure</h2>
        <span className="muted small">Form checked {day(disclosure.formVerifiedOn)}</span>
      </div>
      <ul className="disclosure">
        {disclosure.answers.map((answer) => (
          <li key={answer.category}>
            <div className="disclosure-q">
              <span className="eyebrow">{CATEGORY_LABEL[answer.category]}</span>
              <p>{answer.question}</p>
            </div>
            <div className="disclosure-a">
              <span className={`disclosure-answer ${answer.answer === 'Yes' ? 'yes' : ''}`}>{answer.answer}</span>
              {answer.extent && <span>{answer.extent}</span>}
              {answer.tools.length > 0 && <span className="muted">{answer.tools.join(', ')}</span>}
              <CopyButton text={answerText(answer)} />
            </div>
            <p className="muted small disclosure-basis">{answer.basis}</p>
          </li>
        ))}
      </ul>
      <div className="panel-body disclosure-stats num">
        <span>
          <strong>{disclosure.assistedEdits}</strong> assisted edits
        </span>
        <span>
          <strong>{disclosure.generatedEdits}</strong> generated edits
        </span>
        <span>
          <strong>{disclosure.generatedWords}</strong> generated words
        </span>
      </div>
      {disclosure.notes.length > 0 && (
        <div className="panel-body stack">
          {disclosure.notes.map((note) => (
            <div key={note} className="notice notice-gilt">
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Checklist({ view, onChange }: { view: NonNullable<ComplianceView['report']>; onChange: (confirmations: string[]) => void }) {
  const { bookId } = useWorkspace();
  const action = useAction();
  const confirmed = new Set(view.confirmations);
  const needed = view.checklist.filter((item) => item.status === 'confirm');
  const remaining = needed.filter((item) => !confirmed.has(item.id)).length;

  async function toggle(itemId: string, value: boolean) {
    await action.run(async () => {
      const result = await api.post<{ confirmations: string[] }>(`/books/${bookId}/compliance/confirm`, { itemIds: [itemId], confirmed: value });
      onChange(result.confirmations);
    });
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Rights Checklist</h2>
        {needed.length > 0 && <span className={`tag ${remaining === 0 ? 'tag-ok' : 'tag-accent'}`}>{remaining === 0 ? 'All Confirmed' : `${remaining} To Confirm`}</span>}
      </div>
      {action.error && (
        <div className="panel-body">
          <div className="form-error">{action.error}</div>
        </div>
      )}
      <ul className="checklist">
        {view.checklist.map((item) => (
          <li key={item.id}>
            <div className="checklist-head">
              {item.status === 'confirm' ? (
                <label className="checkbox">
                  <input type="checkbox" checked={confirmed.has(item.id)} disabled={action.busy} onChange={(event) => void toggle(item.id, event.target.checked)} />
                  <strong>{item.label}</strong>
                </label>
              ) : (
                <strong>{item.label}</strong>
              )}
              <span className={`tag ${STATUS_TAG[item.status]}`}>{STATUS_LABEL[item.status]}</span>
            </div>
            <p className="muted small">{item.detail}</p>
            {item.findings.length > 0 && (
              <ul className="findings">
                {item.findings.slice(0, 5).map((finding) => (
                  <li key={`${finding.blockId}-${finding.excerpt}`}>{finding.excerpt}</li>
                ))}
                {item.findings.length > 5 && <li className="muted">+{item.findings.length - 5} more</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeclarationForm() {
  const { bookId, detail, reload } = useWorkspace();
  const [declaration, setDeclaration] = useState<AuthorDeclaration>(detail.book.declaration ?? EMPTY_DECLARATION);
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    setDeclaration(detail.book.declaration ?? EMPTY_DECLARATION);
  }, [detail.book.declaration]);

  function update(key: keyof AuthorDeclaration, patch: Partial<AuthorDeclarationEntry>) {
    setSaved(false);
    setDeclaration((previous) => {
      const next = { ...previous[key], ...patch };
      if (!next.used) Object.assign(next, { extent: null, tool: null });
      return { ...previous, [key]: next };
    });
  }

  async function save() {
    const ok = await action.run(async () => {
      await api.patch(`/books/${bookId}`, { declaration });
      await reload();
    });
    setSaved(ok);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your Declaration</h2>
      </div>
      <div className="panel-body stack">
        {DECLARATION_FIELDS.map((field) => {
          const entry = declaration[field.key];
          return (
            <div key={field.key} className="declaration-row">
              <label className="checkbox">
                <input type="checkbox" checked={entry.used} onChange={(event) => update(field.key, { used: event.target.checked })} />
                {field.label}
              </label>
              {entry.used && (
                <div className="form-grid two">
                  <label className="field">
                    <span className="field-label">Extent</span>
                    <select className="select" value={entry.extent ?? ''} onChange={(event) => update(field.key, { extent: event.target.value || null })}>
                      <option value="">Choose</option>
                      {KDP_EXTENT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Tool</span>
                    <input className="input" maxLength={120} value={entry.tool ?? ''} onChange={(event) => update(field.key, { tool: event.target.value || null })} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
        {action.error && <div className="form-error">{action.error}</div>}
        <div className="btn-row">
          <button type="button" className="btn" disabled={action.busy} onClick={() => void save()}>
            {action.busy ? <span className="spinner" /> : saved ? 'Saved' : 'Save Declaration'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Velocity({ velocity }: { velocity: ComplianceView['velocity'] }) {
  const used = Math.min(100, (velocity.publishedLast24h / velocity.limit) * 100);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Publishing Velocity</h2>
        <span className="num">
          {velocity.publishedLast24h} / {velocity.limit}
        </span>
      </div>
      <div className="panel-body stack">
        <div className={`meter${velocity.remaining === 0 ? ' over' : ''}`}>
          <span style={{ width: `${used}%` }} />
        </div>
        <p className="muted small">{velocity.remaining > 0 ? `${velocity.remaining} publishes left in 24h` : velocity.nextSlotAt ? `Next slot ${moment(velocity.nextSlotAt)}` : 'Limit reached'}</p>
      </div>
    </div>
  );
}

export function ComplianceTab() {
  const { bookId, detail, goTo, reload } = useWorkspace();
  const compliance = useResource<ComplianceView>(`/books/${bookId}/compliance`);
  const run = useAction();

  async function check() {
    await run.run(async () => {
      await api.post(`/books/${bookId}/compliance`, {});
      await Promise.all([compliance.reload(), reload()]);
    });
  }

  if (compliance.loading && !compliance.data) return <div className="loading">Loading…</div>;
  if (compliance.error && !compliance.data) return <div className="form-error">{compliance.error}</div>;
  const view = compliance.data;
  if (!view) return null;
  const report = view.report;
  const stale = report !== null && detail.pendingEdits > 0;

  return (
    <div className="split">
      <div className="stack">
        <div className="section-head">
          <span className="muted small">{report ? `Checked ${moment(report.createdAt)}` : 'Not checked'}</span>
          <div className="btn-row">
            {report && (
              <button type="button" className="btn btn-ghost" onClick={() => goTo('export')}>
                Export
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={run.busy || !detail.manuscript} onClick={() => void check()}>
              {run.busy ? <span className="spinner" /> : report ? 'Run Again' : 'Run Check'}
            </button>
          </div>
        </div>
        {run.error && <div className="form-error">{run.error}</div>}
        {stale && <div className="notice notice-gilt">{detail.pendingEdits} edits still pending. Run again after review.</div>}
        {!report && (
          <div className="empty">
            <h2>No Report Yet</h2>
          </div>
        )}
        {report && <Disclosure view={report} />}
        {report && (
          <Checklist
            view={report}
            onChange={(confirmations) => {
              compliance.setData({ ...view, report: { ...report, confirmations } });
            }}
          />
        )}
      </div>
      <div className="stack">
        <DeclarationForm />
        <Velocity velocity={view.velocity} />
      </div>
    </div>
  );
}
