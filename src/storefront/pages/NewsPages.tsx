import { Newspaper } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { CONTENT_TYPES, type ContentType } from '@/domain/content/types';
import { resolveLocalized } from '@/domain/localized';
import { breadcrumbJsonLd } from '@/features/seo/structuredData';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { useIsDemoMode, useRuntime } from '@/runtime/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { EntryCard } from '../components/EntryCard';
import { CONTENT_TYPE_LABEL } from '../components/links';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import { useEntries, useEntry } from '../data/hooks';
import styles from './contentPages.module.css';
import { BidiText } from '@/components/text/BidiText';

/** "Malek updates": campaigns, new releases, coming soon, offer updates and news, filterable by type. */
export function NewsPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const raw = params.get('type');
  const type = CONTENT_TYPES.includes(raw as ContentType) ? (raw as ContentType) : null;
  const { data, isPending, isError } = useEntries(type ? { types: [type] } : {});
  usePageMeta({
    title: t('content.newsTitle'),
    description: t('content.newsSubtitle'),
    noIndex: type !== null,
  });

  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs
        items={[{ label: t('common.home'), href: '/' }, { label: t('content.newsTitle') }]}
      />
      <header className={styles.head}>
        <h1 className={styles.title}>{t('content.newsTitle')}</h1>
        <p className={styles.subtitle}>{t('content.newsSubtitle')}</p>
      </header>
      <nav aria-label={t('content.filterLabel')}>
        <ul className={styles.jump}>
          <li>
            <LocaleLink
              to="/news"
              className={styles.tab}
              aria-current={type === null ? 'page' : undefined}
            >
              {t('content.filterAll')}
            </LocaleLink>
          </li>
          {CONTENT_TYPES.map((value) => (
            <li key={value}>
              <LocaleLink
                to={`/news?type=${value}`}
                className={styles.tab}
                aria-current={type === value ? 'page' : undefined}
              >
                {t(CONTENT_TYPE_LABEL[value])}
              </LocaleLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.section}>
        {isPending ? (
          <ProductGridSkeleton count={6} columns={3} />
        ) : isError ? (
          <StateMessage icon={<Newspaper />} title={t('content.loadError')} role="alert" />
        ) : data.length === 0 ? (
          <StateMessage icon={<Newspaper />} title={t('content.empty')} />
        ) : (
          <ul className={styles.grid}>
            {data.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} headingLevel={2} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EntryPage() {
  const { slug = '' } = useParams();
  const { t, locale, format } = useI18n();
  const { config } = useRuntime();
  const isDemo = useIsDemoMode();
  const { data: entry, isPending, isError } = useEntry(slug);
  const title = entry ? resolveLocalized(entry.title, locale) : t('content.notFoundTitle');
  const crumbs = [
    { label: t('common.home'), href: '/' },
    { label: t('content.newsTitle'), href: '/news' },
    { label: title },
  ];
  usePageMeta({
    title: entry?.seo.title ? resolveLocalized(entry.seo.title, locale) : title,
    description: entry?.seo.description
      ? resolveLocalized(entry.seo.description, locale)
      : entry?.excerpt
        ? resolveLocalized(entry.excerpt, locale)
        : undefined,
    noIndex: !entry,
    type: 'article',
    image: entry?.media?.kind === 'image' ? entry.media.url : undefined,
    jsonLd: entry
      ? [
          breadcrumbJsonLd(crumbs, { origin: config.siteUrl ?? window.location.origin, locale }),
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: title,
            datePublished: entry.publishAt,
            ...(entry.expiresAt ? { expires: entry.expiresAt } : {}),
          },
        ]
      : undefined,
  });

  if (isPending) {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <ProductGridSkeleton count={3} columns={3} />
      </div>
    );
  }
  if (isError || !entry) {
    return (
      <div className={`container ${styles.page}`}>
        <StateMessage
          icon={<Newspaper />}
          headingLevel={1}
          title={isError ? t('content.loadError') : t('content.notFoundTitle')}
          body={isError ? undefined : t('content.notFoundBody')}
          role={isError ? 'alert' : undefined}
          actions={
            <ButtonLink to="/news" variant="primary">
              {t('content.newsTitle')}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs items={crumbs} />
      <article>
        <div className={styles.detail}>
          <div className={styles.detailMedia}>
            {entry.media?.kind === 'video' ? (
              // Captions are attached whenever the entry media has a WebVTT file.
              // eslint-disable-next-line jsx-a11y-x/media-has-caption
              <video
                src={entry.media.url}
                poster={entry.media.posterUrl ?? undefined}
                controls
                preload="none"
                playsInline
                aria-label={resolveLocalized(entry.media.alt, locale)}
              >
                {entry.media.captionsUrl && (
                  <track kind="captions" src={entry.media.captionsUrl} srcLang={locale} default />
                )}
              </video>
            ) : entry.media ? (
              <img
                src={entry.media.url}
                alt={resolveLocalized(entry.media.alt, locale)}
                width={800}
                height={800}
              />
            ) : null}
          </div>
          <div className={styles.detailBody}>
            <p className={styles.meta}>
              <span className={styles.eyebrow}>{t(CONTENT_TYPE_LABEL[entry.type])}</span>
              <time dateTime={entry.publishAt}>
                {t('content.publishedOn', { date: format.date(entry.publishAt) })}
              </time>
              {entry.releaseDate && (
                <span>{t('content.releaseOn', { date: format.date(entry.releaseDate) })}</span>
              )}
            </p>
            <h1 className={styles.title}>
              <BidiText text={title} />
            </h1>
            {entry.subtitle && (
              <p className={styles.subtitle}>{resolveLocalized(entry.subtitle, locale)}</p>
            )}
            {entry.body && (
              <div className={styles.prose}>
                {resolveLocalized(entry.body, locale)
                  .split(/\n{2,}/)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            )}
            {isDemo && entry.isDemo && <p className={styles.demoNote}>{t('content.demoNote')}</p>}
            {(entry.cta || entry.secondaryCta) && (
              <div className={styles.actions}>
                {entry.cta && (
                  <ButtonLink to={entry.cta.href} variant="accent" size="lg">
                    {resolveLocalized(entry.cta.label, locale)}
                  </ButtonLink>
                )}
                {entry.secondaryCta && (
                  <ButtonLink to={entry.secondaryCta.href} variant="secondary" size="lg">
                    {resolveLocalized(entry.secondaryCta.label, locale)}
                  </ButtonLink>
                )}
              </div>
            )}
          </div>
        </div>
      </article>
      {entry.products.length > 0 && (
        <section className={styles.section} aria-labelledby="entry-products">
          <SectionHeading id="entry-products" title={t('content.related')} />
          <ProductGrid products={entry.products} />
        </section>
      )}
    </div>
  );
}
