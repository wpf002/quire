/** KDP limits each account to 3 new titles per day across all formats. */
export const KDP_TITLES_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface VelocityStatus {
  publishedLast24h: number;
  remaining: number;
  nextSlotAt: Date | null;
}

export function velocityStatus(publishedAt: Date[], now: Date): VelocityStatus {
  const windowStart = now.getTime() - DAY_MS;
  const recent = publishedAt.filter((date) => date.getTime() > windowStart).sort((left, right) => left.getTime() - right.getTime());
  const remaining = Math.max(0, KDP_TITLES_PER_DAY - recent.length);
  const oldest = recent[0];
  return {
    publishedLast24h: recent.length,
    remaining,
    nextSlotAt: remaining === 0 && oldest ? new Date(oldest.getTime() + DAY_MS) : null,
  };
}
