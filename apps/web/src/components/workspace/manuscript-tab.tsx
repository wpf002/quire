'use client';

import type { PassKind } from '@quire/core/stages';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { bytes, count, dollars, moment } from '@/lib/format';
import { waitForJob } from '@/lib/jobs';
import type { Block, Manuscript, Pass, Run } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';

const ACCEPTED = '.docx,.epub,.md,.markdown';
const PASSES: Array<{ kind: PassKind; label: string; scope: string }> = [
  { kind: 'copyedit', label: 'Copyedit', scope: 'Grammar, usage, consistency' },
  { kind: 'proofread', label: 'Proofread', scope: 'Typos, punctuation, spacing' },
  { kind: 'structural', label: 'Structural', scope: 'Chapter notes, pacing' },
];

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) => {
        let node: React.ReactNode = run.text;
        if (run.em) node = <em>{node}</em>;
        if (run.strong) node = <strong>{node}</strong>;
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? <h3 className="reader-h2"><Runs runs={block.runs} /></h3> : <h4 className="reader-h3"><Runs runs={block.runs} /></h4>;
    case 'quote':
      return <blockquote><Runs runs={block.runs} /></blockquote>;
    case 'scene-break':
      return <p className="scene-break" aria-label="Scene break">⁂</p>;
    case 'paragraph':
      return <p><Runs runs={block.runs} /></p>;
  }
}

export function Dropzone({ compact = false }: { compact?: boolean }) {
  const { bookId, reload } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = useAction();

  async function send(file: File | undefined) {
    if (!file) return;
    await upload.run(async () => {
      await api.upload(`/books/${bookId}/upload`, file);
      await reload();
    });
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    void send(event.dataTransfer.files[0]);
  }

  if (compact) {
    return (
      <>
        <input ref={input} type="file" accept={ACCEPTED} hidden onChange={(event) => void send(event.target.files?.[0])} />
        <button type="button" className="btn btn-small" disabled={upload.busy} onClick={() => input.current?.click()}>
          {upload.busy ? <span className="spinner" /> : 'Replace File'}
        </button>
        {upload.error && <div className="form-error">{upload.error}</div>}
      </>
    );
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input ref={input} type="file" accept={ACCEPTED} hidden onChange={(event) => void send(event.target.files?.[0])} />
      <div className="dropzone-sheet" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <h2>Drop Your Manuscript</h2>
      <p className="muted">DOCX, EPUB or Markdown</p>
      <button type="button" className="btn btn-primary" disabled={upload.busy} onClick={() => input.current?.click()}>
        {upload.busy ? <span className="spinner" /> : 'Choose File'}
      </button>
      {upload.error && <div className="form-error">{upload.error}</div>}
    </div>
  );
}

function PassPanel() {
  const { bookId, reload, goTo } = useWorkspace();
  const passes = useResource<{ passes: Pass[] }>(`/books/${bookId}/passes`);
  const [running, setRunning] = useState<PassKind | null>(null);
  const action = useAction();
  const latestStructural = passes.data?.passes.find((pass) => pass.kind === 'structural' && pass.status === 'done' && pass.notes && pass.notes.length > 0);

  async function start(kind: PassKind) {
    setRunning(kind);
    await action.run(async () => {
      const { jobId } = await api.post<{ jobId: string }>(`/books/${bookId}/passes`, { kind });
      await passes.reload();
      await waitForJob(jobId);
      await Promise.all([passes.reload(), reload()]);
    });
    setRunning(null);
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Passes</h2>
        </div>
        <ul className="pass-list">
          {PASSES.map((pass) => (
            <li key={pass.kind}>
              <span>
                <strong>{pass.label}</strong>
                <span className="muted">{pass.scope}</span>
              </span>
              <button type="button" className="btn btn-small" disabled={running !== null} onClick={() => void start(pass.kind)}>
                {running === pass.kind ? <span className="spinner" /> : 'Run'}
              </button>
            </li>
          ))}
        </ul>
        {action.error && <div className="panel-body"><div className="form-error">{action.error}</div></div>}
      </div>

      {passes.data && passes.data.passes.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>History</h2>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => goTo('edits')}>
              Review Edits
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Pass</th>
                <th className="right">Edits</th>
                <th className="right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {passes.data.passes.map((pass) => (
                <tr key={pass.id}>
                  <td>
                    <div className="pass-kind">
                      {pass.kind[0]?.toUpperCase() + pass.kind.slice(1)}
                      <StatusTag pass={pass} />
                    </div>
                    <div className="muted small">
                      v{pass.manuscriptVersion} · {moment(pass.createdAt)}
                    </div>
                  </td>
                  <td className="right num">{pass._count.edits}</td>
                  <td className="right num">{dollars(pass.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {latestStructural?.notes && (
        <div className="panel">
          <div className="panel-head">
            <h2>Structural Notes</h2>
          </div>
          <ul className="notes">
            {latestStructural.notes.map((note, index) => (
              <li key={index}>
                <span className={`tag ${note.specificity === 'specific' ? 'tag-blue' : ''}`}>{note.specificity === 'specific' ? 'Specific' : 'Generic'}</span>
                <p>{note.note}</p>
                {note.quote && <blockquote>{note.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusTag({ pass }: { pass: Pass }) {
  if (pass.status === 'failed') return <span className="tag tag-accent" title={pass.error ?? undefined}>Failed</span>;
  if (pass.status !== 'done') return <span className="tag tag-gilt"><span className="spinner" /> {pass.status === 'queued' ? 'Queued' : 'Running'}</span>;
  if (!pass.model) return <span className="tag" title={pass.modelSkippedReason ?? undefined}>Rules Only</span>;
  return <span className="tag tag-blue">Model</span>;
}

export function ManuscriptTab() {
  const { bookId, detail } = useWorkspace();
  const manuscript = detail.manuscript;
  const text = useResource<{ version: number; manuscript: Manuscript }>(manuscript ? `/books/${bookId}/manuscript` : null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const { reload: reloadText } = text;

  useEffect(() => {
    if (manuscript) void reloadText();
  }, [manuscript, reloadText]);

  if (!manuscript) {
    return <Dropzone />;
  }

  const chapters = text.data?.manuscript.chapters ?? [];
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];
  const upload = detail.uploads[0];

  return (
    <div className="manuscript">
      <aside className="toc">
        <div className="section-head">
          <span className="eyebrow">Version {manuscript.version}</span>
          <Dropzone compact />
        </div>
        {upload && (
          <p className="muted small toc-file">
            {upload.filename} · {bytes(upload.bytes)}
          </p>
        )}
        <ol>
          {manuscript.chapters.map((item, index) => (
            <li key={item.id}>
              <button type="button" aria-current={chapter?.id === item.id ? 'true' : undefined} onClick={() => setChapterId(item.id)}>
                <span className="num">{index + 1}</span>
                <span className="toc-title">{item.title}</span>
                <span className="num muted">{count(item.words)}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <article className="reader">
        {!chapter && <div className="loading">Loading…</div>}
        {chapter && (
          <>
            <h2 className="reader-title">{chapter.title}</h2>
            {chapter.blocks.map((block) => (
              <BlockView key={block.id} block={block} />
            ))}
          </>
        )}
      </article>
      <PassPanel />
    </div>
  );
}
