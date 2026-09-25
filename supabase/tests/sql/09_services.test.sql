-- Service experiences: repair / trade-in / used / after-sales intake, media validation and storage
-- privacy, staff workflow (assignment, status, notes, info requests, quotes, valuations, proposals,
-- after-sales decisions), money safety, notifications, audit, RLS and permissions.
-- Mirrors src/domain/services/*.test.ts.
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

select id as target from public.product_variants where sku = 'IP18P-1TB-ORANGE' \gset
select id as cable from public.product_variants where sku = 'USBC-1M-WHITE' \gset
\set delivery '{"method": "delivery", "governorate": "cairo", "area": "Nasr City", "address": "12 Makram Ebeid St, floor 3"}'

select tests.create_user('alice9@test.local') as alice \gset
select tests.create_user('bob9@test.local') as bob \gset
select tests.create_user('carol9@test.local') as carol \gset
select tests.create_user('manager9@test.local', 'store_manager') as manager \gset
select tests.create_user('tech9@test.local', 'repairs_team') as tech \gset
select tests.create_user('sales9@test.local', 'sales') as sales \gset
select tests.create_user('cs9@test.local', 'customer_service') as cs \gset
select tests.create_user('editor9@test.local', 'content_editor') as editor \gset

-- "Upload" a file as the current caller (storage policies apply) and return its path.
create or replace function tests.upload(p_bucket text, p_owner uuid, p_ext text, p_mime text, p_size bigint)
returns text language plpgsql as $$
declare
  v_path text := p_owner::text || '/' || gen_random_uuid()::text || '.' || p_ext;
begin
  insert into storage.objects (bucket_id, name, metadata)
  values (p_bucket, v_path, jsonb_build_object('mimetype', p_mime, 'size', p_size));
  return v_path;
end;
$$;

create or replace function tests.deliver9(p_order uuid, p_manager uuid) returns void language plpgsql as $$
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
grant execute on all functions in schema tests to anon, authenticated;

\set contact '"contact": {"name": "Alice Hanna", "phone": "0101 234 5678"}'

-- ── Repair intake ───────────────────────────────────────────────────────────
select tests.act_as_anon();
select tests.assert_raises($$select public.create_service_request('repair', '{}'::jsonb)$$, '42501',
  'anonymous visitors cannot submit service requests');
reset role;

select tests.act_as(:'alice');
select tests.upload('repairs', :'alice', 'webp', 'image/webp', 350000) as photo1 \gset
select tests.upload('repairs', :'alice', 'mp4', 'video/mp4', 9000000) as video1 \gset
select tests.upload('repairs', :'alice', 'mp4', 'video/mp4', 9000000) as video2 \gset
select tests.upload('repairs', :'alice', 'png', 'image/webp', 1000) as badext \gset
select tests.upload('repairs', :'alice', 'jpg', 'image/jpeg', 99999999) as huge \gset
select tests.upload('repairs', :'alice', 'svg', 'image/svg+xml', 1000) as svg \gset

\set repair_base '"device": {"category": "smartphone", "brand": "Apple", "model": "iPhone 15 Pro"}, "description": "The screen cracked after a fall and touch is patchy.", "handoff": "store_visit", "locale": "en"'

select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "device": {"category": "toaster", "brand": "X", "model": "Y"}}', :'contact', '"description": "long enough text"')::jsonb) ->> 'code',
  'invalid_device', 'repair category must exist in the published diagnostic model');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "diagnosis": {"component": "keyboard"}}', :'contact', :'repair_base')::jsonb) ->> 'code',
  'invalid_diagnosis', 'component must belong to the device category');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "diagnosis": {"component": "screen", "symptom": "drains_fast"}}', :'contact', :'repair_base')::jsonb) ->> 'code',
  'invalid_diagnosis', 'symptom must belong to the component');
select tests.assert_equal(public.create_service_request('repair', format('{%s, "device": {"category": "smartphone", "brand": "Apple", "model": "iPhone 15"}, "description": "short", "diagnosis": {"unsure": true}}', :'contact')::jsonb) ->> 'code',
  'invalid_description', 'a description of at least 10 characters is required');
select tests.assert_equal(public.create_service_request('repair', format('{"contact": {"name": "Alice", "phone": "12345"}, %s}', :'repair_base')::jsonb) ->> 'code',
  'invalid_phone', 'Egyptian mobile required');
select tests.assert_equal(public.create_service_request('repair', format('{"contact": {"name": "Alice", "phone": "0224567890"}, %s}', :'repair_base')::jsonb) ->> 'code',
  'invalid_phone', 'landlines are not accepted for service follow-up');

-- Media validation (server side: ownership, existence, MIME ↔ extension, size, counts).
select tests.upload('repairs', :'alice', 'webp', 'image/webp', 1000) as p_tmp \gset
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', replace(:'p_tmp', 'webp', 'jpg'))::jsonb) ->> 'code',
  'media_missing', 'media must exist in storage');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', :'badext')::jsonb) ->> 'code',
  'invalid_media_type', 'stored MIME type must match the file extension');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', :'svg')::jsonb) ->> 'code',
  'invalid_media_type', 'unexpected file types (SVG) are rejected');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', :'huge')::jsonb) ->> 'code',
  'media_too_large', 'configured size limit enforced');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}, {"path": "%s"}]}', :'contact', :'repair_base', :'video1', :'video2')::jsonb) ->> 'code',
  'too_many_videos', 'video count limit enforced');
reset role;
select tests.act_as(:'bob');
select tests.upload('repairs', :'bob', 'webp', 'image/webp', 1000) as bob_photo \gset
reset role;
select tests.act_as(:'alice');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', :'bob_photo')::jsonb) ->> 'code',
  'invalid_media', 'cannot attach another customer''s file');

select gen_random_uuid() as rkey \gset
select public.create_service_request('repair', format('{"idempotencyKey": "%s", %s, %s, "diagnosis": {"component": "screen", "symptom": "broken_glass", "viewer": "3d"}, "media": [{"path": "%s", "label": "damage", "width": 1600, "height": 1200}, {"path": "%s"}]}',
  :'rkey', :'contact', :'repair_base', :'photo1', :'video1')::jsonb) as rep \gset
select tests.assert_equal(:'rep'::jsonb ->> 'ok', 'true', 'repair request created');
select tests.assert(:'rep'::jsonb -> 'request' ->> 'number' ~ '^RP-[0-9]{4}-[0-9]{6}$', 'human request number RP-YYYY-000001 (not the primary key)');
select (:'rep'::jsonb -> 'request' ->> 'id') as rep_id, (:'rep'::jsonb -> 'request' ->> 'number') as rep_no \gset
select tests.assert_equal(public.create_service_request('repair', format('{"idempotencyKey": "%s", %s, %s}', :'rkey', :'contact', :'repair_base')::jsonb) ->> 'duplicate',
  'true', 'double submit returns the same request (idempotent)');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s, "media": [{"path": "%s"}]}', :'contact', :'repair_base', :'photo1')::jsonb) ->> 'code',
  'media_in_use', 'a file can only belong to one request');
select tests.assert_equal((select count(*)::int from public.service_media where request_id = :'rep_id'), 2, 'photo + video attached');
select tests.assert_equal((select contact_phone from public.service_requests where id = :'rep_id'), '+201012345678', 'mobile normalised like checkout (E.164)');
select tests.assert_equal((select consultation_required from public.service_requests where id = :'rep_id'), false,
  'a selected component + symptom is not a consultation');
select tests.assert_equal(public.get_my_service_request(:'rep_no') -> 'details' -> 'diagnosis' ->> 'symptom', 'broken_glass',
  'diagnosis stored from the data-driven model');
select tests.assert_equal(public.get_my_service_request(:'rep_no') ->> 'status', 'new', 'customer tracking shows the status');

select public.create_service_request('repair', format('{%s, "device": {"category": "laptop", "brand": "Apple", "model": "MacBook Air"}, "description": "Not sure what is wrong, it gets very hot.", "diagnosis": {"unsure": true}, "consultation": true}', :'contact')::jsonb) as rep2 \gset
select tests.assert_equal((select consultation_required from public.service_requests where id = (:'rep2'::jsonb -> 'request' ->> 'id')::uuid), true,
  '"I''m not sure" / consultation is recorded');
select tests.assert_equal(public.create_service_request('repair', format('{%s, "device": {"category": "other", "brand": "Kindle", "model": "Paperwhite"}, "description": "Screen frozen on one page.", "diagnosis": {"unsure": true}}', :'contact')::jsonb) ->> 'ok',
  'true', 'other devices can be submitted as consultations');
reset role;

-- Privacy: other customers and anonymous users.
select tests.act_as(:'bob');
select tests.assert(public.get_my_service_request(:'rep_no') is null, 'Customer B cannot open Customer A''s repair');
select tests.assert_equal((select count(*)::int from public.service_requests), 0, 'RLS hides other customers'' requests');
select tests.assert_equal((select count(*)::int from public.service_media), 0, 'RLS hides other customers'' media rows');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'repairs' and name = :'photo1'), 0,
  'Customer B cannot read Customer A''s repair media');
select tests.assert_equal(public.cancel_my_service_request(:'rep_no') ->> 'code', 'not_found', 'Customer B cannot cancel it');
reset role;
select tests.act_as_anon();
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id in ('repairs', 'trade-in', 'after-sales', 'used-requests')), 0,
  'anonymous users cannot read private request media');
select tests.assert_raises($$select count(*) from public.service_requests$$, '42501', 'anonymous users have no access to requests');
reset role;

-- ── Staff workflow (repairs) ────────────────────────────────────────────────
select tests.act_as(:'editor');
select tests.assert_raises(format($$select public.staff_list_service_requests('repair')$$), '42501', 'staff without repairs.view cannot list repairs');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.staff_get_service_request(%L)$$, :'rep_id'), '42501', 'sales (no repairs.view) cannot open repairs');
reset role;
select tests.act_as(:'cs');
select tests.assert(public.staff_get_service_request(:'rep_id') is not null, 'customer service can view repairs');
select tests.assert_raises(format($$select public.staff_set_service_status(%L, 'under_review')$$, :'rep_id'), '42501',
  'view-only staff cannot change repair status');
reset role;

select tests.act_as(:'tech');
select tests.assert_equal((public.staff_list_service_requests('repair', 'open') ->> 'total')::int >= 3, true, 'repairs team sees the open queue');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'repairs' and name = :'photo1'), 1,
  'authorised staff can read repair media');
select tests.assert_equal(public.staff_assign_service_request(:'rep_id', :'alice') ->> 'code', 'not_staff', 'only eligible staff can be assigned');
select tests.assert_equal(public.staff_assign_service_request(:'rep_id', :'tech') -> 'request' -> 'assignedTo' ->> 'id', :'tech',
  'technician assigned');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'quote_sent') ->> 'code', 'use_offer', 'quote status only through a quote');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'refund_handling') ->> 'code', 'invalid_status', 'unknown repair status rejected');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'diagnosing', 'Checking the display assembly') -> 'request' ->> 'status',
  'diagnosing', 'status updated');
select tests.assert_equal(public.staff_add_service_note(:'rep_id', 'INTERNAL: customer seems in a hurry', false) ->> 'ok', 'true', 'internal note added');
select tests.assert_equal(public.staff_add_service_note(:'rep_id', 'We are testing a replacement display.', true) ->> 'ok', 'true', 'customer-visible update added');
select tests.assert_equal(public.staff_send_repair_quote(:'rep_id', 'estimate', -5) ->> 'code', 'invalid_amount', 'negative quote rejected');
select tests.assert_equal(public.staff_send_repair_quote(:'rep_id', 'estimate', 1500.555) ->> 'code', 'invalid_amount', 'quote must be whole piasters');
select tests.assert_equal(public.staff_send_repair_quote(:'rep_id', 'estimate', 4500, 'Includes original display') -> 'request' ->> 'status',
  'quote_sent', 'estimate sent → quote sent');
reset role;

select tests.act_as(:'alice');
select public.get_my_service_request(:'rep_no') as rview \gset
select tests.assert(not (:'rview'::jsonb::text ~ 'INTERNAL'), 'internal notes never reach the customer');
select tests.assert(not (:'rview'::jsonb ? 'assignedTo'), 'assignment is not exposed to the customer');
select tests.assert_equal((select count(*)::int from public.service_events where request_id = :'rep_id' and message ~ 'INTERNAL'), 0,
  'RLS hides internal timeline events');
select tests.assert(:'rview'::jsonb::text ~ 'replacement display', 'customer-visible update shown');
select tests.assert_equal((:'rview'::jsonb -> 'offers' -> 0 ->> 'amount')::numeric, 4500::numeric, 'published quote visible to the customer');
select tests.assert_equal((select count(*)::int from public.notifications where template_key = 'service.repair.quote_ready'), 1,
  'quote-ready in-app notification');
select tests.assert((select body ->> 'en' from public.notifications where template_key = 'service.repair.quote_ready') ~ 'EGP 4,500',
  'notification shows the quoted amount');
select tests.assert_raises(format($$update public.service_offers set amount = 1 where request_id = %L$$, :'rep_id'), '42501',
  'customers cannot edit quote values');
select tests.assert_raises(format($$select public.staff_send_repair_quote(%L, 'final', 1)$$, :'rep_id'), '42501',
  'customers cannot create quotes');
select (:'rview'::jsonb -> 'offers' -> 0 ->> 'id') as quote_id \gset
select tests.assert_equal(public.respond_my_service_offer(:'quote_id', 'accept') -> 'request' ->> 'status', 'customer_approved',
  'customer approves the quote');
select tests.assert_equal(public.respond_my_service_offer(:'quote_id', 'accept') ->> 'code', 'offer_closed', 'a quote is answered once');
select tests.assert_equal(public.cancel_my_service_request(:'rep_no') ->> 'code', 'cannot_cancel', 'no self-cancel after approval');
reset role;

select tests.act_as(:'tech');
select public.staff_set_service_status(:'rep_id', 'repairing');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'ready') -> 'request' ->> 'status', 'ready', 'ready for pickup');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'ready') ->> 'code', 'same_status', 'repeated status is a no-op');
reset role;
select app.service_notify(:'rep_id', 'service.repair.ready', 'status:ready');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.repair.ready'), 1,
  'status notifications are idempotent');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.updated'
                           and dedupe_key like 'service:' || :'rep_id' || ':status:%'), 1,
  'only meaningful statuses notify (repairing), diagnosing does not');
select tests.assert_equal((select action_path from public.notifications where template_key = 'service.repair.ready'), '/account/requests/' || :'rep_no',
  'notification links to the request detail');
select tests.assert((select count(*) from public.audit_logs where action = 'service.repair_quote_sent') = 1, 'repair quote audited');
select tests.assert((select count(*) from public.audit_logs where action = 'service.status_changed') >= 3, 'status changes audited');
select tests.assert((select count(*) from public.audit_logs where action = 'service.assigned') = 1, 'assignment audited');
select tests.assert((select count(*) from public.audit_logs where action = 'service.note_added') = 1, 'internal note audited');

select tests.act_as(:'tech');
select public.staff_set_service_status(:'rep_id', 'completed');
select tests.assert_equal(public.staff_set_service_status(:'rep_id', 'repairing') ->> 'code', 'closed', 'completed requests are closed');
reset role;

-- ── Trade-in ────────────────────────────────────────────────────────────────
select tests.act_as(:'alice');
select tests.upload('trade-in', :'alice', 'webp', 'image/webp', 400000) as ti_front \gset
select tests.upload('trade-in', :'alice', 'webp', 'image/webp', 400000) as ti_back \gset
\set ti_current '"current": {"category": "smartphone", "brand": "Apple", "model": "iPhone 14 Pro Max", "storage": "256GB", "color": "Deep Purple", "batteryHealth": 86, "taxPaid": "yes", "accessories": ["box", "cable"], "conditions": ["scratches"], "openedBefore": "no", "repairedBefore": "no"}'
select tests.assert_equal(public.create_service_request('trade_in', format('{%s, "current": {"brand": "Apple", "model": "iPhone 14", "batteryHealth": 150, "conditions": ["none"]}, "target": {"variantId": "%s"}}', :'contact', :'target')::jsonb) ->> 'code',
  'invalid_battery', 'battery health 1–100 %');
select tests.assert_equal(public.create_service_request('trade_in', format('{%s, "current": {"brand": "Apple", "model": "iPhone 14", "conditions": ["none", "dents"]}, "target": {"variantId": "%s"}}', :'contact', :'target')::jsonb) ->> 'code',
  'invalid_condition', '"No known issue" cannot be combined with issues');
select tests.assert_equal(public.create_service_request('trade_in', format('{%s, "current": {"brand": "Apple", "model": "iPhone 14", "conditions": ["none"], "accessories": ["gold bar"]}, "target": {"variantId": "%s"}}', :'contact', :'target')::jsonb) ->> 'code',
  'invalid_request', 'accessories come from a fixed list');
select tests.assert_equal(public.create_service_request('trade_in', format('{%s, %s, "target": {"variantId": "%s"}}', :'contact', :'ti_current', gen_random_uuid())::jsonb) ->> 'code',
  'invalid_target', 'target must be a live catalog variant');
select tests.assert_equal(public.create_service_request('trade_in', format('{%s, %s, "target": {"variantId": "%s"}, "media": [{"path": "%s"}]}', :'contact', :'ti_current', :'target', :'photo1')::jsonb) ->> 'code',
  'media_missing', 'files must be in the service''s own bucket');
select public.create_service_request('trade_in', format('{%s, %s, "target": {"variantId": "%s"}, "media": [{"path": "%s", "label": "front"}, {"path": "%s", "label": "back"}]}',
  :'contact', :'ti_current', :'target', :'ti_front', :'ti_back')::jsonb) as ti \gset
select tests.assert(:'ti'::jsonb -> 'request' ->> 'number' ~ '^TI-[0-9]{4}-[0-9]{6}$', 'trade-in request TI-YYYY-…');
select (:'ti'::jsonb -> 'request' ->> 'id') as ti_id, (:'ti'::jsonb -> 'request' ->> 'number') as ti_no \gset
select tests.assert_equal((select target_variant_id from public.service_requests where id = :'ti_id'), :'target'::uuid,
  'exact target variant id saved');
select public.create_service_request('trade_in', format('{%s, %s, "target": {"manual": {"brand": "Apple", "model": "iPhone 17 Pro Max", "storage": "512GB", "color": "Cosmic Orange"}}}',
  :'contact', :'ti_current')::jsonb) as ti2 \gset
select (:'ti2'::jsonb -> 'request' ->> 'id') as ti2_id, (:'ti2'::jsonb -> 'request' ->> 'number') as ti2_no \gset
reset role;

select tests.act_as(:'tech');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'trade-in'), 0,
  'repairs team cannot read trade-in media');
reset role;
select tests.act_as(:'sales');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'trade-in' and name = :'ti_front'), 1,
  'trade-in staff can read trade-in media');
select tests.assert_equal(public.staff_request_service_info(:'ti_id', 'Please send a photo with the screen on.') -> 'request' ->> 'status',
  'need_more_info', 'more info needed');
reset role;
select tests.act_as(:'alice');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.info_needed'), 1,
  'info-needed notification');
select tests.upload('trade-in', :'alice', 'jpg', 'image/jpeg', 500000) as ti_screen \gset
select tests.assert_equal(public.respond_my_service_request(:'ti_no', 'Here it is', format('[{"path": "%s", "label": "screen_on"}]', :'ti_screen')::jsonb) -> 'request' ->> 'status',
  'under_review', 'customer answer returns the request to review');
reset role;

select vp.unit_price as tprice from app.variant_pricing(:'target') vp \gset
select tests.act_as(:'sales');
select tests.assert_equal(public.staff_send_trade_in_offer(:'ti_id', 20000, 99) ->> 'code', 'catalog_price_only',
  'the new-device price for a catalog target is never typed in');
select public.staff_send_trade_in_offer(:'ti_id', 20000.50, null, 'Good condition', 'Final after in-store inspection') as tioffer \gset
select tests.assert_equal(:'tioffer'::jsonb -> 'request' ->> 'status', 'offer_sent', 'valuation sent');
select tests.assert_equal((:'tioffer'::jsonb -> 'request' -> 'offers' -> 0 ->> 'targetPrice')::numeric,
  :'tprice'::numeric, 'target price snapshot = authoritative catalog price');
select tests.assert_equal((:'tioffer'::jsonb -> 'request' -> 'offers' -> 0 ->> 'difference')::numeric,
  :'tprice'::numeric - 20000.50, 'difference = new price − valuation (exact EGP)');
select tests.assert((:'tioffer'::jsonb -> 'request' -> 'offers' -> 0 ->> 'expiresAt')::timestamptz between now() + interval '6 days' and now() + interval '8 days',
  'offer validity from settings (7 days)');
select tests.assert_equal(public.staff_send_trade_in_offer(:'ti2_id', 12000) ->> 'code', 'invalid_amount', 'manual target needs a staff price');
select tests.assert_equal((public.staff_send_trade_in_offer(:'ti2_id', 12000.25, 50000) -> 'request' -> 'offers' -> 0 ->> 'difference')::numeric,
  37999.75::numeric, 'manual target difference');
select public.staff_send_trade_in_offer(:'ti2_id', 13000, 50000);
select tests.assert_equal((select count(*)::int from public.service_offers where request_id = :'ti2_id' and status = 'sent'), 1,
  'a new valuation supersedes the previous one');
reset role;

select tests.act_as(:'alice');
select public.get_my_service_request(:'ti_no') -> 'offers' -> 0 ->> 'id' as ti_offer \gset
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.trade_in.offer_ready'), 3,
  'one offer-ready notice per offer');
select tests.assert_equal(public.respond_my_service_offer(:'ti_offer', 'decline', 'Too low') -> 'request' ->> 'status', 'customer_declined',
  'customer declines the offer');
select public.get_my_service_request(:'ti2_no') -> 'offers' -> 0 ->> 'id' as ti2_offer \gset
reset role;
update public.service_offers set expires_at = now() - interval '1 minute' where id = :'ti2_offer';
select tests.act_as(:'alice');
select tests.assert_equal(public.respond_my_service_offer(:'ti2_offer', 'accept') ->> 'code', 'offer_expired', 'expired offers cannot be accepted');
reset role;
select tests.assert((select count(*) from public.audit_logs where action = 'service.trade_in_valuation') = 3, 'every valuation audited');

-- ── Used-device request ─────────────────────────────────────────────────────
select tests.act_as(:'alice');
select tests.assert_equal(public.create_service_request('used', format('{%s, "device": {"brand": "Apple", "model": "iPhone 15", "batteryPreference": "whatever"}}', :'contact')::jsonb) ->> 'code',
  'invalid_request', 'battery preference uses fixed professional options');
select tests.assert_equal(public.create_service_request('used', format('{%s, "device": {"brand": "Apple", "model": "iPhone 15", "budget": -10}}', :'contact')::jsonb) ->> 'code',
  'invalid_budget', 'budget must be positive');
select public.create_service_request('used', format('{%s, "device": {"brand": "Apple", "model": "iPhone 15 Pro", "storage": "256GB", "color": "Natural", "batteryPreference": "90_plus", "taxPreference": "tax_paid", "budget": 38000, "notes": "Prefer boxed"}}', :'contact')::jsonb) as ud \gset
select tests.assert(:'ud'::jsonb -> 'request' ->> 'number' ~ '^UD-[0-9]{4}-[0-9]{6}$', 'used request UD-YYYY-…');
select (:'ud'::jsonb -> 'request' ->> 'id') as ud_id, (:'ud'::jsonb -> 'request' ->> 'number') as ud_no \gset
select tests.assert_equal(public.get_my_service_request(:'ud_no') -> 'details' -> 'device' ->> 'batteryPreference', '90_plus', 'battery preference stored');
reset role;

select tests.act_as(:'sales');
select tests.upload('used-requests', :'sales', 'webp', 'image/webp', 300000) as ud_photo \gset
select public.staff_set_service_status(:'ud_id', 'searching');
select tests.assert_equal(public.staff_send_used_proposal(:'ud_id', '{"brand": "Apple", "model": "iPhone 15 Pro", "batteryHealth": 91, "taxStatus": "tax_paid", "condition": "Very good"}', 0) ->> 'code',
  'invalid_amount', 'proposal needs a price');
select tests.assert_equal(public.staff_send_used_proposal(:'ud_id', '{"brand": "Apple", "model": "iPhone 15 Pro", "storage": "256GB", "color": "Natural", "batteryHealth": 91, "taxStatus": "tax_paid", "condition": "Very good, light marks on the frame"}',
  36500, 'Available at Abbasseya branch', format('[{"path": "%s"}]', :'ud_photo')::jsonb) -> 'request' ->> 'status', 'option_found', 'proposal attached');
reset role;
select tests.act_as(:'alice');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'used-requests' and name = :'ud_photo'), 1,
  'customer sees photos attached to their own request');
select tests.assert_equal((public.get_my_service_request(:'ud_no') -> 'offers' -> 0 -> 'device' ->> 'batteryHealth')::int, 91, 'proposal details visible');
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.used.option_found'), 1,
  'option-found notification');
select public.get_my_service_request(:'ud_no') -> 'offers' -> 0 ->> 'id' as ud_offer \gset
select tests.assert_equal(public.respond_my_service_offer(:'ud_offer', 'accept') -> 'request' ->> 'status', 'customer_interested', 'customer interested');
reset role;
select tests.act_as(:'bob');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'used-requests'), 0,
  'other customers cannot see proposal photos');
reset role;
select tests.act_as(:'sales');
select public.staff_set_service_status(:'ud_id', 'reserved');
select tests.assert_equal(public.staff_set_service_status(:'ud_id', 'completed') -> 'request' ->> 'status', 'completed', 'used request completed');
reset role;

-- ── After-sales ─────────────────────────────────────────────────────────────
select tests.act_as(:'alice');
select tests.checkout(tests.items(:'cable', '1'), :'delivery', '{"method": "cod"}') -> 'order' ->> 'id' as order_a \gset
select tests.assert_equal(jsonb_array_length(public.list_my_after_sales_items()), 0, 'undelivered orders are not eligible');
reset role;
select tests.deliver9(:'order_a', :'manager');
select (app.services_config() -> 'afterSales' ->> 'policyVersion') as pv \gset
select tests.act_as(:'alice');
select public.list_my_after_sales_items() -> 0 ->> 'itemId' as item_a \gset
select tests.assert(:'item_a' is not null, 'delivered purchase listed for after-sales');
\set as_base '"type": "warranty", "reason": "defective", "description": "The cable stopped charging after a week."'
select tests.assert_equal(public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyVersion": "%s"}', :'contact', :'as_base', :'item_a', :'pv')::jsonb) ->> 'code',
  'policy_required', 'policy acknowledgement required');
select tests.assert_equal(public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyAccepted": true, "policyVersion": "old"}', :'contact', :'as_base', :'item_a')::jsonb) ->> 'code',
  'policy_changed', 'acknowledgement must match the current policy version');
select tests.assert_equal(public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyAccepted": true, "policyVersion": "%s"}', :'contact', :'as_base', gen_random_uuid(), :'pv')::jsonb) ->> 'code',
  'not_eligible', 'forged order item ids are rejected');
select tests.upload('after-sales', :'alice', 'jpg', 'image/jpeg', 250000) as as_photo \gset
select public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyAccepted": true, "policyVersion": "%s", "media": [{"path": "%s"}]}',
  :'contact', :'as_base', :'item_a', :'pv', :'as_photo')::jsonb) as asr \gset
select tests.assert(:'asr'::jsonb -> 'request' ->> 'number' ~ '^AS-[0-9]{4}-[0-9]{6}$', 'after-sales request AS-YYYY-…');
select (:'asr'::jsonb -> 'request' ->> 'id') as as_id, (:'asr'::jsonb -> 'request' ->> 'number') as as_no \gset
select tests.assert_equal((select policy_version from public.service_requests where id = :'as_id'), :'pv', 'policy version recorded');
select tests.assert_equal(public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyAccepted": true, "policyVersion": "%s"}', :'contact', :'as_base', :'item_a', :'pv')::jsonb) ->> 'code',
  'duplicate_open', 'one open request per item and type');
reset role;
select tests.act_as(:'carol');
select tests.assert_equal(public.create_service_request('after_sales', format('{%s, %s, "orderItemId": "%s", "policyAccepted": true, "policyVersion": "%s"}', :'contact', :'as_base', :'item_a', :'pv')::jsonb) ->> 'code',
  'not_eligible', 'another customer cannot claim Customer A''s purchase');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'after-sales'), 0, 'after-sales media is private');
reset role;

select tests.act_as(:'tech');
select tests.assert_raises(format($$select public.staff_decide_after_sales(%L, 'approved')$$, :'as_id'), '42501',
  'view-only after-sales staff cannot decide');
reset role;
select tests.act_as(:'cs');
select tests.assert_equal(public.staff_set_service_status(:'as_id', 'warranty_handling') ->> 'code', 'approval_required', 'handling needs approval first');
select tests.assert_equal(public.staff_set_service_status(:'as_id', 'refund_handling') ->> 'code', 'invalid_status', 'refund handling is not a warranty state');
select tests.assert_equal(public.staff_decide_after_sales(:'as_id', 'rejected') ->> 'code', 'reason_required', 'rejection needs a reason');
select tests.assert_equal(public.staff_decide_after_sales(:'as_id', 'approved', 'Bring the cable to the branch') -> 'request' ->> 'status', 'approved', 'approved');
select tests.assert_equal(public.staff_decide_after_sales(:'as_id', 'rejected', 'x') ->> 'code', 'already_decided', 'decision is final');
select public.staff_set_service_status(:'as_id', 'item_received');
select tests.assert_equal(public.staff_set_service_status(:'as_id', 'warranty_handling') -> 'request' ->> 'status', 'warranty_handling', 'warranty handling');
reset role;
select tests.assert_equal((select count(*)::int from public.notifications where user_id = :'alice' and template_key = 'service.after_sales.approved'), 1,
  'approval notification');
select tests.assert((select count(*) from public.audit_logs where action = 'service.after_sales_approved') = 1, 'approval audited');

-- Public review media behaviour is unchanged by the service buckets (private until approved).
select tests.act_as(:'alice');
select tests.upload('reviews', :'alice', 'webp', 'image/webp', 90000) as rv_photo \gset
select public.submit_review('usb-c-cable', 5, 'Solid cable, charges fast and feels durable.', null, :'rv_photo') -> 'review' ->> 'id' as rv_id \gset
reset role;
select tests.act_as_anon();
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'reviews' and name = :'rv_photo'), 0,
  'pending review photo is not public');
reset role;
select tests.act_as(:'manager');
select public.staff_moderate_review(:'rv_id', 'approved', null);
reset role;
select tests.act_as_anon();
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'reviews' and name = :'rv_photo'), 1,
  'approved review photo stays publicly readable');
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id <> 'reviews'
                           and bucket_id in ('repairs', 'trade-in', 'after-sales', 'used-requests')), 0,
  'service media never becomes public');
reset role;

-- ── Customer hub, cancellation, limits ──────────────────────────────────────
select tests.act_as(:'alice');
select tests.assert_equal((public.list_my_service_requests() ->> 'total')::int, 7, 'hub lists all of the customer''s requests');
select tests.assert_equal((public.list_my_service_requests('trade_in') ->> 'total')::int, 2, 'hub filters by type');
select tests.assert_equal((public.list_my_service_requests(null, 'completed') ->> 'total')::int, 2, 'hub filters by status');
select tests.assert_equal(public.cancel_my_service_request(:'ti2_no', 'Changed my mind') -> 'request' ->> 'status', 'cancelled',
  'customer cancels an early request');
select tests.assert_equal((select count(*)::int from public.service_offers where request_id = :'ti2_id' and status = 'sent'), 0,
  'open offers are withdrawn on cancel');
select tests.assert_equal(
  (select p -> 'mandatory' from jsonb_array_elements(public.get_my_notification_preferences()) p where p ->> 'category' = 'service'),
  'true'::jsonb, 'service updates are mandatory in-app notifications');
reset role;

update public.site_settings set value = value || '{"requests": {"maxOpenPerCustomer": 1}}' where key = 'services';
select tests.act_as(:'bob');
select public.create_service_request('used', format('{%s, "device": {"brand": "Samsung", "model": "S24"}}', :'contact')::jsonb);
select tests.assert_equal(public.create_service_request('used', format('{%s, "device": {"brand": "Samsung", "model": "S25"}}', :'contact')::jsonb) ->> 'code',
  'too_many_open', 'open-request limit per customer');
reset role;
update public.site_settings set value = value || '{"enabled": {"repairs": false, "tradeIn": true, "used": true, "afterSales": true}}' where key = 'services';
select tests.act_as(:'carol');
select tests.assert_equal(public.create_service_request('repair', format('{%s, %s}', :'contact', :'repair_base')::jsonb) ->> 'code',
  'service_disabled', 'a disabled service accepts no requests');
reset role;

-- Demo rows are registered for demo-data cleanup; direct writes are blocked.
select tests.assert((select count(*) from app.demo_tables where table_name::text in ('service_requests', 'service_media', 'service_offers')) = 3,
  'service tables registered for demo cleanup');
select tests.act_as(:'alice');
select tests.assert_raises($$insert into public.service_requests (kind, request_number, user_id, contact_name, contact_phone) values ('used', 'UD-2026-999999', auth.uid(), 'x x', '01012345678')$$,
  '42501', 'no direct request writes');
select tests.assert_raises(format($$update public.service_requests set status = 'completed' where id = %L$$, :'rep_id'), '42501',
  'customers cannot change status directly');
reset role;

rollback;
