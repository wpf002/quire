/** Static product preview for the landing hero: a typeset print page behind a rank chart for the same sample book. */

const CHART = { width: 360, height: 150, padX: 8, padY: 14 };
const WORST_RANK = 60;
/** Day the sample listing change went live. */
const CHANGE_DAY = 11;

/** Organic rank for "cozy bakery mystery", one point per day. Illustrative, not a real book. */
const SAMPLE_RANKS = [
  52, 49, 54, 50, 47, 51, 48, 46, 49, 47, 45, 41, 36, 31, 28, 24, 22, 19, 18, 16, 15, 14, 14, 13, 12, 12, 11,
  12, 11, 11,
];

function xForDay(day: number): number {
  return CHART.padX + (day / (SAMPLE_RANKS.length - 1)) * (CHART.width - CHART.padX * 2);
}

function yForRank(rank: number): number {
  return CHART.padY + ((rank - 1) / (WORST_RANK - 1)) * (CHART.height - CHART.padY * 2);
}

function rankPath(): string {
  return SAMPLE_RANKS.map(
    (rank, day) => `${day === 0 ? 'M' : 'L'}${xForDay(day).toFixed(1)},${yForRank(rank).toFixed(1)}`,
  ).join(' ');
}

export function LandingProof() {
  const before = SAMPLE_RANKS[CHANGE_DAY - 1]!;
  const after = SAMPLE_RANKS[SAMPLE_RANKS.length - 1]!;
  const changeX = xForDay(CHANGE_DAY);

  return (
    <figure className="proof" aria-label="Sample book in Quire">
      <div className="proof-page" aria-hidden="true">
        <p className="proof-chapter">Chapter Three</p>
        <p className="proof-title">The Proving Drawer</p>
        <p className="proof-body">
          <span className="proof-drop">T</span>he bell over the door rang twice before Maggie looked up from
          the dough. Nobody came in. Flour hung in the light from the front window, and the rye starter on the
          counter had climbed halfway out of its jar again.
        </p>
        <p className="proof-body proof-indent">
          She wiped her hands and counted the loaves on the rack. Eleven. She had baked twelve.
        </p>
        <p className="proof-folio num">41</p>
      </div>

      <div className="proof-card">
        <div className="proof-card-head">
          <span className="small muted">Cozy Bakery Mystery</span>
          <span className="tag">Sample</span>
        </div>
        <p className="proof-delta num">
          #{before} <span aria-hidden="true">→</span> #{after}
        </p>
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          role="img"
          aria-label={`Keyword rank moved from ${before} to ${after} after a keyword change`}
        >
          <line className="proof-change" x1={changeX} x2={changeX} y1={0} y2={CHART.height} />
          <text className="proof-change-label" x={changeX + 6} y={CHART.height - 6}>
            Keywords v2
          </text>
          <path className="proof-line" d={rankPath()} />
        </svg>
        <p className="proof-foot small muted">30 days · Kindle search rank</p>
      </div>
    </figure>
  );
}
