import { Skeleton } from '@/components/feedback/Skeleton';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { ContentEntry } from '@/domain/content/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { CONTENT_TYPE_LABEL, entryHref } from './links';
import styles from './content.module.css';
import catalogStyles from './catalog.module.css';
import { BidiText } from '@/components/text/BidiText';

export function EntryCard({
  entry,
  headingLevel = 3,
}: {
  entry: ContentEntry;
  headingLevel?: 2 | 3 | 4;
}) {
  const { t, locale, format } = useI18n();
  const Heading = `h${headingLevel}` as const;
  return (
    <article className={styles.entry}>
      <div className={styles.entryMedia}>
        {entry.media?.kind === 'image' && (
          <img
            src={entry.media.url}
            alt={resolveLocalized(entry.media.alt, locale)}
            width={800}
            height={800}
            loading="lazy"
            decoding="async"
          />
        )}
      </div>
      <div className={styles.entryBody}>
        <p className={styles.entryMeta}>
          <span className={styles.entryType}>{t(CONTENT_TYPE_LABEL[entry.type])}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={entry.publishAt}>{format.date(entry.publishAt)}</time>
        </p>
        <Heading className={styles.entryTitle}>
          <LocaleLink to={entryHref(entry)} className={catalogStyles.cardLink}>
            <BidiText text={resolveLocalized(entry.title, locale)} />
          </LocaleLink>
        </Heading>
        {(entry.excerpt ?? entry.subtitle) && (
          <p className={styles.entryExcerpt}>
            {resolveLocalized(entry.excerpt ?? entry.subtitle, locale)}
          </p>
        )}
      </div>
    </article>
  );
}

/** Loading placeholder with an entry card's shape (16:10 media + meta, title, excerpt). */
export function EntryCardSkeleton() {
  return (
    <div className={styles.entry} aria-hidden="true">
      <div className={styles.entryMedia} />
      <div className={styles.entryBody}>
        <Skeleton width="45%" height="0.8rem" />
        <Skeleton width="90%" height="1.25rem" />
        <Skeleton width="70%" height="1.25rem" />
        <Skeleton width="100%" height="0.9rem" />
        <Skeleton width="80%" height="0.9rem" />
      </div>
    </div>
  );
}
