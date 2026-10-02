import { LOCALES, type Locale } from '@/i18n/config';
import { localizePath } from '@/i18n/paths';

/**
 * Site-level SEO rules shared by the storefront, the build-time generator (sitemap.xml,
 * robots.txt, prerendered pages) and the service worker's cache rules.
 */

/** Private areas: never indexed, never prerendered, never cached by the service worker. */
export const PRIVATE_PATH_PREFIXES = [
  '/admin',
  '/account',
  '/checkout',
  '/cart',
  '/order',
  '/wishlist',
  '/compare',
] as const;

/** Strip the /en prefix (the storefront's only localized prefix). */
export function basePath(pathname: string) {
  return pathname === '/en' ? '/' : pathname.startsWith('/en/') ? pathname.slice(3) : pathname;
}

export function isPrivatePath(pathname: string) {
  const path = basePath(pathname);
  return PRIVATE_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Public, indexable storefront pages with fixed routes. `title` / `description` are the storefront
 * dictionary keys the page itself uses (checked by tests), `seoPage` links the Site Editor's
 * per-page SEO.
 */
export interface StaticRoute {
  path: string;
  title?: string;
  description?: string;
  seoPage?: 'home' | 'apple' | 'offers';
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

export const STATIC_ROUTES: StaticRoute[] = [
  { path: '/', seoPage: 'home', changefreq: 'daily', priority: 1 },
  {
    path: '/store',
    title: 'catalog.storeTitle',
    description: 'catalog.storeSubtitle',
    changefreq: 'daily',
    priority: 0.9,
  },
  {
    path: '/apple',
    title: 'apple.title',
    description: 'apple.description',
    seoPage: 'apple',
    changefreq: 'weekly',
    priority: 0.8,
  },
  {
    path: '/offers',
    title: 'offers.title',
    description: 'offers.subtitle',
    seoPage: 'offers',
    changefreq: 'daily',
    priority: 0.8,
  },
  {
    path: '/new',
    title: 'content.newTitle',
    description: 'content.newSubtitle',
    changefreq: 'weekly',
    priority: 0.7,
  },
  {
    path: '/coming-soon',
    title: 'content.comingSoonTitle',
    description: 'content.comingSoonSubtitle',
    changefreq: 'weekly',
    priority: 0.6,
  },
  {
    path: '/news',
    title: 'content.newsTitle',
    description: 'content.newsSubtitle',
    changefreq: 'weekly',
    priority: 0.6,
  },
  {
    path: '/services',
    title: 'services.hubTitle',
    description: 'services.hubBody',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/repairs',
    title: 'repairs.title',
    description: 'repairs.heroBody',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/trade-in',
    title: 'tradeIn.title',
    description: 'tradeIn.heroBody',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/used',
    title: 'used.title',
    description: 'used.heroBody',
    changefreq: 'monthly',
    priority: 0.6,
  },
  {
    path: '/after-sales',
    title: 'afterSales.title',
    description: 'afterSales.heroBody',
    changefreq: 'monthly',
    priority: 0.5,
  },
  {
    path: '/contact',
    title: 'contact.title',
    description: 'contact.subtitle',
    changefreq: 'monthly',
    priority: 0.6,
  },
];

export interface SitemapEntry {
  path: string;
  lastmod?: string | null;
  changefreq?: StaticRoute['changefreq'];
  priority?: number;
}

const xml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HREFLANG: Record<Locale, string> = { ar: 'ar-EG', en: 'en' };

/**
 * sitemap.xml with every page in Arabic and English, each listing its language alternates
 * (hreflang, Arabic as x-default) — the same URLs `usePageMeta` declares as canonical.
 */
export function buildSitemap(origin: string, entries: SitemapEntry[], comment?: string): string {
  const urls = entries.flatMap((entry) =>
    LOCALES.map((locale) => {
      const alternates = [
        ...LOCALES.map(
          (l) =>
            `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${xml(origin + localizePath(entry.path, l))}"/>`,
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(origin + localizePath(entry.path, 'ar'))}"/>`,
      ];
      return [
        '  <url>',
        `    <loc>${xml(origin + localizePath(entry.path, locale))}</loc>`,
        ...(entry.lastmod ? [`    <lastmod>${xml(entry.lastmod.slice(0, 10))}</lastmod>`] : []),
        ...(entry.changefreq ? [`    <changefreq>${entry.changefreq}</changefreq>`] : []),
        ...(entry.priority !== undefined
          ? [`    <priority>${entry.priority.toFixed(1)}</priority>`]
          : []),
        ...alternates,
        '  </url>',
      ].join('\n');
    }),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...(comment ? [`<!-- ${xml(comment)} -->`] : []),
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * robots.txt. A demo deployment, or a live site with indexing switched off (`seo.allowIndexing`),
 * blocks everything; otherwise public pages are open, private areas are disallowed (in both
 * languages) and the sitemap is announced.
 */
export function buildRobots({
  indexable,
  sitemapUrl,
  reason,
}: {
  indexable: boolean;
  sitemapUrl: string | null;
  reason: string;
}): string {
  if (!indexable) return ['# ' + reason, 'User-agent: *', 'Disallow: /', ''].join('\n');
  const disallow = PRIVATE_PATH_PREFIXES.flatMap((p) => [`Disallow: ${p}`, `Disallow: /en${p}`]);
  return [
    '# ' + reason,
    'User-agent: *',
    'Allow: /',
    ...disallow,
    'Disallow: /search',
    'Disallow: /en/search',
    ...(sitemapUrl ? ['', `Sitemap: ${sitemapUrl}`] : []),
    '',
  ].join('\n');
}
