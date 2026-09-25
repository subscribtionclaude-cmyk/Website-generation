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
          isCover: z.boolean(),
          sortOrder: z.number(),
        }),
      ),
      specGroups: z.array(
        z.object({
          key: z.string(),
          title: lt,
          items: z.array(z.object({ key: z.string(), label: lt, value: lt })),
        }),
      ),
      relations: z.array(
        z.object({
          kind: z.enum(['accessory', 'similar', 'recommended']),
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
      media: z.null(),
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
        z.object({ slug: z.string(), role: z.enum(['target', 'bundle_item', 'gift']) }),
      ),
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
      media: z
        .object({
          kind: z.enum(['image', 'video']),
          url: z.string(),
          posterUrl: z.string().nullable(),
          captionsUrl: z.string().nullable().default(null),
          alt: lt,
        })
        .nullable(),
      cta: rawCtaSchema.nullable(),
      secondaryCta: rawCtaSchema.nullable(),
      state: availabilityStateSchema.nullable(),
      releaseDate: z.string().nullable(),
      publishAt: z.string(),
      expiresAt: z.string().nullable(),
      isFeatured: z.boolean(),
      products: z.array(z.string()),
    }),
  ),
});

export type RawCatalog = z.infer<typeof rawCatalogSchema>;
export type RawProduct = RawCatalog['products'][number];

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
