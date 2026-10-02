import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { PageSection } from '@/domain/content/types';
import { buildPageHead } from '@/domain/seo/pageHead';
import { resolveSeo, sectionShareImage } from '@/domain/seo/pageSeo';
import { serializeJsonLd, type JsonLd } from '@/domain/seo/structuredData';
import { useSettings } from '@/features/settings/context';
import { LOCALE_META, LOCALES, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/context';
import { localizePath, parseLocalePath } from '@/i18n/paths';
import { useRuntime } from '@/runtime/context';

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertLink(rel: string, href: string, hreflang?: string) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement('link');
    element.rel = rel;
    if (hreflang) element.hreflang = hreflang;
    document.head.appendChild(element);
  }
  element.href = href;
}

const JSON_LD_ID = 'page-json-ld';

export const HTML_LANG = Object.fromEntries(
  LOCALES.map((l) => [l, LOCALE_META[l].htmlLang]),
) as Record<Locale, string>;

function setJsonLd(data: JsonLd[] | undefined) {
  document.getElementById(JSON_LD_ID)?.remove();
  if (!data || data.length === 0) return;
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = JSON_LD_ID;
  // Serialized data with "<" escaped, so it can never close the script element.
  script.textContent = serializeJsonLd(data);
  document.head.appendChild(script);
}

interface PageMeta {
  /** Page title; omitted → the site default title. */
  title?: string;
  description?: string;
  noIndex?: boolean;
  /** Absolute or root-relative image for Open Graph. */
  image?: string;
  /** Open Graph type (default "website"). */
  type?: 'website' | 'product' | 'article';
  /** Structured data (schema.org JSON-LD) for this page. */
  jsonLd?: object[];
  /** Editable page whose per-page SEO (Site Editor → `page_seo`) overrides the defaults above. */
  seoPage?: 'home' | 'apple' | 'offers';
  /** The page's sections: an image banner can supply the share image (see `sectionShareImage`). */
  sections?: readonly PageSection[];
}

/**
 * Route-aware metadata for the client-rendered SPA: title, description, robots, Open Graph,
 * canonical and hreflang alternates. Public pages are also prerendered at build time with the same
 * head (src/build/generateSite.ts), so crawlers that don't execute JS see it too.
 */
export function usePageMeta({
  title: pageTitle,
  description: pageDescription,
  noIndex = false,
  image: pageImage,
  type = 'website',
  jsonLd,
  seoPage,
  sections,
}: PageMeta) {
  const { seo, brand, page_seo: pageSeo } = useSettings();
  const { locale } = useI18n();
  // Same resolver as the Site Editor's SEO preview (src/domain/seo/pageSeo.ts).
  const resolved = resolveSeo({
    locale,
    seo,
    override: seoPage ? pageSeo.pages[seoPage] : null,
    title: pageTitle,
    description: pageDescription,
    image: pageImage,
    sectionImage: sectionShareImage(sections),
  });
  const { title: fullTitle, description: metaDescription, image } = resolved;
  const { config, mode } = useRuntime();
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : '';
  const location = useLocation();

  useEffect(() => {
    const origin = config.siteUrl ?? window.location.origin;
    const { path } = parseLocalePath(location.pathname);
    // Same head as the build-time prerenderer writes (src/domain/seo/pageHead.ts).
    const head = buildPageHead({
      resolved: { title: fullTitle, description: metaDescription, image },
      locale,
      path,
      origin,
      siteName: brand.name,
      type,
      noIndex,
      demo: mode === 'demo',
      allowIndexing: seo.allowIndexing,
      localize: localizePath,
      htmlLang: HTML_LANG,
      jsonLd: jsonLdKey ? (JSON.parse(jsonLdKey) as JsonLd[]) : undefined,
    });

    document.title = head.title;
    for (const m of head.meta) upsertMeta(m.attr, m.key, m.content);
    setJsonLd(head.jsonLd);
    if (!head.urls) {
      // Non-indexable pages (account, admin, placeholders) advertise no canonical/alternate URLs.
      for (const link of document.head.querySelectorAll(
        'link[rel="canonical"], link[rel="alternate"]',
      )) {
        link.remove();
      }
      return;
    }
    upsertLink('canonical', head.urls.canonical);
    for (const alternate of head.urls.alternates)
      upsertLink('alternate', alternate.href, alternate.hreflang);
  }, [
    fullTitle,
    metaDescription,
    noIndex,
    mode,
    image,
    type,
    jsonLdKey,
    seo.allowIndexing,
    brand.name,
    locale,
    config.siteUrl,
    location.pathname,
  ]);

  useEffect(() => () => setJsonLd(undefined), []);
}
