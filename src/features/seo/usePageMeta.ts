import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { LOCALE_META, LOCALES } from '@/i18n/config';
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
}

/**
 * Route-aware metadata for the client-rendered SPA: title, description, robots, Open Graph,
 * canonical and hreflang alternates. Crawlers that don't execute JS only see index.html defaults —
 * Phase 08 adds prerendering of public pages and the sitemap (see docs/ARCHITECTURE.md, SEO).
 */
export function usePageMeta({
  title,
  description,
  noIndex = false,
  image,
  type = 'website',
  jsonLd,
}: PageMeta) {
  const { seo, brand } = useSettings();
  const { locale } = useI18n();
  const { config, mode } = useRuntime();
  // Demo deployments are previews: robots always noindex (canonical/hreflang still describe the page).
  const robotsNoIndex = noIndex || mode === 'demo';
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : '';
  const location = useLocation();

  useEffect(() => {
    const fullTitle = title
      ? resolveLocalized(seo.titleTemplate, locale).replace('%s', title)
      : resolveLocalized(seo.defaultTitle, locale);
    const metaDescription = description ?? resolveLocalized(seo.defaultDescription, locale);
    const origin = config.siteUrl ?? window.location.origin;
    const { path } = parseLocalePath(location.pathname);

    document.title = fullTitle;
    upsertMeta('name', 'description', metaDescription);
    upsertMeta(
      'name',
      'robots',
      robotsNoIndex || !seo.allowIndexing ? 'noindex, nofollow' : 'index, follow',
    );
    upsertMeta('property', 'og:title', fullTitle);
    upsertMeta('property', 'og:description', metaDescription);
    upsertMeta('property', 'og:site_name', brand.name);
    upsertMeta('property', 'og:locale', locale === 'ar' ? 'ar_EG' : 'en_US');
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:url', `${origin}${localizePath(path, locale)}`);
    upsertMeta(
      'property',
      'og:image',
      new URL(image ?? '/brand/og-default.png', `${origin}/`).toString(),
    );
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
    upsertLink('canonical', `${origin}${localizePath(path, locale)}`);
    for (const alternate of LOCALES) {
      upsertLink(
        'alternate',
        `${origin}${localizePath(path, alternate)}`,
        LOCALE_META[alternate].htmlLang,
      );
    }
    upsertLink('alternate', `${origin}${localizePath(path, 'ar')}`, 'x-default');
  }, [
    title,
    description,
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
