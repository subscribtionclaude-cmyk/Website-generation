import { ButtonLink } from '@/components/navigation/ButtonLink';
import type { SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import styles from './sections.module.css';

const TONE = {
  dark: styles.promoDark,
  brand: styles.promoBrand,
  light: styles.promoLight,
} as const;

/**
 * Image banner (Site Editor): copy + 1–4 staff-uploaded images. Images come from the store's own
 * media storage (or https); every image carries localized alt text.
 */
export function MediaBanner({ id, props }: { id: string; props: SectionProps<'media_banner'> }) {
  const { locale } = useI18n();
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <div
        className={`${styles.promo} ${styles.media} ${TONE[props.tone]} ${
          props.layout === 'grid' ? styles.mediaGrid : ''
        }`}
      >
        <div className={styles.promoCopy}>
          {props.eyebrow && (
            <p className={styles.promoEyebrow}>{resolveLocalized(props.eyebrow, locale)}</p>
          )}
          <h2 id={headingId} className={styles.promoTitle}>
            {resolveLocalized(props.title, locale)}
          </h2>
          {props.body && <p className={styles.promoBody}>{resolveLocalized(props.body, locale)}</p>}
          {props.cta && (
            <div className={styles.promoActions}>
              <ButtonLink
                to={props.cta.href}
                variant={props.tone === 'brand' ? 'inverse' : 'primary'}
                size="lg"
              >
                {resolveLocalized(props.cta.label, locale)}
              </ButtonLink>
            </div>
          )}
        </div>
        <ul className={styles.mediaImages} data-count={props.images.length}>
          {props.images.map((image, index) => (
            <li key={index}>
              <img
                src={image.url}
                alt={resolveLocalized(image.alt, locale)}
                loading="lazy"
                decoding="async"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
