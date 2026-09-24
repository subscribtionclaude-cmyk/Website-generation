import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';

/** Runtime validation of catalog data crossing the repository boundary (demo JSON or RPC JSON). */
const lt = localizedTextSchema;
const ltNullable = localizedTextSchema.nullable();

export const availabilityStateSchema = z.enum([
  'available',
  'coming_soon',
  'waitlist_only',
  'pre_order',
]);
export const stockStateSchema = z.enum(['in_stock', 'low_stock', 'out_of_stock']);

const refSchema = z.object({ slug: z.string(), name: lt });

export const mediaItemSchema = z.object({
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
});

export const optionValueSchema = z.object({
  key: z.string(),
  label: lt,
  hex: z.string().nullable(),
});

export const offerBadgeSchema = z.object({
  slug: z.string(),
  kind: z.string(),
  badge: lt,
  discountPercent: z.number().nullable(),
  endsAt: z.string().nullable(),
});

export const productSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  subtitle: ltNullable,
  model: z.string().nullable(),
  brand: refSchema,
  category: refSchema.nullable(),
  categorySlugs: z.array(z.string()),
  availabilityState: availabilityStateSchema,
  stockState: stockStateSchema,
  isNew: z.boolean(),
  isFeatured: z.boolean(),
  releaseDate: z.string().nullable(),
  price: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    compareAt: z.number().nullable(),
  }),
  storages: z.array(z.object({ key: z.string(), label: lt })),
  colors: z.array(optionValueSchema),
  image: mediaItemSchema.nullable(),
  offer: offerBadgeSchema.nullable(),
  isDemo: z.boolean(),
});

export const productDetailSchema = productSummarySchema.extend({
  description: ltNullable,
  warranty: ltNullable,
  options: z.array(z.object({ key: z.string(), name: lt, values: z.array(optionValueSchema) })),
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      options: z.record(z.string(), z.string()),
      price: z.number().nullable(),
      compareAtPrice: z.number().nullable(),
      stockState: stockStateSchema,
      warranty: ltNullable,
      isDefault: z.boolean(),
    }),
  ),
  media: z.array(mediaItemSchema),
  specGroups: z.array(
    z.object({
      key: z.string(),
      title: lt,
      items: z.array(z.object({ key: z.string(), label: lt, value: lt })),
    }),
  ),
  relations: z.object({
    accessories: z.array(productSummarySchema),
    similar: z.array(productSummarySchema),
    recommended: z.array(productSummarySchema),
  }),
  seo: z.object({ title: ltNullable, description: ltNullable }),
});

const facetOptionSchema = z.object({
  key: z.string(),
  label: lt,
  count: z.number(),
  hex: z.string().nullable().optional(),
});

export const catalogPageSchema = z.object({
  items: z.array(productSummarySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  facets: z.object({
    brands: z.array(facetOptionSchema),
    categories: z.array(facetOptionSchema),
    storage: z.array(facetOptionSchema),
    colors: z.array(facetOptionSchema),
    price: z.object({ min: z.number().nullable(), max: z.number().nullable() }),
  }),
});

export const brandSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  description: ltNullable,
  logoUrl: z.string().nullable(),
  sortOrder: z.number(),
  categorySlugs: z.array(z.string()),
  productCount: z.number(),
  isDemo: z.boolean(),
});

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: lt,
  parentSlug: z.string().nullable(),
  description: ltNullable,
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sortOrder: z.number(),
  showInNav: z.boolean(),
  showOnHome: z.boolean(),
  showInShop: z.boolean(),
  showInCategoryGrid: z.boolean(),
  productCount: z.number(),
  isDemo: z.boolean(),
});
