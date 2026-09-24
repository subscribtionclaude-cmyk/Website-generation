import { z } from 'zod';
import { availabilityStateSchema, productSummarySchema } from '@/domain/catalog/schemas';
import { localizedTextSchema } from '@/domain/localized';
import { isSafeHref } from '@/domain/settings/schemas';
import { CONTENT_TYPES, OFFER_KINDS } from './types';

const lt = localizedTextSchema;
const ltNullable = localizedTextSchema.nullable();

export const ctaSchema = z.object({
  label: lt,
  href: z.string().refine(isSafeHref, 'Unsafe CTA link'),
});
export const contentMediaSchema = z.object({
  kind: z.enum(['image', 'video']),
  url: z.string(),
  posterUrl: z.string().nullable(),
  captionsUrl: z.string().nullable().default(null),
  alt: lt,
});

export const offerSchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: z.enum(OFFER_KINDS),
  title: lt,
  subtitle: ltNullable,
  description: ltNullable,
  badge: lt,
  media: contentMediaSchema.nullable(),
  cta: ctaSchema.nullable(),
  discountPercent: z.number().nullable(),
  discountAmount: z.number().nullable(),
  bundlePrice: z.number().nullable(),
  promoCode: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  showCountdown: z.boolean(),
  featuredOnHome: z.boolean(),
  sortOrder: z.number(),
  products: z.array(productSummarySchema),
  productRoles: z.record(z.string(), z.enum(['target', 'bundle_item', 'gift'])),
  isDemo: z.boolean(),
});

export const contentEntrySchema = z.object({
  id: z.string(),
  slug: z.string(),
  type: z.enum(CONTENT_TYPES),
  eyebrow: ltNullable,
  title: lt,
  subtitle: ltNullable,
  excerpt: ltNullable,
  body: ltNullable,
  media: contentMediaSchema.nullable(),
  cta: ctaSchema.nullable(),
  secondaryCta: ctaSchema.nullable(),
  state: availabilityStateSchema.nullable(),
  releaseDate: z.string().nullable(),
  publishAt: z.string(),
  expiresAt: z.string().nullable(),
  isFeatured: z.boolean(),
  products: z.array(productSummarySchema),
  seo: z.object({ title: ltNullable, description: ltNullable }),
  isDemo: z.boolean(),
});

export const pageSectionSchema = z.object({
  id: z.string(),
  pageKey: z.string(),
  type: z.string(),
  sortOrder: z.number(),
  isVisible: z.boolean(),
  props: z.unknown(),
});
