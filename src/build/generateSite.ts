import type { ProductDetail, ProductSummary } from '@/domain/catalog/types';
import type { ContentEntry, Offer, PageSection } from '@/domain/content/types';
import { resolveLocalized } from '@/domain/localized';
import {
  productMeta,
  entryMeta,
  offerMeta,
  categoryMeta,
  brandMeta,
} from '@/domain/seo/entityMeta';
import { buildPageHead, renderPageHead } from '@/domain/seo/pageHead';
import { resolveSeo, sectionShareImage } from '@/domain/seo/pageSeo';
import { buildRobots, buildSitemap, STATIC_ROUTES, type SitemapEntry } from '@/domain/seo/site';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  promotionJsonLd,
  storeJsonLd,
  validateJsonLd,
  websiteJsonLd,
  type JsonLd,
} from '@/domain/seo/structuredData';
import type { AppConfig } from '@/config/env';
import { LOCALE_META, LOCALES, otherLocale, type Locale } from '@/i18n/config';
import { ar } from '@/i18n/messages/ar';
import { en } from '@/i18n/messages/en';
import { servicesAr } from '@/i18n/messages/services.ar';
import { servicesEn } from '@/i18n/messages/services.en';
import { localizePath } from '@/i18n/paths';
import { createTranslator } from '@/i18n/translator';
import type { MessageParams } from '@/i18n/types';
import { formatMoney } from '@/lib/format/money';
import { formatDate } from '@/lib/time/zoned';
import type { SiteData } from './siteData';

/**
 * Build-time SEO output (run after `vite build` by scripts/generate-site.mjs):
 *   - dist/<page>.html (Home: dist/index.html) — every public page prerendered in Arabic and English with the same
 *     head the SPA sets at runtime (`buildPageHead`) and a readable static body for crawlers that
 *     don't run JavaScript. JS visitors never see that body: the boot splash shows until React
 *     mounts and replaces #root (no hydration, the SPA is unchanged).
 *   - dist/sitemap.xml and dist/robots.txt.
 * Demo deployments are never indexable: robots.txt disallows everything, the sitemap is empty and
 * every page says noindex.
 */

export interface GeneratedFile {
  file: string;
  content: string;
}

export interface SiteReport {
  mode: SiteData['mode'];
  indexable: boolean;
  reason: string;
  pages: number;
  sitemapUrls: number;
}

type T = (key: string, params?: MessageParams) => string;

const DICTIONARIES: Record<Locale, object[]> = { ar: [ar, servicesAr], en: [en, servicesEn] };

/** Translator that refuses unknown keys, so a renamed dictionary key fails the build. */
function translator(locale: Locale): T {
  const t = createTranslator<string>(DICTIONARIES[locale], DICTIONARIES.ar);
  return (key, params) => {
    const value = t(key, params);
    if (value === key) throw new Error(`generate-site: missing message "${key}"`);
    return value;
  };
}

const HTML_LANG = Object.fromEntries(LOCALES.map((l) => [l, LOCALE_META[l].htmlLang])) as Record<
  Locale,
  string
>;

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');

interface Crumb {
  label: string;
  href?: string;
}

interface Page {
  path: string;
  title?: string;
  description?: string;
  image?: string;
  seoPage?: 'home' | 'apple' | 'offers';
  sections?: readonly PageSection[];
  type?: 'website' | 'product' | 'article';
  noIndex?: boolean;
  jsonLd?: (JsonLd | null)[];
  crumbs?: Crumb[];
  heading: string;
  body: string;
}

interface Ctx {
  locale: Locale;
  t: T;
  site: SiteData;
  origin: string | null;
}

function money(ctx: Ctx, amount: number) {
  return formatMoney(amount, {
    locale: ctx.locale,
    numerals: ctx.site.settings.localization.numerals,
  });
}

function date(ctx: Ctx, value: string) {
  return formatDate(value, {
    locale: ctx.locale,
    numerals: ctx.site.settings.localization.numerals,
  });
}

const href = (ctx: Ctx, path: string) => esc(localizePath(path, ctx.locale));

function productList(ctx: Ctx, products: readonly ProductSummary[]) {
  if (products.length === 0) return '';
  const items = products.map((p) => {
    const name = resolveLocalized(p.name, ctx.locale);
    const price =
      p.price.min !== null
        ? ctx.t('catalog.from', { price: money(ctx, p.price.min) })
        : ctx.t(p.availabilityState === 'available' ? 'catalog.askForPrice' : 'catalog.priceTba');
    const image = p.image
      ? `<img src="${esc(p.image.url)}" alt="" width="${p.image.width ?? 400}" height="${p.image.height ?? 400}" loading="lazy" decoding="async" />`
      : '';
    return `<li><a href="${href(ctx, `/product/${p.slug}`)}">${image}<span>${esc(name)}</span></a><span class="pr-price">${esc(price)}</span></li>`;
  });
  return `<ul class="pr-grid">${items.join('')}</ul>`;
}

function linkList(ctx: Ctx, links: { path: string; label: string; note?: string | null }[]) {
  if (links.length === 0) return '';
  return `<ul class="pr-links">${links
    .map(
      (l) =>
        `<li><a href="${href(ctx, l.path)}">${esc(l.label)}</a>${l.note ? `<span>${esc(l.note)}</span>` : ''}</li>`,
    )
    .join('')}</ul>`;
}

const section = (title: string, content: string) =>
  content ? `<section><h2>${esc(title)}</h2>${content}</section>` : '';

// ── pages ──────────────────────────────────────────────────────────────────

function homePage(ctx: Ctx): Page {
  const { site, locale, t, origin } = ctx;
  const { brand, social, store } = site.settings;
  const jctx = origin ? { origin, locale } : null;
  return {
    path: '/',
    seoPage: 'home',
    sections: site.sections.home,
    jsonLd: jctx
      ? [
          organizationJsonLd({ brand, social, store }, jctx),
          websiteJsonLd(brand.name, jctx),
          ...store.branches.map((b) => storeJsonLd(b, brand, jctx)),
        ]
      : [],
    heading: `${brand.name} — ${resolveLocalized(brand.tagline, locale)}`,
    body: [
      section(
        t('catalog.storeTitle'),
        linkList(
          ctx,
          site.categories
            .filter((c) => c.showOnHome || c.showInNav)
            .map((c) => ({ path: `/category/${c.slug}`, label: resolveLocalized(c.name, locale) })),
        ),
      ),
      productList(ctx, (site.listings.get('/store') ?? []).slice(0, 12)),
      section(t('offers.title'), offerLinks(ctx)),
      section(t('content.newsTitle'), entryLinks(ctx, site.entries.slice(0, 6))),
    ].join(''),
  };
}

function offerLinks(ctx: Ctx) {
  return linkList(
    ctx,
    ctx.site.offers.map((o) => ({
      path: `/offers/${o.slug}`,
      label: resolveLocalized(o.title, ctx.locale),
      note: o.subtitle ? resolveLocalized(o.subtitle, ctx.locale) : null,
    })),
  );
}

function entryLinks(ctx: Ctx, entries: readonly ContentEntry[]) {
  return linkList(
    ctx,
    entries.map((e) => ({
      path: `/news/${e.slug}`,
      label: resolveLocalized(e.title, ctx.locale),
      note: e.excerpt ? resolveLocalized(e.excerpt, ctx.locale) : date(ctx, e.publishAt),
    })),
  );
}

function listingJsonLd(ctx: Ctx, title: string, crumbs: Crumb[], items: readonly ProductSummary[]) {
  if (!ctx.origin) return [];
  const jctx = { origin: ctx.origin, locale: ctx.locale };
  return [
    breadcrumbJsonLd(crumbs, jctx),
    itemListJsonLd(
      title,
      items
        .filter((p) => !p.isDemo)
        .map((p) => ({ name: resolveLocalized(p.name, ctx.locale), path: `/product/${p.slug}` })),
      jctx,
    ),
  ];
}

function staticPages(ctx: Ctx): Page[] {
  const { t, site, locale } = ctx;
  const home = { label: t('common.home'), href: '/' };
  const pages: Page[] = [];
  for (const route of STATIC_ROUTES) {
    if (route.path === '/') continue;
    const title = route.title ? t(route.title) : '';
    const description = route.description ? t(route.description) : undefined;
    const crumbs: Crumb[] = [home, { label: title }];
    let body = description ? `<p class="pr-lead">${esc(description)}</p>` : '';
    let jsonLd: (JsonLd | null)[] = [];
    switch (route.path) {
      case '/store': {
        const items = site.listings.get('/store') ?? [];
        body += section(
          t('catalog.storeTitle'),
          linkList(
            ctx,
            site.categories
              .filter((c) => c.showInShop)
              .map((c) => ({
                path: `/category/${c.slug}`,
                label: resolveLocalized(c.name, locale),
              })),
          ),
        );
        body += productList(ctx, items);
        jsonLd = listingJsonLd(ctx, title, crumbs, items);
        break;
      }
      case '/apple':
        body += productList(ctx, site.listings.get('/brand/apple') ?? []);
        break;
      case '/offers':
        body += offerLinks(ctx);
        break;
      case '/new':
        body += productList(ctx, site.products.filter((p) => p.isNew).slice(0, 24));
        break;
      case '/coming-soon':
        body += productList(
          ctx,
          site.products.filter((p) => p.availabilityState === 'coming_soon').slice(0, 24),
        );
        break;
      case '/news':
        body += entryLinks(ctx, site.entries);
        break;
      case '/services':
        body += linkList(
          ctx,
          STATIC_ROUTES.filter((r) =>
            ['/repairs', '/trade-in', '/used', '/after-sales'].includes(r.path),
          ).map((r) => ({ path: r.path, label: r.title ? t(r.title) : r.path })),
        );
        break;
      case '/contact':
        if (ctx.origin) {
          const jctx = { origin: ctx.origin, locale };
          jsonLd = site.settings.store.branches.map((b) =>
            storeJsonLd(b, site.settings.brand, jctx),
          );
        }
        break;
    }
    pages.push({
      path: route.path,
      title,
      description,
      seoPage: route.seoPage,
      sections: route.seoPage ? site.sections[route.seoPage] : undefined,
      crumbs,
      jsonLd,
      heading: title,
      body,
    });
  }
  return pages;
}

function productPage(ctx: Ctx, product: ProductDetail): Page {
  const { t, locale, site, origin } = ctx;
  const meta = productMeta(product, locale);
  const name = resolveLocalized(product.name, locale);
  const crumbs: Crumb[] = [
    { label: t('common.home'), href: '/' },
    product.category
      ? {
          label: resolveLocalized(product.category.name, locale),
          href: `/category/${product.category.slug}`,
        }
      : { label: t('catalog.storeTitle'), href: '/store' },
    { label: name },
  ];
  const price =
    product.price.min !== null
      ? t('catalog.from', { price: money(ctx, product.price.min) })
      : t(product.availabilityState === 'available' ? 'catalog.askForPrice' : 'catalog.priceTba');
  const image = product.image
    ? `<img src="${esc(product.image.url)}" alt="${esc(name)}" width="${product.image.width ?? 800}" height="${product.image.height ?? 800}" />`
    : '';
  const specs = product.specGroups
    .map(
      (g) =>
        `<h3>${esc(resolveLocalized(g.title, locale))}</h3><dl>${g.items
          .map(
            (i) =>
              `<dt>${esc(resolveLocalized(i.label, locale))}</dt><dd>${esc(resolveLocalized(i.value, locale))}</dd>`,
          )
          .join('')}</dl>`,
    )
    .join('');
  const demoNote =
    site.mode === 'demo' && product.isDemo
      ? `<p class="pr-note">${esc(t('product.demoPriceNote'))}</p>`
      : '';
  const jctx = origin ? { origin, locale } : null;
  return {
    path: `/product/${product.slug}`,
    title: meta.title,
    description: meta.description,
    image: meta.image,
    type: 'product',
    crumbs,
    jsonLd: jctx
      ? [breadcrumbJsonLd(crumbs, jctx), productJsonLd(product, { ...jctx, mode: site.mode })]
      : [],
    heading: name,
    body: [
      image,
      product.subtitle
        ? `<p class="pr-lead">${esc(resolveLocalized(product.subtitle, locale))}</p>`
        : '',
      `<p class="pr-price">${esc(price)}</p>`,
      demoNote,
      linkList(ctx, [
        {
          path: `/brand/${product.brand.slug}`,
          label: resolveLocalized(product.brand.name, locale),
        },
      ]),
      product.description
        ? section(
            t('product.description'),
            paragraphs(resolveLocalized(product.description, locale)),
          )
        : '',
      specs ? section(t('product.specs'), specs) : '',
    ].join(''),
  };
}

function listingPage(ctx: Ctx, path: string, meta: { title: string; description?: string }): Page {
  const { t } = ctx;
  const crumbs: Crumb[] = [
    { label: t('common.home'), href: '/' },
    { label: t('catalog.storeTitle'), href: '/store' },
    { label: meta.title },
  ];
  const items = ctx.site.listings.get(path) ?? [];
  return {
    path,
    title: meta.title,
    description: meta.description,
    crumbs,
    jsonLd: listingJsonLd(ctx, meta.title, crumbs, items),
    heading: meta.title,
    body:
      (meta.description ? `<p class="pr-lead">${esc(meta.description)}</p>` : '') +
      productList(ctx, items),
  };
}

function entryPage(ctx: Ctx, entry: ContentEntry): Page {
  const { t, locale, site, origin } = ctx;
  const meta = entryMeta(entry, locale);
  const title = resolveLocalized(entry.title, locale);
  const crumbs: Crumb[] = [
    { label: t('common.home'), href: '/' },
    { label: t('content.newsTitle'), href: '/news' },
    { label: title },
  ];
  const jctx = origin ? { origin, locale } : null;
  return {
    path: `/news/${entry.slug}`,
    title: meta.title,
    description: meta.description,
    image: meta.image,
    type: 'article',
    crumbs,
    jsonLd: jctx
      ? [
          breadcrumbJsonLd(crumbs, jctx),
          articleJsonLd(entry, { ...jctx, mode: site.mode, publisher: site.settings.brand }),
        ]
      : [],
    heading: title,
    body: [
      `<p class="pr-note"><time datetime="${esc(entry.publishAt)}">${esc(date(ctx, entry.publishAt))}</time></p>`,
      entry.subtitle
        ? `<p class="pr-lead">${esc(resolveLocalized(entry.subtitle, locale))}</p>`
        : '',
      entry.body ? paragraphs(resolveLocalized(entry.body, locale)) : '',
      productList(ctx, entry.products),
    ].join(''),
  };
}

function offerPage(ctx: Ctx, offer: Offer): Page {
  const { t, locale, site, origin } = ctx;
  const meta = offerMeta(offer, locale);
  const crumbs: Crumb[] = [
    { label: t('common.home'), href: '/' },
    { label: t('offers.title'), href: '/offers' },
    { label: meta.title },
  ];
  const jctx = origin ? { origin, locale } : null;
  return {
    path: `/offers/${offer.slug}`,
    title: meta.title,
    description: meta.description,
    image: meta.image,
    crumbs,
    jsonLd: jctx
      ? [breadcrumbJsonLd(crumbs, jctx), promotionJsonLd(offer, { ...jctx, mode: site.mode })]
      : [],
    heading: meta.title,
    body: [
      meta.description ? `<p class="pr-lead">${esc(meta.description)}</p>` : '',
      offer.description ? paragraphs(resolveLocalized(offer.description, locale)) : '',
      offer.bundlePrice !== null
        ? `<p class="pr-price">${esc(money(ctx, offer.bundlePrice))}</p>`
        : '',
      offer.endsAt
        ? `<p class="pr-note">${esc(t('offers.validUntil', { date: date(ctx, offer.endsAt) }))}</p>`
        : '',
      productList(ctx, offer.products),
    ].join(''),
  };
}

function legalPage(ctx: Ctx, key: SiteData['legal'][number]): Page {
  const doc = ctx.site.settings.legal.pages[key];
  const title = resolveLocalized(doc.title, ctx.locale);
  const body = doc.body ? resolveLocalized(doc.body, ctx.locale) : '';
  return {
    path: `/legal/${key.replace(/_/g, '-')}`,
    title,
    noIndex: !body,
    crumbs: [{ label: ctx.t('common.home'), href: '/' }, { label: title }],
    heading: title,
    body: paragraphs(body),
  };
}

function pagesFor(ctx: Ctx): Page[] {
  const { site, locale, t } = ctx;
  return [
    homePage(ctx),
    ...staticPages(ctx),
    ...site.products.map((p) => productPage(ctx, p)),
    ...site.categories.map((c) => listingPage(ctx, `/category/${c.slug}`, categoryMeta(c, locale))),
    ...site.brands.map((b) =>
      listingPage(
        ctx,
        `/brand/${b.slug}`,
        brandMeta(b, locale, (brand) => t('catalog.brandTitle', { brand })),
      ),
    ),
    ...site.entries.map((e) => entryPage(ctx, e)),
    ...site.offers.map((o) => offerPage(ctx, o)),
    ...site.legal.map((k) => legalPage(ctx, k)),
  ];
}

// ── document ───────────────────────────────────────────────────────────────

/** Static page chrome; hidden once JavaScript runs (the SPA renders the real header/footer). */
const PRERENDER_STYLE = `<style>
      .js .pr { display: none; }
      html:not(.js) .boot { display: none; }
      .pr { font-family: system-ui, sans-serif; color: #0b0b0c; line-height: 1.6; }
      .pr a { color: inherit; }
      .pr-head, .pr-main, .pr-foot { max-width: 1120px; margin: 0 auto; padding: 16px; }
      .pr-head ul, .pr-links, .pr-grid, .pr-crumbs { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .pr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
      .pr-grid img, .pr-main > img { max-width: 100%; height: auto; display: block; }
      .pr-main > img { width: min(100%, 28rem); }
      .pr-grid a { display: grid; gap: 4px; text-decoration: none; }
      .pr-links { flex-direction: column; }
      .pr-links span { display: block; color: #55565a; }
      .pr-crumbs li + li::before { content: "/"; margin-inline-end: 16px; color: #55565a; }
      .pr-lead { font-size: 1.125rem; }
      .pr-note { color: #55565a; }
      .pr-price { font-weight: 600; }
      .pr-foot { border-top: 1px solid #e3e3e6; }
    </style>
    <script>document.documentElement.classList.add('js')</script>`;

function renderBody(ctx: Ctx, page: Page, alternatePath: string) {
  const { t, site, locale } = ctx;
  const { brand, navigation, store } = site.settings;
  const nav = navigation.primary
    .filter((i) => i.visible && i.href.startsWith('/'))
    .map(
      (i) =>
        `<li><a href="${href(ctx, i.href)}">${esc(resolveLocalized(i.label, locale))}</a></li>`,
    )
    .join('');
  const crumbs = page.crumbs
    ? `<nav aria-label="${esc(t('catalog.breadcrumb'))}"><ol class="pr-crumbs">${page.crumbs
        .map((c) =>
          c.href
            ? `<li><a href="${href(ctx, c.href)}">${esc(c.label)}</a></li>`
            : `<li aria-current="page">${esc(c.label)}</li>`,
        )
        .join('')}</ol></nav>`
    : '';
  const other = otherLocale(locale);
  const branches = store.branches
    .map(
      (b) =>
        `<p><strong>${esc(resolveLocalized(b.name, locale))}</strong><br />${esc(
          resolveLocalized(b.address, locale),
        )}, ${esc(resolveLocalized(b.city, locale))}<br />${b.phones
          .map((p) => `<a href="tel:${esc(p)}" dir="ltr">${esc(p)}</a>`)
          .join(' · ')}</p>`,
    )
    .join('');
  const demo =
    site.mode === 'demo'
      ? `<p class="pr-note">${esc(t('dataMode.demoBanner'))} — ${esc(t('dataMode.demoBannerDetail'))}</p>`
      : '';
  return `<div class="pr">
      <header class="pr-head">
        <a href="${href(ctx, '/')}"><strong>${esc(brand.name)}</strong></a>
        <nav aria-label="${esc(t('common.mainNavigation'))}"><ul>${nav}</ul></nav>
        <a href="${esc(localizePath(alternatePath, other))}" hreflang="${HTML_LANG[other]}" lang="${HTML_LANG[other]}">${esc(t('common.switchToOther'))}</a>
      </header>
      <main class="pr-main">
        ${demo}${crumbs}
        <h1>${esc(page.heading)}</h1>
        ${page.body}
      </main>
      <footer class="pr-foot"><h2>${esc(t('footer.visit'))}</h2>${branches}</footer>
    </div>`;
}

/** Remove the template's default title / description / Open Graph tags (the page head replaces them). */
function stripDefaultHead(template: string) {
  return template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/>\s*/, '')
    .replace(/<meta\s+property="og:[^"]+"[^>]*\/>\s*/g, '');
}

export function renderDocument(template: string, head: string, body: string, locale: Locale) {
  if (!/<html lang="ar" dir="rtl">/.test(template) || !template.includes('<div id="root">'))
    throw new Error('generate-site: unexpected index.html template');
  let html = stripDefaultHead(template);
  // The Arabic font preload only helps Arabic pages.
  if (locale !== 'ar') html = html.replace(/\s*<link [^>]*data-locale="ar"[^>]*>/g, '');
  return html
    .replace(
      '<html lang="ar" dir="rtl">',
      `<html lang="${HTML_LANG[locale]}" dir="${LOCALE_META[locale].dir}">`,
    )
    .replace('</head>', `    ${head}\n    ${PRERENDER_STYLE}\n  </head>`)
    .replace('<div id="root">', `<div id="root">\n      ${body}`);
}

function fileFor(path: string) {
  // "/en/store" → en/store.html: static hosts (and `vite preview`) serve /en/store from it.
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}.html` : 'index.html';
}

export function generateSite({
  template,
  config,
  site,
}: {
  template: string;
  config: AppConfig;
  site: SiteData;
}): { files: GeneratedFile[]; report: SiteReport } {
  const origin = config.siteUrl;
  const { seo, page_seo: pageSeo, brand } = site.settings;
  const [indexable, reason] =
    site.mode === 'demo'
      ? [false, 'Demo deployment: never indexed.']
      : !origin
        ? [
            false,
            'VITE_SITE_URL is not set: indexing stays off until the public URL is configured.',
          ]
        : !seo.allowIndexing
          ? [false, 'Indexing is switched off in Admin → SEO (seo.allowIndexing).']
          : [true, 'Live store: public pages are open to search engines.'];

  const files: GeneratedFile[] = [];
  const sitemap: SitemapEntry[] = [];
  const problems: string[] = [];

  for (const locale of LOCALES) {
    const ctx: Ctx = { locale, t: translator(locale), site, origin };
    for (const page of pagesFor(ctx)) {
      const resolved = resolveSeo({
        locale,
        seo,
        override: page.seoPage ? pageSeo.pages[page.seoPage] : null,
        title: page.title,
        description: page.description,
        image: page.image,
        sectionImage: sectionShareImage(page.sections),
      });
      const jsonLd = (page.jsonLd ?? []).filter((n): n is JsonLd => n !== null);
      for (const node of jsonLd)
        problems.push(
          ...validateJsonLd(node).map((p) => `${localizePath(page.path, locale)}: ${p}`),
        );
      const head = buildPageHead({
        resolved,
        locale,
        path: page.path,
        origin,
        siteName: brand.name,
        type: page.type ?? 'website',
        noIndex: page.noIndex ?? false,
        demo: site.mode === 'demo',
        allowIndexing: seo.allowIndexing,
        localize: localizePath,
        htmlLang: HTML_LANG,
        jsonLd,
      });
      const html = renderDocument(
        template,
        renderPageHead(head),
        renderBody(ctx, page, page.path),
        locale,
      );
      files.push({ file: fileFor(localizePath(page.path, locale)), content: html });
      if (locale === 'ar' && indexable && !page.noIndex) {
        const route = STATIC_ROUTES.find((r) => r.path === page.path);
        sitemap.push({
          path: page.path,
          lastmod: site.lastmod.get(page.path) ?? null,
          changefreq: route?.changefreq ?? 'weekly',
          priority: route?.priority ?? (page.path.startsWith('/product/') ? 0.8 : 0.6),
        });
      }
    }
  }
  if (problems.length > 0)
    throw new Error(`generate-site: invalid structured data\n  ${problems.join('\n  ')}`);

  files.push({
    file: 'sitemap.xml',
    content: buildSitemap(origin ?? '', indexable ? sitemap : [], indexable ? undefined : reason),
  });
  files.push({
    file: 'robots.txt',
    content: buildRobots({
      indexable,
      sitemapUrl: indexable && origin ? `${origin}/sitemap.xml` : null,
      reason,
    }),
  });
  return {
    files,
    report: {
      mode: site.mode,
      indexable,
      reason,
      pages: files.length - 2,
      sitemapUrls: indexable ? sitemap.length * LOCALES.length : 0,
    },
  };
}
