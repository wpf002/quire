'use client';

import { type MouseEvent, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { count, day } from '@/lib/format';
import type { RankView, Recommendation, RecommendationOutcome } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './context';
import { RECOMMENDATION_LABEL, RecommendationRow, recommendationSummary } from './recommendation';

const SIMULATE_DAYS = [7, 14, 30] as const;
// Launch recs go live with the first publish, so they have no before-window to measure against.
const LAUNCH_KINDS: ReadonlyArray<Recommendation['kind']> = ['keywords', 'categories', 'price-ebook', 'price-paperback'];
const UNRANKED = 101;
const SERIES_COLORS = [1, 2, 3, 4, 5, 6].map((index) => `var(--series-${index})`);
const CHART = { width: 760, height: 300, left: 40, right: 16, top: 16, bottom: 28 };
const BSR_CHART = { width: 760, height: 90, left: 40, right: 16, top: 8, bottom: 8 };
const RANK_TICKS = [1, 25, 50, 75, 100];
const VERDICT_TAG: Record<RecommendationOutcome['verdict'], string> = { moved: 'tag-ok', flat: '', worse: 'tag-accent', 'insufficient-data': 'tag-gilt' };
const VERDICT_LABEL: Record<RecommendationOutcome['verdict'], string> = { moved: 'Moved', flat: 'Flat', worse: 'Worse', 'insufficient-data': 'Too Early' };

interface Scale {
  start: number;
  end: number;
}

function xFor(time: number, scale: Scale, box: typeof CHART): number {
  const span = Math.max(scale.end - scale.start, 1);
  return box.left + ((time - scale.start) / span) * (box.width - box.left - box.right);
}

function yForRank(rank: number | null): number {
  const value = rank ?? UNRANKED;
  return CHART.top + ((value - 1) / (UNRANKED - 1)) * (CHART.height - CHART.top - CHART.bottom);
}

function path(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function RankChart({ view }: { view: RankView }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const scale = useMemo<Scale>(() => {
    const times = view.series.flatMap((series) => series.points.map((point) => Date.parse(point.at)));
    return { start: Math.min(...times), end: Math.max(...times) };
  }, [view.series]);
  const days = useMemo(() => [...new Set(view.series.flatMap((series) => series.points.map((point) => point.at)))].sort(), [view.series]);

  function move(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CHART.width;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    days.forEach((at, index) => {
      const distance = Math.abs(xFor(Date.parse(at), scale, CHART) - x);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setHover(nearest);
  }

  const hoverAt = hover !== null ? days[hover] : undefined;
  const hoverX = hoverAt ? xFor(Date.parse(hoverAt), scale, CHART) : 0;

  function toggle(keyword: string) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Keyword Rank</h2>
        <span className="muted small">{days.length} days</span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label="Keyword rank over time" onMouseMove={move} onMouseLeave={() => setHover(null)}>
          {RANK_TICKS.map((tick) => (
            <g key={tick}>
              <line className="grid" x1={CHART.left} x2={CHART.width - CHART.right} y1={yForRank(tick)} y2={yForRank(tick)} />
              <text className="axis" x={CHART.left - 8} y={yForRank(tick) + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          <text className="axis" x={CHART.left - 8} y={yForRank(null) + 4} textAnchor="end">
            —
          </text>
          {view.changes.map((change) => {
            const x = xFor(Date.parse(change.appliedAt), scale, CHART);
            return (
              <g key={change.id} className="change-marker">
                <line x1={x} x2={x} y1={CHART.top} y2={CHART.height - CHART.bottom} />
                <text x={x + 4} y={CHART.top + 10}>
                  v{change.version}
                </text>
              </g>
            );
          })}
          {view.series.map((series, index) =>
            hidden.has(series.keyword) ? null : (
              <path
                key={series.keyword}
                className="series"
                d={path(series.points.map((point) => [xFor(Date.parse(point.at), scale, CHART), yForRank(point.rank)]))}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              />
            ),
          )}
          {hoverAt && <line className="hover-line" x1={hoverX} x2={hoverX} y1={CHART.top} y2={CHART.height - CHART.bottom} />}
          <text className="axis" x={CHART.left} y={CHART.height - 8}>
            {day(new Date(scale.start).toISOString())}
          </text>
          <text className="axis" x={CHART.width - CHART.right} y={CHART.height - 8} textAnchor="end">
            {day(new Date(scale.end).toISOString())}
          </text>
        </svg>
        {hoverAt && (
          <div className="chart-tip" style={{ left: `${(hoverX / CHART.width) * 100}%` }}>
            <strong>{day(hoverAt)}</strong>
            {view.series
              .filter((series) => !hidden.has(series.keyword))
              .map((series) => {
                const point = series.points.find((item) => item.at === hoverAt);
                return (
                  <span key={series.keyword}>
                    <span className="swatch" style={{ background: SERIES_COLORS[view.series.indexOf(series) % SERIES_COLORS.length] }} />
                    {series.keyword} <span className="num">{point?.rank ? `#${point.rank}` : '—'}</span>
                  </span>
                );
              })}
          </div>
        )}
      </div>
      <ul className="legend">
        {view.series.map((series, index) => (
          <li key={series.keyword}>
            <button type="button" aria-pressed={!hidden.has(series.keyword)} onClick={() => toggle(series.keyword)}>
              <span className="swatch" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
              {series.keyword}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BsrChart({ points }: { points: RankView['bsr'] }) {
  const ranked = points.filter((point): point is { at: string; bsr: number } => point.bsr !== null);
  if (ranked.length < 2) return null;
  const scale = { start: Date.parse(ranked[0]!.at), end: Date.parse(ranked.at(-1)!.at) };
  const logs = ranked.map((point) => Math.log10(point.bsr));
  const low = Math.min(...logs);
  const high = Math.max(...logs);
  const y = (value: number) => BSR_CHART.top + ((value - low) / Math.max(high - low, 0.01)) * (BSR_CHART.height - BSR_CHART.top - BSR_CHART.bottom);
  const line = path(ranked.map((point, index) => [xFor(Date.parse(point.at), scale, BSR_CHART), y(logs[index]!)]));
  const latest = ranked.at(-1)!;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Best Sellers Rank</h2>
        <span className="num">#{count(latest.bsr)}</span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${BSR_CHART.width} ${BSR_CHART.height}`} role="img" aria-label="Best Sellers Rank over time">
          <path className="series bsr" d={line} />
        </svg>
      </div>
    </div>
  );
}

function Outcomes({ recommendations }: { recommendations: Recommendation[] }) {
  const measured = recommendations.filter((rec) => rec.status === 'applied' && !LAUNCH_KINDS.includes(rec.kind));
  if (measured.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Change Results</h2>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Change</th>
              <th>Applied</th>
              <th className="right">Before</th>
              <th className="right">After</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {measured.map((rec) => (
              <tr key={rec.id}>
                <td>
                  <strong>{RECOMMENDATION_LABEL[rec.kind]}</strong>
                  <div className="muted small">{recommendationSummary(rec.payload)}</div>
                </td>
                <td className="num">{rec.appliedAt ? day(rec.appliedAt) : '—'}</td>
                <td className="right num">{rec.outcome?.beforeMedian != null ? `#${count(rec.outcome.beforeMedian)}` : '—'}</td>
                <td className="right num">{rec.outcome?.afterMedian != null ? `#${count(rec.outcome.afterMedian)}` : '—'}</td>
                <td>{rec.outcome ? <span className={`tag ${VERDICT_TAG[rec.outcome.verdict]}`}>{VERDICT_LABEL[rec.outcome.verdict]}</span> : <span className="tag tag-gilt">Measuring</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RankTab() {
  const { bookId, detail, goTo, reload } = useWorkspace();
  const rank = useResource<RankView>(detail.book.publishedAt ? `/books/${bookId}/rank` : null);
  const action = useAction();

  if (!detail.book.publishedAt) {
    return (
      <div className="empty">
        <h2>Not Published</h2>
        <button type="button" className="btn btn-primary" onClick={() => goTo('metadata')}>
          Listing
        </button>
      </div>
    );
  }
  if (rank.loading && !rank.data) return <div className="loading">Loading…</div>;
  if (rank.error && !rank.data) return <div className="form-error">{rank.error}</div>;
  const view = rank.data;
  if (!view) return null;

  async function simulate(days: number) {
    await action.run(async () => {
      await api.post(`/books/${bookId}/rank/simulate`, { days });
      await Promise.all([rank.reload(), reload()]);
    });
  }

  async function sweep() {
    await action.run(async () => {
      await api.post(`/books/${bookId}/rank/sweep`, {});
      await rank.reload();
    });
  }

  const open = view.recommendations.filter((rec) => rec.status === 'open' && !LAUNCH_KINDS.includes(rec.kind));
  const hasPoints = view.series.some((series) => series.points.length > 0);

  return (
    <div className="split split-wide">
      <div className="stack">
        <div className="section-head">
          <span className="btn-row">
            {view.simulated && <span className="tag tag-gilt">Sample Data</span>}
            <span className="muted small">Live since {day(view.publishedAt ?? detail.book.publishedAt)}</span>
          </span>
          <span className="btn-row">
            {view.simulated &&
              SIMULATE_DAYS.map((days) => (
                <button key={days} type="button" className="btn btn-small" disabled={action.busy} onClick={() => void simulate(days)}>
                  +{days} Days
                </button>
              ))}
            <button type="button" className="btn btn-small btn-primary" disabled={action.busy} onClick={() => void sweep()}>
              {action.busy ? <span className="spinner" /> : 'Sweep Now'}
            </button>
          </span>
        </div>
        {action.error && <div className="form-error">{action.error}</div>}
        {hasPoints ? (
          <RankChart view={view} />
        ) : (
          <div className="empty">
            <h2>No Observations Yet</h2>
          </div>
        )}
        <BsrChart points={view.bsr} />
        <Outcomes recommendations={view.recommendations} />
      </div>
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <h2>Re-Optimize</h2>
            {open.length > 0 && <span className="tab-count accent">{open.length}</span>}
          </div>
          {open.length === 0 ? (
            <div className="panel-body muted small">No open recs</div>
          ) : (
            <ul className="recs">
              {open.map((rec) => (
                <RecommendationRow key={rec.id} recommendation={rec} onDone={rank.reload} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
