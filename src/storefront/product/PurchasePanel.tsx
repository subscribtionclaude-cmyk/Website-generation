import {
  BellRing,
  Hourglass,
  Info,
  MessageCircle,
  Phone,
  RefreshCcw,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import type { ProductDetail, ProductVariant } from '@/domain/catalog/types';
import type { PurchaseState } from '@/domain/catalog/variants';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import type { RequestKind } from './RequestDrawer';
import styles from './product.module.css';

/**
 * CTA block driven by purchaseState(). Cart/checkout arrive in Phase 03: until then Add to cart /
 * Buy now are visibly disabled with an honest note, and the working paths are call + WhatsApp.
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
      {state.kind === 'purchasable' && (
        <>
          <div className={styles.purchaseActions}>
            <Button
              variant="accent"
              size="lg"
              block
              disabled
              aria-describedby="ordering-soon"
              icon={<ShoppingCart aria-hidden="true" />}
            >
              {t('product.addToCart')}
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              disabled
              aria-describedby="ordering-soon"
              icon={<ShoppingBag aria-hidden="true" />}
            >
              {t('product.buyNow')}
            </Button>
          </div>
          <p id="ordering-soon" className={styles.purchaseNote}>
            <Info aria-hidden="true" />
            {t('product.orderingSoon')}
          </p>
        </>
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
