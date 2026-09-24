import type { StockState } from './types';

/**
 * Single source of the stock-state rule (mirrored by app.variant_stock_state in SQL).
 * Phase 03 subtracts active (unexpired) reservations from the quantity before this rule applies.
 */
export function stockStateFor(
  quantity: number,
  lowStockThreshold: number,
  isActive: boolean,
): StockState {
  if (!isActive || quantity <= 0) return 'out_of_stock';
  if (quantity <= lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

const RANK: Record<StockState, number> = { in_stock: 2, low_stock: 1, out_of_stock: 0 };

/** Product-level state: the best state among its variants. */
export function bestStockState(states: StockState[]): StockState {
  return states.reduce<StockState>((best, s) => (RANK[s] > RANK[best] ? s : best), 'out_of_stock');
}

export function discountPercent(price: number | null, compareAt: number | null): number | null {
  if (price === null || compareAt === null || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
