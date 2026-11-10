// All money is integer cents. Floats never cross a module boundary.
declare const centsBrand: unique symbol;
export type Cents = number & { readonly [centsBrand]: true };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Cents must be a safe integer, got ${value}`);
  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce((sum, value) => sum + value, 0));
}

/** Rounds up so estimates never under-count spend. */
export function centsFromUsd(usd: number): Cents {
  return cents(Math.ceil(usd * 100 - 1e-9));
}

export function formatCents(value: Cents): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(absolute % 100).padStart(2, '0')}`;
}
