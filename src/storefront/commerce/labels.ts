import type {
  FulfillmentMethod,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PromoReason,
  QuoteLineStatus,
} from '@/domain/commerce/types';
import type { CoreMessageKey } from '@/i18n/context';

export const ORDER_STATUS_LABEL: Record<OrderStatus, CoreMessageKey> = {
  new: 'orderStatus.new',
  awaiting_whatsapp: 'orderStatus.awaiting_whatsapp',
  awaiting_payment: 'orderStatus.awaiting_payment',
  payment_verification: 'orderStatus.payment_verification',
  confirmed: 'orderStatus.confirmed',
  preparing: 'orderStatus.preparing',
  ready_for_pickup: 'orderStatus.ready_for_pickup',
  out_for_delivery: 'orderStatus.out_for_delivery',
  delivered: 'orderStatus.delivered',
  completed: 'orderStatus.completed',
  cancelled: 'orderStatus.cancelled',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, CoreMessageKey> = {
  cod_pending: 'paymentStatus.cod_pending',
  awaiting_payment: 'paymentStatus.awaiting_payment',
  awaiting_deposit: 'paymentStatus.awaiting_deposit',
  verification_pending: 'paymentStatus.verification_pending',
  deposit_verified: 'paymentStatus.deposit_verified',
  partially_paid: 'paymentStatus.partially_paid',
  paid: 'paymentStatus.paid',
  void: 'paymentStatus.void',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, CoreMessageKey> = {
  cod: 'payment.cod',
  instapay: 'payment.instapay',
  split: 'payment.split',
};

export const FULFILLMENT_LABEL: Record<FulfillmentMethod, CoreMessageKey> = {
  delivery: 'fulfillment.delivery',
  pickup: 'fulfillment.pickup',
};

export const LINE_STATUS_LABEL: Record<Exclude<QuoteLineStatus, 'ok'>, CoreMessageKey> = {
  unavailable: 'cart.lineUnavailable',
  not_purchasable: 'cart.lineNotPurchasable',
  max_quantity: 'cart.lineMaxQuantity',
  out_of_stock: 'cart.lineOutOfStock',
  insufficient_stock: 'cart.lineInsufficient',
};

export const PROMO_REASON_LABEL: Record<PromoReason, CoreMessageKey> = {
  disabled: 'promo.disabled',
  not_found: 'promo.not_found',
  not_started: 'promo.not_started',
  expired: 'promo.expired',
  limit_reached: 'promo.limit_reached',
  customer_limit: 'promo.customer_limit',
  not_applicable: 'promo.not_applicable',
  min_subtotal: 'promo.min_subtotal',
};
