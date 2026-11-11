'use client';

import { TRIM_SIZES, type TrimSize } from '@quire/core/stages';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api, downloadUrl } from '@/lib/api';
import { bytes, moment } from '@/lib/format';
import type { Book, ExportRow, Manuscript, PreflightCheck } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';

const TRIM_IDS = Object.keys(TRIM_SIZES) as TrimSize[];
const LEVEL_TAG: Record<PreflightCheck['level'], string> = {
  pass: 'tag-ok',
  warn: 'tag-gilt',
  fail: 'tag-accent',
};
const LEVEL_LABEL: Record<PreflightCheck['level'], string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };
const TARGET_LABEL: Record<ExportRow['target'], string> = { kdp: 'KDP', ingramspark: 'IngramSpark' };
// Preview pixels per inch of trim, so switching sizes shows the real difference.
const PREVIEW_PX_PER_IN = 30;
// Opening paragraphs shown on the typeset page preview.
const PREVIEW_PARAGRAPHS = 3;
// Hold the tallest trim's height so the controls below don't jump when the size changes.
const PREVIEW_HEIGHT_PX = Math.max(...TRIM_IDS.map((id) => TRIM_SIZES[id].heightIn)) * PREVIEW_PX_PER_IN;

function openingText(manuscript: Manuscript | undefined): { title: string; paragraphs: string[] } | null {
  const chapter = manuscript?.chapters[0];
  if (!chapter) return null;
  const paragraphs = chapter.blocks
    .filter((block) => block.kind === 'paragraph')
    .slice(0, PREVIEW_PARAGRAPHS)
    .map((block) => block.runs.map((run) => run.text).join(''));
  return { title: chapter.title, paragraphs };
}

function TrimPreview({ trim, opening }: { trim: TrimSize; opening: ReturnType<typeof openingText> }) {
  const size = TRIM_SIZES[trim];
  return (
    <div className="trim-preview" style={{ height: PREVIEW_HEIGHT_PX }} aria-hidden>
      <div
        className="trim-page"
        style={{ width: size.widthIn * PREVIEW_PX_PER_IN, height: size.heightIn * PREVIEW_PX_PER_IN }}
      >
        {opening && (
          <div className="trim-type">
            <p className="trim-chapter">{opening.title}</p>
            {opening.paragraphs.map((paragraph, index) => (
              <p key={index} className={index === 0 ? 'trim-first' : undefined}>
                {paragraph}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DetailsForm {
  trimSize: TrimSize;
  isbn: string;
  dedication: string;
  aboutAuthor: string;
  seriesStarter: boolean;
}

function detailsForm(book: Book): DetailsForm {
  return {
    trimSize: book.trimSize,
    isbn: book.isbn ?? '',
    dedication: book.dedication ?? '',
    aboutAuthor: book.aboutAuthor ?? '',
    seriesStarter: book.seriesStarter,
  };
}

function BookDetails() {
  const { bookId, detail, reload } = useWorkspace();
  const book = detail.book;
  const text = useResource<{ manuscript: Manuscript }>(
    detail.manuscript ? `/books/${bookId}/manuscript` : null,
  );
  const [form, setForm] = useState(() => detailsForm(book));
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    setForm(detailsForm(book));
  }, [book]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await api.patch(`/books/${bookId}`, {
        trimSize: form.trimSize,
        isbn: form.isbn.trim() || null,
        dedication: form.dedication.trim() || null,
        aboutAuthor: form.aboutAuthor.trim() || null,
        seriesStarter: form.seriesStarter,
      });
      await reload();
    });
    setSaved(ok);
  }

  const edit = <K extends keyof DetailsForm>(key: K, value: DetailsForm[K]) => {
    setSaved(false);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <div className="panel-head">
        <h2>Book Details</h2>
      </div>
      <div className="panel-body stack">
        <div className="trim-picker">
          <TrimPreview trim={form.trimSize} opening={openingText(text.data?.manuscript)} />
          <span className="muted small">{TRIM_SIZES[form.trimSize].label}</span>
          <div className="segmented" role="radiogroup" aria-label="Trim size">
            {TRIM_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={form.trimSize === id}
                onClick={() => edit('trimSize', id)}
              >
                {TRIM_SIZES[id].label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">ISBN</span>
          <input
            className="input mono"
            value={form.isbn}
            onChange={(event) => edit('isbn', event.target.value)}
            placeholder="978…"
          />
        </label>
        <label className="field">
          <span className="field-label">Dedication</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={500}
            value={form.dedication}
            onChange={(event) => edit('dedication', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">About the Author</span>
          <textarea
            className="textarea"
            rows={4}
            maxLength={2000}
            value={form.aboutAuthor}
            onChange={(event) => edit('aboutAuthor', event.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.seriesStarter}
            onChange={(event) => edit('seriesStarter', event.target.checked)}
          />
          Series Starter
        </label>
        {action.error && <div className="form-error">{action.error}</div>}
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>
            {action.busy ? <span className="spinner" /> : saved ? 'Saved' : 'Save Details'}
          </button>
        </div>
      </div>
    </form>
  );
}

function ExportCard({ row, bookId }: { row: ExportRow; bookId: string }) {
  const failed = row.preflight.filter((check) => check.level === 'fail').length;
  const warned = row.preflight.filter((check) => check.level === 'warn').length;
  return (
    <li className="export-card">
      <div className="export-head">
        <div>
          <strong>
            {row.format.toUpperCase()} · {TARGET_LABEL[row.target]}
          </strong>
          <div className="muted small num">
            {TRIM_SIZES[row.trimSize].label}
            {row.pageCount !== null && ` · ${row.pageCount} pages`} · {bytes(row.bytes)} ·{' '}
            {moment(row.createdAt)}
          </div>
        </div>
        <span className="btn-row">
          <span className={`tag ${failed > 0 ? 'tag-accent' : warned > 0 ? 'tag-gilt' : 'tag-ok'}`}>
            {failed > 0
              ? `${failed} Failed`
              : warned > 0
                ? `${warned} ${warned === 1 ? 'Warning' : 'Warnings'}`
                : 'Ready'}
          </span>
          <a
            className="btn btn-small"
            href={downloadUrl(`/books/${bookId}/exports/${row.id}/download`)}
            download
          >
            Download
          </a>
        </span>
      </div>
      <ul className="preflight">
        {row.preflight.map((check) => (
          <li key={check.id}>
            <span className={`tag ${LEVEL_TAG[check.level]}`}>{LEVEL_LABEL[check.level]}</span>
            <span>{check.label}</span>
            <span className="muted small">{check.detail}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function ExportTab() {
  const { bookId, detail, goTo, reload } = useWorkspace();
  const exports = useResource<{ exports: ExportRow[] }>(`/books/${bookId}/exports`);
  const [format, setFormat] = useState<ExportRow['format']>('epub');
  const [target, setTarget] = useState<ExportRow['target']>('kdp');
  const [blocked, setBlocked] = useState<string | null>(null);
  const action = useAction();

  async function create() {
    setBlocked(null);
    await action.run(async () => {
      try {
        await api.post(`/books/${bookId}/exports`, { format, target });
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          setBlocked(failure.message);
          return;
        }
        throw failure;
      }
      await Promise.all([exports.reload(), reload()]);
    });
  }

  return (
    <div className="split">
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <h2>New Export</h2>
          </div>
          <div className="panel-body export-form">
            <div className="segmented" role="radiogroup" aria-label="Format">
              {(['epub', 'pdf'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={format === id}
                  onClick={() => setFormat(id)}
                >
                  {id === 'epub' ? 'EPUB' : 'Print PDF'}
                </button>
              ))}
            </div>
            <div className="segmented" role="radiogroup" aria-label="Target">
              {(['kdp', 'ingramspark'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={target === id}
                  onClick={() => setTarget(id)}
                >
                  {TARGET_LABEL[id]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || !detail.manuscript}
              onClick={() => void create()}
            >
              {action.busy ? <span className="spinner" /> : 'Build'}
            </button>
          </div>
          {(blocked || action.error) && (
            <div className="panel-body">
              {blocked && (
                <div className="notice notice-accent notice-action">
                  <span>{blocked}</span>
                  <button type="button" className="btn btn-small" onClick={() => goTo('compliance')}>
                    Compliance
                  </button>
                </div>
              )}
              {action.error && <div className="form-error">{action.error}</div>}
            </div>
          )}
        </div>

        {exports.data && exports.data.exports.length === 0 && (
          <div className="empty">
            <h2>No Exports Yet</h2>
          </div>
        )}
        {exports.data && exports.data.exports.length > 0 && (
          <ul className="exports">
            {exports.data.exports.map((row) => (
              <ExportCard key={row.id} row={row} bookId={bookId} />
            ))}
          </ul>
        )}
        {exports.data && exports.data.exports.length > 0 && (
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => goTo('metadata')}>
              Listing
            </button>
          </div>
        )}
      </div>
      <BookDetails />
    </div>
  );
}
