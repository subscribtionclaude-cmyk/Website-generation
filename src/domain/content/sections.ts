import { z } from 'zod';
import type { CatalogQuery } from '@/domain/catalog/types';
import { localizedTextSchema } from '@/domain/localized';
import { ctaSchema } from './schemas';
import { CONTENT_TYPES, OFFER_KINDS } from './types';

/**
 * Page-section registry contract (Phase 02 renders it; Phase 07 Site Editor edits it).
 * A page is an ordered list of { type, isVisible, props } rows (table public.page_sections).
 * Each type's props are validated here; invalid or unknown sections are skipped, never crash a page.
 */
const lt = localizedTextSchema;
const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

const productSourceSchema = z.strictObject({
  kind: z.enum(['new', 'featured', 'best_sellers', 'on_offer', 'coming_soon']),
  brands: z.array(slug).optional(),
  categories: z.array(slug).optional(),
});

const offerFilterSchema = z.strictObject({
  kinds: z.array(z.enum(OFFER_KINDS)).optional(),
  brands: z.array(slug).optional(),
  categories: z.array(slug).optional(),
});

export const SECTION_PROP_SCHEMAS = {
  hero_campaign: z.strictObject({
    campaignSlug: slug,
    teaserSlug: slug.nullable(),
    tone: z.enum(['dark', 'light']),
  }),
  product_rail: z.strictObject({
    eyebrow: lt.nullable(),
    title: lt,
    subtitle: lt.nullable(),
    source: productSourceSchema,
    limit: z.number().int().min(1).max(12),
    layout: z.enum(['premium', 'grid']),
    cta: ctaSchema.nullable(),
  }),
  offer_rail: z.strictObject({
    eyebrow: lt.nullable(),
    title: lt,
    subtitle: lt.nullable(),
    featuredOnly: z.boolean(),
    filter: offerFilterSchema.nullable(),
    limit: z.number().int().min(1).max(12),
    cta: ctaSchema.nullable(),
  }),
  offer_group: z.strictObject({
    anchor: slug,
    title: lt,
    subtitle: lt.nullable(),
    filter: offerFilterSchema,
  }),
  category_grid: z.strictObject({
    title: lt,
    subtitle: lt.nullable(),
    limit: z.number().int().min(1).max(24),
  }),
  brand_lines: z.strictObject({
    brandSlug: slug,
    eyebrow: lt.nullable(),
    title: lt,
    subtitle: lt.nullable(),
    lines: z
      .array(
        z.strictObject({ label: lt, categorySlug: slug, icon: z.string().regex(/^[a-z-]{1,30}$/) }),
      )
      .min(1)
      .max(12),
    cta: ctaSchema.nullable(),
  }),
  budget_search: z.strictObject({ title: lt, subtitle: lt.nullable() }),
  promo_banner: z.strictObject({
    tone: z.enum(['dark', 'brand', 'light']),
    illustration: z.enum(['trade_in', 'repairs', 'none']),
    eyebrow: lt.nullable(),
    title: lt,
    body: lt.nullable(),
    points: z.array(lt).max(5),
    cta: ctaSchema,
    secondaryCta: ctaSchema.nullable(),
  }),
  coming_soon: z.strictObject({
    title: lt,
    subtitle: lt.nullable(),
    limit: z.number().int().min(1).max(8),
  }),
  content_rail: z.strictObject({
    title: lt,
    subtitle: lt.nullable(),
    types: z.array(z.enum(CONTENT_TYPES)).min(1),
    limit: z.number().int().min(1).max(12),
    cta: ctaSchema.nullable(),
  }),
  trust_strip: z.strictObject({ title: lt.nullable(), itemIds: z.array(slug).nullable() }),
  trust_feature: z.strictObject({ itemId: slug, eyebrow: lt.nullable() }),
  branch_contact: z.strictObject({ title: lt, subtitle: lt.nullable() }),
} as const;

export type SectionType = keyof typeof SECTION_PROP_SCHEMAS;
export type SectionProps<T extends SectionType> = z.infer<(typeof SECTION_PROP_SCHEMAS)[T]>;
export const SECTION_TYPES = Object.keys(SECTION_PROP_SCHEMAS) as SectionType[];

export function isSectionType(value: string): value is SectionType {
  return Object.prototype.hasOwnProperty.call(SECTION_PROP_SCHEMAS, value);
}

export type ResolvedSection = {
  [T in SectionType]: { id: string; type: T; props: SectionProps<T> };
}[SectionType];

/** Validate raw section rows: unknown types / invalid props / hidden rows are dropped (reported). */
export function resolveSections(
  rows: { id: string; type: string; isVisible: boolean; sortOrder: number; props: unknown }[],
  onInvalid?: (id: string, reason: string) => void,
): ResolvedSection[] {
  return [...rows]
    .filter((row) => row.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row) => {
      if (!isSectionType(row.type)) {
        onInvalid?.(row.id, `unknown type ${row.type}`);
        return [];
      }
      const parsed = SECTION_PROP_SCHEMAS[row.type].safeParse(row.props);
      if (!parsed.success) {
        onInvalid?.(row.id, parsed.error.issues[0]?.message ?? 'invalid props');
        return [];
      }
      return [{ id: row.id, type: row.type, props: parsed.data } as ResolvedSection];
    });
}

/** Map a product-rail source to a catalog query (same query in demo and live adapters). */
export function productSourceQuery(
  source: SectionProps<'product_rail'>['source'],
  limit: number,
): CatalogQuery {
  const base = { brands: source.brands, categories: source.categories, page: 1, pageSize: limit };
  switch (source.kind) {
    case 'new':
      return { ...base, newOnly: true, sort: 'newest' };
    case 'featured':
      return { ...base, featuredOnly: true, sort: 'featured' };
    case 'best_sellers':
      return { ...base, availability: ['available'], sort: 'best_selling' };
    case 'on_offer':
      return { ...base, onOffer: true, sort: 'featured' };
    case 'coming_soon':
      return {
        ...base,
        availability: ['coming_soon', 'waitlist_only', 'pre_order'],
        sort: 'newest',
      };
  }
}
