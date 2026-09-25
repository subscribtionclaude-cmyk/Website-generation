import type { AvailabilityState, StockState } from '@/domain/catalog/types';
import type { CoreMessageKey } from '@/i18n/context';

const STOCK_KEY: Record<StockState, CoreMessageKey> = {
  in_stock: 'catalog.inStock',
  low_stock: 'catalog.lowStock',
  out_of_stock: 'catalog.outOfStock',
};

/** Label key for a product's stock / availability state (shared by badges, compare and requests). */
export function stockLabelKey(
  state: StockState,
  availability: AvailabilityState = 'available',
): CoreMessageKey {
  if (availability === 'coming_soon') return 'catalog.comingSoon';
  if (availability === 'pre_order') return 'catalog.preOrder';
  if (availability === 'waitlist_only') return 'catalog.waitlistOnly';
  return STOCK_KEY[state];
}
