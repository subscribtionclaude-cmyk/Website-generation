import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  accountCartSchema,
  createOrderResultSchema,
  orderSchema,
  orderSummarySchema,
  quoteSchema,
  staffActionResultSchema,
  staffOrderSchema,
  staffOrderSummarySchema,
} from '@/domain/commerce/schemas';
import type { CommerceRepository, OrderOperationsRepository } from '../types';
import { rpc } from './rpc';

/**
 * Commerce over the checkout/operations RPCs (supabase/migrations/20260926100200_*, …300_*).
 * The database computes every amount, enforces ownership and permissions, and returns
 * business rejections as { ok:false, code } — never raw SQL errors.
 */
export class SupabaseCommerceRepository implements CommerceRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  quote(
    items: Parameters<CommerceRepository['quote']>[0],
    options: Parameters<CommerceRepository['quote']>[1] = {},
  ) {
    return rpc(
      this.client,
      'quote_checkout',
      {
        p_items: items,
        p_promo_code: options.promoCode ?? null,
        p_fulfillment: options.fulfillment ?? null,
      },
      quoteSchema,
    );
  }

  getCart() {
    return rpc(this.client, 'cart_get', {}, accountCartSchema);
  }

  mergeCart(items: Parameters<CommerceRepository['mergeCart']>[0]) {
    return rpc(this.client, 'cart_merge', { p_items: items }, accountCartSchema);
  }

  setCartItem(
    variantId: string,
    quantity: number,
    savedForLater: boolean,
    seenUnitPrice: number | null,
  ) {
    return rpc(
      this.client,
      'cart_set_item',
      {
        p_variant_id: variantId,
        p_quantity: quantity,
        p_saved_for_later: savedForLater,
        p_seen_unit_price: seenUnitPrice,
      },
      accountCartSchema,
    );
  }

  createOrder(payload: Parameters<CommerceRepository['createOrder']>[0]) {
    return rpc(this.client, 'create_order', { p_payload: payload }, createOrderResultSchema);
  }

  getMyOrder(orderNumber: string) {
    return rpc(
      this.client,
      'get_my_order',
      { p_order_number: orderNumber },
      orderSchema.nullable(),
    );
  }

  listMyOrders() {
    return rpc(this.client, 'list_my_orders', { p_limit: 50 }, z.array(orderSummarySchema));
  }

  cancelMyOrder(orderNumber: string, reason: string | null) {
    return rpc(
      this.client,
      'cancel_my_order',
      { p_order_number: orderNumber, p_reason: reason },
      z.object({ ok: z.boolean(), code: z.string().optional(), order: orderSchema.optional() }),
    );
  }
}

export class SupabaseOrderOperationsRepository implements OrderOperationsRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  listOrders(filter: Parameters<OrderOperationsRepository['listOrders']>[0] = {}) {
    return rpc(
      this.client,
      'staff_list_orders',
      { p_filter: filter },
      z.object({ total: z.number().int(), items: z.array(staffOrderSummarySchema) }),
    );
  }

  getOrder(orderId: string) {
    return rpc(
      this.client,
      'staff_get_order',
      { p_order_id: orderId },
      staffOrderSchema.nullable(),
    );
  }

  setStatus(
    orderId: string,
    status: Parameters<OrderOperationsRepository['setStatus']>[1],
    note: string | null,
  ) {
    return rpc(
      this.client,
      'staff_set_order_status',
      { p_order_id: orderId, p_status: status, p_note: note },
      staffActionResultSchema,
    );
  }

  cancel(orderId: string, reason: string) {
    return rpc(
      this.client,
      'staff_cancel_order',
      { p_order_id: orderId, p_reason: reason },
      staffActionResultSchema,
    );
  }

  setShipping(orderId: string, input: Parameters<OrderOperationsRepository['setShipping']>[1]) {
    return rpc(
      this.client,
      'staff_set_shipping',
      {
        p_order_id: orderId,
        p_fee: input.fee,
        p_eta: input.eta ?? null,
        p_courier: input.courier ?? null,
        p_tracking: input.tracking ?? null,
        p_note: input.note ?? null,
      },
      staffActionResultSchema,
    );
  }

  markPaymentVerification(orderId: string, note: string | null) {
    return rpc(
      this.client,
      'staff_mark_payment_verification',
      { p_order_id: orderId, p_note: note },
      staffActionResultSchema,
    );
  }

  recordPayment(orderId: string, input: Parameters<OrderOperationsRepository['recordPayment']>[1]) {
    return rpc(
      this.client,
      'staff_record_payment',
      {
        p_order_id: orderId,
        p_amount: input.amount,
        p_method: input.method,
        p_reference: input.reference ?? null,
        p_note: input.note ?? null,
      },
      staffActionResultSchema,
    );
  }

  review(orderId: string, decision: 'approved' | 'rejected', note: string | null) {
    return rpc(
      this.client,
      'staff_review_order',
      { p_order_id: orderId, p_decision: decision, p_note: note },
      staffActionResultSchema,
    );
  }

  addNote(orderId: string, note: string) {
    return rpc(
      this.client,
      'staff_add_order_note',
      { p_order_id: orderId, p_note: note },
      staffActionResultSchema,
    );
  }

  releaseExpiredReservations() {
    return rpc(this.client, 'release_expired_reservations', {}, z.number().int());
  }
}
