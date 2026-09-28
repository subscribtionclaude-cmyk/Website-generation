import { describe, expect, it } from 'vitest';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import { localizePath } from '@/i18n/paths';
import {
  DEFAULT_SHARE_IMAGE,
  resolveSeo,
  robotsContent,
  sectionShareImage,
  seoUrls,
} from './pageSeo';

const seo = BASE_SETTINGS.seo;
const lt = (ar: string, en = '') => ({ ar, en });
const banner = (url: string, isVisible = true) => ({
  type: 'media_banner',
  isVisible,
  props: { images: [{ url, alt: lt('صورة') }] },
});

describe('page SEO resolver (shared by the storefront and the Site Editor preview)', () => {
  it('falls back from page setting → page default → site default', () => {
    const site = resolveSeo({ locale: 'ar', seo });
    expect(site.title).toBe(seo.defaultTitle.ar);
    expect(site).toMatchObject({
      titleSource: 'site',
      descriptionSource: 'site',
      imageSource: 'site',
    });
    expect(site.image).toBe(seo.ogImage ?? DEFAULT_SHARE_IMAGE);

    const page = resolveSeo({ locale: 'en', seo, title: 'Offers', description: 'All offers' });
    expect(page.title).toBe((seo.titleTemplate.en ?? '').replace('%s', 'Offers'));
    expect(page).toMatchObject({ titleSource: 'default', description: 'All offers' });

    const own = resolveSeo({
      locale: 'en',
      seo,
      title: 'Offers',
      override: {
        title: lt('عروض', 'Deals'),
        description: lt('وصف', 'Deals desc'),
        ogImage: '/og.png',
      },
    });
    expect(own.title).toBe((seo.titleTemplate.en ?? '').replace('%s', 'Deals'));
    expect(own).toMatchObject({
      titleSource: 'page',
      description: 'Deals desc',
      descriptionSource: 'page',
      image: '/og.png',
      imageSource: 'page',
    });
  });

  it('English falls back to the Arabic page title when English is empty', () => {
    const r = resolveSeo({
      locale: 'en',
      seo,
      override: { title: lt('آبل'), description: null, ogImage: null },
    });
    expect(r.title).toContain('آبل');
  });

  it("uses the page's first visible image banner as the share image (never demo data URLs)", () => {
    expect(
      sectionShareImage([banner('/brand/a.png', false), banner('https://cdn.example/b.webp')]),
    ).toBe('https://cdn.example/b.webp');
    expect(sectionShareImage([banner('data:image/png;base64,AA')])).toBeNull();
    expect(sectionShareImage([banner('//evil.example/x.png')])).toBeNull();
    const r = resolveSeo({ locale: 'ar', seo, sectionImage: '/brand/banner.png' });
    expect(r).toMatchObject({ image: '/brand/banner.png', imageSource: 'section' });
  });

  it('canonical + hreflang alternates per language, Arabic as x-default', () => {
    const lang = { ar: 'ar-EG', en: 'en' } as const;
    const ar = seoUrls('https://malek.example', '/apple', 'ar', localizePath, lang);
    const en = seoUrls('https://malek.example', '/apple', 'en', localizePath, lang);
    expect(ar.canonical).toBe('https://malek.example/apple');
    expect(en.canonical).toBe('https://malek.example/en/apple');
    expect(en.alternates).toEqual([
      { hreflang: 'ar-EG', href: 'https://malek.example/apple' },
      { hreflang: 'en', href: 'https://malek.example/en/apple' },
      { hreflang: 'x-default', href: 'https://malek.example/apple' },
    ]);
    expect(robotsContent(false, true)).toBe('index, follow');
    expect(robotsContent(true, true)).toBe('noindex, nofollow');
    expect(robotsContent(false, false)).toBe('noindex, nofollow');
  });
});
