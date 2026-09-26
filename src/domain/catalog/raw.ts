import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';
import { availabilityStateSchema } from './schemas';

/**
 * Normalised catalog document (supabase/seed/data/demo/catalog.json). Mirrors the database tables
 * closely so the same data can be seeded into Postgres and served by the demo adapter.
 * Dates may be relative tokens ("+5d", "-12h") resolved at load time.
 */
const lt = localizedTextSchema;
const ltn = localizedTextSchema.nullable();

const rawCtaSchema = z.object({ label: lt, href: z.string() });
const rawMediaSchema = z.object({
  kind: z.enum(['image', 'video']),
  url: z.string(),
  posterUrl: z.string().nullable(),
  captionsUrl: z.string().nullable().default(null),
  alt: lt,
});
const publishStatus = z.enum(['draft', 'published', 'archived']).default('published');
const warrantyKind = z
  .enum(['authorized_distributor', 'store', 'local', 'none', 'custom'])
  .nullable()
  .default(null);
/** Admin-managed fields (Phase 06). Optional in the seed file; defaults = published & visible. */
const editMeta = {
  updatedAt: z.string().nullable().default(null),
  seoTitle: ltn.default(null),
  seoDescription: ltn.default(null),
};

export const rawCatalogSchema = z.object({
  version: z.literal(1),
  brands: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: lt,
      description: ltn,
      logoUrl: z.string().nullable(),
      sortOrder: z.number(),
      isVisible: z.boolean().default(true),
      isFeatured: z.boolean().default(false),
      showOnApple: z.boolean().default(false),
      categorySlugs: z.array(z.string()).default([]),
      deletedAt: z.string().nullable().default(null),
      ...editMeta,
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      parentSlug: z.string().nullable(),
      name: lt,
      description: ltn,
      icon: z.string().nullable(),
      imageUrl: z.string().nullable(),
      sortOrder: z.number(),
      showInNav: z.boolean(),
      showOnHome: z.boolean(),
      showInShop: z.boolean(),
      showInCategoryGrid: z.boolean(),
      isVisible: z.boolean().default(true),
      deletedAt: z.string().nullable().default(null),
      ...editMeta,
    }),
  ),
  products: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      brandSlug: z.string(),
      categorySlugs: z.array(z.string()).min(1),
      model: z.string().nullable(),
      name: lt,
      subtitle: ltn,
      description: ltn,
      availabilityState: availabilityStateSchema,
      isNew: z.boolean(),
      isFeatured: z.boolean(),
      releaseDate: z.string().nullable(),
      warranty: ltn,
      bestSellerScore: z.number(),
      keywords: z.string(),
      status: publishStatus,
      isVisible: z.boolean().default(true),
      warrantyKind,
      createdAt: z.string().nullable().default(null),
      updatedAt: z.string().nullable().default(null),
      deletedAt: z.string().nullable().default(null),
      options: z.array(
        z.object({
          key: z.string(),
          name: lt,
          values: z.array(z.object({ key: z.string(), label: lt, hex: z.string().nullable() })),
        }),
      ),
      variants: z.array(
        z.object({
          id: z.string(),
          sku: z.string(),
          options: z.record(z.string(), z.string()),
          price: z.number().nullable(),
          compareAtPrice: z.number().nullable(),
          stock: z.number().int(),
          lowStockThreshold: z.number().int(),
          isActive: z.boolean(),
          isDefault: z.boolean(),
          warranty: ltn,
          barcode: z.string().nullable().default(null),
          warrantyKind,
          updatedAt: z.string().nullable().default(null),
          /** Removed in the editor: kept for order history, hidden everywhere else. */
          retiredAt: z.string().nullable().default(null),
        }),
      ),
      media: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['image', 'video']),
          url: z.string(),
          posterUrl: z.string().nullable(),
          captionsUrl: z.string().nullable().default(null),
          alt: lt,
          width: z.number().nullable(),
          height: z.number().nullable(),
          colorKey: z.string().nullable(),
          variantSku: z.string().nullable().default(null),
          isCover: z.boolean(),
          sortOrder: z.number(),
        }),
      ),
      specGroups: z.array(
        z.object({
          key: z.string(),
          title: lt,
          items: z.array(
            z.object({
              key: z.string(),
              label: lt,
              value: lt,
              visible: z.boolean().default(true),
            }),
          ),
        }),
      ),
      relations: z.array(
        z.object({
          kind: z.enum(['accessory', 'similar', 'recommended', 'compatible', 'bought_together']),
          slug: z.string(),
          sortOrder: z.number(),
        }),
      ),
      seo: z.object({ title: ltn, description: ltn }),
    }),
  ),
  offers: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      kind: z.string(),
      title: lt,
      subtitle: ltn,
      description: ltn,
      badge: lt,
      media: rawMediaSchema.nullable(),
      cta: rawCtaSchema.nullable(),
      discountPercent: z.number().nullable(),
      discountAmount: z.number().nullable(),
      bundlePrice: z.number().nullable(),
      promoCode: z.string().nullable(),
      maxRedemptions: z.number().int().positive().nullable().default(null),
      maxRedemptionsPerCustomer: z.number().int().positive().nullable().default(null),
      minSubtotal: z.number().nonnegative().nullable().default(null),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      showCountdown: z.boolean(),
      featuredOnHome: z.boolean(),
      sortOrder: z.number(),
      products: z.array(
        z.object({
          slug: z.string(),
          role: z.enum(['target', 'bundle_item', 'gift']),
          variantSku: z.string().nullable().default(null),
          quantity: z.number().int().positive().default(1),
        }),
      ),
      status: publishStatus,
      buyQuantity: z.number().int().positive().nullable().default(null),
      getQuantity: z.number().int().positive().nullable().default(null),
      categorySlugs: z.array(z.string()).default([]),
      ...editMeta,
    }),
  ),
  entries: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      type: z.enum(['campaign', 'new_release', 'coming_soon', 'offer_update', 'news']),
      eyebrow: ltn,
      title: lt,
      subtitle: ltn,
      excerpt: ltn,
      body: ltn,
      media: rawMediaSchema.nullable(),
      cta: rawCtaSchema.nullable(),
      secondaryCta: rawCtaSchema.nullable(),
      state: availabilityStateSchema.nullable(),
      releaseDate: z.string().nullable(),
      publishAt: z.string(),
      expiresAt: z.string().nullable(),
      isFeatured: z.boolean(),
      products: z.array(z.string()),
      status: publishStatus,
      ...editMeta,
    }),
  ),
  /** Demo reviews only (is_demo, never verified buyers). */
  reviews: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string(),
        product: z.string(),
        rating: z.number().int().min(1).max(5),
        title: ltn,
        body: lt,
        author: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  /** Demo service requests (Phase 05): staff-visible only, never tied to a customer. */
  serviceRequests: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string(),
        kind: z.enum(['repair', 'trade_in', 'used', 'after_sales']),
        number: z.string(),
        status: z.string(),
        deviceCategory: z.string().nullable(),
        brand: z.string().nullable(),
        model: z.string().nullable(),
        consultation: z.boolean(),
        handoff: z.enum(['store_visit', 'pickup_delivery']).nullable(),
        afterSalesType: z.enum(['exchange', 'return', 'warranty']).nullable(),
        targetSku: z.string().nullable(),
        policyVersion: z.string().nullable(),
        details: z.record(z.string(), z.unknown()),
        createdAt: z.string(),
      }),
    )
    .default([]),
});

export type RawCatalog = z.infer<typeof rawCatalogSchema>;
export type RawProduct = RawCatalog['products'][number];
export type RawVariant = RawProduct['variants'][number];

/**
 * What the storefront may see (mirrors app.product_is_visible and the published-only RLS on
 * offers / entries): published + visible products of visible brands, visible categories,
 * published offers and entries, active (non-retired) variants and approved specs.
 */
export function publicCatalog(raw: RawCatalog): RawCatalog {
  const brands = raw.brands.filter((b) => b.isVisible && !b.deletedAt);
  const brandSlugs = new Set(brands.map((b) => b.slug));
  const categories = raw.categories.filter((c) => c.isVisible && !c.deletedAt);
  const categorySlugs = new Set(categories.map((c) => c.slug));
  const products = raw.products
    .filter(
      (p) => p.status === 'published' && p.isVisible && !p.deletedAt && brandSlugs.has(p.brandSlug),
    )
    .map((p) => ({
      ...p,
      categorySlugs: p.categorySlugs.some((c) => categorySlugs.has(c))
        ? p.categorySlugs.filter((c) => categorySlugs.has(c))
        : p.categorySlugs,
      variants: p.variants.filter((v) => !v.retiredAt),
      specGroups: p.specGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.visible) }))
        .filter((g) => g.items.length > 0),
    }));
  const productSlugs = new Set(products.map((p) => p.slug));
  return {
    ...raw,
    brands,
    categories: categories.map((c) => ({
      ...c,
      parentSlug: c.parentSlug && categorySlugs.has(c.parentSlug) ? c.parentSlug : null,
    })),
    products: products.map((p) => ({
      ...p,
      relations: p.relations.filter((r) => productSlugs.has(r.slug)),
    })),
    offers: raw.offers.filter((o) => o.status === 'published'),
    entries: raw.entries.filter((e) => e.status === 'published'),
  };
}

const RELATIVE = /^([+-])(\d+)([dhm])$/;

/** Resolve "+5d" / "-12h" / ISO strings to an ISO timestamp relative to `now`. */
export function resolveTime(value: string | null, now: Date): string | null {
  if (value === null) return null;
  const match = RELATIVE.exec(value);
  if (!match) return new Date(value).toISOString();
  const [, sign, amount, unit] = match;
  const ms = Number(amount) * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000);
  return new Date(now.getTime() + (sign === '-' ? -ms : ms)).toISOString();
}

/** Same as resolveTime but returns a calendar date (YYYY-MM-DD) for release dates. */
export function resolveDate(value: string | null, now: Date): string | null {
  return resolveTime(value, now)?.slice(0, 10) ?? null;
}
