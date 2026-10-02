import { z } from 'zod';

/**
 * What a live deployment may index, from `public.seo_public_index()`: published, visible,
 * non-demo rows only (demo rows are excluded even when the staging "show demo catalog" switch is
 * on), plus the `seo.allowIndexing` switch. Used by the build-time sitemap / prerenderer.
 */
const itemSchema = z.object({ slug: z.string().min(1), updatedAt: z.string().nullable() });

export const seoPublicIndexSchema = z.object({
  products: z.array(itemSchema),
  categories: z.array(itemSchema),
  brands: z.array(itemSchema),
  entries: z.array(itemSchema),
  offers: z.array(itemSchema),
  legal: z.array(z.string()),
  allowIndexing: z.boolean(),
});

export type SeoPublicIndex = z.infer<typeof seoPublicIndexSchema>;
