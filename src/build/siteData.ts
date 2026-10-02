import type { Brand, Category, ProductDetail, ProductSummary } from '@/domain/catalog/types';
import type { ContentEntry, Offer, PageSection } from '@/domain/content/types';
import { seoPublicIndexSchema, type SeoPublicIndex } from '@/domain/seo/publicIndex';
import { LEGAL_PAGE_KEYS, type LegalPageKey } from '@/domain/settings/schemas';
import { resolveSettings } from '@/domain/settings/resolve';
import type { PublicSettings } from '@/domain/settings/registry';
import type { AppConfig, DataMode } from '@/config/env';
import { createDemoRepositories } from '@/repositories/demo/demoRepositories';
import { createSupabaseRepositories } from '@/repositories/supabase/supabaseRepositories';
import type { Repositories } from '@/repositories/types';
import { DemoAuthService } from '@/services/auth/demoAuthService';
import { createSupabaseBuildClient } from '@/services/supabase/client';

/**
 * Everything the build-time generator renders, read through the SAME repositories the storefront
 * uses (demo adapters in demo mode, the Supabase adapters with the public anon key in live mode).
 * Live mode is limited to `seo_public_index()`: published, visible, non-demo rows only.
 */
export interface SiteData {
  mode: DataMode;
  settings: PublicSettings;
  categories: Category[];
  brands: Brand[];
  products: ProductDetail[];
  entries: ContentEntry[];
  offers: Offer[];
  sections: Record<'home' | 'apple' | 'offers', PageSection[]>;
  /** Products shown on each listing page (first page, as the storefront loads it). */
  listings: Map<string, ProductSummary[]>;
  legal: LegalPageKey[];
  /** Last modification per unlocalized path (sitemap lastmod). */
  lastmod: Map<string, string>;
}

async function allProducts(repos: Repositories): Promise<ProductSummary[]> {
  const items: ProductSummary[] = [];
  for (let page = 1; page < 100; page++) {
    const result = await repos.catalog.search({ page, pageSize: 60, sort: 'featured' });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length);
  const queue = items.map((item, i) => [item, i] as const);
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) out[job[1]] = await fn(job[0]);
    }),
  );
  return out;
}

const present = <T>(value: T | null): value is T => value !== null;

/**
 * Load the site. `index` (live mode) restricts every list to indexable rows; demo mode renders
 * the whole demo catalog (every demo page is noindex, and the sitemap stays empty).
 */
export async function loadSiteData(
  repos: Repositories,
  mode: DataMode,
  index: SeoPublicIndex | null,
): Promise<SiteData> {
  const settings = resolveSettings(await repos.settings.listPublishedSettings()).settings;
  const allow = (list: { slug: string }[] | undefined) =>
    list ? new Set(list.map((i) => i.slug)) : null;
  const only = <T extends { slug: string }>(items: T[], set: Set<string> | null) =>
    set ? items.filter((i) => set.has(i.slug)) : items;

  const productSlugs = index
    ? index.products.map((p) => p.slug)
    : (await allProducts(repos)).map((p) => p.slug);
  const entrySlugs = index
    ? index.entries.map((e) => e.slug)
    : (await repos.content.listEntries()).map((e) => e.slug);
  const offerSlugs = index
    ? index.offers.map((o) => o.slug)
    : (await repos.content.listOffers()).map((o) => o.slug);

  const [categories, brands, products, entries, offers, home, apple, offersPage] =
    await Promise.all([
      repos.catalog.listCategories().then((c) => only(c, allow(index?.categories))),
      repos.catalog.listBrands().then((b) => only(b, allow(index?.brands))),
      mapLimit(productSlugs, 6, (slug) => repos.catalog.getProduct(slug)),
      mapLimit(entrySlugs, 6, (slug) => repos.content.getEntry(slug)),
      mapLimit(offerSlugs, 6, (slug) => repos.content.getOffer(slug)),
      repos.content.listPageSections('home'),
      repos.content.listPageSections('apple'),
      repos.content.listPageSections('offers'),
    ]);

  const pageSize = settings.catalog.pageSize;
  const listings = new Map<string, ProductSummary[]>();
  const visibleOnly = (items: ProductSummary[]) =>
    mode === 'live' ? items.filter((p) => !p.isDemo) : items;
  listings.set('/store', visibleOnly((await repos.catalog.search({ pageSize })).items));
  await mapLimit(categories, 4, async (c) => {
    const page = await repos.catalog.search({ categories: [c.slug], pageSize });
    listings.set(`/category/${c.slug}`, visibleOnly(page.items));
  });
  await mapLimit(brands, 4, async (b) => {
    const page = await repos.catalog.search({ brands: [b.slug], pageSize });
    listings.set(`/brand/${b.slug}`, visibleOnly(page.items));
  });

  const legal = index
    ? LEGAL_PAGE_KEYS.filter((k) => index.legal.includes(k))
    : LEGAL_PAGE_KEYS.filter((k) => settings.legal.pages[k].body !== null);

  const lastmod = new Map<string, string>();
  if (index) {
    for (const p of index.products) if (p.updatedAt) lastmod.set(`/product/${p.slug}`, p.updatedAt);
    for (const c of index.categories)
      if (c.updatedAt) lastmod.set(`/category/${c.slug}`, c.updatedAt);
    for (const b of index.brands) if (b.updatedAt) lastmod.set(`/brand/${b.slug}`, b.updatedAt);
    for (const e of index.entries) if (e.updatedAt) lastmod.set(`/news/${e.slug}`, e.updatedAt);
    for (const o of index.offers) if (o.updatedAt) lastmod.set(`/offers/${o.slug}`, o.updatedAt);
  }

  // Live mode: never render a demo row, even if a repository returned one.
  const live = <T extends { isDemo: boolean }>(items: (T | null)[]) =>
    items.filter(present).filter((i) => mode === 'demo' || !i.isDemo);
  return {
    mode,
    settings,
    categories: live(categories),
    brands: live(brands),
    products: live(products),
    entries: live(entries),
    offers: live(offers),
    sections: { home, apple, offers: offersPage },
    listings,
    legal,
    lastmod,
  };
}

/** Demo deployments: the in-memory demo repositories (the same ones the demo storefront runs on). */
export async function loadDemoSite(): Promise<SiteData> {
  return loadSiteData(createDemoRepositories(new DemoAuthService()), 'demo', null);
}

/**
 * Live deployments: the Supabase repositories with the public anon key and no session — exactly
 * what an anonymous visitor can read (RLS applies). Never a service key.
 */
export async function loadLiveSite(config: AppConfig): Promise<SiteData> {
  if (!config.supabase)
    throw new Error('Live mode needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  const client = createSupabaseBuildClient(config.supabase);
  const { data, error } = await client.rpc('seo_public_index');
  if (error) throw new Error(`seo_public_index failed: ${error.message}`);
  const index = seoPublicIndexSchema.parse(data);
  const site = await loadSiteData(createSupabaseRepositories(client), 'live', index);
  site.settings = {
    ...site.settings,
    seo: { ...site.settings.seo, allowIndexing: index.allowIndexing },
  };
  return site;
}
