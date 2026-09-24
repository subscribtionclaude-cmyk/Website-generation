import { filterOffers } from '@/domain/content/offers';
import type { SectionProps } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { OfferCard } from '../components/OfferCard';
import { ProductGridSkeleton } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import { useOffers } from '../data/hooks';
import styles from './sections.module.css';

export function OfferRail({ id, props }: { id: string; props: SectionProps<'offer_rail'> }) {
  const { locale, t } = useI18n();
  const { data, isPending, isError } = useOffers();
  const offers = filterOffers(data ?? [], props.filter)
    .filter((o) => !props.featuredOnly || o.featuredOnHome)
    .slice(0, props.limit);
  if (!isPending && !isError && offers.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section className={`container ${styles.section}`} aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        eyebrow={props.eyebrow ? resolveLocalized(props.eyebrow, locale) : null}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
        link={
          props.cta
            ? { label: resolveLocalized(props.cta.label, locale), href: props.cta.href }
            : null
        }
      />
      {isPending ? (
        <ProductGridSkeleton count={4} />
      ) : isError ? (
        <p className={styles.errorNote} role="status">
          {t('offers.loadError')}
        </p>
      ) : (
        <ul className={styles.offerGrid}>
          {offers.map((offer) => (
            <li key={offer.id}>
              <OfferCard offer={offer} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One anchored group on the Offers page (Flash, Price drops, Bundles …). Empty groups are hidden. */
export function OfferGroup({ id, props }: { id: string; props: SectionProps<'offer_group'> }) {
  const { locale } = useI18n();
  const { data } = useOffers();
  const offers = filterOffers(data ?? [], props.filter);
  if (offers.length === 0) return null;
  const headingId = `${id}-title`;
  return (
    <section
      id={props.anchor}
      className={`container ${styles.sectionTight}`}
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <SectionHeading
        id={headingId}
        title={resolveLocalized(props.title, locale)}
        subtitle={props.subtitle ? resolveLocalized(props.subtitle, locale) : null}
      />
      <ul className={styles.offerGrid3}>
        {offers.map((offer) => (
          <li key={offer.id}>
            <OfferCard offer={offer} />
          </li>
        ))}
      </ul>
    </section>
  );
}
