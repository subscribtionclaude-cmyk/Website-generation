import { ArrowLeft, PackageX, Printer } from 'lucide-react';
import { useParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { Button } from '@/components/ui/Button';
import type { InvoiceTemplate } from '@/domain/commerce/invoiceTemplate';
import type { Order } from '@/domain/commerce/types';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { useMyOrder } from '../commerce/useMyOrder';
import { InvoiceSheet } from './InvoiceSheet';
import styles from './invoice.module.css';

/**
 * Printable order invoice (browser print → "Save as PDF"; no paid PDF service). Rendered from the
 * published `receipt` setting (Admin → Receipts), with the bundled default template as fallback.
 */
export function InvoicePage() {
  return (
    <RequireAuth>
      <InvoiceView />
    </RequireAuth>
  );
}

function InvoiceView() {
  const { orderNumber = '' } = useParams();
  const { t } = useI18n();
  const order = useMyOrder(orderNumber);
  // Published receipt template (Admin → Receipts); bundled defaults until one is published.
  const { receipt } = useSettings();
  usePageMeta({ title: t('invoice.pageTitle', { number: orderNumber }), noIndex: true });
  if (order.isPending) {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <Skeleton height="480px" />
      </div>
    );
  }
  if (order.isError || !order.data) {
    return (
      <div className="container">
        <StateMessage
          icon={<PackageX />}
          headingLevel={1}
          title={t('order.notFoundTitle')}
          body={t('order.notFoundBody')}
          actions={
            <ButtonLink to="/account" variant="primary">
              {t('order.myOrders')}
            </ButtonLink>
          }
        />
      </div>
    );
  }
  return <Invoice order={order.data} template={receipt} />;
}

function Invoice({ order, template }: { order: Order; template: InvoiceTemplate }) {
  const { t } = useI18n();
  return (
    <div className={`container ${styles.page}`}>
      <div className={`${styles.toolbar} print-hidden`}>
        <LocaleLink to={`/order/${order.orderNumber}`} className={styles.back}>
          <ArrowLeft className="flip-rtl" aria-hidden="true" />
          {t('invoice.backToOrder')}
        </LocaleLink>
        <Button
          variant="primary"
          icon={<Printer aria-hidden="true" />}
          onClick={() => window.print()}
        >
          {t('invoice.print')}
        </Button>
      </div>
      <InvoiceSheet order={order} template={template} />
    </div>
  );
}
