'use client';

import { day, dollars, titleCase } from '@/lib/format';
import type { UsageView } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

const BAR_CHART = { width: 760, height: 160, top: 8, bottom: 24, gap: 4 };
/** Ledger purposes look like `pass:copyedit` or `blurb`. */
function purposeLabel(purpose: string): string {
  const [head, tail] = purpose.split(':');
  return titleCase(tail ? `${tail} ${head}` : (head ?? purpose));
}

function DailyBars({ daily, capCents }: { daily: UsageView['daily']; capCents: number }) {
  const peak = Math.max(capCents, ...daily.map((entry) => entry.costCents), 1);
  const plotHeight = BAR_CHART.height - BAR_CHART.top - BAR_CHART.bottom;
  const barWidth = daily.length > 0 ? (BAR_CHART.width - BAR_CHART.gap * (daily.length - 1)) / daily.length : 0;
  const capY = BAR_CHART.top + plotHeight - (capCents / peak) * plotHeight;
  const first = daily[0];
  const last = daily.at(-1);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${BAR_CHART.width} ${BAR_CHART.height}`} role="img" aria-label="Daily AI spend, last 30 days">
        {daily.map((entry, index) => {
          const height = (entry.costCents / peak) * plotHeight;
          return (
            <rect
              key={entry.day}
              className={`bar${entry.costCents >= capCents && capCents > 0 ? ' over' : ''}`}
              x={index * (barWidth + BAR_CHART.gap)}
              y={BAR_CHART.top + plotHeight - height}
              width={barWidth}
              height={Math.max(height, entry.costCents > 0 ? 1 : 0)}
            >
              <title>{`${day(entry.day)} · ${dollars(entry.costCents)} · ${entry.calls} calls`}</title>
            </rect>
          );
        })}
        <line className="cap-line" x1={0} x2={BAR_CHART.width} y1={capY} y2={capY} />
        <text className="axis" x={BAR_CHART.width} y={capY - 4} textAnchor="end">
          Cap {dollars(capCents)}
        </text>
        {first && (
          <text className="axis" x={0} y={BAR_CHART.height - 6}>
            {day(first.day)}
          </text>
        )}
        {last && (
          <text className="axis" x={BAR_CHART.width} y={BAR_CHART.height - 6} textAnchor="end">
            {day(last.day)}
          </text>
        )}
      </svg>
    </div>
  );
}

export default function UsagePage() {
  const usage = useResource<UsageView>('/usage');
  if (usage.loading && !usage.data) return <div className="page loading">Loading…</div>;
  if (usage.error && !usage.data) return <div className="page form-error">{usage.error}</div>;
  const view = usage.data;
  if (!view) return null;
  const usedPercent = view.capCents > 0 ? Math.min(100, (view.todayCents / view.capCents) * 100) : 100;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Usage</h1>
        <span className={`tag ${view.modelAvailable ? 'tag-ok' : 'tag-gilt'}`}>{view.modelAvailable ? 'Model Connected' : 'Rule Passes Only'}</span>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="eyebrow">Today</span>
          <strong className="num">{dollars(view.todayCents)}</strong>
          <div className={`meter${usedPercent >= 100 ? ' over' : ''}`}>
            <span style={{ width: `${usedPercent}%` }} />
          </div>
          <span className="muted small num">of {dollars(view.capCents)} daily cap</span>
        </div>
        <div className="stat">
          <span className="eyebrow">This Month</span>
          <strong className="num">{dollars(view.monthCents)}</strong>
        </div>
        <div className="stat">
          <span className="eyebrow">Books</span>
          <strong className="num">
            {view.books.used} / {view.books.limit}
          </strong>
          <span className="muted small">{view.plan.name} Plan</span>
        </div>
      </div>
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <h2>Last 30 Days</h2>
          </div>
          <DailyBars daily={view.daily} capCents={view.capCents} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>By Purpose</h2>
          </div>
          {view.byPurpose.length === 0 ? (
            <div className="panel-body muted small">No AI calls yet</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Purpose</th>
                    <th className="right">Calls</th>
                    <th className="right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {view.byPurpose.map((row) => (
                    <tr key={row.purpose}>
                      <td>{purposeLabel(row.purpose)}</td>
                      <td className="right num">{row.calls}</td>
                      <td className="right num">{dollars(row.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
