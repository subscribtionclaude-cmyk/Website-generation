import {
  BellRing,
  CircleCheck,
  Hourglass,
  Info,
  MessageCircle,
  Phone,
  RefreshCcw,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import type { ProductDetail, ProductVariant } from '@/domain/catalog/types';
import type { PurchaseState } from '@/domain/catalog/variants';
import { useCart } from '@/features/cart/context';
import { localizePath } from '@/i18n/paths';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import type { RequestKind } from './RequestDrawer';
import styles from './product.module.css';

/**
 * CTA block driven by purchaseState(). Add to cart / Buy now put the EXACT selected variant in the
 * cart (Buy now then opens checkout — the same server validation applies); call and WhatsApp
 * remain available for customers who prefer to talk to the store.
 */
export function PurchasePanel({
  product,
  variant,
  state,
  whatsappMessage,
  onRequest,
}: {
  product: ProductDetail;
  variant: ProductVariant | null;
  state: PurchaseState;
  whatsappMessage: string;
  onRequest: (kind: RequestKind) => void;
}) {
  const { t } = useI18n();
  const { store } = useSettings();
  const phone = store.branches[0]?.phones[0];
  const tel = phone ? toTelHref(phone) : null;
  const whatsapp = buildWhatsAppLink(store.whatsappNumber, whatsappMessage);

  const contact = (
    <div className={styles.contactRow}>
      {tel && (
        <a href={tel} className={buttonClassName({ variant: 'secondary', block: true })}>
          <Phone aria-hidden="true" />
          {t('product.callToOrder')}
        </a>
      )}
      {whatsapp.status === 'ok' && (
        <a
          href={whatsapp.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: 'secondary', block: true })}
        >
          <MessageCircle aria-hidden="true" />
          {t('product.whatsappCta')}
          <span className="visually-hidden"> {t('common.externalLink')}</span>
        </a>
      )}
    </div>
  );

  return (
    <div className={styles.purchase}>
      {state.kind === 'purchasable' && variant && (
        <PurchaseButtons product={product} variant={variant} />
      )}
      {state.kind === 'out_of_stock' && (
        <>
          <p className={styles.purchaseTitle}>{t('product.outOfStockTitle')}</p>
          <Button
            variant="accent"
            size="lg"
            block
            icon={<BellRing aria-hidden="true" />}
            onClick={() => onRequest('notify')}
          >
            {t('product.notifyMe')}
          </Button>
        </>
      )}
      {(state.kind === 'coming_soon' || state.kind === 'waitlist_only') && (
        <>
          <p className={styles.purchaseNote}>
            <Hourglass aria-hidden="true" />
            {t('product.comingSoonNote')}
          </p>
          <Button
            variant="accent"
            size="lg"
            block
            icon={<BellRing aria-hidden="true" />}
            onClick={() => onRequest('waitlist')}
          >
            {t('product.joinWaitlist')}
          </Button>
        </>
      )}
      {state.kind === 'pre_order' && (
        <>
          <p className={styles.purchaseNote}>
            <Info aria-hidden="true" />
            {t('product.preOrderNote')}
          </p>
          <Button
            variant="accent"
            size="lg"
            block
            icon={<BellRing aria-hidden="true" />}
            onClick={() => onRequest('waitlist')}
          >
            {t('product.joinWaitlist')}
          </Button>
        </>
      )}
      {state.kind === 'unavailable' && (
        <p className={styles.purchaseNote}>
          <Info aria-hidden="true" />
          {t('product.unavailableNote')}
        </p>
      )}
      {contact}
      {variant && product.availabilityState === 'available' && (
        <LocaleLink to={`/trade-in?product=${product.slug}`} className={styles.tradeIn}>
          <RefreshCcw aria-hidden="true" />
          {t('product.tradeInCta')}
        </LocaleLink>
      )}
    </div>
  );
}

function PurchaseButtons({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: ProductVariant;
}) {
  const { t, locale } = useI18n();
  const cart = useCart();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'add' | 'buy' | null>(null);
  const [added, setAdded] = useState(false);
  const inCart = cart.lines.find((l) => l.variantId === variant.id && !l.savedForLater);

  const add = async (mode: 'add' | 'buy') => {
    setBusy(mode);
    try {
      await cart.add({
        variantId: variant.id,
        productSlug: product.slug,
        quantity: 1,
        seenUnitPrice: variant.price,
      });
      if (mode === 'buy') void navigate(localizePath('/checkout', locale));
      else setAdded(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className={styles.purchaseActions}>
        <Button
          variant="accent"
          size="lg"
          block
          loading={busy === 'add'}
          disabled={busy !== null}
          icon={<ShoppingCart aria-hidden="true" />}
          onClick={() => void add('add')}
        >
          {t('product.addToCart')}
        </Button>
        <Button
          variant="primary"
          size="lg"
          block
          loading={busy === 'buy'}
          disabled={busy !== null}
          icon={<ShoppingBag aria-hidden="true" />}
          onClick={() => void add('buy')}
        >
          {t('product.buyNow')}
        </Button>
      </div>
      <p className={styles.addedNote} role="status">
        {added && inCart ? (
          <>
            <CircleCheck aria-hidden="true" />
            <span>{t('cart.added', { count: inCart.quantity })}</span>
            <LocaleLink to="/cart">{t('cart.view')}</LocaleLink>
          </>
        ) : null}
      </p>
    </>
  );
}
