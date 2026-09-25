import type { Category, ProductDetail } from '@/domain/catalog/types';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';

/** Top-level category of a product (used so only comparable products share a table). */
export function rootCategoryOf(
  categorySlug: string | null,
  categories: readonly Category[],
): string | null {
  if (!categorySlug) return null;
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  let current = bySlug.get(categorySlug);
  let guard = 0;
  while (current?.parentSlug && guard < 10) {
    const parent = bySlug.get(current.parentSlug);
    if (!parent) break;
    current = parent;
    guard += 1;
  }
  return current?.slug ?? categorySlug;
}

export interface CompareRow {
  key: string;
  /** Group heading (spec group title) — null for the core rows. */
  group: LocalizedText | null;
  label: LocalizedText;
  values: (string | null)[];
  /** True when not every product has the same value. */
  differs: boolean;
}

/**
 * Build comparison rows dynamically from the flexible spec model (no phone-only hard-coding):
 * core rows (price range, availability, storage, colours, warranty) + every spec key that at least
 * two of the products share (or the only product's specs when comparing one).
 */
export function buildCompareRows(
  products: readonly ProductDetail[],
  locale: Locale,
  labels: {
    price: LocalizedText;
    availability: LocalizedText;
    storage: LocalizedText;
    colors: LocalizedText;
    warranty: LocalizedText;
    brand: LocalizedText;
  },
  format: {
    price: (p: ProductDetail) => string | null;
    availability: (p: ProductDetail) => string;
  },
): CompareRow[] {
  const rows: CompareRow[] = [];
  const push = (
    key: string,
    group: LocalizedText | null,
    label: LocalizedText,
    values: (string | null)[],
  ) => {
    const present = values.filter((v) => v !== null && v !== '');
    if (present.length === 0) return;
    rows.push({ key, group, label, values, differs: new Set(values).size > 1 });
  };
  push('price', null, labels.price, products.map(format.price));
  push('availability', null, labels.availability, products.map(format.availability));
  push(
    'brand',
    null,
    labels.brand,
    products.map((p) => resolveLocalized(p.brand.name, locale)),
  );
  push(
    'storage',
    null,
    labels.storage,
    products.map(
      (p) => p.storages.map((s) => resolveLocalized(s.label, locale)).join(' · ') || null,
    ),
  );
  push(
    'colors',
    null,
    labels.colors,
    products.map((p) => p.colors.map((c) => resolveLocalized(c.label, locale)).join(' · ') || null),
  );

  // Spec keys in first-seen order, grouped by their spec group.
  const specOrder: { key: string; group: LocalizedText; label: LocalizedText }[] = [];
  const seen = new Set<string>();
  for (const product of products)
    for (const group of product.specGroups)
      for (const item of group.items)
        if (!seen.has(item.key)) {
          seen.add(item.key);
          specOrder.push({ key: item.key, group: group.title, label: item.label });
        }
  const minShared = products.length > 1 ? 2 : 1;
  for (const spec of specOrder) {
    const values = products.map((p) => {
      for (const group of p.specGroups) {
        const item = group.items.find((i) => i.key === spec.key);
        if (item) return resolveLocalized(item.value, locale);
      }
      return null;
    });
    if (values.filter((v) => v !== null).length >= minShared)
      push(`spec:${spec.key}`, spec.group, spec.label, values);
  }
  push(
    'warranty',
    null,
    labels.warranty,
    products.map((p) => (p.warranty ? resolveLocalized(p.warranty, locale) : null)),
  );
  return rows;
}
