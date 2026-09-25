import type { FulfillmentMethod, Order, OrderStatus, PaymentMethod, PaymentStatus } from './types';

/** Mirrors app.order_transition_allowed (staff status changes; cancellation is a separate action). */
export function orderTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: FulfillmentMethod,
): boolean {
  switch (from) {
    case 'new':
      return [
        'awaiting_whatsapp',
        'awaiting_payment',
        'payment_verification',
        'confirmed',
      ].includes(to);
    case 'awaiting_whatsapp':
      return ['awaiting_payment', 'payment_verification', 'confirmed'].includes(to);
    case 'awaiting_payment':
      return ['awaiting_whatsapp', 'payment_verification', 'confirmed'].includes(to);
    case 'payment_verification':
      return ['awaiting_payment', 'confirmed'].includes(to);
    case 'confirmed':
      return to === 'preparing';
    case 'preparing':
      return (
        (fulfillment === 'pickup' && to === 'ready_for_pickup') ||
        (fulfillment === 'delivery' && to === 'out_for_delivery')
      );
    case 'ready_for_pickup':
      return fulfillment === 'pickup' && to === 'completed';
    case 'out_for_delivery':
      return to === 'delivered' || to === 'preparing';
    case 'delivered':
      return to === 'completed';
    default:
      return false;
  }
}

export function nextStatuses(order: Pick<Order, 'status' | 'fulfillment'>): OrderStatus[] {
  const all: OrderStatus[] = [
    'awaiting_whatsapp',
    'awaiting_payment',
    'payment_verification',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'completed',
  ];
  return all.filter((to) => orderTransitionAllowed(order.status, to, order.fulfillment.method));
}

export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  switch (method) {
    case 'cod':
      return 'cod_pending';
    case 'instapay':
      return 'awaiting_payment';
    case 'split':
      return 'awaiting_deposit';
    default:
      return 'pay_at_store';
  }
}

/** Mirrors app.derived_payment_status: derived from method + VERIFIED money only. */
export function derivedPaymentStatus(o: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  total: number;
  paidAmount: number;
  shippingFeeStatus: 'pending' | 'confirmed' | 'not_required';
}): PaymentStatus {
  if (o.status === 'cancelled' && o.paidAmount === 0) return 'void';
  if (o.paidAmount > 0 && o.paidAmount >= o.total && o.shippingFeeStatus !== 'pending')
    return 'paid';
  if (o.paidAmount > 0 && o.paymentMethod === 'split') return 'deposit_verified';
  if (o.paidAmount > 0) return 'partially_paid';
  if (o.paymentStatus === 'verification_pending') return 'verification_pending';
  return initialPaymentStatus(o.paymentMethod);
}

export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  'new',
  'awaiting_whatsapp',
  'awaiting_payment',
  'payment_verification',
];

export function canCustomerCancel(o: {
  status: OrderStatus;
  paidAmount: number;
  stockCommitted: boolean;
}): boolean {
  return (
    ['new', 'awaiting_whatsapp', 'awaiting_payment'].includes(o.status) &&
    o.paidAmount === 0 &&
    !o.stockCommitted
  );
}

/** Customer-facing progress steps (cancelled orders show their own state). */
export function progressSteps(method: FulfillmentMethod): OrderStatus[] {
  return method === 'pickup'
    ? ['new', 'confirmed', 'preparing', 'ready_for_pickup', 'completed']
    : ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
}
