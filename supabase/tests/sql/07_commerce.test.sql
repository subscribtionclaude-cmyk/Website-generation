-- Commerce: pricing windows, quotes, promo codes, atomic idempotent checkout, reservations,
-- shipping fee, payments (COD / InstaPay / split), manual review, stock commit, cancellation,
-- cart merge, snapshots, RLS & ownership. Mirrors src/domain/commerce/*.test.ts where applicable.
begin;
update public.site_settings set value = value || '{"showDemoCatalog": true, "promoCodes": true}' where key = 'features';
-- Start with manual review rules off; each review test turns on only the rule it checks.
update public.site_settings set value = jsonb_build_object(
    'preset', 'custom',
    'highValue', jsonb_build_object('enabled', false, 'threshold', 100000),
    'multipleExpensive', jsonb_build_object('enabled', false, 'unitPrice', 20000, 'minUnits', 2),
    'newCustomer', jsonb_build_object('enabled', false, 'minTotal', 30000),
    'splitPayment', jsonb_build_object('enabled', false),
    'unfinishedOrders', jsonb_build_object('enabled', false, 'maxCount', 2, 'windowDays', 7),
    'velocity', jsonb_build_object('enabled', false, 'maxOrders', 3, 'windowHours', 1))
  where key = 'order_review';

select id as airpods from public.product_variants where sku = 'APP3-WHITE' \gset
select id as case18 from public.product_variants where sku = 'CASE18P-WHITE' \gset
select id as cable from public.product_variants where sku = 'USBC-1M-WHITE' \gset
select id as ap4 from public.product_variants where sku = 'AP4-STANDARD-WHITE' \gset
select id as aws from public.product_variants where sku = 'AWS11-42MM-BLACK' \gset
select id as ps5 from public.product_variants where sku = 'PS5S-DIGITAL-WHITE' \gset
select id as promax from public.product_variants where sku = 'IP18PM-256GB-BLACK' \gset
select id as soldout from public.product_variants where sku = 'IP18P-1TB-ORANGE' \gset
select v.id as mba from public.product_variants v join public.products p on p.id = v.product_id
  where p.slug = 'macbook-air-13' and v.sku = 'MBA13-256GB-MIDNIGHT' \gset
select id as charger from public.product_variants where sku = 'A20W-WHITE' \gset

\set pickup '{"method": "pickup", "branchId": "abbasseya"}'
\set delivery '{"method": "delivery", "governorate": "cairo", "area": "Nasr City", "address": "12 Makram Ebeid St, floor 3"}'

select tests.create_user('cust1@test.local') as cust1 \gset
select tests.create_user('cust2@test.local') as cust2 \gset
select tests.create_user('cust3@test.local') as cust3 \gset
select tests.create_user('sales7@test.local', 'sales') as sales \gset
select tests.create_user('manager7@test.local', 'store_manager') as manager \gset
select tests.create_user('editor7@test.local', 'content_editor') as editor \gset

-- ── Pricing windows & availability ──────────────────────────────────────────
select tests.act_as_anon();
select tests.assert_equal((public.catalog_product('airpods-pro-3') -> 'variants' -> 0 ->> 'price')::numeric, 13500.00,
  'automatic time-bound offer sets the selling price');
select tests.assert_equal((public.catalog_product('airpods-pro-3') -> 'variants' -> 0 ->> 'compareAtPrice')::numeric, 15000.00,
  'regular price shown as the "was" price while the offer runs');
select tests.assert_equal((public.catalog_product('playstation-5-slim') -> 'variants' -> 1 ->> 'price')::numeric
                          + (public.catalog_product('playstation-5-slim') -> 'variants' -> 0 ->> 'price')::numeric,
  59500.00, 'fixed-amount flash offer (−2,000) applies to both PS5 editions');
reset role;
update public.offers set ends_at = now() - interval '1 second', starts_at = now() - interval '2 days'
  where slug = 'airpods-pro-3-limited';
select tests.act_as_anon();
select tests.assert_equal((public.catalog_product('airpods-pro-3') -> 'variants' -> 0 ->> 'price')::numeric, 15000.00,
  'price reverts by itself when the offer window ends');
select tests.assert_equal(public.catalog_product('airpods-pro-3') -> 'variants' -> 0 -> 'compareAtPrice', 'null'::jsonb,
  'no "was" price after the offer ends');
reset role;
update public.offers set ends_at = now() + interval '6 days' where slug = 'airpods-pro-3-limited';

-- ── Quote (anonymous cart validation) ───────────────────────────────────────
select tests.act_as_anon();
select public.quote_checkout(tests.items(:'airpods', '1', :'case18', '2', :'ap4', '1', :'aws', '1', :'mba', '1'),
                             'demo10', 'pickup') as q \gset
select tests.assert_equal((:'q'::jsonb ->> 'valid')::boolean, true, 'mixed cart is valid');
select tests.assert_equal((:'q'::jsonb -> 'totals' ->> 'originalSubtotal')::numeric, 111300.00, 'original subtotal (regular prices)');
select tests.assert_equal((:'q'::jsonb -> 'totals' ->> 'subtotal')::numeric, 109800.00, 'subtotal after automatic offers');
select tests.assert_equal((:'q'::jsonb -> 'bundles' -> 0 ->> 'discount')::numeric, 2950.00, 'bundle −10% on AirPods 4 + Watch');
select tests.assert_equal((:'q'::jsonb -> 'promo' ->> 'discount')::numeric, 480.00, 'DEMO10 −10% on eligible accessories only');
select tests.assert_equal((:'q'::jsonb -> 'totals' ->> 'discountTotal')::numeric, 3430.00, 'discounts add up');
select tests.assert_equal((:'q'::jsonb -> 'totals' ->> 'total')::numeric, 106370.00, 'pickup total = subtotal − discounts');
select tests.assert_equal((select count(*)::int from jsonb_array_elements(:'q'::jsonb -> 'lines') l
                           where (l ->> 'isGift')::boolean and (l ->> 'unitPrice')::numeric = 0), 1,
  'free gift line added at price 0 for the MacBook Air offer');
select tests.assert_equal(public.quote_checkout(tests.items(:'airpods', '1'), null, 'delivery') -> 'totals' ->> 'shippingFeeStatus',
  'pending', 'delivery shipping fee is "to be confirmed"');
select tests.assert_equal(public.quote_checkout(tests.items(:'airpods', '6'), null, 'pickup') -> 'lines' -> 0 ->> 'status',
  'max_quantity', 'per-line quantity cap');
select tests.assert_equal(public.quote_checkout(tests.items(:'soldout', '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status',
  'out_of_stock', 'sold-out variant flagged');
select tests.assert_equal(public.quote_checkout(tests.items(gen_random_uuid()::text, '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status',
  'unavailable', 'unknown variant flagged, never priced');
select tests.assert_equal(public.quote_checkout('[{"variantId": "x", "quantity": "lots"}, {"quantity": 1}]'::jsonb) ->> 'valid',
  'false', 'malformed items are ignored safely');
select tests.assert_equal(public.quote_checkout(tests.items(:'airpods', '1'), 'DEMO10', 'pickup') -> 'promo' ->> 'reason',
  'not_applicable', 'promo not applicable to non-accessories');
select tests.assert_equal(public.quote_checkout(tests.items(:'cable', '1'), 'NOPE99', 'pickup') -> 'promo' ->> 'reason',
  'not_found', 'unknown promo code');
reset role;
update public.offers set ends_at = now() - interval '1 second', starts_at = now() - interval '2 days'
  where promo_code = 'DEMO10';
select tests.assert_equal(public.quote_checkout(tests.items(:'cable', '1'), 'demo10', 'pickup') -> 'promo' ->> 'reason',
  'expired', 'expired promo rejected server-side');
update public.offers set ends_at = now() + interval '30 days' where promo_code = 'DEMO10';
update public.site_settings set value = value || '{"promoCodes": false}' where key = 'features';
select tests.assert_equal(public.quote_checkout(tests.items(:'cable', '1'), 'DEMO10', 'pickup') -> 'promo' ->> 'reason',
  'disabled', 'promo codes respect the admin feature toggle');
update public.site_settings set value = value || '{"promoCodes": true}' where key = 'features';

-- ── create_order: validation, price authority, idempotency ──────────────────
select tests.act_as_anon();
select tests.assert_raises($$select public.create_order('{}'::jsonb)$$, '42501', 'checkout requires sign-in (anon has no execute right)');
reset role;

select tests.act_as(:'cust1');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "cod"}', null,
                                         gen_random_uuid(), '12345') ->> 'code', 'invalid_phone', 'phone validated');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), '{"method": "delivery", "governorate": "cairo"}',
                                         '{"method": "cod"}') ->> 'code', 'invalid_address', 'delivery address required');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'delivery', '{"method": "pay_at_store"}') ->> 'code',
  'payment_method_unavailable', 'pay at store is not a V1 payment method (delivery)');
reset role;
update public.site_settings set value = value || '{"payAtStore": true}' where key = 'features';
select tests.act_as(:'cust1');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "pay_at_store"}') ->> 'code',
  'payment_method_unavailable', 'pay at store is rejected even for pickup and even if a stray flag is set');
reset role;
update public.site_settings set value = value - 'payAtStore' where key = 'features';
select tests.act_as(:'cust1');
select tests.assert_equal(public.create_order(jsonb_build_object(
    'idempotencyKey', gen_random_uuid(), 'items', jsonb_build_array(jsonb_build_object('variantId', :'airpods', 'quantity', 1,
      'expectedUnitPrice', 1)), 'expectedTotal', 1, 'contact', jsonb_build_object('name', 'Mona', 'phone', '01012345678'),
    'fulfillment', :'pickup'::jsonb, 'payment', '{"method": "cod"}'::jsonb)) ->> 'code', 'price_changed',
  'client-side prices are never trusted: a mismatch returns the current quote');
select tests.assert_equal(public.create_order(jsonb_build_object(
    'idempotencyKey', gen_random_uuid(), 'items', jsonb_build_array(jsonb_build_object('variantId', :'airpods', 'quantity', 1,
      'expectedUnitPrice', 13500)), 'contact', jsonb_build_object('name', 'Mona', 'phone', '01012345678'),
    'fulfillment', :'pickup'::jsonb, 'payment', '{"method": "cod"}'::jsonb)) ->> 'code', 'price_changed',
  'a missing expected total also counts as unconfirmed prices');
reset role;
select tests.assert_equal((select count(*)::int from public.orders), 0, 'rejected checkouts write nothing');

select tests.act_as(:'cust1');
select tests.checkout(tests.items(:'ps5', '1', :'cable', '2'), :'pickup', '{"method": "cod"}', 'DEMO10',
                      '11111111-1111-4111-8111-111111111111', '+20 101 234 5678') as o1 \gset
select tests.assert_equal((:'o1'::jsonb ->> 'ok')::boolean, true, 'COD pickup order created');
select tests.assert((:'o1'::jsonb -> 'order' ->> 'orderNumber') ~ '^MS-[0-9]{4}-[0-9]{6}$', 'human-friendly order number');
select tests.assert_equal(:'o1'::jsonb -> 'order' ->> 'paymentStatus', 'cod_pending', 'COD: payment due on delivery');
select tests.assert_equal((:'o1'::jsonb -> 'order' -> 'totals' ->> 'total')::numeric, 29120.00,
  'total = 27,500 (flash) + 2 × 900 − 10% DEMO10 on cables (180)');
select tests.assert_equal((:'o1'::jsonb -> 'order' -> 'totals' ->> 'paidAmount')::numeric, 0.00, 'nothing paid yet');
select tests.assert_equal((:'o1'::jsonb -> 'order' -> 'totals' ->> 'remainingAmount')::numeric, 29120.00, 'remaining = total');
select tests.assert_equal(:'o1'::jsonb -> 'order' -> 'customer' ->> 'phone', '+201012345678', 'phone normalised to E.164');
select tests.assert_equal(:'o1'::jsonb -> 'order' -> 'fulfillment' -> 'pickupBranch' -> 'address' ->> 'en', '72 Abbasseya Street',
  'pickup branch snapshot comes from store settings');
select tests.checkout(tests.items(:'ps5', '1', :'cable', '2'), :'pickup', '{"method": "cod"}', 'DEMO10',
                      '11111111-1111-4111-8111-111111111111') as o1b \gset
select tests.assert_equal((:'o1b'::jsonb ->> 'duplicate')::boolean, true, 'same idempotency key → same order (double click / retry)');
select tests.assert_equal(:'o1b'::jsonb -> 'order' ->> 'orderNumber', :'o1'::jsonb -> 'order' ->> 'orderNumber',
  'retry returns the original order number');
reset role;
select (:'o1'::jsonb -> 'order' ->> 'id')::uuid as o1id \gset
select tests.assert_equal((select count(*)::int from public.orders where customer_id = :'cust1'), 1, 'exactly one order row');
select tests.assert_equal((select count(*)::int from public.stock_reservations where order_id = :'o1id' and status = 'active'), 2,
  'one active reservation per line');
select tests.assert(abs(extract(epoch from (select reservation_expires_at from public.orders where id = :'o1id') - now()) - 1800) < 1,
  'default soft reservation: 30 minutes');
select tests.assert_equal((select count(*)::int from public.promo_redemptions where order_id = :'o1id'), 1, 'promo redemption recorded');
select tests.assert_equal((select unit_price from public.order_items where order_id = :'o1id' and line_no = 1), 27500.00,
  'unit price snapshot');
select tests.assert_equal((select variant_label ->> 'en' from public.order_items where order_id = :'o1id' and line_no = 1),
  'Digital edition · White', 'variant snapshot');
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'ps5'), 1,
  'reservation does not decrement stock');

-- ── Reservation race (single process): stock 1, A holds it, B is refused ────
select tests.act_as(:'cust2');
select tests.assert_equal(public.quote_checkout(tests.items(:'ps5', '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status',
  'out_of_stock', 'reserved unit is unavailable to others');
select tests.assert_equal((public.catalog_product('playstation-5-slim') -> 'variants' -> 1 ->> 'stockState'), 'out_of_stock',
  'storefront stock state excludes active reservations');
select tests.assert_equal(tests.checkout(tests.items(:'ps5', '1'), :'pickup', '{"method": "cod"}') ->> 'code', 'cart_invalid',
  'B cannot reserve stock A holds');
reset role;
update public.stock_reservations set expires_at = now() - interval '1 second' where order_id = :'o1id';
select tests.act_as(:'cust2');
select tests.assert_equal(public.quote_checkout(tests.items(:'ps5', '1'), null, 'pickup') -> 'lines' -> 0 ->> 'status', 'ok',
  'expired reservation stops counting by timestamp (no cron)');
select tests.checkout(tests.items(:'ps5', '1'), :'pickup', '{"method": "cod"}') as o2 \gset
select tests.assert_equal((:'o2'::jsonb ->> 'ok')::boolean, true, 'B reserves after A expired');
reset role;
select (:'o2'::jsonb -> 'order' ->> 'id')::uuid as o2id \gset

-- A's expired order cannot be confirmed while B holds the last unit.
select tests.act_as(:'sales');
select tests.assert_equal(public.staff_set_order_status(:'o1id', 'confirmed') ->> 'code', 'stock_unavailable',
  'confirming an expired hold re-checks availability');
select tests.assert_equal(public.staff_cancel_order(:'o1id', 'x') ->> 'code', 'reason_required', 'staff cancellation needs a reason');
select tests.assert_equal((public.staff_cancel_order(:'o1id', 'Customer unreachable') ->> 'ok')::boolean, true, 'staff cancels A');
reset role;
select tests.assert_equal((select status from public.promo_redemptions where order_id = :'o1id'), 'released',
  'cancellation releases the promo redemption');
select tests.assert_equal((select payment_status from public.orders where id = :'o1id'), 'void', 'unpaid cancelled order is void');

-- ── Confirm commits stock exactly once ──────────────────────────────────────
select tests.act_as(:'sales');
select tests.assert_equal((public.staff_set_order_status(:'o2id', 'confirmed') ->> 'ok')::boolean, true, 'COD pickup confirmed');
select tests.assert_equal(public.staff_set_order_status(:'o2id', 'confirmed') ->> 'code', 'invalid_transition',
  'cannot confirm twice');
reset role;
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'ps5'), 0, 'confirmed sale decrements stock');
select tests.assert_equal((select count(*)::int from public.stock_movements where order_id = :'o2id' and reason = 'sale'), 1,
  'one coherent sale movement');
select tests.assert_equal((select status from public.stock_reservations where order_id = :'o2id'), 'committed',
  'reservation converted to committed');
select tests.assert_equal((select count(*)::int from public.stock_movements where order_id = :'o1id'), 0,
  'cancelled-before-commit order produced no stock movement');
select tests.act_as(:'cust2');
select tests.assert_equal(public.cancel_my_order(:'o2'::jsonb -> 'order' ->> 'orderNumber') ->> 'code', 'cannot_cancel',
  'customer cannot cancel after stock commitment');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal((public.staff_set_order_status(:'o2id', 'preparing') ->> 'ok')::boolean, true, 'preparing');
select tests.assert_equal(public.staff_set_order_status(:'o2id', 'out_for_delivery') ->> 'code', 'invalid_transition',
  'pickup orders never go out for delivery');
select tests.assert_equal((public.staff_set_order_status(:'o2id', 'ready_for_pickup') ->> 'ok')::boolean, true, 'ready for pickup');
select tests.assert_equal(public.staff_set_order_status(:'o2id', 'completed') ->> 'code', 'balance_due',
  'cannot complete with a balance due');
select tests.assert_raises(format('select public.staff_record_payment(%L, 27500, %L)', :'o2id', 'cash'), '42501',
  'sales role cannot verify money (payments.verify)');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal((public.staff_record_payment(:'o2id', 27500, 'cash') -> 'order' ->> 'paymentStatus'), 'paid',
  'cash collected at the store → paid');
select tests.assert_equal((public.staff_set_order_status(:'o2id', 'completed') ->> 'ok')::boolean, true, 'completed');
select tests.assert_equal(public.staff_cancel_order(:'o2id', 'Too late') ->> 'code', 'cannot_cancel',
  'completed orders go to after-sales, not cancellation');
reset role;
select tests.assert_equal((select count(*)::int from public.order_events where order_id = :'o2id' and event_type = 'status'), 5,
  'status history: new → confirmed → preparing → ready_for_pickup → completed');

-- ── Delivery + manual shipping fee + split payment ──────────────────────────
select tests.act_as(:'cust3');
select tests.checkout(tests.items(:'airpods', '1'), :'delivery', '{"method": "split", "depositAmount": 5000}') as o3 \gset
select tests.assert_equal((:'o3'::jsonb ->> 'ok')::boolean, true, 'split delivery order created');
select tests.assert_equal(:'o3'::jsonb -> 'order' -> 'totals' ->> 'shippingFeeStatus', 'pending', 'shipping fee pending');
select tests.assert_equal((:'o3'::jsonb -> 'order' -> 'totals' ->> 'total')::numeric, 13500.00, 'total excludes the pending fee');
select tests.assert_equal(:'o3'::jsonb -> 'order' ->> 'paymentStatus', 'awaiting_deposit', 'split starts awaiting the deposit');
select (:'o3'::jsonb -> 'order' ->> 'id')::uuid as o3id \gset
select tests.assert_raises(format('select public.staff_set_shipping(%L, 0)', :'o3id'), '42501',
  'customers cannot set shipping fees');
select tests.assert_raises(format('select public.staff_record_payment(%L, 13500, %L)', :'o3id', 'instapay'), '42501',
  'customers cannot mark payments verified');
select tests.assert_raises(format('update public.orders set total = 1 where id = %L', :'o3id'), '42501',
  'customers cannot modify order totals');
select tests.assert_raises(format('insert into public.payment_records (order_id, method, kind, amount, verified_by) values (%L, %L, %L, 1, %L)',
                                  :'o3id', 'instapay', 'payment', :'cust3'), '42501', 'customers cannot insert payment records');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal(public.staff_set_order_status(:'o3id', 'confirmed') ->> 'code', 'shipping_fee_pending',
  'delivery orders need a confirmed shipping fee first');
select tests.assert_equal(public.staff_set_shipping(:'o3id', 150) -> 'order' -> 'totals' ->> 'total', '13650.00',
  'staff shipping fee recalculates the total');
select tests.assert_equal(public.staff_set_order_status(:'o3id', 'confirmed') ->> 'code', 'deposit_not_verified',
  'split orders need a verified deposit');
select tests.assert_equal((public.staff_mark_payment_verification(:'o3id', 'Screenshot received on WhatsApp') -> 'order' ->> 'paymentStatus'),
  'verification_pending', 'a screenshot only starts verification');
reset role;
select tests.assert_equal((select paid_amount from public.orders where id = :'o3id'), 0.00, 'screenshot never changes paid amount');
select tests.act_as(:'manager');
select tests.assert_equal(public.staff_record_payment(:'o3id', 20000, 'instapay') ->> 'code', 'exceeds_remaining',
  'cannot record more than the remaining balance');
select public.staff_record_payment(:'o3id', 5000, 'instapay', 'IPN-778899') as p3 \gset
select tests.assert_equal(:'p3'::jsonb -> 'order' ->> 'paymentStatus', 'deposit_verified', 'deposit verified');
select tests.assert_equal((:'p3'::jsonb -> 'order' -> 'totals' ->> 'remainingAmount')::numeric, 8650.00,
  'remaining balance due on delivery');
select tests.assert_equal(public.staff_set_shipping(:'o3id', 0) -> 'order' -> 'totals' ->> 'remainingAmount', '8500.00',
  'fee change keeps the paid amount and recomputes the balance');
reset role;
select tests.assert_raises(format('update public.orders set paid_amount = total + 1 where id = %L', :'o3id'), '23514',
  'database constraint: paid amount can never exceed the total');
select tests.assert_raises(format('update public.orders set total = total + 1 where id = %L', :'o3id'), '23514',
  'database constraint: total = subtotal − discount + shipping');
select tests.assert_equal((select paid_amount + remaining_amount = total from public.orders where id = :'o3id'), true,
  'paid + remaining = total');
select tests.assert_equal((select kind from public.payment_records where order_id = :'o3id'), 'deposit', 'payment record kind');
select tests.assert_equal((select count(*)::int from public.audit_logs where entity_id = :'o3id'::text and action = 'order.deposit_verified'), 1,
  'deposit verification audited');
select tests.assert_equal((select count(*)::int from public.audit_logs where entity_id = :'o3id'::text and action = 'order.shipping_updated'), 2,
  'shipping fee changes audited');

-- ── InstaPay full payment ───────────────────────────────────────────────────
select tests.act_as(:'cust3');
select tests.checkout(tests.items(:'aws', '1'), :'pickup', '{"method": "instapay"}') as o4 \gset
select (:'o4'::jsonb -> 'order' ->> 'id')::uuid as o4id \gset
select tests.assert_equal(:'o4'::jsonb -> 'order' ->> 'paymentStatus', 'awaiting_payment', 'InstaPay awaits payment');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal(public.staff_set_order_status(:'o4id', 'confirmed') ->> 'code', 'payment_not_verified',
  'InstaPay orders are confirmed only after staff verify the money');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.staff_record_payment(:'o4id', 22000, 'instapay') -> 'order' ->> 'paymentStatus', 'paid',
  'verified InstaPay transfer → paid');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal((public.staff_set_order_status(:'o4id', 'confirmed') ->> 'ok')::boolean, true, 'paid InstaPay order confirmed');
select tests.assert_equal(public.staff_cancel_order(:'o4id', 'Changed mind') ->> 'code', 'refund_required',
  'paid orders need the refund workflow, never a silent cancel');
reset role;

-- ── Manual review ───────────────────────────────────────────────────────────
update public.site_settings set value = jsonb_set(value, '{multipleExpensive,enabled}', 'true') where key = 'order_review';
select tests.act_as(:'cust2');
select tests.checkout(tests.items(:'promax', '2'), :'pickup', '{"method": "cod"}') as o5 \gset
select (:'o5'::jsonb -> 'order' ->> 'id')::uuid as o5id \gset
select tests.assert_equal((:'o5'::jsonb -> 'order' ->> 'reviewPending')::boolean, true, 'multiple expensive devices → manual review');
select tests.assert(not (:'o5'::jsonb -> 'order' ? 'manualReview'), 'customers never see fraud-rule details');
reset role;
select tests.assert_equal((select manual_review_reasons from public.orders where id = :'o5id'), array['multiple_expensive'],
  'review reason recorded');
select tests.act_as(:'sales');
select tests.assert_equal(public.staff_set_order_status(:'o5id', 'confirmed') ->> 'code', 'review_pending',
  'orders under review cannot be confirmed');
select tests.assert_raises(format('select public.staff_review_order(%L, %L)', :'o5id', 'approved'), '42501',
  'review decisions need payments.verify');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.staff_review_order(:'o5id', 'approved', 'Known customer') -> 'order' -> 'manualReview' ->> 'status',
  'approved', 'manager approves');
select tests.assert_equal((public.staff_set_order_status(:'o5id', 'confirmed') ->> 'ok')::boolean, true, 'approved order confirmed');
select tests.assert_equal((public.staff_set_order_status(:'o5id', 'preparing') ->> 'ok')::boolean, true, 'preparing (manager)');
reset role;
select stock_quantity as promax_before from public.product_variants where id = :'promax' \gset
select tests.act_as(:'sales');
select tests.assert_equal((public.staff_cancel_order(:'o5id', 'Out of warranty stock mix-up') ->> 'ok')::boolean, true,
  'staff can cancel a committed but unpaid order before dispatch');
reset role;
select tests.assert_equal((select stock_quantity from public.product_variants where id = :'promax'), :'promax_before'::int + 2,
  'cancellation after commit restocks');
select tests.assert_equal((select count(*)::int from public.stock_movements where order_id = :'o5id' and reason = 'cancellation_restock'), 1,
  'restock movement recorded');
update public.site_settings set value = jsonb_set(value, '{multipleExpensive,enabled}', 'false') where key = 'order_review';
update public.site_settings set value = jsonb_set(value, '{splitPayment,enabled}', 'true') where key = 'order_review';
select tests.act_as(:'cust2');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "split"}') -> 'order' ->> 'reviewPending',
  'true', 'split-payment rule');
reset role;

-- ── Customer cancel releases the hold; open-order limit; promo per-customer limit ─
select tests.act_as(:'cust1');
select tests.checkout(tests.items(:'case18', '1'), :'pickup', '{"method": "cod"}', 'DEMO10') as o6 \gset
select tests.assert_equal((public.cancel_my_order(:'o6'::jsonb -> 'order' ->> 'orderNumber', 'Ordered by mistake') ->> 'ok')::boolean,
  true, 'customer cancels before confirmation');
reset role;
select tests.assert_equal((select count(*)::int from public.stock_reservations
                           where order_id = (:'o6'::jsonb -> 'order' ->> 'id')::uuid and status = 'released'), 1,
  'reservation released on cancel');
select tests.act_as(:'cust1');
select tests.assert_equal(tests.checkout(tests.items(:'case18', '1'), :'pickup', '{"method": "cod"}', 'DEMO10') ->> 'ok', 'true',
  'redeem DEMO10 (1/2)');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "cod"}', 'DEMO10') ->> 'ok', 'true',
  'redeem DEMO10 (2/2)');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "cod"}', 'DEMO10') ->> 'code', 'promo_invalid',
  'per-customer promo limit enforced');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "cod"}') ->> 'ok', 'true',
  'third open order allowed');
select tests.assert_equal(tests.checkout(tests.items(:'cable', '1'), :'pickup', '{"method": "cod"}') ->> 'code', 'too_many_open_orders',
  'open-order limit stops reservation hoarding');

-- ── Ownership & RLS ─────────────────────────────────────────────────────────
select tests.assert_equal((select count(*)::int from public.orders where customer_id <> :'cust1'), 0,
  'customers only see their own orders (RLS)');
select tests.assert_equal(public.get_my_order(:'o2'::jsonb -> 'order' ->> 'orderNumber'), null::jsonb,
  'guessing another order number returns nothing');
select tests.assert_raises($$select public.staff_list_orders('{}')$$, '42501', 'customers cannot list all orders');
select tests.assert_equal(jsonb_array_length(public.list_my_orders()), 5, 'my orders list');
select tests.assert_equal((select count(*)::int from public.stock_reservations), 0, 'reservations are staff-only');
select tests.assert_equal((select count(*)::int from public.order_events e where e.visible_to_customer = false), 0,
  'internal timeline events hidden from customers');
reset role;
select tests.act_as_anon();
select tests.assert_raises($$select count(*) from public.orders$$, '42501', 'anon cannot read orders');
select tests.assert_raises($$select public.get_my_order('MS-2026-000001')$$, '42501', 'anon cannot call order RPCs');
reset role;
select tests.act_as(:'editor');
select tests.assert_raises(format('select public.staff_get_order(%L)', :'o2id'), '42501', 'content editors cannot read orders');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal((public.staff_list_orders('{"limit": 100}') ->> 'total')::int,
  (select count(*)::int from public.orders), 'staff with orders.view list all orders');
select tests.assert_equal((public.staff_list_orders('{"reviewPending": true}') ->> 'total')::int, 1, 'review queue filter');
reset role;

-- ── Snapshots survive catalog changes ───────────────────────────────────────
update public.product_variants set price = 99999 where id = :'aws';
update public.products set name = '{"ar": "اسم جديد", "en": "Renamed"}' where id = (select product_id from public.product_variants where id = :'aws');
select tests.assert_equal((select unit_price from public.order_items where order_id = :'o4id'), 22000.00,
  'historical order keeps the purchase-time price');
select tests.assert_equal((select product_name ->> 'en' from public.order_items where order_id = :'o4id'), 'Apple Watch Series 11',
  'historical order keeps the purchase-time name');

-- ── Account cart merge ──────────────────────────────────────────────────────
select tests.act_as(:'cust3');
select public.cart_set_item(:'cable', 3) as c0 \gset
select public.cart_merge(jsonb_build_array(
  jsonb_build_object('variantId', :'cable', 'quantity', 4),
  jsonb_build_object('variantId', :'airpods', 'quantity', 1, 'savedForLater', true),
  jsonb_build_object('variantId', gen_random_uuid(), 'quantity', 1))) as merged \gset
select tests.assert_equal((select (i ->> 'quantity')::int from jsonb_array_elements(:'merged'::jsonb -> 'items') i
                           where i ->> 'variantId' = :'cable'), 5, 'same variant merged and capped at the per-line maximum');
select tests.assert_equal((select (i ->> 'savedForLater')::boolean from jsonb_array_elements(:'merged'::jsonb -> 'items') i
                           where i ->> 'variantId' = :'airpods'), true, 'saved-for-later kept');
select tests.assert_equal(jsonb_array_length(:'merged'::jsonb -> 'items'), 2, 'no duplicate lines');
select tests.assert_equal((select count(*)::int from jsonb_array_elements(:'merged'::jsonb -> 'adjustments') a
                           where a ->> 'reason' = 'removed_missing'), 1, 'unknown variant reported, not silently kept');
select tests.assert_equal(jsonb_array_length(public.cart_set_item(:'cable', 0) -> 'items'), 1, 'quantity 0 removes the line');
reset role;
select tests.act_as(:'cust2');
select tests.assert_equal(jsonb_array_length(public.cart_get() -> 'items'), 0, 'carts are private');
reset role;

-- ── Optional cleanup of expired holds ───────────────────────────────────────
update public.stock_reservations set expires_at = now() - interval '1 second' where status = 'active';
select tests.act_as(:'sales');
select tests.assert(public.release_expired_reservations() > 0, 'expired holds can be tidied up (optional)');
reset role;
select tests.assert_equal((select count(*)::int from public.stock_reservations where status = 'active' and expires_at <= now()), 0,
  'no stale active reservations left');

rollback;
