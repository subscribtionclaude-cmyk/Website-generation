import { Copy, TicketPercent } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { filterOffers } from '@/domain/content/offers';
import { resolveSections } from '@/domain/content/sections';
import { resolveLocalized } from '@/domain/localized';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n } from '@/i18n/context';
import { useIsDemoMode } from '@/runtime/context';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Countdown } from '../components/Countdown';
import { Price } from '../components/Price';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { SectionHeading } from '../components/SectionHeading';
import { useOffer, useOffers, usePageSections } from '../data/hooks';
import { RenderSections } from '../sections/SectionRenderer';
import styles from './contentPages.module.css';
import { BidiText } from '@/components/text/BidiText';

/** Offers page: header + jump links + section-driven offer groups (only non-empty groups show). */
export function OffersPage() {
  const { t, locale } = useI18n();
  usePageMeta({ title: t('offers.title'), description: t('offers.subtitle') });
  const offers = useOffers();
  const sections = usePageSections('offers');
  const resolved = sections.data ? resolveSections(sections.data) : [];
  const groups = resolved.flatMap((s) =>
    s.type === 'offer_group' && filterOffers(offers.data ?? [], s.props.filter).length > 0
      ? [s]
      : [],
  );
  const loading = offers.isPending || sections.isPending;

  return (
    <div className={styles.page}>
      <div className="container">
        <Breadcrumbs
          items={[{ label: t('common.home'), href: '/' }, { label: t('offers.title') }]}
        />
        <header className={styles.head}>
          <h1 className={styles.title}>{t('offers.title')}</h1>
          <p className={styles.subtitle}>{t('offers.subtitle')}</p>
        </header>
        {groups.length > 1 && (
          <nav aria-label={t('offers.jumpTo')}>
            <ul className={styles.jump}>
              {groups.map((g) =>
                g.type === 'offer_group' ? (
                  <li key={g.id}>
                    <a href={`#${g.props.anchor}`}>{resolveLocalized(g.props.title, locale)}</a>
                  </li>
                ) : null,
              )}
            </ul>
          </nav>
        )}
      </div>
      {loading ? (
        <div className="container">
          <ProductGridSkeleton count={6} columns={3} />
        </div>
      ) : offers.isError || sections.isError ? (
        <div className="container">
          <StateMessage icon={<TicketPercent />} title={t('offers.loadError')} role="alert" />
        </div>
      ) : groups.length === 0 ? (
        <div className="container">
          <StateMessage
            icon={<TicketPercent />}
            title={t('offers.empty')}
            actions={
              <ButtonLink to="/store" variant="primary">
                {t('common.backToStore')}
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <RenderSections sections={groups} />
      )}
    </div>
  );
}

export function OfferDetailPage() {
  const { slug = '' } = useParams();
  const { t, locale, format } = useI18n();
  const isDemo = useIsDemoMode();
  const { data: offer, isPending, isError } = useOffer(slug);
  const [copied, setCopied] = useState(false);
  const title = offer ? resolveLocalized(offer.title, locale) : t('offers.notFoundTitle');
  usePageMeta({
    title,
    description: offer?.subtitle ? resolveLocalized(offer.subtitle, locale) : undefined,
    noIndex: !offer,
    image: offer?.products[0]?.image?.url,
  });

  if (isPending) {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <ProductGridSkeleton count={3} columns={3} />
      </div>
    );
  }
  if (isError || !offer) {
    return (
      <div className={`container ${styles.page}`}>
        <StateMessage
          icon={<TicketPercent />}
          headingLevel={1}
          title={isError ? t('offers.loadError') : t('offers.notFoundTitle')}
          body={isError ? undefined : t('offers.notFoundBody')}
          role={isError ? 'alert' : undefined}
          actions={
            <ButtonLink to="/offers" variant="primary">
              {t('offers.allOffers')}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const copy = async () => {
    if (!offer.promoCode) return;
    try {
      await navigator.clipboard.writeText(offer.promoCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const gifts = offer.products.filter((p) => offer.productRoles[p.slug] === 'gift');
  const main = offer.products.filter((p) => offer.productRoles[p.slug] !== 'gift');
  const images = main.flatMap((p) => (p.image ? [p.image] : [])).slice(0, 2);

  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs
        items={[
          { label: t('common.home'), href: '/' },
          { label: t('offers.title'), href: '/offers' },
          { label: title },
        ]}
      />
      <div className={styles.detail}>
        <div className={styles.detailMedia}>
          <div className={styles.detailMediaRow}>
            {images.map((image) => (
              <img
                key={image.id}
                src={image.url}
                alt=""
                width={image.width ?? 800}
                height={image.height ?? 800}
              />
            ))}
          </div>
        </div>
        <div className={styles.detailBody}>
          <p className={styles.eyebrow}>{resolveLocalized(offer.badge, locale)}</p>
          <h1 className={styles.title}>
            <BidiText text={title} />
          </h1>
          {offer.subtitle && (
            <p className={styles.subtitle}>{resolveLocalized(offer.subtitle, locale)}</p>
          )}
          {offer.description && (
            <div className={styles.prose}>
              {resolveLocalized(offer.description, locale)
                .split(/\n{2,}/)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
          )}
          {offer.bundlePrice !== null && <Price min={offer.bundlePrice} size="lg" />}
          {offer.endsAt &&
            (offer.showCountdown ? (
              <Countdown endsAt={offer.endsAt} />
            ) : (
              <p className={styles.meta}>
                {t('offers.validUntil', { date: format.date(offer.endsAt) })}
              </p>
            ))}
          {offer.promoCode && (
            <div className={styles.promo}>
              <span className={styles.note}>{t('offers.promoCode')}</span>
              <span className={styles.promoCode}>{offer.promoCode}</span>
              <Button
                variant="secondary"
                size="sm"
                icon={<Copy aria-hidden="true" />}
                onClick={() => void copy()}
              >
                {copied ? t('offers.copied') : t('offers.copyCode')}
              </Button>
              <span role="status" className="visually-hidden">
                {copied ? t('offers.copied') : ''}
              </span>
              <p className={styles.note}>{t('offers.promoLater')}</p>
            </div>
          )}
          {isDemo && offer.isDemo && (
            <p className={styles.demoNote}>{t('product.demoPriceNote')}</p>
          )}
          {offer.cta && (
            <div className={styles.actions}>
              <ButtonLink to={offer.cta.href} variant="accent" size="lg">
                {resolveLocalized(offer.cta.label, locale)}
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
      {main.length > 0 && (
        <section className={styles.section} aria-labelledby="offer-products">
          <SectionHeading
            id="offer-products"
            title={offer.kind === 'bundle' ? t('offers.bundleItems') : t('offers.includedProducts')}
          />
          <ProductGrid products={main} />
        </section>
      )}
      {gifts.length > 0 && (
        <section className={styles.section} aria-labelledby="offer-gifts">
          <SectionHeading id="offer-gifts" title={t('offers.gift')} />
          <ProductGrid products={gifts} />
        </section>
      )}
    </div>
  );
}
