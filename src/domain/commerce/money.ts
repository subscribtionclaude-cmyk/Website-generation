import { roundMoney } from '@/lib/format/money';

/**
 * Money arithmetic in integer piasters (1 EGP = 100 minor units) so the browser never accumulates
 * float errors. Rounding matches PostgreSQL `round(numeric, 2)` (half away from zero; amounts here
 * are never negative). The database stays the authority — these helpers power the demo adapter and
 * display-only estimates.
 */
export function toMinor(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

/** percent of base, both in EGP; result rounded to piasters (e.g. 10% of 2 × 900 = 180). */
export function percentOf(base: number, percent: number): number {
  const baseMinor = toMinor(base);
  const hundredths = Math.round(percent * 100); // 12.5% → 1250
  return fromMinor(Math.floor((baseMinor * hundredths + 5000) / 10000));
}

export function addMoney(...amounts: number[]): number {
  return fromMinor(amounts.reduce((sum, amount) => sum + toMinor(amount), 0));
}

export function subtractMoney(a: number, b: number): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

export function multiplyMoney(amount: number, quantity: number): number {
  return fromMinor(toMinor(amount) * quantity);
}

export function minMoney(...amounts: number[]): number {
  return Math.min(...amounts);
}
