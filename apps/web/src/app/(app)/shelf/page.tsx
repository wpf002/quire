'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { STAGE_LABELS, StageStrip } from '@/components/stage-strip';
import { api, errorMessage } from '@/lib/api';
import { count, since } from '@/lib/format';
import type { BookSummary } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

const GENRES = ['Fantasy', 'Science Fiction', 'Romance', 'Thriller', 'Mystery', 'Historical Fiction', 'Literary Fiction', 'Horror', 'Nonfiction'];

function NewBookForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subtitle = String(form.get('subtitle') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      const { book } = await api.post<{ book: { id: string } }>('/books', {
        title: form.get('title'),
        subtitle: subtitle || undefined,
        author: form.get('author'),
        genre: form.get('genre'),
      });
      router.push(`/books/${book.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="panel new-book" onSubmit={submit}>
      <div className="panel-head">
        <h2>New Book</h2>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <div className="panel-body form-grid two">
        <label className="field">
          <span className="field-label">Title</span>
          <input className="input" name="title" required maxLength={200} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Subtitle</span>
          <input className="input" name="subtitle" maxLength={200} />
        </label>
        <label className="field">
          <span className="field-label">Author</span>
          <input className="input" name="author" required maxLength={120} />
        </label>
        <label className="field">
          <span className="field-label">Genre</span>
          <select className="select" name="genre" required defaultValue="Fantasy">
            {GENRES.map((genre) => (
              <option key={genre}>{genre}</option>
            ))}
          </select>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Create Book'}
          </button>
        </div>
      </div>
    </form>
  );
}

function ShelfRow({ book }: { book: BookSummary }) {
  return (
    <li>
      <Link href={`/books/${book.id}`} className="shelf-row">
        <span className="shelf-spine" aria-hidden />
        <span className="shelf-title">
          <span className="shelf-name">{book.title}</span>
          <span className="muted">
            {book.author} · {book.genre}
          </span>
        </span>
        <span className="shelf-stage">
          <StageStrip stage={book.stage} />
          <span className="eyebrow">{STAGE_LABELS[book.stage]}</span>
        </span>
        <span className="shelf-stat num">{book.wordCount > 0 ? count(book.wordCount) : '—'}</span>
        <span className="shelf-flags">
          {book.pendingEdits > 0 && <span className="tag tag-blue">{book.pendingEdits} Edits</span>}
          {book.openRecommendations > 0 && <span className="tag tag-accent">{book.openRecommendations} Recs</span>}
          {book.asin && <span className="tag tag-ok">Live</span>}
        </span>
        <span className="shelf-updated muted">{since(book.updatedAt)}</span>
      </Link>
    </li>
  );
}

export default function ShelfPage() {
  const books = useResource<{ books: BookSummary[] }>('/books');
  const [adding, setAdding] = useState(false);
  const list = books.data?.books ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Shelf</h1>
        {list.length > 0 && !adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            New Book
          </button>
        )}
      </div>
      {books.error && <div className="form-error">{books.error}</div>}
      {books.loading && !books.data && <div className="loading">Loading…</div>}
      {books.data && list.length === 0 && <NewBookForm />}
      {adding && <NewBookForm onCancel={() => setAdding(false)} />}
      {list.length > 0 && (
        <div className="shelf">
          <div className="shelf-head">
            <span />
            <span>Title</span>
            <span>Stage</span>
            <span className="right">Words</span>
            <span />
            <span className="right">Updated</span>
          </div>
          <ul>
            {list.map((book) => (
              <ShelfRow key={book.id} book={book} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
