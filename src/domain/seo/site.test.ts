import { describe, expect, it } from 'vitest';
import demoCatalogJson from '@seed/demo/catalog.json';
import { createCatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import { ar } from '@/i18n/messages/ar';
import { en } from '@/i18n/messages/en';
import { servicesAr } from '@/i18n/messages/services.ar';
import { servicesEn } from '@/i18n/messages/services.en';
import { createTranslator } from '@/i18n/translator';
import { buildPageHead, renderPageHead } from './pageHead';
import { buildRobots, buildSitemap, isPrivatePath, STATIC_ROUTES } from './site';
import {
  articleJsonLd,
  organizationJsonLd,
  promotionJsonLd,
  serializeJsonLd,
  storeJsonLd,
  validateJsonLd,
  websiteJsonLd,
} from './structuredData';

const ctx = { origin: 'https://malek.test', locale: 'en' as const };
const { brand, social, store } = BASE_SETTINGS;

describe('site rules (sitemap, robots, private areas)', () => {
  it('private areas cover admin, account, checkout, cart, orders, wishlist and compare in both languages', () => {
    for (const path of ['/admin', '/admin/orders', '/en/account/orders', '/checkout', '/en/cart'])
      expect(isPrivatePath(path)).toBe(true);
    for (const path of ['/order/MS-1/invoice', '/wishlist', '/en/compare'])
      expect(isPrivatePath(path)).toBe(true);
    for (const path of ['/', '/en', '/store', '/en/product/x', '/administrator-guide', '/offers'])
      expect(isPrivatePath(path)).toBe(false);
  });

  it('sitemap lists each page in Arabic and English with hreflang alternates (escaped)', () => {
    const xml = buildSitemap('https://malek.test', [
      { path: '/', changefreq: 'daily', priority: 1 },
      { path: '/product/a&b', lastmod: '2026-09-01T10:00:00Z' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(4);
    expect(xml).toContain('<loc>https://malek.test/</loc>');
    expect(xml).toContain('<loc>https://malek.test/en</loc>');
    expect(xml).toContain('<loc>https://malek.test/en/product/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-09-01</lastmod>');
    expect(xml).toContain('hreflang="ar-EG" href="https://malek.test/product/a&amp;b"');
    expect(xml).toContain('hreflang="x-default" href="https://malek.test/product/a&amp;b"');
    expect(xml).toContain('<priority>1.0</priority>');
  });

  it('robots: blocks everything when not indexable, otherwise disallows private areas', () => {
    const closed = buildRobots({ indexable: false, sitemapUrl: null, reason: 'Demo' });
    expect(closed).toBe('# Demo\nUser-agent: *\nDisallow: /\n');
    const open = buildRobots({
      indexable: true,
      sitemapUrl: 'https://malek.test/sitemap.xml',
      reason: 'Live',
    });
    expect(open).toContain('Allow: /\n');
    for (const p of ['/admin', '/en/admin', '/account', '/checkout', '/en/cart', '/search'])
      expect(open).toContain(`Disallow: ${p}\n`);
    expect(open).toContain('Sitemap: https://malek.test/sitemap.xml');
  });

  it('every static route title / description exists in both languages', () => {
    for (const [dict, services] of [
      [ar, servicesAr],
      [en, servicesEn],
    ] as const) {
      const t = createTranslator<string>([dict, services], []);
      for (const route of STATIC_ROUTES) {
        if (route.title) expect(t(route.title)).not.toBe(route.title);
        if (route.description) expect(t(route.description)).not.toBe(route.description);
      }
    }
  });
});

describe('page head (shared by the SPA and the prerenderer)', () => {
  const base = {
    resolved: { title: 'Store | MALEK STORE', description: 'Phones', image: '/brand/og.png' },
    locale: 'en' as const,
    path: '/store',
    siteName: 'MALEK STORE',
    type: 'website' as const,
    allowIndexing: true,
    localize: (p: string, l: 'ar' | 'en') => (l === 'en' ? `/en${p === '/' ? '' : p}` : p),
    htmlLang: { ar: 'ar-EG', en: 'en' },
  };

  it('indexable page: robots index, canonical, alternates and absolute share image', () => {
    const head = buildPageHead({
      ...base,
      origin: 'https://malek.test',
      noIndex: false,
      demo: false,
    });
    const html = renderPageHead(head);
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain('<link rel="canonical" href="https://malek.test/en/store" />');
    expect(html).toContain('hreflang="x-default" href="https://malek.test/store"');
    expect(html).toContain('content="https://malek.test/brand/og.png"');
  });

  it('demo mode is noindex; noIndex pages advertise no canonical', () => {
    const demo = buildPageHead({
      ...base,
      origin: 'https://malek.test',
      noIndex: false,
      demo: true,
    });
    expect(demo.meta.find((m) => m.key === 'robots')?.content).toBe('noindex, nofollow');
    expect(demo.urls?.canonical).toBe('https://malek.test/en/store');
    const hidden = buildPageHead({
      ...base,
      origin: 'https://malek.test',
      noIndex: true,
      demo: false,
    });
    expect(hidden.urls).toBeNull();
  });

  it('escapes text and never lets JSON-LD close its script element', () => {
    const head = buildPageHead({
      ...base,
      resolved: { ...base.resolved, title: 'A "quoted" <b> & more' },
      origin: null,
      noIndex: false,
      demo: false,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Thing', name: '</script><x>' }],
    });
    const html = renderPageHead(head);
    expect(html).toContain('<title>A &quot;quoted&quot; &lt;b&gt; &amp; more</title>');
    expect(html).not.toContain('</script><x>');
    expect(html).not.toContain('og:url');
  });
});

describe('structured data (Organization, Store, WebSite, Article, Offer)', () => {
  it('organization, branches and site search validate and carry only public data', () => {
    const nodes = [
      organizationJsonLd({ brand, social, store }, ctx),
      websiteJsonLd(brand.name, ctx),
      ...store.branches.map((b) => storeJsonLd(b, brand, ctx)),
    ];
    for (const node of nodes) expect(validateJsonLd(node)).toEqual([]);
    const branch = nodes[2] as Record<string, unknown>;
    expect(branch['@type']).toBe('ElectronicsStore');
    expect((branch.address as Record<string, string>).addressCountry).toBe('EG');
    const search = (nodes[1] as { potentialAction: { target: { urlTemplate: string } } })
      .potentialAction.target.urlTemplate;
    expect(search).toBe('https://malek.test/en/search?q={search_term_string}');
    expect(serializeJsonLd(nodes)).not.toMatch(/password|secret|isDemo|internal/i);
  });

  it('articles and promotions: live, non-demo only, and valid', () => {
    const engine = createCatalogEngine(
      rawCatalogSchema.parse(demoCatalogJson),
      new Date('2026-09-25T12:00:00Z'),
    );
    const product = engine.product('iphone-18-pro');
    if (!product) throw new Error('missing product');
    const entry = {
      id: 'e1',
      slug: 'launch',
      type: 'news' as const,
      eyebrow: null,
      title: { ar: 'إطلاق', en: 'Launch' },
      subtitle: null,
      excerpt: { ar: 'ملخص', en: 'Summary' },
      body: null,
      media: null,
      cta: null,
      secondaryCta: null,
      state: null,
      releaseDate: null,
      publishAt: '2026-09-01T10:00:00Z',
      expiresAt: null,
      isFeatured: false,
      products: [],
      seo: { title: null, description: null },
      isDemo: false,
    };
    expect(articleJsonLd(entry, { ...ctx, mode: 'demo', publisher: brand })).toBeNull();
    expect(
      articleJsonLd({ ...entry, isDemo: true }, { ...ctx, mode: 'live', publisher: brand }),
    ).toBeNull();
    const article = articleJsonLd(entry, { ...ctx, mode: 'live', publisher: brand });
    expect(validateJsonLd(article)).toEqual([]);

    const offer = {
      id: 'o1',
      slug: 'bundle',
      kind: 'bundle' as const,
      title: { ar: 'باقة', en: 'Bundle' },
      subtitle: null,
      description: null,
      badge: { ar: 'عرض', en: 'Offer' },
      media: null,
      cta: null,
      discountPercent: null,
      discountAmount: null,
      bundlePrice: 1000,
      promoCode: null,
      startsAt: '2026-09-01T00:00:00Z',
      endsAt: '2026-10-01T00:00:00Z',
      showCountdown: false,
      featuredOnHome: false,
      sortOrder: 0,
      products: [
        { ...product, isDemo: false },
        { ...product, slug: 'demo-row', isDemo: true },
      ],
      productRoles: {},
      isDemo: false,
    };
    expect(promotionJsonLd(offer, { ...ctx, mode: 'demo' })).toBeNull();
    const promo = promotionJsonLd(offer, { ...ctx, mode: 'live' });
    expect(validateJsonLd(promo)).toEqual([]);
    expect(JSON.stringify(promo)).not.toContain('demo-row');
  });

  it('the validator reports missing fields, relative URLs and private keys', () => {
    expect(validateJsonLd({ '@type': 'Organization', name: 'x', url: '/rel' })).toEqual([
      '$: missing @context',
      '$.url: URL must be absolute',
    ]);
    expect(
      validateJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: ' ',
        url: 'https://a.test',
        internalNote: 'x',
      }),
    ).toEqual(['$: Organization needs name', '$.internalNote: private key in public markup']);
  });
});
