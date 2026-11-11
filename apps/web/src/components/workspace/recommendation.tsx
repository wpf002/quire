'use client';

import { api } from '@/lib/api';
import { CATEGORY_SEPARATOR, dollars } from '@/lib/format';
import type { Recommendation, RecommendationPayload } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useWorkspace } from './context';

const KIND_LABEL: Record<RecommendationPayload['kind'], string> = {
  keywords: 'Keyword Boxes',
  categories: 'Categories',
  'price-ebook': 'Ebook Price',
  'price-paperback': 'Paperback Price',
  'swap-keyword': 'Swap Keyword',
  'switch-category': 'Switch Category',
  'raise-price': 'Raise Price',
};

function categoryLeaf(path: string): string {
  return path.split(CATEGORY_SEPARATOR).at(-1) ?? path;
}

function summary(payload: RecommendationPayload): string {
  switch (payload.kind) {
    case 'keywords':
      return payload.boxes.filter((box) => box.text).map((box) => box.text).join(' · ');
    case 'categories':
      return payload.categories.map((category) => categoryLeaf(category.path)).join(', ');
    case 'price-ebook':
    case 'price-paperback':
      return `${dollars(payload.pricing.recommendedCents)} · ${dollars(payload.pricing.royaltyCents)} royalty`;
    case 'swap-keyword':
      return `“${payload.remove}” → “${payload.add}”`;
    case 'switch-category':
      return `${payload.from ? categoryLeaf(payload.from) : 'None'} → ${categoryLeaf(payload.to)}`;
    case 'raise-price':
      return `${dollars(payload.fromCents)} → ${dollars(payload.toCents)}`;
  }
}

/** Sample providers get a gilt tag so simulated data is never mistaken for live data. */
export function SourceTag({ source }: { source: string }) {
  const sample = source.includes('sample');
  const label = source
    .replace(/^rank:/, 'rank ')
    .split(/[\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return <span className={`tag ${sample ? 'tag-gilt' : 'tag-blue'}`}>{label}</span>;
}

/** One open recommendation with Apply and Dismiss. */
export function RecommendationRow({ recommendation, onDone }: { recommendation: Recommendation; onDone: () => Promise<void> }) {
  const { bookId, reload } = useWorkspace();
  const action = useAction();

  async function act(verb: 'apply' | 'dismiss') {
    await action.run(async () => {
      await api.post(`/books/${bookId}/recommendations/${recommendation.id}/${verb}`, {});
      await Promise.all([onDone(), reload()]);
    });
  }

  return (
    <li className="rec">
      <div className="rec-head">
        <span className="eyebrow">{KIND_LABEL[recommendation.kind]}</span>
        <span className="rec-sources">
          {recommendation.dataSources.map((source) => (
            <SourceTag key={source} source={source} />
          ))}
        </span>
      </div>
      <strong className="rec-summary">{summary(recommendation.payload)}</strong>
      <p className="muted small">{recommendation.rationale}</p>
      {action.error && <div className="form-error">{action.error}</div>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-small" disabled={action.busy} onClick={() => void act('apply')}>
          Apply
        </button>
        <button type="button" className="btn btn-ghost btn-small" disabled={action.busy} onClick={() => void act('dismiss')}>
          Dismiss
        </button>
      </div>
    </li>
  );
}

export { KIND_LABEL as RECOMMENDATION_LABEL, summary as recommendationSummary };
