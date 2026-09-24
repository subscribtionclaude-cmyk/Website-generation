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

interface PageMeta {
  /** Page title; omitted → the site default title. */
  title?: string;
  description?: string;
  noIndex?: boolean;
}

/**
 * Route-aware metadata for the client-rendered SPA: title, description, robots, Open Graph,
 * canonical and hreflang alternates. Crawlers that don't execute JS only see index.html defaults —
 * Phase 08 adds prerendering of public pages and the sitemap (see docs/ARCHITECTURE.md, SEO).
 */
export function usePageMeta({ title, description, noIndex = false }: PageMeta) {
  const { seo, brand } = useSettings();
  const { locale } = useI18n();
  const { config } = useRuntime();
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
      noIndex || !seo.allowIndexing ? 'noindex, nofollow' : 'index, follow',
    );
    upsertMeta('property', 'og:title', fullTitle);
    upsertMeta('property', 'og:description', metaDescription);
    upsertMeta('property', 'og:site_name', brand.name);
    upsertMeta('property', 'og:locale', locale === 'ar' ? 'ar_EG' : 'en_US');
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
  }, [title, description, noIndex, seo, brand.name, locale, config.siteUrl, location.pathname]);
}
