import type { LocalizedText } from '@/domain/localized';
import type { EntryInput, OfferInput, ProductInput } from './schemas';

/**
 * Client-side mirror of the admin RPC validation (supabase/migrations/20260929100100_admin_catalog.sql).
 * The editor uses it for instant feedback and the demo engine to behave like the database; the
 * database stays authoritative. Codes are the same `{ code, field }` the RPCs return.
 */
export interface ValidationProblem {
  code: string;
  field?: string;
}

export const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
export const BARCODE_PATTERN = /^[A-Za-z0-9._-]{4,64}$/;
export const OPTION_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,30}$/;
export const VALUE_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;
export const SPEC_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;
export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export const validLt = (value: LocalizedText | null | undefined, required = true) =>
  value === null || value === undefined ? !required : !required || value.ar.trim().length > 0;

/** Empty bilingual inputs are stored as null (Arabic is the required base language). */
export function ltOrNull(ar: string, en: string): LocalizedText | null {
  const a = ar.trim();
  const e = en.trim();
  if (!a && !e) return null;
  return e ? { ar: a, en: e } : { ar: a };
}

/** URL-safe slug suggestion from an English (or transliterated) name. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const normaliseSku = (sku: string) => sku.trim().toUpperCase();

const comboKey = (options: Record<string, string>) =>
  Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join(',');

/** Shape validation of a product aggregate (no database lookups). */
export function validateProductInput(input: ProductInput): ValidationProblem | null {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { code: 'invalid_slug', field: 'slug' };
  if (!validLt(input.name)) return { code: 'name_required', field: 'name' };
  if (!input.brandId) return { code: 'brand_required', field: 'brandId' };
  if (input.categoryIds.length === 0) return { code: 'category_required', field: 'categoryIds' };
  if (input.variants.length === 0) return { code: 'variant_required', field: 'variants' };
  const optionKeys = new Set<string>();
  for (const o of input.options) {
    if (
      !OPTION_KEY_PATTERN.test(o.key) ||
      !validLt(o.name) ||
      o.values.length === 0 ||
      optionKeys.has(o.key)
    )
      return { code: 'invalid_options', field: 'options' };
    optionKeys.add(o.key);
    const valueKeys = new Set<string>();
    for (const v of o.values) {
      if (
        !VALUE_KEY_PATTERN.test(v.key) ||
        !validLt(v.label) ||
        (v.swatchHex && !HEX_PATTERN.test(v.swatchHex)) ||
        valueKeys.has(v.key)
      )
        return { code: 'invalid_options', field: 'options' };
      valueKeys.add(v.key);
    }
  }
  const skus = new Set<string>();
  for (const v of input.variants) {
    const sku = normaliseSku(v.sku);
    if (!SKU_PATTERN.test(sku)) return { code: 'invalid_sku', field: 'variants' };
    if (skus.has(sku)) return { code: 'duplicate_sku', field: 'variants' };
    skus.add(sku);
    if (v.barcode && !BARCODE_PATTERN.test(v.barcode))
      return { code: 'invalid_barcode', field: 'variants' };
  }
  const combos = new Set<string>();
  for (const v of input.variants) {
    const keys = Object.keys(v.options);
    const complete =
      keys.length === input.options.length &&
      input.options.every((o) => o.values.some((val) => val.key === v.options[o.key]));
    const key = comboKey(v.options);
    if (!complete || combos.has(key)) return { code: 'invalid_combination', field: 'variants' };
    combos.add(key);
  }
  for (const v of input.variants) {
    const bad = (n: number | null) => n !== null && (!Number.isFinite(n) || n < 0);
    if (
      bad(v.price) ||
      bad(v.compareAtPrice) ||
      (v.price !== null && v.compareAtPrice !== null && v.compareAtPrice <= v.price) ||
      !Number.isInteger(v.lowStockThreshold) ||
      v.lowStockThreshold < 0 ||
      (v.initialStock ?? 0) < 0
    )
      return { code: 'invalid_price', field: 'variants' };
  }
  for (const m of input.media) {
    if (
      !/^(\/|https:\/\/|data:image\/)/.test(m.url) ||
      (m.posterUrl && !/^(\/|https:\/\/)/.test(m.posterUrl))
    )
      return { code: 'invalid_media', field: 'media' };
  }
  const groupKeys = new Set<string>();
  for (const g of input.specGroups) {
    if (!SPEC_KEY_PATTERN.test(g.key) || !validLt(g.title) || groupKeys.has(g.key))
      return { code: 'invalid_specs', field: 'specGroups' };
    groupKeys.add(g.key);
    const itemKeys = new Set<string>();
    for (const item of g.items) {
      if (
        !SPEC_KEY_PATTERN.test(item.key) ||
        !validLt(item.label) ||
        !validLt(item.value) ||
        itemKeys.has(item.key)
      )
        return { code: 'invalid_specs', field: 'specGroups' };
      itemKeys.add(item.key);
    }
  }
  for (const r of input.relations) {
    if (!r.productId || r.productId === input.id)
      return { code: 'invalid_relation', field: 'relations' };
  }
  return null;
}

/** Cartesian product of option values (matrix editing: Storage × Color …). */
export function optionCombinations(
  options: { key: string; values: { key: string }[] }[],
): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (acc, option) =>
      acc.flatMap((combo) => option.values.map((v) => ({ ...combo, [option.key]: v.key }))),
    [{}],
  );
}

export { comboKey };

/** Same-site path or https URL (mirrors app.is_safe_href). */
export const isSafeHref = (href: string | null | undefined) =>
  !href || (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('https://');
const isMediaUrl = (url: string | null | undefined) =>
  !url || /^(\/|https:\/\/|data:image\/)/.test(url);

export function validateOfferInput(input: OfferInput): ValidationProblem | null {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { code: 'invalid_slug', field: 'slug' };
  if (!validLt(input.title)) return { code: 'title_required', field: 'title' };
  if (!validLt(input.badge)) return { code: 'badge_required', field: 'badge' };
  if (!isSafeHref(input.ctaHref)) return { code: 'invalid_link', field: 'ctaHref' };
  if (!isMediaUrl(input.mediaUrl)) return { code: 'invalid_media', field: 'mediaUrl' };
  const {
    discountPercent: pct,
    discountAmount: amt,
    bundlePrice: bundle,
    minSubtotal: min,
  } = input;
  if (
    (pct !== null && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) ||
    (amt !== null && (!Number.isFinite(amt) || amt <= 0)) ||
    (bundle !== null && (!Number.isFinite(bundle) || bundle < 0)) ||
    (min !== null && (!Number.isFinite(min) || min < 0))
  )
    return { code: 'invalid_discount', field: 'discount' };
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt)
    return { code: 'invalid_dates', field: 'endsAt' };
  if (
    (['percentage', 'flash', 'limited_time'].includes(input.kind) &&
      pct === null &&
      amt === null) ||
    (input.kind === 'fixed' && amt === null)
  )
    return { code: 'discount_required', field: 'discount' };
  if (['flash', 'limited_time'].includes(input.kind) && !input.endsAt)
    return { code: 'end_required', field: 'endsAt' };
  const code = input.promoCode?.trim().toUpperCase() || null;
  if (input.kind === 'promo_code') {
    if (!code || !/^[A-Z0-9_-]{3,30}$/.test(code))
      return { code: 'invalid_code', field: 'promoCode' };
    if (pct === null && amt === null) return { code: 'discount_required', field: 'discount' };
  } else if (code) return { code: 'code_only_for_promo', field: 'promoCode' };
  if (input.kind === 'bundle' && input.products.filter((p) => p.role === 'bundle_item').length < 2)
    return { code: 'bundle_items_required', field: 'products' };
  if (input.kind === 'free_gift' && !input.products.some((p) => p.role === 'gift'))
    return { code: 'gift_required', field: 'products' };
  if (input.kind === 'buy_x_get_y' && (!input.buyQuantity || !input.getQuantity))
    return { code: 'quantities_required', field: 'buyQuantity' };
  return null;
}

export function validateEntryInput(input: EntryInput): ValidationProblem | null {
  if (!SLUG_PATTERN.test(input.slug.trim().toLowerCase()))
    return { code: 'invalid_slug', field: 'slug' };
  if (!validLt(input.title)) return { code: 'title_required', field: 'title' };
  if (!isSafeHref(input.ctaHref) || !isSafeHref(input.secondaryCtaHref))
    return { code: 'invalid_link', field: 'ctaHref' };
  if (!isMediaUrl(input.mediaUrl)) return { code: 'invalid_media', field: 'mediaUrl' };
  if (input.expiresAt && input.expiresAt <= input.publishAt)
    return { code: 'invalid_dates', field: 'expiresAt' };
  return null;
}
