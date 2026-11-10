/**
 * Best Seller Rank → estimated daily sales, Kindle store US.
 * Anchors from public author-community estimates; interpolated on a log-log scale.
 * These are estimates. The UI shows them as ranges, never as facts.
 */
const BSR_ANCHORS: Array<[bsr: number, dailySales: number]> = [
  [1, 5_000],
  [100, 350],
  [1_000, 100],
  [10_000, 15],
  [100_000, 1],
  [500_000, 0.1],
];

export function estimateDailySales(bsr: number): number {
  if (bsr <= 1) return BSR_ANCHORS[0]![1];
  for (let index = 1; index < BSR_ANCHORS.length; index += 1) {
    const [rankHigh, salesHigh] = BSR_ANCHORS[index - 1]!;
    const [rankLow, salesLow] = BSR_ANCHORS[index]!;
    if (bsr <= rankLow) {
      const position = (Math.log(bsr) - Math.log(rankHigh)) / (Math.log(rankLow) - Math.log(rankHigh));
      return Math.exp(Math.log(salesHigh) + position * (Math.log(salesLow) - Math.log(salesHigh)));
    }
  }
  const [lastRank, lastSales] = BSR_ANCHORS[BSR_ANCHORS.length - 1]!;
  return lastSales * (lastRank / bsr);
}

/** Inverse of estimateDailySales, for "you need N sales a day to reach rank R". */
export function bsrForDailySales(dailySales: number): number {
  let low = 1;
  let high = 5_000_000;
  for (let step = 0; step < 60; step += 1) {
    const middle = Math.sqrt(low * high);
    if (estimateDailySales(middle) > dailySales) low = middle;
    else high = middle;
  }
  return Math.round(Math.sqrt(low * high));
}
