-- Customer features: profile & addresses, notifications (order events, idempotency, preferences,
-- manual staff message), wishlist (merge, dedupe, price drop), recently viewed, notify-me / waitlist
-- lifecycle (claim, back in stock, waitlist event), abandoned carts, verified-buyer reviews and
-- moderation, rule-based recommendations, RLS & privacy. Mirrors src/domain/customer/*.test.ts.
begin;
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';
update public.site_settings set value = jsonb_build_object(
    'preset', 'custom',
    'highValue', jsonb_build_object('enabled', false, 'threshold', 100000),
    'multipleExpensive', jsonb_build_object('enabled', false, 'unitPrice', 20000, 'minUnits', 2),
    'newCustomer', jsonb_build_object('enabled', false, 'minTotal', 30000),
    'splitPayment', jsonb_build_object('enabled', false),
    'unfinishedOrders', jsonb_build_object('enabled', false, 'maxCount', 2, 'windowDays', 7),
    'velocity', jsonb_build_object('enabled', false, 'maxOrders', 3, 'windowHours', 1))
  where key = 'order_review';
update public.site_settings set value = value || '{"maxOpenOrdersPerCustomer": 20}' where key = 'commerce';

select id as cable from public.product_variants where sku = 'USBC-1M-WHITE' \gset
select id as charger from public.product_variants where sku = 'A20W-WHITE' \gset
select id as ap4 from public.product_variants where sku = 'AP4-STANDARD-WHITE' \gset
select id as soldout from public.product_variants where sku = 'IP18P-1TB-ORANGE' \gset
select id as p_cable from public.products where slug = 'usb-c-cable' \gset
select id as p_charger from public.products where slug = 'apple-20w-usb-c-adapter' \gset
select id as p_ap4 from public.products where slug = 'airpods-4' \gset
select id as p_ip18 from public.products where slug = 'iphone-18-pro' \gset
select id as p_duo from public.products where slug = 'iphone-duo' \gset

\set delivery '{"method": "delivery", "governorate": "cairo", "area": "Nasr City", "address": "12 Makram Ebeid St, floor 3"}'

select tests.create_user('alice8@test.local') as alice \gset
select tests.create_user('bob8@test.local') as bob \gset
select tests.create_user('carol8@test.local') as carol \gset
select tests.create_user('dave8@test.local') as dave \gset
select tests.create_user('manager8@test.local', 'store_manager') as manager \gset
select tests.create_user('cs8@test.local', 'customer_service') as cs \gset
select tests.create_user('editor8@test.local', 'content_editor') as editor \gset

-- Staff path to "delivered" for a delivery order (fee → confirmed → preparing → out → delivered).
create or replace function tests.deliver(p_order uuid, p_manager uuid) returns void language plpgsql as $$
begin
  perform tests.act_as(p_manager);
  perform public.staff_set_shipping(p_order, 50);
  perform public.staff_set_order_status(p_order, 'confirmed');
  perform public.staff_set_order_status(p_order, 'preparing');
  perform public.staff_set_order_status(p_order, 'out_for_delivery');
  perform public.staff_set_order_status(p_order, 'delivered');
  reset role;
end;
$$;

-- ── Profile & addresses ─────────────────────────────────────────────────────
select tests.act_as(:'alice');
select tests.assert_equal(public.update_my_profile('Alice Adel', '0101 234 5678', 'en') -> 'profile' ->> 'phone',
  '+201012345678', 'profile phone normalised like checkout');
select tests.assert_equal(public.update_my_profile('Alice Adel', '12345') ->> 'code', 'invalid_phone', 'invalid phone rejected');
select tests.assert_equal(public.save_my_address(jsonb_build_object('label', 'home', 'governorate', 'cairo',
  'area', 'Nasr City', 'address', '12 Makram Ebeid St')) -> 'address' ->> 'isDefault', 'true', 'first address becomes default');
select public.save_my_address(jsonb_build_object('label', 'work', 'governorate', 'giza', 'area', 'Dokki',
  'address', '5 Tahrir St', 'isDefault', true)) -> 'address' ->> 'id' as work_addr \gset
select tests.assert_equal((select count(*)::int from jsonb_array_elements(public.list_my_addresses()) a
                           where (a ->> 'isDefault')::boolean), 1, 'exactly one default address');
select tests.assert_equal((public.list_my_addresses() -> 0 ->> 'id'), :'work_addr', 'new default listed first');
select tests.assert_equal(public.save_my_address(jsonb_build_object('governorate', 'cairo', 'area', 'N',
  'address', '12 St')) ->> 'field', 'area', 'same address rules as checkout');
select tests.assert_raises($$insert into public.customer_addresses (user_id, governorate, area, address)
  values (app.current_actor_id(), 'cairo', 'Area', 'Some address')$$, '42501', 'no direct address writes');
reset role;
select tests.act_as(:'bob');
select tests.assert_equal(jsonb_array_length(public.list_my_addresses()), 0, 'addresses are private');
select tests.assert_equal(public.save_my_address(jsonb_build_object('id', :'work_addr', 'governorate', 'cairo',
  'area', 'Heliopolis', 'address', '1 Street name')) ->> 'code', 'not_found', 'cannot edit another customer''s address');
select tests.assert_equal((select count(*)::int from public.customer_addresses), 0, 'RLS hides other addresses');
reset role;
select tests.act_as_anon();
select tests.assert_raises($$select public.list_my_addresses()$$, '42501', 'anonymous cannot call account RPCs');
reset role;

-- ── Orders → in-app notifications (idempotent) ─────────────────────────────
select tests.act_as(:'alice');
select tests.checkout(tests.items(:'cable', '1'), :'delivery', '{"method": "cod"}') -> 'order' as o1 \gset
select (:'o1'::jsonb ->> 'id') as o1_id, (:'o1'::jsonb ->> 'orderNumber') as o1_no \gset
reset role;
select tests.deliver(:'o1_id', :'manager');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and category = 'order'), 4,
  'confirmed / preparing / out for delivery / delivered each notified once');
insert into public.order_events (order_id, event_type, status, visible_to_customer, actor_kind)
values (:'o1_id', 'status', 'delivered', true, 'staff');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and category = 'order'), 4,
  'a duplicate status event does not create a duplicate notification');
select tests.assert_equal((select action_path from public.notifications where user_id = :'alice'
                           and dedupe_key = 'order:' || :'o1_id' || ':delivered'), '/order/' || :'o1_no',
  'notification links to the customer order page');
select tests.assert((select body ->> 'en' from public.notifications where dedupe_key = 'order:' || :'o1_id' || ':confirmed')
                    like '%' || :'o1_no' || '%', 'template placeholders rendered (order number)');
select tests.assert_equal(app.render_template('Hi {{customer_name}} {{unknown}}', '{"customer_name": "A {{status}}"}', 'en'),
  'Hi A status', 'placeholders are a closed set; values cannot inject placeholders');

select tests.act_as(:'alice');
select public.list_my_notifications(2) as inbox \gset
select tests.assert_equal(jsonb_array_length(:'inbox'::jsonb -> 'items'), 2, 'inbox paginates');
select tests.assert_equal((:'inbox'::jsonb ->> 'hasMore')::boolean, true, 'inbox reports more pages');
select tests.assert_equal((:'inbox'::jsonb ->> 'unreadCount')::int, 4, 'unread count');
select tests.assert_equal(public.mark_notification_read((:'inbox'::jsonb -> 'items' -> 0 ->> 'id')::uuid), 3, 'mark one read');
select public.mark_all_notifications_read();
select tests.assert_equal(public.my_unread_notification_count(), 0, 'mark all read');
select tests.assert_raises($$update public.notifications set read_at = null$$, '42501', 'no direct notification writes');
select tests.assert_raises($$select app.notify(app.current_actor_id(), 'order.confirmed', '{}', 'x:1')$$, '42501',
  'customers cannot create notifications');
select tests.assert_equal(public.set_my_notification_preference('order', 'in_app', false) ->> 'code', 'mandatory_category',
  'order updates cannot be switched off in-app');
select tests.assert_equal(public.set_my_notification_preference('price_drop', 'email', true) ->> 'code', 'channel_unavailable',
  'external channels are not offered while no provider is configured');
select tests.assert_equal((select c -> 'channels' -> 'whatsapp' ->> 'available' from jsonb_array_elements(
  public.get_my_notification_preferences()) c where c ->> 'category' = 'order'), 'false', 'WhatsApp shown as unavailable');
reset role;
select tests.act_as(:'bob');
select tests.assert_equal((public.list_my_notifications() ->> 'unreadCount')::int, 0, 'notifications are private (inbox)');
select tests.assert_equal((select count(*)::int from public.notifications), 0, 'notifications are private (RLS)');
select tests.assert_raises($$select public.staff_send_notification(app.current_actor_id(), '{"ar": "x"}', '{"ar": "y"}')$$,
  '42501', 'customers cannot send manual notifications');
reset role;
select tests.act_as(:'cs');
select tests.assert_equal(public.staff_send_notification(:'bob', '{"ar": "مرحبا", "en": "Hello"}',
  '{"ar": "رسالة من المتجر", "en": "A message from the store"}', '/account') ->> 'ok', 'true', 'staff manual in-app message');
reset role;
select tests.assert_equal((select count(*)::int from public.audit_logs where action = 'notification.manual_sent'), 1,
  'manual notification audited');
select tests.assert_equal((select count(*)::int from public.notification_deliveries), 0,
  'no external delivery attempted without a configured provider');

-- ── Wishlist ────────────────────────────────────────────────────────────────
select tests.act_as(:'bob');
select tests.assert_equal(public.wishlist_set(:'p_cable') ->> 'saved', 'true', 'add to wishlist');
select tests.assert_equal(public.wishlist_set(:'p_cable') ->> 'saved', 'true', 'adding twice is harmless');
select public.wishlist_merge(jsonb_build_array(
  jsonb_build_object('productId', :'p_cable', 'addedAt', '2026-01-01T00:00:00Z'),
  jsonb_build_object('productId', :'p_ap4', 'variantId', :'ap4', 'addedAt', '2026-01-02T00:00:00Z'),
  jsonb_build_object('productId', :'p_ap4', 'variantId', :'ap4'),
  jsonb_build_object('productId', gen_random_uuid()),
  jsonb_build_object('productId', 'not-a-uuid'))) as merged \gset
select tests.assert_equal(jsonb_array_length(:'merged'::jsonb -> 'items'), 2, 'merge keeps account entries and adds new ones without duplicates');
select tests.assert_equal(jsonb_array_length(:'merged'::jsonb -> 'adjustments'), 2, 'invalid guest items reported, not silently dropped');
select tests.assert_equal(jsonb_array_length(public.wishlist_merge(:'merged'::jsonb -> 'items') -> 'items'), 2,
  'merging again (repeated login) is idempotent');
select tests.assert_equal(public.wishlist_set(:'p_cable', null, false) ->> 'saved', 'false', 'remove from wishlist');
select tests.assert_equal(jsonb_array_length(public.wishlist_get() -> 'items'), 1, 'account retrieval');
reset role;
select tests.act_as(:'carol');
select tests.assert_equal(jsonb_array_length(public.wishlist_get() -> 'items'), 0, 'wishlists are private');
select tests.assert_equal((select count(*)::int from public.wishlist_items), 0, 'wishlist RLS');
reset role;
-- Price drop on a saved variant (event-driven, idempotent per price).
update public.product_variants set price = 6000 where id = :'ap4';
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'bob' and category = 'price_drop'), 1,
  'price drop ≥ 5 % → one in-app notice');
update public.product_variants set price = 5980 where id = :'ap4';
select tests.act_as(:'bob');
select public.wishlist_get();
reset role;
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'bob' and category = 'price_drop'), 2,
  'a further drop is announced once');
update public.product_variants set price = 5990 where id = :'ap4';
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'bob' and category = 'price_drop'), 2,
  'price rising again does not notify');
update public.product_variants set price = 7500 where id = :'ap4';

-- ── Recently viewed ─────────────────────────────────────────────────────────
update public.site_settings set value = jsonb_set(value, '{recentlyViewed,maxItems}', '3') where key = 'engagement';
select tests.act_as(:'carol');
select public.recent_track(:'p_cable');
select public.recent_track(:'p_charger');
select public.recent_track(:'p_cable');
select tests.assert_equal(public.recent_list() -> 0 ->> 'productId', :'p_cable', 'most recent first, no duplicates');
select tests.assert_equal(jsonb_array_length(public.recent_list()), 2, 'deduplicated');
select public.recent_merge(jsonb_build_array(jsonb_build_object('productId', :'p_ap4', 'viewedAt', '2026-01-01T00:00:00Z'),
  jsonb_build_object('productId', :'p_ip18', 'viewedAt', '2020-01-01T00:00:00Z')));
select tests.assert_equal(jsonb_array_length(public.recent_list()), 3, 'history capped at the configured maximum');
select tests.assert(not exists (select 1 from jsonb_array_elements(public.recent_list()) r where r ->> 'productId' = :'p_ip18'),
  'oldest entry dropped by the cap');
reset role;
select tests.act_as(:'dave');
select tests.assert_equal(jsonb_array_length(public.recent_list()), 0, 'history is private');
reset role;
update public.site_settings set value = jsonb_set(value, '{recentlyViewed,maxItems}', '20') where key = 'engagement';

-- ── Notify-me / waitlist lifecycle ──────────────────────────────────────────
select tests.act_as_anon();
select public.request_stock_alert('iphone-18-pro', 'IP18P-1TB-ORANGE', 'Guest Dave', '01112223334', 'dave8@test.local') as guest_req \gset
reset role;
select tests.assert(:'guest_req'::jsonb ->> 'claimToken' is not null, 'guest request receives a one-time claim token');
select tests.act_as(:'carol');
select public.request_stock_alert('iphone-18-pro', 'IP18P-1TB-ORANGE', 'Carol', '01212223334') ->> 'status' as s \gset
select tests.assert_equal(:'s'::text, 'created', 'signed-in request created');
select public.join_waitlist('iphone-duo', 'Carol', '01212223334', null, '256GB', 'Black');
select tests.assert_equal(public.list_my_requests() -> 'notify' -> 0 ->> 'status', 'active', 'request shown as active');
select tests.assert_equal(public.list_my_requests() -> 'waitlist' -> 0 ->> 'desiredStorage', '256GB', 'waitlist keeps storage/colour');
select tests.assert_equal(public.claim_my_requests(jsonb_build_array(jsonb_build_object('kind', 'notify',
  'id', :'guest_req'::jsonb ->> 'id', 'token', 'wrong-token-wrong-token-wrong'))) ->> 'linked', '0', 'wrong token links nothing');
reset role;
select tests.act_as(:'dave');
select tests.assert_equal((public.claim_my_requests(jsonb_build_array(jsonb_build_object('kind', 'notify',
  'id', :'guest_req'::jsonb ->> 'id', 'token', :'guest_req'::jsonb ->> 'claimToken'))) ->> 'linked')::int >= 1, true,
  'guest request claimed with its token after sign-in');
select tests.assert_equal(jsonb_array_length(public.list_my_requests() -> 'notify'), 1, 'claimed request appears in the account');
reset role;
select tests.act_as(:'bob');
select tests.assert_equal(jsonb_array_length(public.list_my_requests() -> 'notify'), 0, 'requests are private');
reset role;
-- Back in stock (event-driven).
update public.product_variants set stock_quantity = 3 where id = :'soldout';
select tests.assert_equal((select count(*)::int from public.notifications where category = 'back_in_stock'), 2,
  'restock notifies each linked request once');
select tests.assert_equal((select status from public.stock_notifications where user_id = :'carol'), 'notified', 'request → notified');
update public.product_variants set stock_quantity = 5 where id = :'soldout';
select tests.assert_equal((select count(*)::int from public.notifications where category = 'back_in_stock'), 2,
  'another restock does not notify again');
-- Waitlist event.
update public.products set availability_state = 'pre_order' where id = :'p_duo';
select tests.assert_equal((select template_key from public.notifications where user_id = :'carol' and category = 'waitlist'),
  'waitlist.pre_order', 'waitlist → pre-order open notification');
select tests.act_as(:'carol');
select tests.assert_equal(public.list_my_requests() -> 'waitlist' -> 0 ->> 'status', 'notified', 'waitlist entry → notified');
select tests.assert_equal(public.cancel_my_request('waitlist', (public.list_my_requests() -> 'waitlist' -> 0 ->> 'id')::uuid) ->> 'code',
  'not_found', 'a notified entry is closed');
reset role;
update public.stock_notifications set created_at = now() - interval '400 days', status = 'pending' where user_id = :'dave';
select tests.act_as(:'dave');
select tests.assert_equal(public.list_my_requests() -> 'notify' -> 0 ->> 'status', 'expired', 'old requests are shown as expired');
reset role;

-- ── Abandoned carts ─────────────────────────────────────────────────────────
select tests.act_as(:'dave');
select public.cart_set_item(:'cable', 1);
select tests.assert_equal(public.my_cart_status() ->> 'abandoned', 'false', 'recent cart is not abandoned');
reset role;
update public.carts set updated_at = now() - interval '3 days' where customer_id = :'dave';
update public.cart_items set updated_at = now() - interval '3 days' where cart_id = (select id from public.carts where customer_id = :'dave');
select tests.act_as(:'dave');
select tests.assert_equal(public.my_cart_status() ->> 'abandoned', 'true', 'idle cart past the threshold is abandoned');
select public.list_my_notifications();
select public.list_my_notifications();
reset role;
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'dave' and category = 'cart'), 1,
  'one gentle in-app reminder per idle period');
select tests.act_as(:'editor');
select tests.assert_raises($$select public.staff_list_abandoned_carts()$$, '42501', 'abandoned carts need customers.view');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal((public.staff_list_abandoned_carts() -> 'items' -> 0 ->> 'customerId'), :'dave', 'staff can inspect abandoned carts');
reset role;
select tests.act_as(:'carol');
select tests.assert_equal(public.my_cart_status() ->> 'abandoned', 'false', 'empty cart is not abandoned');
select public.cart_set_item(:'charger', 1);
reset role;
update public.carts set updated_at = now() - interval '3 days' where customer_id = :'carol';
update public.cart_items set updated_at = now() - interval '3 days' where cart_id = (select id from public.carts where customer_id = :'carol');
update public.orders set created_at = now() - interval '1 day' where customer_id = :'carol';
select tests.act_as(:'carol');
select tests.checkout(tests.items(:'cable', '1'), :'delivery', '{"method": "cod"}');
select tests.assert_equal(public.my_cart_status() ->> 'abandoned', 'false', 'a cart converted into an order is not abandoned');
reset role;
update public.site_settings set value = value || '{"followUp": "off"}' where key = 'abandoned_cart';
delete from public.notifications where user_id = :'dave' and category = 'cart';
select tests.act_as(:'dave');
select public.list_my_notifications();
reset role;
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'dave' and category = 'cart'), 0,
  'follow-up off → no reminder');
update public.site_settings set value = value || '{"enabled": false, "followUp": "in_app"}' where key = 'abandoned_cart';
select tests.act_as(:'dave');
select tests.assert_equal(public.my_cart_status() ->> 'abandoned', 'false', 'disabled setting → nothing is abandoned');
reset role;
update public.site_settings set value = value || '{"enabled": true}' where key = 'abandoned_cart';

-- ── Verified-buyer reviews ──────────────────────────────────────────────────
select tests.act_as(:'bob');
select public.update_my_profile('Bob Samir', null);
select tests.checkout(tests.items(:'charger', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as bob_order \gset
select tests.assert_equal(public.my_review_status('apple-20w-usb-c-adapter') ->> 'reason', 'not_delivered',
  'unfinished order → not eligible yet');
select tests.assert_equal(public.submit_review('apple-20w-usb-c-adapter', 5, 'Great charger, fast!') ->> 'code', 'not_eligible',
  'cannot review before delivery');
reset role;
select tests.deliver(:'bob_order', :'manager');
select tests.act_as(:'bob');
select tests.assert_equal(public.my_review_status('apple-20w-usb-c-adapter') ->> 'eligible', 'true', 'delivered order → eligible');
select tests.assert_equal(public.submit_review('apple-20w-usb-c-adapter', 7, 'Great charger, fast!') ->> 'field', 'rating',
  'rating validated');
select public.submit_review('apple-20w-usb-c-adapter', 5, 'Great charger, fast!', 'Recommended') -> 'review' as rv \gset
select tests.assert_equal(:'rv'::jsonb ->> 'status', 'pending', 'new review is pending');
select tests.assert_equal(:'rv'::jsonb ->> 'verifiedBuyer', 'true', 'verified buyer set by the server');
select tests.assert_equal(public.submit_review('apple-20w-usb-c-adapter', 4, 'Edited: still a great charger') -> 'review' ->> 'id',
  :'rv'::jsonb ->> 'id', 'one review per customer per product (edit, not duplicate)');
select tests.assert_raises($$update public.product_reviews set status = 'approved'$$, '42501', 'customers cannot approve reviews');
select tests.assert_raises($$insert into public.product_reviews (product_id, user_id, rating, body, author_name, verified_buyer)
  select id, app.current_actor_id(), 5, 'Forged verified review', 'X', true from public.products limit 1$$, '42501',
  'verified buyer cannot be forged');
select tests.assert_raises($$select public.staff_moderate_review(gen_random_uuid(), 'approved')$$, '42501',
  'customers cannot moderate');
reset role;
select tests.act_as(:'alice');
select tests.assert_equal(public.submit_review('apple-20w-usb-c-adapter', 1, 'I never bought this one') ->> 'code', 'not_eligible',
  'customer without a purchase → rejected');
select tests.assert_equal(public.submit_review('usb-c-cable', 5, 'Solid braided cable.') -> 'review' ->> 'status', 'pending',
  'another eligible customer can review their own purchase');
reset role;
select tests.act_as_anon();
select tests.assert_equal(public.product_reviews_public('apple-20w-usb-c-adapter') -> 'summary' ->> 'count', '0',
  'pending reviews are not public');
select tests.assert_equal(public.my_review_status('apple-20w-usb-c-adapter') ->> 'reason', 'sign_in', 'anonymous → sign in');
reset role;
select tests.act_as(:'editor');
select tests.assert_raises($$select public.staff_list_reviews()$$, '42501', 'moderation needs reviews.moderate');
reset role;
select tests.act_as(:'cs');
select tests.assert_equal((public.staff_list_reviews('pending') ->> 'total')::int, 2, 'moderation queue');
select tests.assert_equal(public.staff_moderate_review((:'rv'::jsonb ->> 'id')::uuid, 'approved', 'ok') ->> 'ok', 'true', 'approve');
reset role;
select tests.act_as_anon();
select public.product_reviews_public('apple-20w-usb-c-adapter') as pub \gset
select tests.assert_equal(:'pub'::jsonb -> 'summary' ->> 'count', '1', 'approved review is public');
select tests.assert_equal(:'pub'::jsonb -> 'items' -> 0 ->> 'authorName', 'Bob S.', 'author shown as first name + initial only');
select tests.assert(not (:'pub'::jsonb::text ~ '(bob8@|moderation|userId|user_id|orderId)'), 'no email, user id or moderation data in public reviews');
reset role;
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'bob' and category = 'review'), 1,
  'author notified of approval');
select tests.assert_equal((select count(*)::int from public.audit_logs where action = 'review.approved'), 1, 'moderation audited');
select tests.act_as(:'cs');
select public.staff_moderate_review((select id from public.product_reviews where user_id = :'alice'), 'rejected', 'off-topic');
reset role;
select tests.act_as_anon();
select tests.assert_equal(public.product_reviews_public('usb-c-cable') -> 'summary' ->> 'count', '0', 'rejected review is not public');
reset role;
select tests.act_as(:'alice');
select tests.assert_equal(public.list_my_reviews() -> 0 ->> 'status', 'rejected', 'author sees their review status');
select tests.assert(not (public.list_my_reviews()::text ~ 'off-topic'), 'internal moderation note not shown to the author');
reset role;
-- Another customer can neither list nor read the rejected review's row.
select tests.act_as(:'dave');
select tests.assert_equal(jsonb_array_length(public.list_my_reviews()), 0, 'reviews are private (own list)');
select tests.assert_equal((select count(*)::int from public.product_reviews where user_id = :'alice'), 0,
  'reviews are private (RLS)');
reset role;
-- Staff cannot moderate their own review.
select tests.act_as(:'cs');
select tests.checkout(tests.items(:'cable', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as cs_order \gset
reset role;
select tests.deliver(:'cs_order', :'manager');
select tests.act_as(:'cs');
select public.submit_review('usb-c-cable', 5, 'My own review as staff') -> 'review' ->> 'id' as cs_review \gset
select tests.assert_equal(public.staff_moderate_review(:'cs_review', 'approved') ->> 'code', 'own_review', 'no self-approval');
reset role;
-- Demo reviews are labelled and never verified.
select tests.act_as_anon();
select tests.assert_equal(public.product_reviews_public('iphone-18-pro') -> 'items' -> 0 ->> 'isDemo', 'true', 'demo review flagged');
select tests.assert_equal(public.product_reviews_public('iphone-18-pro') -> 'items' -> 0 ->> 'verifiedBuyer', 'false',
  'demo review is not a verified buyer');
reset role;

-- ── Recommendations ─────────────────────────────────────────────────────────
select tests.act_as_anon();
select public.product_recommendations('iphone-18-pro') as rec \gset
select tests.assert((select bool_or(x ->> 'slug' = 'magsafe-clear-case-18-pro') from jsonb_array_elements(:'rec'::jsonb -> 'compatible') x),
  'explicit compatibility');
select tests.assert((select bool_or(x ->> 'slug' = 'iphone-18-pro') from jsonb_array_elements(
  public.product_recommendations('magsafe-clear-case-18-pro') -> 'compatible') x), 'compatibility works in both directions');
select tests.assert_equal(:'rec'::jsonb -> 'boughtTogether' -> 0 ->> 'slug', 'apple-20w-usb-c-adapter', 'manual relationship first');
select tests.assert_equal(:'rec'::jsonb -> 'related' -> 0 ->> 'slug', 'iphone-18-pro-max', 'manual related products first');
select tests.assert(jsonb_array_length(:'rec'::jsonb -> 'accessories') > 0, 'manual accessories');
select tests.assert(not exists (select 1 from jsonb_array_elements(:'rec'::jsonb -> 'youMayAlsoLike') x
                                where x ->> 'slug' = 'iphone-18-pro'), 'never recommends the product itself');
select tests.assert(not exists (select 1 from jsonb_array_elements(public.product_recommendations('usb-c-cable') -> 'boughtTogether') x
                                where x ->> 'slug' = 'airpods-4'), 'no order-based pair before real orders exist');
reset role;
-- Real (non-demo) delivered orders from two different customers buying cable + AirPods 4.
select tests.act_as(:'alice');
select tests.checkout(tests.items(:'cable', '1', :'ap4', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as bt1 \gset
reset role;
select tests.act_as(:'carol');
select tests.checkout(tests.items(:'cable', '1', :'ap4', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as bt2 \gset
reset role;
update public.orders set is_demo = false where id in (:'bt1', :'bt2');
select tests.deliver(:'bt1', :'manager');
select tests.act_as_anon();
select tests.assert(not exists (select 1 from jsonb_array_elements(public.product_recommendations('usb-c-cable') -> 'boughtTogether') x
                                where x ->> 'slug' = 'airpods-4'), 'one customer is not enough (privacy threshold)');
reset role;
select tests.act_as(:'manager');
select public.staff_cancel_order(:'bt2', 'test');
reset role;
select tests.act_as_anon();
select tests.assert(not exists (select 1 from jsonb_array_elements(public.product_recommendations('usb-c-cable') -> 'boughtTogether') x
                                where x ->> 'slug' = 'airpods-4'), 'cancelled orders are excluded');
reset role;
select tests.act_as(:'carol');
select tests.checkout(tests.items(:'cable', '1', :'ap4', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as bt3 \gset
reset role;
select tests.deliver(:'bt3', :'manager');
select tests.act_as_anon();
select tests.assert(not exists (select 1 from jsonb_array_elements(public.product_recommendations('usb-c-cable') -> 'boughtTogether') x
                                where x ->> 'slug' = 'airpods-4'), 'demo orders never feed live rankings');
reset role;
update public.orders set is_demo = false where id = :'bt3';
select tests.act_as_anon();
select public.product_recommendations('usb-c-cable') as rec2 \gset
select tests.assert(exists (select 1 from jsonb_array_elements(:'rec2'::jsonb -> 'boughtTogether') x where x ->> 'slug' = 'airpods-4'),
  'frequently bought together from real delivered orders of ≥ 2 customers');
select tests.assert(not (:'rec2'::jsonb::text ~ '(@test\.local|customer|MS-20)'), 'aggregates only: no customer or order data exposed');
reset role;

rollback;
