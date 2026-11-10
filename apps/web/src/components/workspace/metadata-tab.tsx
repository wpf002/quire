'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { CATEGORY_SEPARATOR, count, dollars, moment } from '@/lib/format';
import { waitForJob } from '@/lib/jobs';
import type { CategoryFitResult, DiscoveryView, MetadataVersion, MetadataView, PricingRecommendation } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';
import { RECOMMENDATION_LABEL, RecommendationRow, SourceTag } from './recommendation';

const KEYWORD_BOXES = 7;
const KEYWORD_BOX_MAX = 50;
const CATEGORY_SLOTS = 3;
const DESCRIPTION_MAX = 4000;
const CENTS_PER_DOLLAR = 100;
const FIT_TAG: Record<string, string> = { winnable: 'tag-ok', stretch: 'tag-gilt', crowded: 'tag-accent', ghost: '' };

interface DraftForm {
  title: string;
  subtitle: string;
  description: string;
  keywordBoxes: string[];
  categories: string[];
  ebookPrice: string;
  paperbackPrice: string;
}

function padBoxes(boxes: string[]): string[] {
  return Array.from({ length: KEYWORD_BOXES }, (_, index) => boxes[index] ?? '');
}

function toForm(version: MetadataVersion | null, fallbackTitle: string, fallbackSubtitle: string | null): DraftForm {
  return {
    title: version?.title ?? fallbackTitle,
    subtitle: version?.subtitle ?? fallbackSubtitle ?? '',
    description: version?.description ?? '',
    keywordBoxes: padBoxes(version?.keywordBoxes ?? []),
    categories: version?.categories ?? [],
    ebookPrice: version?.ebookPriceCents ? (version.ebookPriceCents / CENTS_PER_DOLLAR).toFixed(2) : '',
    paperbackPrice: version?.paperbackPriceCents ? (version.paperbackPriceCents / CENTS_PER_DOLLAR).toFixed(2) : '',
  };
}

function toCents(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * CENTS_PER_DOLLAR) : null;
}

function leaf(path: string): string {
  return path.split(CATEGORY_SEPARATOR).at(-1) ?? path;
}

function DiscoveryForm({ onDone }: { onDone: () => Promise<void> }) {
  const { bookId, detail } = useWorkspace();
  const [seeds, setSeeds] = useState(detail.book.genre);
  const [storefront, setStorefront] = useState<'kindle' | 'books'>('kindle');
  const [sales, setSales] = useState('3');
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const seedList = seeds.split(',').map((seed) => seed.trim()).filter((seed) => seed.length >= 2);
      const { jobId } = await api.post<{ jobId: string }>(`/books/${bookId}/discovery`, { seeds: seedList, storefront, expectedDailySales: Number(sales) || 3 });
      await waitForJob(jobId);
      await onDone();
    });
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-head">
        <h2>Discovery</h2>
      </div>
      <div className="panel-body stack">
        <label className="field">
          <span className="field-label">Seed Phrases</span>
          <input className="input" value={seeds} onChange={(event) => setSeeds(event.target.value)} placeholder="cozy mystery, small town sleuth" />
          <span className="field-hint">Comma separated, up to 8</span>
        </label>
        <div className="form-grid two">
          <label className="field">
            <span className="field-label">Store</span>
            <select className="select" value={storefront} onChange={(event) => setStorefront(event.target.value === 'books' ? 'books' : 'kindle')}>
              <option value="kindle">Kindle Store</option>
              <option value="books">Books</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Sales / Day</span>
            <input className="input num" type="number" min={0.1} max={500} step="any" value={sales} onChange={(event) => setSales(event.target.value)} />
          </label>
        </div>
        {action.error && <div className="form-error">{action.error}</div>}
        <button type="submit" className="btn btn-primary" disabled={action.busy || !seeds.trim()}>
          {action.busy ? <span className="spinner" /> : 'Find Keywords'}
        </button>
      </div>
    </form>
  );
}

function RoyaltyTable({ pricing }: { pricing: PricingRecommendation }) {
  return (
    <table className="table royalty">
      <thead>
        <tr>
          <th>{pricing.format === 'ebook' ? 'Ebook' : 'Paperback'}</th>
          <th className="right">Royalty</th>
        </tr>
      </thead>
      <tbody>
        {pricing.table.map((row) => (
          <tr key={row.priceCents} className={row.priceCents === pricing.recommendedCents ? 'selected' : undefined}>
            <td className="num">
              {dollars(row.priceCents)} {row.note && <span className="muted small">{row.note}</span>}
            </td>
            <td className="right num">{dollars(row.royaltyCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DraftEditor({ metadata, discovery, onSaved }: { metadata: MetadataView; discovery: DiscoveryView | null; onSaved: (view: MetadataView) => void }) {
  const { bookId, detail, reload } = useWorkspace();
  const base = metadata.draft ?? metadata.live;
  const [form, setForm] = useState<DraftForm>(() => toForm(base, detail.book.title, detail.book.subtitle));
  const [asin, setAsin] = useState(detail.book.asin ?? '');
  const [blurbNotice, setBlurbNotice] = useState<string | null>(null);
  const save = useAction();
  const blurb = useAction();
  const publish = useAction();

  useEffect(() => {
    setForm(toForm(metadata.draft ?? metadata.live, detail.book.title, detail.book.subtitle));
  }, [metadata.draft, metadata.live, detail.book.title, detail.book.subtitle]);

  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const categories = discovery?.run?.result.categories ?? [];
  const pricing = (discovery?.recommendations ?? []).flatMap((rec) => (rec.payload.kind === 'price-ebook' || rec.payload.kind === 'price-paperback' ? [rec.payload.pricing] : []));

  async function persist(): Promise<boolean> {
    return save.run(async () => {
      const result = await api.patch<{ draft: MetadataVersion; issues: MetadataView['issues'] }>(`/books/${bookId}/metadata/draft`, {
        title: form.title,
        subtitle: form.subtitle.trim() || null,
        description: form.description,
        keywordBoxes: form.keywordBoxes,
        categories: form.categories,
        ebookPriceCents: toCents(form.ebookPrice),
        paperbackPriceCents: toCents(form.paperbackPrice),
      });
      onSaved({ ...metadata, draft: result.draft, issues: result.issues });
    });
  }

  async function writeBlurb() {
    setBlurbNotice(null);
    await blurb.run(async () => {
      try {
        const { jobId } = await api.post<{ jobId: string }>(`/books/${bookId}/blurb`, {});
        await waitForJob(jobId);
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          setBlurbNotice(failure.message);
          return;
        }
        throw failure;
      }
      await reload();
      const refreshed = await api.get<MetadataView>(`/books/${bookId}/metadata`);
      onSaved(refreshed);
    });
  }

  async function goLive() {
    if (!(await persist())) return;
    await publish.run(async () => {
      await api.post(`/books/${bookId}/metadata/publish`, { asin: asin.trim() || null });
      onSaved(await api.get<MetadataView>(`/books/${bookId}/metadata`));
      await reload();
    });
  }

  function toggleCategory(path: string) {
    const has = form.categories.includes(path);
    if (!has && form.categories.length >= CATEGORY_SLOTS) return;
    set('categories', has ? form.categories.filter((item) => item !== path) : [...form.categories, path]);
  }

  const bookBlurb = detail.book.blurb;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>{metadata.draft ? `Draft v${metadata.draft.version}` : 'Listing'}</h2>
          {metadata.live && <span className="tag tag-ok">Live v{metadata.live.version}</span>}
        </div>
        <div className="panel-body stack">
          <div className="form-grid two">
            <label className="field">
              <span className="field-label">Title</span>
              <input className="input" maxLength={200} value={form.title} onChange={(event) => set('title', event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Subtitle</span>
              <input className="input" maxLength={200} value={form.subtitle} onChange={(event) => set('subtitle', event.target.value)} />
            </label>
          </div>

          <label className="field">
            <span className="field-label field-label-row">
              Description
              <span className={`num ${form.description.length > DESCRIPTION_MAX ? 'over' : 'muted'}`}>
                {count(form.description.length)} / {count(DESCRIPTION_MAX)}
              </span>
            </span>
            <textarea className="textarea" rows={8} value={form.description} onChange={(event) => set('description', event.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-small" disabled={blurb.busy || !detail.manuscript} onClick={() => void writeBlurb()}>
              {blurb.busy ? <span className="spinner" /> : 'Write Blurb'}
            </button>
            {bookBlurb && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => set('description', bookBlurb.description)}>
                Use Saved Blurb
              </button>
            )}
          </div>
          {blurbNotice && <div className="notice notice-gilt">{blurbNotice}</div>}
          {blurb.error && <div className="form-error">{blurb.error}</div>}
          {bookBlurb && (
            <div className="blurb">
              <span className="eyebrow">Hook</span>
              <p>{bookBlurb.hook}</p>
              <span className="eyebrow">Back Cover</span>
              <p>{bookBlurb.backCover}</p>
            </div>
          )}

          <div className="field">
            <span className="field-label">Keyword Boxes</span>
            <ol className="keyword-boxes">
              {form.keywordBoxes.map((box, index) => (
                <li key={index}>
                  <span className="num muted">{index + 1}</span>
                  <input
                    className="input"
                    maxLength={KEYWORD_BOX_MAX}
                    value={box}
                    onChange={(event) => set('keywordBoxes', form.keywordBoxes.map((item, position) => (position === index ? event.target.value : item)))}
                  />
                  <span className={`num small ${box.length >= KEYWORD_BOX_MAX ? 'full' : 'muted'}`}>
                    {box.length}/{KEYWORD_BOX_MAX}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="field">
            <span className="field-label field-label-row">
              Categories
              <span className="num muted">
                {form.categories.length} / {CATEGORY_SLOTS}
              </span>
            </span>
            {form.categories.length === 0 ? (
              <span className="muted small">Pick from Category Fit</span>
            ) : (
              <ul className="picked">
                {form.categories.map((path) => (
                  <li key={path}>
                    <span title={path}>{leaf(path)}</span>
                    <button type="button" className="btn btn-ghost btn-small" aria-label={`Remove ${path}`} onClick={() => toggleCategory(path)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="form-grid two">
            <label className="field">
              <span className="field-label">Ebook Price</span>
              <input className="input num" inputMode="decimal" value={form.ebookPrice} onChange={(event) => set('ebookPrice', event.target.value)} placeholder="4.99" />
            </label>
            <label className="field">
              <span className="field-label">Paperback Price</span>
              <input className="input num" inputMode="decimal" value={form.paperbackPrice} onChange={(event) => set('paperbackPrice', event.target.value)} placeholder="14.99" />
            </label>
          </div>
          {pricing.length > 0 && (
            <div className="form-grid two">
              {pricing.map((item) => (
                <RoyaltyTable key={item.format} pricing={item} />
              ))}
            </div>
          )}

          {metadata.issues.length > 0 && (
            <ul className="issues">
              {metadata.issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>
                  <span className="tag tag-accent">{issue.field}</span> {issue.message}
                </li>
              ))}
            </ul>
          )}
          {save.error && <div className="form-error">{save.error}</div>}
          <div className="btn-row">
            <button type="button" className="btn" disabled={save.busy} onClick={() => void persist()}>
              {save.busy ? <span className="spinner" /> : 'Save Draft'}
            </button>
          </div>
        </div>
      </div>

      <div className="panel publish-panel">
        <div className="panel-head">
          <h2>{detail.book.publishedAt ? 'Push Update' : 'Publish'}</h2>
        </div>
        <div className="panel-body stack">
          <label className="field">
            <span className="field-label">ASIN</span>
            <input className="input mono" maxLength={20} value={asin} onChange={(event) => setAsin(event.target.value)} placeholder="B0XXXXXXXX" />
          </label>
          {publish.error && <div className="form-error">{publish.error}</div>}
          <button type="button" className="btn btn-primary" disabled={publish.busy || save.busy} onClick={() => void goLive()}>
            {publish.busy ? <span className="spinner" /> : detail.book.publishedAt ? 'Mark Live' : 'Mark Published'}
          </button>
        </div>
      </div>

      {categories.length > 0 && <CategoryFit categories={categories} picked={form.categories} onToggle={toggleCategory} />}
    </div>
  );
}

function CategoryFit({ categories, picked, onToggle }: { categories: CategoryFitResult[]; picked: string[]; onToggle: (path: string) => void }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Category Fit</h2>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Fit</th>
              <th className="right">#1 BSR</th>
              <th className="right">#10 BSR</th>
              <th className="right">Sales / Day For #10</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const on = picked.includes(category.path);
              return (
                <tr key={category.path} className={on ? 'selected' : undefined}>
                  <td>
                    <strong>{leaf(category.path)}</strong>
                    <div className="muted small">{category.path}</div>
                  </td>
                  <td>
                    <span className={`tag ${FIT_TAG[category.fit] ?? ''}`}>{category.fit[0]?.toUpperCase() + category.fit.slice(1)}</span>
                  </td>
                  <td className="right num">{count(category.bsrFirst)}</td>
                  <td className="right num">{count(category.bsrTenth)}</td>
                  <td className="right num">{category.salesForTopTen.toFixed(1)}</td>
                  <td className="right">
                    <button type="button" className="btn btn-ghost btn-small" disabled={!on && picked.length >= CATEGORY_SLOTS} onClick={() => onToggle(category.path)}>
                      {on ? 'Remove' : 'Pick'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeywordTable({ discovery }: { discovery: NonNullable<DiscoveryView['run']> }) {
  const packed = new Set(discovery.result.boxes.flatMap((box) => box.phrases));
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Keywords</h2>
        <span className="btn-row">
          {discovery.sources.map((source) => (
            <SourceTag key={source} source={source} />
          ))}
        </span>
      </div>
      <div className="table-wrap keyword-table">
        <table className="table">
          <thead>
            <tr>
              <th>Phrase</th>
              <th className="right">Score</th>
              <th className="right">Demand</th>
              <th className="right">Competition</th>
            </tr>
          </thead>
          <tbody>
            {discovery.result.keywords.map((keyword) => (
              <tr key={keyword.keyword}>
                <td>
                  {keyword.keyword} {packed.has(keyword.keyword) && <span className="dot" title="Packed" />}
                </td>
                <td className="right num">
                  <span className="score">
                    <span style={{ width: `${Math.round(keyword.score * 100)}%` }} />
                  </span>
                  {Math.round(keyword.score * 100)}
                </td>
                <td className="right num">{Math.round(keyword.demand * 100)}</td>
                <td className="right num">{Math.round(keyword.competition * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History({ versions }: { versions: MetadataVersion[] }) {
  if (versions.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>History</h2>
      </div>
      <ol className="history">
        {versions.map((version) => (
          <li key={version.id}>
            <span className="num">v{version.version}</span>
            <span>
              {version.appliedAt ? `Live ${moment(version.appliedAt)}` : 'Draft'}
              {version.recommendation && (
                <span className="muted small"> · {RECOMMENDATION_LABEL[version.recommendation.kind as keyof typeof RECOMMENDATION_LABEL] ?? version.recommendation.kind}</span>
              )}
            </span>
            {version.recommendation?.outcome && <span className="tag">{version.recommendation.outcome.verdict}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MetadataTab() {
  const { bookId } = useWorkspace();
  const metadata = useResource<MetadataView>(`/books/${bookId}/metadata`);
  const discovery = useResource<DiscoveryView>(`/books/${bookId}/discovery`);
  const refresh = async () => {
    await Promise.all([metadata.reload(), discovery.reload()]);
  };

  if ((metadata.loading && !metadata.data) || (discovery.loading && !discovery.data)) return <div className="loading">Loading…</div>;
  const error = metadata.error ?? discovery.error;
  if (error && !metadata.data) return <div className="form-error">{error}</div>;
  if (!metadata.data) return null;

  const open = (discovery.data?.recommendations ?? []).filter((rec) => rec.status === 'open');
  const run = discovery.data?.run ?? null;

  return (
    <div className="split split-wide">
      <DraftEditor metadata={metadata.data} discovery={discovery.data} onSaved={metadata.setData} />
      <div className="stack">
        <DiscoveryForm onDone={refresh} />
        {open.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>Launch Recs</h2>
              <span className="tab-count accent">{open.length}</span>
            </div>
            <ul className="recs">
              {open.map((rec) => (
                <RecommendationRow key={rec.id} recommendation={rec} onDone={refresh} />
              ))}
            </ul>
          </div>
        )}
        {run && <KeywordTable discovery={run} />}
        <History versions={metadata.data.versions} />
      </div>
    </div>
  );
}

