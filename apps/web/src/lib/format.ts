const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const whole = new Intl.NumberFormat('en-US');
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const dollars = (cents: number): string => usd.format(cents / 100);
export const count = (value: number): string => whole.format(value);
export const day = (iso: string): string => shortDate.format(new Date(iso));
export const moment = (iso: string): string => dateTime.format(new Date(iso));

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(value: string): string {
  return value.replace(/(^|[\s-])(\w)/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

export function since(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Category paths arrive as "A › B › C" from the sample provider and "A > B > C" from others. */
export const CATEGORY_SEPARATOR = /\s[›>]\s/;
