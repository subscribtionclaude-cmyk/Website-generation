import type { MediaItem, ProductDetail, ProductVariant, StockState } from './types';

export type Selection = Record<string, string>;

function matches(variant: ProductVariant, selection: Selection): boolean {
  return Object.entries(selection).every(([key, value]) => variant.options[key] === value);
}

export function findVariant(product: ProductDetail, selection: Selection): ProductVariant | null {
  if (product.variants.length === 0) return null;
  return (
    product.variants.find((v) =>
      product.options.every((o) => v.options[o.key] === selection[o.key]),
    ) ?? null
  );
}

/** Default selection: the default variant if purchasable, else the first in-stock one, else default. */
export function initialSelection(product: ProductDetail, preferred: Selection = {}): Selection {
  const preferredVariant = product.variants.find(
    (v) => Object.keys(preferred).length > 0 && matches(v, preferred),
  );
  const variant =
    preferredVariant ??
    product.variants.find((v) => v.isDefault && v.stockState !== 'out_of_stock') ??
    product.variants.find((v) => v.stockState !== 'out_of_stock') ??
    product.variants.find((v) => v.isDefault) ??
    product.variants[0];
  return variant ? { ...variant.options } : {};
}

export type OptionValueState = 'available' | 'out_of_stock' | 'unavailable';

/**
 * State of one option value given the other current choices:
 *  available    — the exact combination exists and can be bought
 *  out_of_stock — the combination exists but is sold out (still selectable → Notify Me)
 *  unavailable  — no variant exists with this value and the other choices (selecting it will
 *                 move the other options to the closest existing combination)
 */
export function optionValueState(
  product: ProductDetail,
  selection: Selection,
  optionKey: string,
  valueKey: string,
): OptionValueState {
  const candidate = { ...selection, [optionKey]: valueKey };
  const variant = product.variants.find((v) =>
    product.options.every((o) => v.options[o.key] === candidate[o.key]),
  );
  if (!variant) return 'unavailable';
  return variant.stockState === 'out_of_stock' ? 'out_of_stock' : 'available';
}

/** Change one option; if the exact combination doesn't exist, keep as many other choices as possible. */
export function selectOption(
  product: ProductDetail,
  selection: Selection,
  optionKey: string,
  valueKey: string,
): Selection {
  const candidate = { ...selection, [optionKey]: valueKey };
  if (findVariant(product, candidate)) return candidate;
  const withValue = product.variants.filter((v) => v.options[optionKey] === valueKey);
  const score = (v: ProductVariant) =>
    product.options.reduce((s, o) => s + (v.options[o.key] === selection[o.key] ? 2 : 0), 0) +
    (v.stockState === 'out_of_stock' ? 0 : 1);
  const best = [...withValue].sort((a, b) => score(b) - score(a))[0];
  return best ? { ...best.options } : candidate;
}

/** Gallery media for the selected colour (falls back to shared media, then everything). */
export function mediaForSelection(product: ProductDetail, selection: Selection): MediaItem[] {
  const color = selection.color;
  const forColor = product.media.filter((m) => m.colorKey !== null && m.colorKey === color);
  const shared = product.media.filter((m) => m.colorKey === null);
  const list = [...forColor, ...shared];
  return list.length > 0 ? list : product.media;
}

export type PurchaseState =
  | { kind: 'purchasable'; stockState: Exclude<StockState, 'out_of_stock'> }
  | { kind: 'out_of_stock' }
  | { kind: 'coming_soon' }
  | { kind: 'waitlist_only' }
  | { kind: 'pre_order' }
  | { kind: 'unavailable' };

/** Which call-to-action the product page must show for the current selection. */
export function purchaseState(
  product: ProductDetail,
  variant: ProductVariant | null,
): PurchaseState {
  switch (product.availabilityState) {
    case 'coming_soon':
      return { kind: 'coming_soon' };
    case 'waitlist_only':
      return { kind: 'waitlist_only' };
    case 'pre_order':
      return { kind: 'pre_order' };
    default:
      if (!variant || variant.price === null) return { kind: 'unavailable' };
      if (variant.stockState === 'out_of_stock') return { kind: 'out_of_stock' };
      return { kind: 'purchasable', stockState: variant.stockState };
  }
}
