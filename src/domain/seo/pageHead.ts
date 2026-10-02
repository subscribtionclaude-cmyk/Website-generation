import type { Locale } from '@/i18n/config';
import { robotsContent, seoUrls, type ResolvedSeo, type SeoUrls } from './pageSeo';
import { serializeJsonLd, type JsonLd } from './structuredData';

/**
 * The complete set of head tags for one page, computed once and written two ways: into the live
 * document by `usePageMeta`, and as static HTML by the build-time prerenderer
 * (src/build/generateSite.ts). Both therefore always agree.
 */
export interface HeadMeta {
  attr: 'name' | 'property';
  key: string;
  content: string;
}

export interface PageHead {
  title: string;
  meta: HeadMeta[];
  /** Null for non-indexable pages: they advertise no canonical or alternate URLs. */
  urls: SeoUrls | null;
  jsonLd: JsonLd[];
}

export interface PageHeadInput {
  resolved: Pick<ResolvedSeo, 'title' | 'description' | 'image'>;
  locale: Locale;
  /** Unlocalized path (e.g. "/store"). */
  path: string;
  /**
   * Public origin. Null (build without VITE_SITE_URL): no canonical / alternates / og:url and a
   * relative og:image — the SPA sets them at runtime from the page's own origin.
   */
  origin: string | null;
  siteName: string;
  type: 'website' | 'product' | 'article';
  /** The page itself is not indexable (not found, account, search …). */
  noIndex: boolean;
  /** Demo deployments: robots noindex, canonical still describes the page. */
  demo: boolean;
  allowIndexing: boolean;
  localize: (path: string, locale: Locale) => string;
  htmlLang: Record<Locale, string>;
  jsonLd?: JsonLd[];
}

export function buildPageHead(input: PageHeadInput): PageHead {
  const { resolved, locale, path, origin, localize } = input;
  const meta: HeadMeta[] = [
    { attr: 'name', key: 'description', content: resolved.description },
    {
      attr: 'name',
      key: 'robots',
      content: robotsContent(input.noIndex || input.demo, input.allowIndexing),
    },
    { attr: 'property', key: 'og:title', content: resolved.title },
    { attr: 'property', key: 'og:description', content: resolved.description },
    { attr: 'property', key: 'og:site_name', content: input.siteName },
    { attr: 'property', key: 'og:locale', content: locale === 'ar' ? 'ar_EG' : 'en_US' },
    { attr: 'property', key: 'og:type', content: input.type },
  ];
  if (origin) {
    meta.push(
      { attr: 'property', key: 'og:url', content: `${origin}${localize(path, locale)}` },
      { attr: 'property', key: 'og:image', content: new URL(resolved.image, `${origin}/`).href },
    );
  }
  return {
    title: resolved.title,
    meta,
    urls: input.noIndex || !origin ? null : seoUrls(origin, path, locale, localize, input.htmlLang),
    jsonLd: input.jsonLd ?? [],
  };
}

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Static HTML for a page head (the prerenderer's half of `buildPageHead`). */
export function renderPageHead(head: PageHead): string {
  const lines = [
    `<title>${attr(head.title)}</title>`,
    ...head.meta.map((m) => `<meta ${m.attr}="${m.key}" content="${attr(m.content)}" />`),
    ...(head.urls
      ? [
          `<link rel="canonical" href="${attr(head.urls.canonical)}" />`,
          ...head.urls.alternates.map(
            (a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${attr(a.href)}" />`,
          ),
        ]
      : []),
    ...(head.jsonLd.length
      ? [
          `<script type="application/ld+json" id="page-json-ld">${serializeJsonLd(head.jsonLd)}</script>`,
        ]
      : []),
  ];
  return lines.join('\n    ');
}
