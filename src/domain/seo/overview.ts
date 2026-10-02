import { z } from 'zod';
import { localizedTextSchema } from '@/domain/localized';

/**
 * Admin → SEO overview, from `public.admin_seo_overview()` (content.view). Counts cover real
 * (non-demo) published rows only — the same rows the sitemap and prerenderer may index; demo rows
 * are counted separately because they are never indexed.
 */
const count = z.coerce.number().int().min(0);

export const seoOverviewSchema = z.object({
  allowIndexing: z.boolean(),
  pageSeo: z.record(z.string(), z.unknown()).nullable(),
  products: z.object({
    published: count,
    missingTitle: count,
    missingDescription: count,
    missingImage: count,
  }),
  entries: z.object({ published: count, missingTitle: count, missingDescription: count }),
  offers: z.object({ published: count, missingDescription: count }),
  categories: z.object({ visible: count, missingDescription: count }),
  brands: z.object({ visible: count, missingDescription: count }),
  demoPublished: z.object({ products: count, offers: count, entries: count }),
  demoCatalogShown: z.boolean(),
  missing: z.array(
    z.object({
      kind: z.enum(['product', 'entry']),
      id: z.string(),
      slug: z.string(),
      name: localizedTextSchema,
    }),
  ),
});

export type SeoOverview = z.infer<typeof seoOverviewSchema>;

export type SeoCheckLevel = 'ok' | 'warning' | 'error';

export interface SeoCheck {
  id:
    | 'demoDeployment'
    | 'siteUrl'
    | 'indexing'
    | 'productDescriptions'
    | 'productImages'
    | 'entryDescriptions'
    | 'offerDescriptions'
    | 'categoryDescriptions'
    | 'brandDescriptions'
    | 'demoShownLive';
  level: SeoCheckLevel;
  /** Rows affected (for the count in the message). */
  count?: number;
}

/**
 * Indexing status and metadata warnings, most serious first. Pure: shared by the Admin SEO page
 * and its tests. `missingTitle` is informational only (pages fall back to the item name), so
 * it is shown in the table but is not a warning.
 */
export function seoChecks(
  overview: SeoOverview,
  ctx: { mode: 'demo' | 'live'; siteUrl: string | null },
): SeoCheck[] {
  const checks: SeoCheck[] = [];
  if (ctx.mode === 'demo') checks.push({ id: 'demoDeployment', level: 'warning' });
  else {
    checks.push({ id: 'siteUrl', level: ctx.siteUrl ? 'ok' : 'error' });
    checks.push({ id: 'indexing', level: overview.allowIndexing ? 'ok' : 'warning' });
  }
  const missing = (id: SeoCheck['id'], n: number, total: number) => {
    if (total > 0) checks.push({ id, level: n > 0 ? 'warning' : 'ok', count: n });
  };
  missing('productDescriptions', overview.products.missingDescription, overview.products.published);
  missing('productImages', overview.products.missingImage, overview.products.published);
  missing('entryDescriptions', overview.entries.missingDescription, overview.entries.published);
  missing('offerDescriptions', overview.offers.missingDescription, overview.offers.published);
  missing(
    'categoryDescriptions',
    overview.categories.missingDescription,
    overview.categories.visible,
  );
  missing('brandDescriptions', overview.brands.missingDescription, overview.brands.visible);
  if (ctx.mode === 'live' && overview.demoCatalogShown)
    checks.push({ id: 'demoShownLive', level: 'warning' });
  const rank: Record<SeoCheckLevel, number> = { error: 0, warning: 1, ok: 2 };
  return checks.sort((a, b) => rank[a.level] - rank[b.level]);
}
