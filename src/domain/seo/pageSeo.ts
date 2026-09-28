import type { PageSection } from '@/domain/content/types';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';

/**
 * One resolver for page metadata, shared by the storefront (`usePageMeta`) and the Site Editor's
 * SEO preview, so what the editor shows is exactly what the page will set. Inputs are the existing
 * `seo` and `page_seo` settings plus the page's own sections — there is no separate SEO store.
 */
export type SeoSource = 'page' | 'section' | 'default' | 'site';

export const DEFAULT_SHARE_IMAGE = '/brand/og-default.png';

interface SiteSeo {
  titleTemplate: LocalizedText;
  defaultTitle: LocalizedText;
  defaultDescription: LocalizedText;
  allowIndexing: boolean;
  ogImage?: string | null;
}

interface PageOverride {
  title: LocalizedText | null;
  description: LocalizedText | null;
  ogImage: string | null;
}

export interface SeoInput {
  locale: Locale;
  seo: SiteSeo;
  /** `page_seo.pages[page]` for Home / Apple / Offers (null elsewhere). */
  override?: PageOverride | null;
  /** The page's built-in title / description (e.g. "Offers"); none for Home. */
  title?: string;
  description?: string;
  image?: string;
  /** Share image taken from the page's own sections (first image banner). */
  sectionImage?: string | null;
}

export interface ResolvedSeo {
  /** Full document title (template applied). */
  title: string;
  titleSource: SeoSource;
  description: string;
  descriptionSource: SeoSource;
  image: string;
  imageSource: SeoSource;
}

export function resolveSeo(input: SeoInput): ResolvedSeo {
  const { locale, seo, override } = input;
  const own = override?.title ? resolveLocalized(override.title, locale) : '';
  const pageTitle = own || input.title;
  const title = pageTitle
    ? resolveLocalized(seo.titleTemplate, locale).replace('%s', pageTitle)
    : resolveLocalized(seo.defaultTitle, locale);
  const ownDescription = override?.description
    ? resolveLocalized(override.description, locale)
    : '';
  const description =
    ownDescription || input.description || resolveLocalized(seo.defaultDescription, locale);
  const [image, imageSource]: [string, SeoSource] = override?.ogImage
    ? [override.ogImage, 'page']
    : input.image
      ? [input.image, 'default']
      : input.sectionImage
        ? [input.sectionImage, 'section']
        : seo.ogImage
          ? [seo.ogImage, 'site']
          : [DEFAULT_SHARE_IMAGE, 'site'];
  return {
    title,
    titleSource: own ? 'page' : pageTitle ? 'default' : 'site',
    description,
    descriptionSource: ownDescription ? 'page' : input.description ? 'default' : 'site',
    image,
    imageSource,
  };
}

/**
 * First shareable image of a page's visible image banners (store paths or https only — in-browser
 * demo uploads are never used as share images).
 */
export function sectionShareImage(
  sections: readonly Pick<PageSection, 'type' | 'isVisible' | 'props'>[] | undefined,
): string | null {
  for (const s of sections ?? []) {
    if (s.type !== 'media_banner' || !s.isVisible) continue;
    const url = (s.props as { images?: { url?: unknown }[] }).images?.[0]?.url;
    if (typeof url === 'string' && (/^\/(?!\/)/.test(url) || url.startsWith('https://')))
      return url;
  }
  return null;
}

export interface SeoUrls {
  canonical: string;
  alternates: { hreflang: string; href: string }[];
}

/** Canonical + hreflang alternates (Arabic is x-default), as `usePageMeta` writes them. */
export function seoUrls(
  origin: string,
  path: string,
  locale: Locale,
  localize: (path: string, locale: Locale) => string,
  htmlLang: Record<Locale, string>,
): SeoUrls {
  const locales = Object.keys(htmlLang) as Locale[];
  return {
    canonical: `${origin}${localize(path, locale)}`,
    alternates: [
      ...locales.map((l) => ({ hreflang: htmlLang[l], href: `${origin}${localize(path, l)}` })),
      { hreflang: 'x-default', href: `${origin}${localize(path, 'ar')}` },
    ],
  };
}

export function robotsContent(noIndex: boolean, allowIndexing: boolean) {
  return noIndex || !allowIndexing ? 'noindex, nofollow' : 'index, follow';
}
