import type { OrderReviewSettings } from '@/domain/settings/schemas';
import type { ManualReviewReason, PaymentMethod } from './types';

/** Mirrors app.manual_review_reasons: which configured rules flag this order for manual review. */
export function manualReviewReasons(
  rules: OrderReviewSettings,
  input: {
    itemsTotal: number;
    lines: { unitPrice: number; quantity: number; isGift: boolean }[];
    paymentMethod: PaymentMethod;
    /** Orders of this customer (for new-customer, unfinished and velocity rules). */
    history: { createdAt: string; status: string }[];
    now: Date;
  },
): ManualReviewReason[] {
  const reasons: ManualReviewReason[] = [];
  const nowMs = input.now.getTime();
  if (rules.highValue.enabled && input.itemsTotal >= rules.highValue.threshold)
    reasons.push('high_value');
  if (
    rules.multipleExpensive.enabled &&
    input.lines
      .filter((l) => !l.isGift && l.unitPrice >= rules.multipleExpensive.unitPrice)
      .reduce((n, l) => n + l.quantity, 0) >= rules.multipleExpensive.minUnits
  )
    reasons.push('multiple_expensive');
  if (
    rules.newCustomer.enabled &&
    input.itemsTotal >= rules.newCustomer.minTotal &&
    !input.history.some((o) => o.status !== 'cancelled')
  )
    reasons.push('new_customer');
  if (rules.splitPayment.enabled && input.paymentMethod === 'split') reasons.push('split_payment');
  if (
    rules.unfinishedOrders.enabled &&
    input.history.filter(
      (o) =>
        o.status === 'cancelled' &&
        nowMs - new Date(o.createdAt).getTime() < rules.unfinishedOrders.windowDays * 86_400_000,
    ).length >= rules.unfinishedOrders.maxCount
  )
    reasons.push('unfinished_orders');
  if (
    rules.velocity.enabled &&
    input.history.filter(
      (o) => nowMs - new Date(o.createdAt).getTime() < rules.velocity.windowHours * 3_600_000,
    ).length >= rules.velocity.maxOrders
  )
    reasons.push('order_velocity');
  return reasons;
}
