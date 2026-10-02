import { beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '@/config/env';
import { createDemoRepositories } from '@/repositories/demo/demoRepositories';
import { DemoAuthService } from '@/services/auth/demoAuthService';
import { generateSite, type GeneratedFile } from './generateSite';
import { loadDemoSite, loadSiteData, type SiteData } from './siteData';
import template from '../../index.html?raw';

const demoConfig: AppConfig = {
  dataMode: 'demo',
  dataModeSource: 'explicit',
  supabase: null,
  siteUrl: null,
};
const liveConfig: AppConfig = {
  dataMode: 'live',
  dataModeSource: 'explicit',
  supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
  siteUrl: 'https://malek.test',
};

/** The demo catalog re-labelled as real rows: stands in for a live store's public data. */
function asLive(site: SiteData, allowIndexing = true): SiteData {
  const real = <T extends { isDemo: boolean }>(items: T[]) =>
    items.map((i) => ({ ...i, isDemo: false }));
  return {
    ...site,
    mode: 'live',
    settings: { ...site.settings, seo: { ...site.settings.seo, allowIndexing } },
    products: real(site.products).map((p) => ({ ...p, isDemo: false })),
    categories: real(site.categories),
    brands: real(site.brands),
    entries: real(site.entries),
    offers: real(site.offers).map((o) => ({ ...o, products: real(o.products) })),
    listings: new Map([...site.listings].map(([k, v]) => [k, real(v)])),
  };
}

const byFile = (files: GeneratedFile[], name: string) => {
  const file = files.find((f) => f.file === name);
  if (!file) throw new Error(`missing ${name}`);
  return file.content;
};

let demo: SiteData;
beforeAll(async () => {
  demo = await loadDemoSite();
}, 30_000);

describe('build-time site generation', () => {
  it('demo deployments are never indexed: robots blocks all, empty sitemap, noindex pages', () => {
    const { files, report } = generateSite({ template, config: demoConfig, site: demo });
    expect(report.indexable).toBe(false);
    expect(byFile(files, 'robots.txt')).toMatch(/User-agent: \*\nDisallow: \/\n/);
    expect(byFile(files, 'robots.txt')).not.toContain('Sitemap:');
    expect(byFile(files, 'sitemap.xml')).not.toContain('<url>');
    const pages = files.filter((f) => f.file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(100);
    for (const page of pages) expect(page.content).toContain('content="noindex, nofollow"');
  });

  it('prerenders every public page in Arabic and English with its own head and body', () => {
    const { files } = generateSite({ template, config: demoConfig, site: demo });
    const names = files.map((f) => f.file);
    for (const path of ['index.html', 'en.html', 'store.html', 'en/store.html', 'contact.html'])
      expect(names).toContain(path);
    const [product] = demo.products;
    if (!product) throw new Error('no demo products');
    expect(names).toContain(`product/${product.slug}.html`);
    expect(names).toContain(`en/product/${product.slug}.html`);
    expect(names.some((n) => n.startsWith('category/'))).toBe(true);
    expect(names.some((n) => n.startsWith('en/news/'))).toBe(true);
    // Private areas are never prerendered.
    expect(
      names.some((n) => /^(en\/)?(admin|account|checkout|cart|order|wishlist|compare)/.test(n)),
    ).toBe(false);

    const en = byFile(files, `en/product/${product.slug}.html`);
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain(`<h1>${product.name.en}</h1>`);
    expect(en.match(/<title>/g)).toHaveLength(1);
    expect(en).toContain('<script type="module"'); // the SPA still boots
    const arHome = byFile(files, 'index.html');
    expect(arHome).toContain('<html lang="ar-EG" dir="rtl">');
    // JS visitors see the boot splash, not the static body.
    expect(arHome).toContain('.js .pr { display: none; }');
  });

  it('without VITE_SITE_URL the head has no canonical / og:url (the SPA adds them at runtime)', () => {
    const { files } = generateSite({ template, config: demoConfig, site: demo });
    const page = byFile(files, 'en/store.html');
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
  });

  it('a live store with indexing on: sitemap with ar/en alternates, robots with the sitemap', () => {
    const live = asLive(demo);
    const { files, report } = generateSite({ template, config: liveConfig, site: live });
    expect(report.indexable).toBe(true);
    const robots = byFile(files, 'robots.txt');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /en/checkout');
    expect(robots).toContain('Sitemap: https://malek.test/sitemap.xml');

    const sitemap = byFile(files, 'sitemap.xml');
    const [product] = live.products;
    if (!product) throw new Error('no products');
    expect(sitemap).toContain(`<loc>https://malek.test/product/${product.slug}</loc>`);
    expect(sitemap).toContain(`<loc>https://malek.test/en/product/${product.slug}</loc>`);
    expect(sitemap).toContain(
      `hreflang="x-default" href="https://malek.test/product/${product.slug}"`,
    );
    expect(sitemap).not.toMatch(/\/(admin|account|checkout|cart|search)/);
    expect(report.sitemapUrls).toBe((sitemap.match(/<url>/g) ?? []).length);

    const page = byFile(files, `en/product/${product.slug}.html`);
    expect(page).toContain('content="index, follow"');
    expect(page).toContain(
      `<link rel="canonical" href="https://malek.test/en/product/${product.slug}" />`,
    );
    expect(page).toContain('"@type":"Product"');
    expect(page).toContain('"priceCurrency":"EGP"');
  });

  it('a live store with indexing switched off stays out of search engines', () => {
    const { files, report } = generateSite({
      template,
      config: liveConfig,
      site: asLive(demo, false),
    });
    expect(report.indexable).toBe(false);
    expect(byFile(files, 'robots.txt')).toContain('Disallow: /\n');
    expect(byFile(files, 'store.html')).toContain('content="noindex, nofollow"');
  });

  it('live without a public URL is not indexable (sitemaps need absolute URLs)', () => {
    const { report } = generateSite({
      template,
      config: { ...liveConfig, siteUrl: null },
      site: asLive(demo),
    });
    expect(report.indexable).toBe(false);
    expect(report.reason).toContain('VITE_SITE_URL');
  });

  it('live mode never renders demo rows, even when a repository returns them', async () => {
    const repos = createDemoRepositories(new DemoAuthService());
    const slugs = demo.products.slice(0, 3).map((p) => ({ slug: p.slug, updatedAt: null }));
    const site = await loadSiteData(repos, 'live', {
      products: slugs,
      categories: [],
      brands: [],
      entries: [],
      offers: [],
      legal: [],
      allowIndexing: true,
    });
    // The rows exist, but they are demo rows: nothing of them may reach a live build.
    expect(site.products).toEqual([]);
    expect([...site.listings.values()].flat()).toEqual([]);
    const { files } = generateSite({ template, config: liveConfig, site });
    expect(files.some((f) => f.file.startsWith('product/'))).toBe(false);
  });

  it('structured data is validated: a broken node fails the build', () => {
    const live = asLive(demo);
    const broken = {
      ...live,
      settings: {
        ...live.settings,
        brand: { ...live.settings.brand, name: '' },
      },
    };
    expect(() => generateSite({ template, config: liveConfig, site: broken })).toThrow(
      /invalid structured data/,
    );
  });
});
