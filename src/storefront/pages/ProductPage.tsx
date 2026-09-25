import { PackageX, ShieldCheck, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/feedback/Skeleton';
import type { ProductDetail } from '@/domain/catalog/types';
import {
  findVariant,
  initialSelection,
  mediaForSelection,
  purchaseState,
  type Selection,
} from '@/domain/catalog/variants';
import { resolveLocalized } from '@/domain/localized';
import { breadcrumbJsonLd, productJsonLd } from '@/features/seo/structuredData';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useWhatsAppMessage } from '@/features/whatsapp/context';
import { useI18n } from '@/i18n/context';
import { useIsDemoMode, useRuntime } from '@/runtime/context';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs';
import { Price } from '../components/Price';
import { ProductBadges, StockStatus } from '../components/StatusBadges';
import { ProductGallery } from '../product/ProductGallery';
import { PurchasePanel } from '../product/PurchasePanel';
import { RequestDrawer, type RequestKind } from '../product/RequestDrawer';
import { VariantSelector } from '../product/VariantSelector';
import { useProduct } from '../data/hooks';
import styles from '../product/product.module.css';
import { BidiText } from '@/components/text/BidiText';
import { useCustomerLists } from '@/features/customer/context';
import { CompareButton } from '../customer/CompareButton';
import { ProductRecommendations, RecentlyViewedRail } from '../customer/ProductRails';
import { ProductReviews } from '../customer/ProductReviews';
import { WishlistButton } from '../customer/WishlistButton';

export function ProductPage() {
  const { slug = '' } = useParams();
  const { t } = useI18n();
  const { data: product, isPending, isError, refetch } = useProduct(slug);

  if (isPending) return <ProductSkeleton />;
  if (isError) {
    return (
      <div className={`container ${styles.page}`}>
        <StateMessage
          icon={<PackageX />}
          title={t('product.loadError')}
          headingLevel={1}
          role="alert"
          actions={
            <Button variant="primary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (!product) return <ProductNotFound />;
  return <ProductView key={product.slug} product={product} />;
}

function ProductNotFound() {
  const { t } = useI18n();
  usePageMeta({ title: t('product.notFoundTitle'), noIndex: true });
  return (
    <div className={`container ${styles.page}`}>
      <StateMessage
        icon={<PackageX />}
        title={t('product.notFoundTitle')}
        body={t('product.notFoundBody')}
        headingLevel={1}
        actions={
          <>
            <ButtonLink to="/store" variant="primary">
              {t('common.backToStore')}
            </ButtonLink>
            <ButtonLink to="/contact" variant="secondary">
              {t('common.contactUs')}
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}

function ProductView({ product }: { product: ProductDetail }) {
  const { t, locale, format } = useI18n();
  const { mode, config } = useRuntime();
  const isDemo = useIsDemoMode();
  const [params, setParams] = useSearchParams();
  const [request, setRequest] = useState<RequestKind | null>(null);

  // Selection lives in the URL (?storage=512gb&color=orange) so a variant can be shared/linked.
  const preferred: Selection = {};
  for (const option of product.options) {
    const value = params.get(option.key);
    if (value && option.values.some((v) => v.key === value)) preferred[option.key] = value;
  }
  const selection = initialSelection(product, preferred);
  const variant = findVariant(product, selection);
  const state = purchaseState(product, variant);
  const media = mediaForSelection(product, selection);

  const setSelection = (next: Selection) => {
    const nextParams = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) nextParams.set(key, value);
    setParams(nextParams, { replace: true, preventScrollReset: true });
  };

  const name = resolveLocalized(product.name, locale);
  const variantLabel =
    product.options
      .map((o) => o.values.find((v) => v.key === selection[o.key]))
      .filter((v) => v !== undefined)
      .map((v) => resolveLocalized(v.label, locale))
      .join(' · ') || null;
  const warranty = variant?.warranty ?? product.warranty;

  // Recently viewed: once per product page view (+ the variant the customer is looking at).
  const { recent } = useCustomerLists();
  const track = recent.track;
  const variantId = variant?.id ?? null;
  const chosenVariant = product.options.some((o) => params.has(o.key)) ? variantId : null;
  useEffect(() => {
    track({ productId: product.id, productSlug: product.slug, variantId: chosenVariant });
  }, [track, product.id, product.slug, chosenVariant]);

  const whatsappMessage = [
    t('product.whatsappMessage', { product: name }),
    variantLabel && t('product.whatsappVariant', { variant: variantLabel }),
    variant && t('product.whatsappSku', { sku: variant.sku }),
    variant?.price != null && t('product.whatsappPrice', { price: format.money(variant.price) }),
  ]
    .filter(Boolean)
    .join('\n');
  useWhatsAppMessage(whatsappMessage);

  const crumbs: Crumb[] = [
    { label: t('common.home'), href: '/' },
    ...(product.category
      ? [
          {
            label: resolveLocalized(product.category.name, locale),
            href: `/category/${product.category.slug}`,
          },
        ]
      : [{ label: t('catalog.storeTitle'), href: '/store' }]),
    { label: name },
  ];
  const origin = config.siteUrl ?? window.location.origin;
  const productLd = productJsonLd(product, { origin, locale, mode });
  usePageMeta({
    title: product.seo.title ? resolveLocalized(product.seo.title, locale) : name,
    description: product.seo.description
      ? resolveLocalized(product.seo.description, locale)
      : product.subtitle
        ? resolveLocalized(product.subtitle, locale)
        : undefined,
    image: product.image?.url,
    type: 'product',
    jsonLd: [breadcrumbJsonLd(crumbs, { origin, locale }), ...(productLd ? [productLd] : [])],
  });

  const price = variant?.price ?? null;
  return (
    <div className={`container ${styles.page}`}>
      <Breadcrumbs items={crumbs} />
      <div className={styles.top}>
        <ProductGallery key={selection.color ?? 'all'} media={media} productName={name} />
        <div className={styles.info}>
          <div>
            <LocaleLink to={`/brand/${product.brand.slug}`} className={styles.brand}>
              {resolveLocalized(product.brand.name, locale)}
              <span className="visually-hidden">
                {' '}
                — {t('product.brandLink', { brand: resolveLocalized(product.brand.name, locale) })}
              </span>
            </LocaleLink>
            <h1 className={styles.title}>
              <BidiText text={name} />
            </h1>
            {product.subtitle && (
              <p className={styles.subtitle}>{resolveLocalized(product.subtitle, locale)}</p>
            )}
          </div>
          <div className={styles.headBadges}>
            <ProductBadges product={product} max={3} />
          </div>
          <div className={styles.priceBlock}>
            {product.availabilityState === 'available' ? (
              <Price
                min={price}
                compareAt={variant?.compareAtPrice ?? null}
                size="lg"
                showFrom={false}
              />
            ) : (
              <Price min={product.price.min} max={product.price.max} size="lg" />
            )}
            <div className={styles.meta}>
              {product.availabilityState === 'available' && variant ? (
                <StockStatus state={variant.stockState} />
              ) : (
                <StockStatus state="out_of_stock" availability={product.availabilityState} />
              )}
              {variant && (
                <span>
                  {t('product.skuLabel')}: <bdi className={styles.sku}>{variant.sku}</bdi>
                </span>
              )}
              {product.offer && (
                <LocaleLink to={`/offers/${product.offer.slug}`} className={styles.metaItem}>
                  <Tag aria-hidden="true" />
                  {resolveLocalized(product.offer.badge, locale)}
                </LocaleLink>
              )}
            </div>
            {warranty && (
              <p className={styles.meta}>
                <span className={styles.metaItem}>
                  <ShieldCheck aria-hidden="true" />
                  {t('product.warranty')}: {resolveLocalized(warranty, locale)}
                </span>
              </p>
            )}
            {isDemo && product.isDemo && (
              <p className={styles.demoNote}>{t('product.demoPriceNote')}</p>
            )}
          </div>
          {product.variants.length > 0 && (
            <VariantSelector product={product} selection={selection} onChange={setSelection} />
          )}
          <PurchasePanel
            product={product}
            variant={variant}
            state={state}
            whatsappMessage={whatsappMessage}
            onRequest={setRequest}
          />
          <div className={styles.saveRow}>
            <WishlistButton
              variant="full"
              product={{ id: product.id, slug: product.slug, name }}
              variantId={chosenVariant}
            />
            <CompareButton variant="full" product={product} name={name} />
          </div>
        </div>
      </div>

      {(product.description || product.specGroups.length > 0) && (
        <div className={styles.details}>
          {product.description && (
            <section aria-labelledby="product-about">
              <h2 id="product-about" className={styles.detailTitle}>
                {t('product.description')}
              </h2>
              <div className={styles.description}>
                {resolveLocalized(product.description, locale)
                  .split(/\n{2,}/)
                  .map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
              </div>
            </section>
          )}
          {product.specGroups.length > 0 && (
            <section aria-labelledby="product-specs">
              <h2 id="product-specs" className={styles.detailTitle}>
                {t('product.specs')}
              </h2>
              {product.isDemo && (
                <p className={`${styles.demoNote} ${styles.specGroup}`}>
                  {t('product.demoSpecsNote')}
                </p>
              )}
              {product.specGroups.map((group) => (
                <div key={group.key} className={styles.specGroup}>
                  <h3 className={styles.specGroupTitle}>{resolveLocalized(group.title, locale)}</h3>
                  <dl className={styles.specs}>
                    {group.items.map((item) => (
                      <div key={item.key} className={styles.specRow}>
                        <dt>{resolveLocalized(item.label, locale)}</dt>
                        <dd>{resolveLocalized(item.value, locale)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <ProductRecommendations product={product} />
      <ProductReviews product={product} />
      <RecentlyViewedRail excludeProductId={product.id} />

      {request && (
        <RequestDrawer
          kind={request}
          open
          onClose={() => setRequest(null)}
          product={product}
          variantSku={variant?.sku ?? null}
          variantLabel={variantLabel}
        />
      )}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className={`container ${styles.page}`} aria-busy="true">
      <div className={styles.top}>
        <Skeleton height="auto" className="skeleton-square" radius="var(--radius-lg)" />
        <div className={styles.info}>
          <Skeleton width="30%" height="1rem" />
          <Skeleton width="80%" height="2.4rem" />
          <Skeleton width="45%" height="2rem" />
          <Skeleton height="120px" />
        </div>
      </div>
    </div>
  );
}
