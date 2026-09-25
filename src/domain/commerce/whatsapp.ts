import type { Locale } from '@/i18n/config';
import { resolveLocalized } from '@/domain/localized';
import type { Order } from './types';

export interface OrderMessageLabels {
  intro: (orderNumber: string) => string;
  customer: (name: string) => string;
  item: (line: { name: string; variant: string | null; quantity: number }) => string;
  total: (total: string) => string;
  shippingPending: string;
  payment: (method: string) => string;
  fulfillment: (method: string) => string;
}

/**
 * WhatsApp hand-off text, sent only AFTER the order exists. Contains what staff need to find and
 * confirm the order — no email, address or other unnecessary personal data.
 */
export function orderWhatsAppMessage(
  order: Order,
  locale: Locale,
  labels: OrderMessageLabels,
  formatMoney: (amount: number) => string,
  methodLabel: string,
  fulfillmentLabel: string,
): string {
  return [
    labels.intro(order.orderNumber),
    labels.customer(order.customer.name),
    ...order.items.map((item) =>
      labels.item({
        name: resolveLocalized(item.productName, locale),
        variant: item.variantLabel ? resolveLocalized(item.variantLabel, locale) : null,
        quantity: item.quantity,
      }),
    ),
    labels.total(formatMoney(order.totals.total)),
    ...(order.totals.shippingFeeStatus === 'pending' ? [labels.shippingPending] : []),
    labels.payment(methodLabel),
    labels.fulfillment(fulfillmentLabel),
  ].join('\n');
}
