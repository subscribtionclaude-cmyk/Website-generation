import { Gift, Tag } from 'lucide-react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import type { Offer } from '@/domain/content/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { Countdown } from './Countdown';
import { offerHref } from './links';
import styles from './content.module.css';
import catalogStyles from './catalog.module.css';
import { BidiText } from '@/components/text/BidiText';

export function OfferCard({ offer, headingLevel = 3 }: { offer: Offer; headingLevel?: 2 | 3 | 4 }) {
  const { t, locale, format } = useI18n();
  const Heading = `h${headingLevel}` as const;
  const images = offer.products.filter((p) => p.image).slice(0, 2);
  return (
    <article className={styles.offer}>
      <div className={styles.offerMedia}>
        {images.map((p) =>
          p.image ? (
            <img
              key={p.id}
              src={p.image.url}
              alt=""
              width={p.image.width ?? 800}
              height={p.image.height ?? 800}
              loading="lazy"
              decoding="async"
            />
          ) : null,
        )}
        <span className={`${catalogStyles.badge} ${catalogStyles.badgeOffer} ${styles.offerBadge}`}>
          {offer.kind === 'free_gift' ? <Gift aria-hidden="true" /> : <Tag aria-hidden="true" />}
          {resolveLocalized(offer.badge, locale)}
        </span>
      </div>
      <div className={styles.offerBody}>
        <Heading className={styles.offerTitle}>
          <LocaleLink to={offerHref(offer)} className={catalogStyles.cardLink}>
            <BidiText text={resolveLocalized(offer.title, locale)} />
          </LocaleLink>
        </Heading>
        {offer.subtitle && (
          <p className={styles.offerSubtitle}>{resolveLocalized(offer.subtitle, locale)}</p>
        )}
        <div className={styles.offerFoot}>
          {offer.promoCode && <span className={styles.promo}>{offer.promoCode}</span>}
          {offer.showCountdown && offer.endsAt ? (
            <Countdown endsAt={offer.endsAt} />
          ) : offer.endsAt ? (
            <span className={styles.entryMeta}>
              {t('offers.validUntil', { date: format.date(offer.endsAt) })}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
