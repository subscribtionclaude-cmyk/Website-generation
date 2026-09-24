import { ArrowRight, Hourglass } from 'lucide-react';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { useEntry } from '../data/hooks';
import styles from './sections.module.css';
import { BidiText } from '@/components/text/BidiText';

/**
 * Data-driven launch hero (campaign content entry + optional teaser entry). Restrained motion:
 * a single rise-in and a slow float, disabled for reduced motion / constrained devices.
 * If the campaign is missing or expired the hero falls back to the brand tagline — never blank.
 */
export function HeroCampaign({
  id,
  props,
  level,
}: {
  id: string;
  props: SectionProps<'hero_campaign'>;
  level: 1 | 2;
}) {
  const { t, locale, format } = useI18n();
  const { brand } = useSettings();
  const campaign = useEntry(props.campaignSlug);
  const teaser = useEntry(props.teaserSlug ?? '');
  const Heading = `h${level}` as const;
  const headingId = `${id}-title`;
  const tone = props.tone === 'dark' ? styles.heroDark : styles.heroLight;
  const entry = campaign.data;

  if (campaign.isPending) {
    return (
      <section className={`${styles.hero} ${tone}`} aria-busy="true" style={{ minHeight: 420 }} />
    );
  }

  const prices =
    entry?.products.map((p) => p.price.min).filter((v): v is number => v !== null) ?? [];
  const minPrice = prices.length ? Math.min(...prices) : null;
  const images = (entry?.products ?? []).flatMap((p) => (p.image ? [p.image] : [])).slice(0, 2);
  const teaserEntry = props.teaserSlug ? teaser.data : null;

  return (
    <section className={`${styles.hero} ${tone}`} aria-labelledby={headingId}>
      <div className={`container ${styles.heroInner}`}>
        <div className={styles.heroCopy}>
          <p className={styles.heroEyebrow}>
            {entry?.eyebrow ? resolveLocalized(entry.eyebrow, locale) : brand.name}
          </p>
          <Heading id={headingId} className={styles.heroTitle}>
            <BidiText
              text={
                entry
                  ? resolveLocalized(entry.title, locale)
                  : resolveLocalized(brand.tagline, locale)
              }
            />
          </Heading>
          {entry?.subtitle && (
            <p className={styles.heroSubtitle}>{resolveLocalized(entry.subtitle, locale)}</p>
          )}
          {minPrice !== null && (
            <p className={styles.heroPrice}>
              {t('campaign.startsFrom', { price: format.money(minPrice) })}
            </p>
          )}
          <div className={styles.heroActions}>
            <ButtonLink to={entry?.cta?.href ?? '/store'} variant="accent" size="lg">
              {entry?.cta ? resolveLocalized(entry.cta.label, locale) : t('campaign.fallbackCta')}
            </ButtonLink>
            {entry?.secondaryCta && (
              <ButtonLink
                to={entry.secondaryCta.href}
                variant={props.tone === 'dark' ? 'inverse' : 'secondary'}
                size="lg"
              >
                {resolveLocalized(entry.secondaryCta.label, locale)}
              </ButtonLink>
            )}
          </div>
          {teaserEntry && (
            <div className={styles.teaser}>
              {teaserEntry.media?.kind === 'image' && (
                <img src={teaserEntry.media.url} alt="" width={44} height={64} />
              )}
              <div className={styles.teaserText}>
                <span className={styles.teaserLabel}>
                  <Hourglass aria-hidden="true" width={12} height={12} /> {t('campaign.teaser')}
                </span>
                <span className={styles.teaserTitle}>
                  {resolveLocalized(teaserEntry.title, locale)}
                </span>
              </div>
              {teaserEntry.cta && (
                <LocaleLink to={teaserEntry.cta.href} className={styles.teaserLink}>
                  {t('campaign.teaserCta')}
                  <span className="visually-hidden">
                    : {resolveLocalized(teaserEntry.title, locale)}
                  </span>
                  <ArrowRight className="flip-rtl" aria-hidden="true" width={14} height={14} />
                </LocaleLink>
              )}
            </div>
          )}
        </div>
        <div className={styles.heroVisual}>
          {images.length > 0 ? (
            images.map((image, index) => (
              <img
                key={image.id}
                src={image.url}
                alt={index === 0 && entry?.media ? resolveLocalized(entry.media.alt, locale) : ''}
                width={image.width ?? 800}
                height={image.height ?? 800}
                fetchPriority={index === 0 ? 'high' : 'auto'}
              />
            ))
          ) : (
            <img src="/brand/malek-store-mark-384.webp" alt="" width={384} height={378} />
          )}
        </div>
      </div>
    </section>
  );
}
