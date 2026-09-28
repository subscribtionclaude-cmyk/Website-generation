import { useId, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { PageSeoSettings, SeoSettings } from '@/domain/settings/schemas';
import {
  resolveSeo,
  robotsContent,
  sectionShareImage,
  seoUrls,
  type ResolvedSeo,
  type SeoSource,
} from '@/domain/seo/pageSeo';
import type { EditablePage, LayoutSection } from '@/domain/siteEditor/schemas';
import { HTML_LANG } from '@/features/seo/usePageMeta';
import type { Locale } from '@/i18n/config';
import { ar } from '@/i18n/messages/ar';
import { en } from '@/i18n/messages/en';
import { localizePath } from '@/i18n/paths';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import ui from '../../ui/adminUi.module.css';
import { STOREFRONT_PATH } from './editorState';
import styles from './siteEditor.module.css';

/** Search engines typically show ~60 title and ~160 description characters. */
const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

/** Working or published values of the two SEO settings (unvalidated editor state). */
interface PageSettings {
  seo?: SeoSettings;
  page_seo?: PageSeoSettings;
}

const MESSAGES = { ar, en } as const;

/** The page's own title / description, exactly as the storefront page passes them. */
function pageDefaults(page: EditablePage, locale: Locale) {
  const m = MESSAGES[locale];
  if (page === 'apple') return { title: m.apple.title, description: m.apple.description };
  if (page === 'offers') return { title: m.offers.title, description: m.offers.subtitle };
  return {};
}

function resolveFor(
  page: EditablePage,
  locale: Locale,
  settings: PageSettings,
  layout: readonly LayoutSection[],
): ResolvedSeo | null {
  if (!settings.seo) return null;
  return resolveSeo({
    locale,
    seo: settings.seo,
    override: settings.page_seo?.pages[page] ?? null,
    ...pageDefaults(page, locale),
    sectionImage: sectionShareImage(layout),
  });
}

const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;

/**
 * SEO preview for Home / Apple / Offers in Arabic and English: search result, social share card,
 * canonical + hreflang + robots. Computed with the storefront's own resolver
 * (src/domain/seo/pageSeo.ts) from the working `seo` / `page_seo` settings and the page's sections,
 * next to what is published now. Nothing here is stored separately.
 */
export function SeoPreview({
  page,
  working,
  workingLayout,
  published,
  publishedLayout,
}: {
  page: EditablePage;
  working: PageSettings;
  workingLayout: readonly LayoutSection[];
  published: PageSettings;
  publishedLayout: readonly LayoutSection[];
}) {
  const { at } = useAdminI18n();
  const { config, mode } = useRuntime();
  const name = useId();
  const [locale, setLocale] = useState<Locale>('ar');
  const draft = resolveFor(page, locale, working, workingLayout);
  const live = resolveFor(page, locale, published, publishedLayout);
  if (!draft) return null;
  const origin = config.siteUrl ?? window.location.origin;
  const host = new URL(origin).host;
  const path = STOREFRONT_PATH[page];
  const urls = seoUrls(origin, path, locale, localizePath, HTML_LANG);
  const robots = robotsContent(mode === 'demo', working.seo?.allowIndexing ?? false);
  const imageUrl = new URL(draft.image, `${origin}/`).toString();
  const override = working.page_seo?.pages[page];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const warnings: string[] = [];
  if (draft.title.length > TITLE_LIMIT)
    warnings.push(at('siteEditor.seoPreview.titleLong', { count: draft.title.length }));
  if (draft.description.length > DESCRIPTION_LIMIT)
    warnings.push(at('siteEditor.seoPreview.descLong', { count: draft.description.length }));
  if (draft.description.length < 50) warnings.push(at('siteEditor.seoPreview.descShort'));
  if (locale === 'en' && override?.title && !override.title.en)
    warnings.push(at('siteEditor.seoPreview.enFallback'));
  if (draft.imageSource === 'site' && !working.seo?.ogImage)
    warnings.push(at('siteEditor.seoPreview.defaultImage'));

  const source = (s: SeoSource) => (
    <Badge tone={s === 'page' ? 'brand' : 'neutral'}>
      {at(`siteEditor.seoPreview.source.${s}` as AdminMessageKey)}
    </Badge>
  );
  const changed = (a: string | undefined, b: string | undefined) => live !== null && a !== b;

  return (
    <section className={styles.seoPreview} aria-labelledby={`${name}-h`}>
      <div className={styles.paneHead}>
        <h3 id={`${name}-h`} className={styles.panelTitle}>
          {at('siteEditor.seoPreview.title', {
            page: at(`sectionsAdmin.page.${page}` as AdminMessageKey),
          })}
        </h3>
        <fieldset className={styles.segmented}>
          <legend className="visually-hidden">{at('siteEditor.seoPreview.language')}</legend>
          {(['ar', 'en'] as const).map((l) => (
            <label key={l} className={styles.segment}>
              <input
                type="radio"
                name={`${name}-lang`}
                checked={locale === l}
                onChange={() => setLocale(l)}
              />
              <span lang={l}>{l === 'ar' ? 'العربية' : 'English'}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <h4 className={styles.seoLabel}>{at('siteEditor.seoPreview.search')}</h4>
      <div className={styles.serp} dir={dir} lang={locale} data-testid="seo-serp">
        <span className={styles.serpUrl} dir="ltr">
          {host} › {localizePath(path, locale)}
        </span>
        <span className={styles.serpTitle}>{cut(draft.title, TITLE_LIMIT)}</span>
        <span className={styles.serpDesc}>{cut(draft.description, DESCRIPTION_LIMIT)}</span>
      </div>
      <p className={ui.small}>
        {at('siteEditor.seoPreview.titleMeta', { count: draft.title.length })}{' '}
        {source(draft.titleSource)} ·{' '}
        {at('siteEditor.seoPreview.descMeta', { count: draft.description.length })}{' '}
        {source(draft.descriptionSource)}
      </p>

      <h4 className={styles.seoLabel}>{at('siteEditor.seoPreview.social')}</h4>
      <div className={styles.shareCard} dir={dir} lang={locale} data-testid="seo-share">
        <img src={imageUrl} alt="" className={styles.shareImage} />
        <div className={styles.shareText}>
          <span className={styles.serpUrl} dir="ltr">
            {host.toUpperCase()}
          </span>
          <strong>{draft.title}</strong>
          <span>{cut(draft.description, 110)}</span>
        </div>
      </div>
      <p className={ui.small}>
        {at('siteEditor.seoPreview.image')} {source(draft.imageSource)}
      </p>

      <h4 className={styles.seoLabel}>{at('siteEditor.seoPreview.urls')}</h4>
      <dl className={styles.seoUrls} data-testid="seo-urls">
        <dt>{at('siteEditor.seoPreview.canonical')}</dt>
        <dd dir="ltr">{urls.canonical}</dd>
        {urls.alternates.map((a) => (
          <div key={a.hreflang} className={styles.seoUrlRow}>
            <dt>hreflang {a.hreflang}</dt>
            <dd dir="ltr">{a.href}</dd>
          </div>
        ))}
        <dt>robots</dt>
        <dd dir="ltr">
          {robots}
          {mode === 'demo' && (
            <span className={ui.small}> — {at('siteEditor.seoPreview.demoNoindex')}</span>
          )}
        </dd>
      </dl>

      {warnings.length > 0 && (
        <ul className={styles.seoWarnings} aria-label={at('siteEditor.seoPreview.checks')}>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {live &&
        (changed(draft.title, live.title) ||
          changed(draft.description, live.description) ||
          changed(draft.image, live.image)) && (
          <div className={styles.seoLive}>
            <strong>{at('siteEditor.seoPreview.publishedNow')}</strong>
            <span dir={dir} lang={locale}>
              {live.title}
            </span>
            <span className={ui.small} dir={dir} lang={locale}>
              {cut(live.description, DESCRIPTION_LIMIT)}
            </span>
          </div>
        )}
    </section>
  );
}
