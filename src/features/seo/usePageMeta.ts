import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { PageSection } from '@/domain/content/types';
import { resolveSeo, robotsContent, sectionShareImage, seoUrls } from '@/domain/seo/pageSeo';
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

function setJsonLd(data: object[] | undefined) {
  document.getElementById(JSON_LD_ID)?.remove();
  if (!data || data.length === 0) return;
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = JSON_LD_ID;
  // JSON.stringify output is data; "<" is escaped so it can never close the script element.
  script.textContent = JSON.stringify(data.length === 1 ? data[0] : data).replace(/</g, '\\u003c');
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
 * canonical and hreflang alternates. Crawlers that don't execute JS only see index.html defaults —
 * Phase 08 adds prerendering of public pages and the sitemap (see docs/ARCHITECTURE.md, SEO).
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
  // Demo deployments are previews: robots always noindex (canonical/hreflang still describe the page).
  const robotsNoIndex = noIndex || mode === 'demo';
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : '';
  const location = useLocation();

  useEffect(() => {
    const origin = config.siteUrl ?? window.location.origin;
    const { path } = parseLocalePath(location.pathname);

    document.title = fullTitle;
    upsertMeta('name', 'description', metaDescription);
    upsertMeta('name', 'robots', robotsContent(robotsNoIndex, seo.allowIndexing));
    upsertMeta('property', 'og:title', fullTitle);
    upsertMeta('property', 'og:description', metaDescription);
    upsertMeta('property', 'og:site_name', brand.name);
    upsertMeta('property', 'og:locale', locale === 'ar' ? 'ar_EG' : 'en_US');
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:url', `${origin}${localizePath(path, locale)}`);
    upsertMeta('property', 'og:image', new URL(image, `${origin}/`).toString());
    setJsonLd(jsonLdKey ? (JSON.parse(jsonLdKey) as object[]) : undefined);
    if (noIndex) {
      // Non-indexable pages (account, admin, placeholders) advertise no canonical/alternate URLs.
      for (const link of document.head.querySelectorAll(
        'link[rel="canonical"], link[rel="alternate"]',
      )) {
        link.remove();
      }
      return;
    }
    const urls = seoUrls(origin, path, locale, localizePath, HTML_LANG);
    upsertLink('canonical', urls.canonical);
    for (const alternate of urls.alternates)
      upsertLink('alternate', alternate.href, alternate.hreflang);
  }, [
    fullTitle,
    metaDescription,
    noIndex,
    robotsNoIndex,
    image,
    type,
    jsonLdKey,
    seo,
    brand.name,
    locale,
    config.siteUrl,
    location.pathname,
  ]);

  useEffect(() => () => setJsonLd(undefined), []);
}
