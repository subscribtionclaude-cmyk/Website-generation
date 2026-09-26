-- Admin control center (Phase 06): settings workflow + stale drafts, audit viewer + redaction,
-- staff suspension and role changes, catalog aggregate editing, price history, stock adjustments
-- and movements, categories / brands, orders / customers / CRM notes, service SLA + priority,
-- reviews / waitlists, notification templates, offers / entries / page sections, dashboard,
-- analytics, exports, backup, product import (preview → commit, atomic) and RBAC on every RPC.
begin;
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';

-- Read protected tables as the test superuser in the middle of an impersonated section.
create or replace function tests.su() returns void language plpgsql as $$
begin
  perform set_config('tests.saved_claims', coalesce(current_setting('request.jwt.claims', true), ''), true);
  perform set_config('role', 'none', true);
end;
$$;
create or replace function tests.resume() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', current_setting('tests.saved_claims', true), true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function tests.su(), tests.resume() to anon, authenticated;

select tests.create_user('owner10@test.local', 'owner') as owner \gset
select tests.create_user('super10@test.local', 'super_admin') as super \gset
select tests.create_user('manager10@test.local', 'store_manager') as manager \gset
select tests.create_user('sales10@test.local', 'sales') as sales \gset
select tests.create_user('cs10@test.local', 'customer_service') as cs \gset
select tests.create_user('tech10@test.local', 'repairs_team') as tech \gset
select tests.create_user('editor10@test.local', 'content_editor') as editor \gset
select tests.create_user('designer10@test.local', 'design_editor') as designer \gset
select tests.create_user('alice10@test.local') as alice \gset
update public.profiles set full_name = 'Alice Customer', phone = '+201012345678' where id = :'alice';

select id as apple from public.brands where slug = 'apple' \gset
select id as samsung from public.brands where slug = 'samsung' \gset
select id as phones from public.categories where slug = 'phones' \gset
select id as laptops from public.categories where slug = 'laptops' \gset
select id as macbook from public.categories where slug = 'macbook' \gset
select id as accessories from public.categories where slug = 'accessories' \gset
select id as ip17 from public.products where slug = 'iphone-17' \gset

-- ══ Settings workflow ═══════════════════════════════════════════════════════
select tests.act_as(:'manager');
select tests.assert((select count(*) from jsonb_array_elements(public.admin_settings_overview()) x
                     where x ->> 'key' in ('shipping', 'receipt', 'legal', 'loyalty', 'service_sla')) = 5,
  'the manager sees the new Phase 06 setting keys');
select tests.assert(not exists (select 1 from jsonb_array_elements(public.admin_settings_overview()) x where x ->> 'key' = 'security'),
  'security settings stay hidden without security.manage');
select tests.assert_equal((select (x ->> 'canEdit')::boolean from jsonb_array_elements(public.admin_settings_overview()) x
                           where x ->> 'key' = 'store'), false, 'the store manager can view but not edit store settings');
select tests.assert_raises($$select public.admin_save_setting_draft('store', '{}', null)$$, '42501', 'viewing is not editing');
reset role;
select tests.act_as(:'super');
select public.admin_save_setting_draft('shipping',
  (select value from public.site_settings where key = 'shipping') || '{"defaultMode": "pickup"}', null) ->> 'ok' as saved \gset
select tests.assert_equal(:'saved'::text, 'true', 'a draft is saved from a clean state');
select tests.assert_equal(public.admin_save_setting_draft('shipping', '{"defaultMode": "delivery"}', null) ->> 'code',
  'draft_conflict', 'a second editor starting from "no draft" cannot overwrite the newer draft');
select (select x ->> 'draftUpdatedAt' from jsonb_array_elements(public.admin_settings_overview()) x where x ->> 'key' = 'shipping') as draft_at \gset
select tests.assert_equal(public.admin_save_setting_draft('shipping',
  (select value from public.site_settings where key = 'shipping') || '{"defaultMode": "pickup", "deliveryNotes": null}', :'draft_at'::timestamptz) ->> 'ok',
  'true', 'the editor who holds the latest draft can keep saving');
select (select x ->> 'draftUpdatedAt' from jsonb_array_elements(public.admin_settings_overview()) x where x ->> 'key' = 'shipping') as draft_at \gset
reset role;
select tests.act_as(:'manager');
select tests.assert_raises($$select public.publish_setting('shipping')$$, '42501', 'publishing needs settings.publish');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_save_setting_draft('store', '{}', null)$$, '42501', 'sales cannot edit settings');
select tests.assert_raises($$select public.admin_setting_versions('store')$$, '42501', 'sales cannot read setting history');
reset role;
select tests.act_as(:'super');
select tests.assert_equal(public.publish_setting('shipping', 'Pickup first'), 2, 'publish creates version 2');
select tests.assert_equal((select value ->> 'defaultMode' from public.site_settings where key = 'shipping'), 'pickup', 'published value is live');
select tests.assert_equal(jsonb_array_length(public.admin_setting_versions('shipping')), 2, 'version history keeps both versions');
select tests.assert_equal(public.admin_save_setting_draft('shipping', '{"x": 1}', :'draft_at'::timestamptz) ->> 'code', 'draft_gone',
  'a draft started before the publish is recognised as stale');
select tests.assert_equal(public.rollback_setting('shipping', 1, 'Back to delivery'), 3, 'rollback publishes version 1 as version 3');
select tests.assert_equal((select value ->> 'defaultMode' from public.site_settings where key = 'shipping'), 'delivery', 'rollback restored the value');
select tests.su();
select tests.assert((select count(*) from public.audit_logs where action in ('setting.publish', 'setting.rollback')
                     and entity_id = 'shipping') >= 2, 'publish and rollback are audited');
select tests.resume();
reset role;
select tests.act_as(:'editor');
select tests.assert_raises($$select public.admin_save_setting_draft('legal', '{"pages": {}}', null)$$, '42501',
  'content editors cannot edit legal pages (no legal.manage)');
reset role;

-- ══ Staff: suspension, roles, activity ══════════════════════════════════════
select tests.act_as(:'manager');
select tests.assert((select count(*) from jsonb_array_elements(public.admin_list_staff()) s) >= 8, 'staff list includes every role holder');
select tests.assert_raises($$select public.admin_set_staff_suspended(gen_random_uuid(), true, 'x')$$, '42501',
  'the store manager has no users.manage');
reset role;
select tests.act_as(:'owner');
select public.admin_touch_activity();
select tests.su();
select tests.assert((select last_active_at is not null from public.profiles where id = :'owner'), 'staff activity is recorded');
select tests.resume();
select tests.assert_equal(public.admin_set_staff_suspended(:'owner', true, 'x') ->> 'code', 'cannot_suspend_self', 'nobody suspends themselves');
select tests.assert_equal(public.admin_set_staff_suspended(:'editor', true, '') ->> 'code', 'reason_required', 'suspension needs a reason');
select tests.assert_equal(public.admin_set_staff_suspended(:'editor', true, 'Left the company') ->> 'ok', 'true', 'owner suspends an editor');
reset role;
select tests.act_as(:'editor');
select tests.assert(not app.has_permission('content.view'), 'a suspended user holds no permission');
select tests.assert_equal((public.get_my_access() ->> 'suspended')::boolean, true, 'access profile reports the suspension');
select tests.assert_raises($$select public.admin_list_entries()$$, '42501', 'suspended staff are denied by every RPC');
reset role;
select tests.act_as(:'owner');
select tests.assert_equal(public.admin_set_staff_suspended(:'editor', false) ->> 'ok', 'true', 'owner reactivates the editor');
select tests.assert_equal(public.admin_change_staff_role(:'cs', 'customer_service', 'sales') ->> 'ok', 'true', 'owner changes a role');
select tests.su();
select tests.assert(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                            where ur.user_id = :'cs' and r.key = 'sales')
                    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                    where ur.user_id = :'cs' and r.key = 'customer_service'), 'role swapped atomically');
select tests.resume();
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'access.role_changed' and entity_id = :'cs'), 'role change audited');
select tests.resume();
select tests.assert_equal(public.admin_change_staff_role(:'cs', 'sales', 'customer_service') ->> 'ok', 'true', 'and back');
select tests.assert_equal(public.admin_lookup_account('ALICE10@test.local') ->> 'found', 'true', 'accounts are found by email (case-insensitive)');
select tests.assert_equal(public.admin_lookup_account('nobody@test.local') ->> 'found', 'false', 'no account means the person must sign in first');
select tests.assert_equal(public.admin_set_staff_suspended(:'super', true, 'test') ->> 'ok', 'true', 'the owner may suspend a super admin');
select tests.assert_equal(public.admin_set_staff_suspended(:'super', false) ->> 'ok', 'true', 'and reactivate');
reset role;
select tests.act_as(:'super');
select tests.assert_raises(format($$select public.admin_change_staff_role(%L, null, 'owner')$$, :'alice'), '42501',
  'only an owner can grant owner');
select tests.assert_equal(public.admin_set_staff_suspended(:'owner', true, 'coup') ->> 'code', 'only_owner_can_suspend_owner',
  'non-owners cannot suspend an owner');
reset role;
select tests.act_as(:'manager');
select tests.assert_raises(format($$select public.admin_change_staff_role(%L, null, 'super_admin')$$, :'alice'), '42501',
  'the manager has no roles.manage');
select tests.assert((select (r ->> 'editable')::boolean = false from jsonb_array_elements(public.admin_list_roles()) r where r ->> 'key' = 'sales'),
  'roles are read-only for staff without roles.manage');
reset role;

-- ══ Catalog: product aggregate ══════════════════════════════════════════════
\set new_product '{"slug": "pixel-test-10", "brandId": "BRAND", "categoryIds": ["CAT"], "primaryCategoryId": "CAT", "name": {"ar": "هاتف تجريبي", "en": "Test Phone"}, "status": "draft", "isVisible": true, "availabilityState": "available", "warrantyKind": "store", "warranty": {"ar": "ضمان المتجر سنة", "en": "1-year store warranty"}, "options": [{"key": "storage", "name": {"ar": "المساحة", "en": "Storage"}, "values": [{"key": "128gb", "label": {"ar": "128 جيجا", "en": "128GB"}}, {"key": "256gb", "label": {"ar": "256 جيجا", "en": "256GB"}}]}, {"key": "color", "name": {"ar": "اللون", "en": "Colour"}, "values": [{"key": "black", "label": {"ar": "أسود", "en": "Black"}, "swatchHex": "#111111"}]}], "variants": [{"sku": "TP10-128-BLK", "options": {"storage": "128gb", "color": "black"}, "price": 20000, "initialStock": 5, "lowStockThreshold": 2, "isDefault": true}, {"sku": "TP10-256-BLK", "options": {"storage": "256gb", "color": "black"}, "price": 24000, "compareAtPrice": 25000, "initialStock": 0}], "specGroups": [{"key": "display", "title": {"ar": "الشاشة", "en": "Display"}, "items": [{"key": "size", "label": {"ar": "المقاس", "en": "Size"}, "value": {"ar": "6.1 بوصة", "en": "6.1 in"}, "visible": true}, {"key": "hz", "label": {"ar": "التردد", "en": "Refresh"}, "value": {"ar": "120 هرتز", "en": "120 Hz"}, "visible": false}]}], "media": [{"kind": "image", "url": "/demo/media/iphone-17-black-front.svg", "alt": {"ar": "صورة", "en": "Image"}, "isCover": true, "colorKey": "black"}], "relations": [{"kind": "accessory", "productId": "REL"}], "priceReason": "Launch price"}'
select replace(replace(replace(:'new_product', 'BRAND', :'samsung'), 'CAT', :'phones'), 'REL', :'ip17') as payload \gset

select tests.act_as(:'editor');
select tests.assert_raises(format($$select public.admin_save_product(%L::jsonb)$$, :'payload'), '42501',
  'content editors cannot manage the catalog');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.admin_save_product(%L::jsonb)$$, :'payload'), '42501', 'sales cannot manage the catalog');
reset role;

select tests.act_as(:'manager');
select tests.assert_equal(public.admin_save_product((:'payload'::jsonb) || '{"slug": "Bad Slug"}') ->> 'code', 'invalid_slug', 'slug format validated');
select tests.assert_equal(public.admin_save_product((:'payload'::jsonb) || '{"categoryIds": []}') ->> 'code', 'category_required', 'a category is required');
select tests.assert_equal(public.admin_save_product(jsonb_set(:'payload'::jsonb, '{variants,1,sku}', '"TP10-128-BLK"')) ->> 'code',
  'duplicate_sku', 'duplicate SKUs in one product are refused');
select tests.assert_equal(public.admin_save_product(jsonb_set(:'payload'::jsonb, '{variants,0,sku}', '"IP18P-1TB-ORANGE"')) ->> 'code',
  'sku_taken', 'SKUs are unique across the catalog');
select tests.assert_equal(public.admin_save_product(jsonb_set(:'payload'::jsonb, '{variants,1,options,storage}', '"128gb"')) ->> 'code',
  'invalid_combination', 'two variants cannot share an option combination');
select tests.assert_equal(public.admin_save_product(jsonb_set(:'payload'::jsonb, '{variants,1,compareAtPrice}', '20000')) ->> 'code',
  'invalid_price', 'compare-at must be above the price');
select public.admin_save_product(:'payload'::jsonb) as created \gset
select tests.assert_equal((:'created'::jsonb) ->> 'ok', 'true', 'the manager creates a product with variants, specs, media and relations');
select (:'created'::jsonb) ->> 'id' as pid \gset
set constraints all immediate;
set constraints all deferred;
select public.admin_get_product(:'pid') as doc \gset
select tests.assert_equal(jsonb_array_length((:'doc'::jsonb) -> 'variants'), 2, 'both variants saved');
select tests.assert_equal(((:'doc'::jsonb) -> 'variants' -> 0 ->> 'stock')::integer, 5, 'initial stock applied to a new variant');
select tests.su();
select tests.assert_equal((select count(*)::integer from public.stock_movements sm join public.product_variants v on v.id = sm.variant_id
                           where v.sku = 'TP10-128-BLK' and sm.reason = 'initial'), 1, 'initial stock writes a movement');
select tests.resume();
select tests.su();
select tests.assert_equal((select count(*)::integer from public.price_history h join public.product_variants v on v.id = h.variant_id
                           where v.product_id = :'pid'::uuid and h.source = 'admin' and h.reason = 'Launch price'), 2,
  'initial prices are recorded in price history with the reason');
select tests.resume();
select tests.assert_equal((select (s ->> 'visible')::boolean from jsonb_array_elements((:'doc'::jsonb) -> 'specGroups' -> 0 -> 'items') s
                           where s ->> 'key' = 'hz'), false, 'hidden specs stay hidden');
select tests.assert_equal((:'doc'::jsonb) -> 'relations' -> 0 ->> 'slug', 'iphone-17', 'manual accessory relation saved');
select tests.assert_equal((:'doc'::jsonb) -> 'media' -> 0 ->> 'colorKey', 'black', 'colour-specific media kept');
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'catalog.product_created' and entity_id = :'pid'),
  'product creation is audited');
select tests.resume();
select tests.assert_equal(public.admin_save_product(:'payload'::jsonb) ->> 'code', 'slug_taken', 'slugs are unique');

-- Stale edits: the editor loaded version A; someone else saved since.
select (:'doc'::jsonb) ->> 'updatedAt' as doc_at \gset
select ((:'doc'::jsonb) -> 'variants' -> 0) as v0 \gset
select ((:'doc'::jsonb) -> 'variants' -> 1) as v1 \gset
select jsonb_build_object('id', :'pid', 'expectedUpdatedAt', :'doc_at') || ((:'payload'::jsonb) - 'variants')
  || jsonb_build_object('variants', jsonb_build_array(
       (:'v0'::jsonb) - 'stock' - 'reserved' - 'available' - 'lastPriceChange',
       (:'v1'::jsonb) - 'stock' - 'reserved' - 'available' - 'lastPriceChange'), 'name', '{"ar": "هاتف تجريبي 2", "en": "Test Phone 2"}'::jsonb) as edit \gset
select public.admin_save_product(:'edit'::jsonb) ->> 'ok' as edit_ok \gset
select tests.assert_equal(:'edit_ok'::text, 'true', 'an up-to-date editor can save');
select tests.assert_equal(public.admin_save_product(:'edit'::jsonb) ->> 'code', 'stale',
  'saving again from the old version is refused (no silent overwrite)');

-- Visibility / archive / duplicate / delete.
select tests.assert_equal(public.admin_set_products_state(array[:'pid'::uuid], 'publish') ->> 'updated', '1', 'publish');
reset role;
select tests.act_as_anon();
select tests.assert(public.catalog_product('pixel-test-10') is not null, 'a published product is public');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_set_products_state(array[:'pid'::uuid], 'hide') ->> 'updated', '1', 'hide');
reset role;
select tests.act_as_anon();
select tests.assert(public.catalog_product('pixel-test-10') is null, 'a hidden product disappears from the storefront');
reset role;
select tests.act_as(:'manager');
select public.admin_set_products_state(array[:'pid'::uuid], 'show');
select public.admin_duplicate_product(:'pid') as dup \gset
select tests.assert_equal((:'dup'::jsonb) ->> 'ok', 'true', 'duplicate');
select tests.su();
select tests.assert_equal((select status from public.products where id = ((:'dup'::jsonb) ->> 'id')::uuid), 'draft', 'duplicates start as drafts');
select tests.resume();
select tests.su();
select tests.assert((select count(*) from public.product_variants where product_id = ((:'dup'::jsonb) ->> 'id')::uuid
                     and sku like '%-COPY%' and stock_quantity = 0) = 2, 'duplicate variants get new SKUs and no stock');
select tests.resume();
select tests.assert_equal(public.admin_delete_product(((:'dup'::jsonb) ->> 'id')::uuid) ->> 'ok', 'true', 'an unused product can be deleted');
select tests.su();
select tests.assert_equal(public.admin_delete_product((select id from public.products where slug = 'iphone-18-pro')) ->> 'code',
  'has_history', 'a product referenced by a trade-in request cannot be hard-deleted (archive it instead)');
reset role;

-- ══ Pricing ═════════════════════════════════════════════════════════════════
select id as tpv, updated_at as tpv_at from public.product_variants where sku = 'TP10-128-BLK' \gset
select tests.act_as(:'cs');
select tests.assert_raises(format($$select public.admin_set_variant_price(%L, 19000, null, 'x', now())$$, :'tpv'), '42501',
  'customer service cannot change prices');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_set_variant_price(:'tpv', 19000, 21000, 'Competitor match', now() - interval '1 year') ->> 'code',
  'stale', 'a stale price edit is refused');
select tests.assert_equal(public.admin_set_variant_price(:'tpv', -1, null, 'x', :'tpv_at'::timestamptz) ->> 'code', 'invalid_price', 'negative prices refused');
select tests.assert_equal(public.admin_set_variant_price(:'tpv', 19000, 21000, 'Competitor match', :'tpv_at'::timestamptz) ->> 'ok', 'true',
  'the manager changes a price');
select tests.su();
select tests.assert_equal((select reason from public.price_history where variant_id = :'tpv' order by id desc limit 1), 'Competitor match',
  'the change is in price history with its reason');
select tests.resume();
select tests.su();
select tests.assert_equal((select old_price::text || '>' || new_price::text from public.price_history where variant_id = :'tpv' order by id desc limit 1),
  '20000.00>19000.00', 'old and new prices recorded');
select tests.resume();
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'price.changed' and entity_id = 'TP10-128-BLK'),
  'price change audited');
select tests.resume();
select tests.assert((public.admin_list_price_history(jsonb_build_object('q', 'TP10-128')) ->> 'total')::integer >= 2,
  'price history is searchable by SKU');
select tests.assert((public.admin_list_price_history(jsonb_build_object('actor', 'manager10')) ->> 'total')::integer >= 1,
  'price history is searchable by staff');
-- Bulk: +10 % with a reason; compare-at kept only when still above the price.
select tests.assert_equal(public.admin_bulk_update_variants(array[:'tpv'::uuid], '{"priceMode": "percent", "priceValue": 10}', '') ->> 'code',
  'reason_required', 'bulk price changes need a reason');
select tests.assert_equal(public.admin_bulk_update_variants(array[:'tpv'::uuid], '{"priceMode": "percent", "priceValue": 10}', 'Supplier increase') ->> 'updated',
  '1', 'bulk percent change');
select tests.su();
select tests.assert_equal((select price from public.product_variants where id = :'tpv'), 20900.00::numeric, '19000 + 10 % = 20900');
select tests.resume();
select tests.su();
select tests.assert_equal((select source from public.price_history where variant_id = :'tpv' order by id desc limit 1), 'bulk',
  'bulk changes are tagged in price history');
select tests.resume();
select tests.assert_equal(public.admin_bulk_update_variants(array[:'tpv'::uuid], '{"lowStockThreshold": 3, "isActive": true}', null) ->> 'updated',
  '1', 'bulk threshold / availability update');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.admin_bulk_update_variants(array[%L::uuid], '{"priceMode": "set", "priceValue": 1}', 'x')$$, :'tpv'),
  '42501', 'sales cannot bulk-edit variants');
reset role;

-- ══ Inventory ═══════════════════════════════════════════════════════════════
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'addition', 3, '') ->> 'code', 'reason_required', 'adjustments need a reason');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'addition', 0, 'x') ->> 'code', 'invalid_quantity', 'quantity must be positive');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'damage', 50, 'Dropped') ->> 'code', 'negative', 'stock never goes negative');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'addition', 3, 'Delivery', 4) ->> 'code', 'stale',
  'adjusting from a stale quantity is refused');
select public.admin_adjust_stock(:'tpv', 'addition', 3, 'Supplier delivery', 5) as adj \gset
select tests.assert_equal((:'adj'::jsonb) ->> 'before' || '>' || ((:'adj'::jsonb) ->> 'after'), '5>8', 'before / after returned');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'damage', 1, 'Cracked screen') ->> 'after', '7', 'damage reduces stock');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'correction', 6, 'Count') ->> 'after', '6', 'correction sets the count');
select tests.su();
select tests.assert_equal((select count(*)::integer from public.stock_movements where variant_id = :'tpv' and reason in ('addition', 'damage', 'correction')), 3,
  'every adjustment writes a typed movement');
select tests.resume();
select tests.su();
select tests.assert_equal((select quantity_before || '/' || delta || '/' || quantity_after from public.stock_movements
                           where variant_id = :'tpv' order by id desc limit 1), '7/-1/6', 'movement keeps before / change / after');
select tests.resume();
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'stock.adjusted' and entity_id = 'TP10-128-BLK'),
  'stock adjustments are audited');
select tests.resume();
select tests.assert((public.admin_list_stock_movements(jsonb_build_object('q', 'TP10-128', 'type', 'damage')) ->> 'total')::integer = 1,
  'movement history filters by type');
select tests.assert((select (x ->> 'available')::integer from jsonb_array_elements(public.admin_list_inventory(jsonb_build_object('q', 'TP10-128')) -> 'items') x
                     limit 1) = 6, 'inventory shows available quantity');
reset role;
-- A real order reserves stock: available < quantity, and stock cannot drop below reserved units.
update public.site_settings set value = jsonb_build_object(
    'preset', 'custom', 'highValue', jsonb_build_object('enabled', false, 'threshold', 100000),
    'multipleExpensive', jsonb_build_object('enabled', false, 'unitPrice', 20000, 'minUnits', 2),
    'newCustomer', jsonb_build_object('enabled', false, 'minTotal', 30000), 'splitPayment', jsonb_build_object('enabled', false),
    'unfinishedOrders', jsonb_build_object('enabled', false, 'maxCount', 2, 'windowDays', 7),
    'velocity', jsonb_build_object('enabled', false, 'maxOrders', 3, 'windowHours', 1))
  where key = 'order_review';
select tests.act_as(:'alice');
select tests.checkout(tests.items(:'tpv', '4'), '{"method": "pickup"}', '{"method": "cod"}') -> 'order' ->> 'id' as res_order \gset
reset role;
select tests.assert(:'res_order' <> '', 'a customer order reserves 4 units');
select tests.act_as(:'manager');
select tests.assert_equal((select (x ->> 'reserved')::integer from jsonb_array_elements(public.admin_list_inventory(jsonb_build_object('q', 'TP10-128')) -> 'items') x
                           limit 1), 4, 'inventory shows reserved units');
select tests.assert_equal((select (x ->> 'available')::integer from jsonb_array_elements(public.admin_list_inventory(jsonb_build_object('q', 'TP10-128')) -> 'items') x
                           limit 1), 2, 'available = quantity − reserved');
select tests.assert_equal(public.admin_adjust_stock(:'tpv', 'reduction', 3, 'Transfer') ->> 'code', 'below_reserved',
  'stock cannot drop below reserved units');
select tests.assert((public.staff_list_orders(jsonb_build_object('fulfillment', 'pickup', 'paymentMethod', 'cod', 'q', 'Test Customer')) ->> 'total')::integer = 1,
  'order filters: fulfillment, payment method and customer search');
select tests.assert_equal((public.staff_list_orders(jsonb_build_object('fulfillment', 'delivery', 'q', 'Test Customer')) ->> 'total')::integer, 0,
  'filters combine');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.staff_record_payment(%L, 100, 'cash')$$, :'res_order'), '42501',
  'sales (no payments.verify) cannot record verified payments');
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.staff_record_payment(:'res_order', 100, 'cash', null, 'Deposit at the counter') ->> 'ok', 'true',
  'the manager records a verified payment');
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where entity_type = 'public.payment_records' and action = 'insert'),
  'payment verification is audited');
select tests.resume();
select tests.assert(exists (select 1 from jsonb_array_elements(public.admin_list_inventory(jsonb_build_object('view', 'out')) -> 'items') x
                            where x ->> 'sku' = 'TP10-256-BLK'), 'out-of-stock view lists variants with nothing available');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.admin_adjust_stock(%L, 'addition', 1, 'x')$$, :'tpv'), '42501', 'sales cannot adjust stock');
reset role;

-- ══ Categories & brands ═════════════════════════════════════════════════════
select tests.act_as(:'manager');
select tests.su();
select updated_at as laptops_at from public.categories where id = :'laptops' \gset
select tests.resume();
select tests.assert_equal(public.admin_save_category(jsonb_build_object('id', :'laptops', 'slug', 'laptops', 'parentId', :'macbook',
  'name', '{"ar": "لابتوب", "en": "Laptops"}'::jsonb, 'expectedUpdatedAt', :'laptops_at')) ->> 'code', 'cycle',
  'a category cannot move under its own child');
select tests.assert_equal(public.admin_save_category(jsonb_build_object('slug', 'cases', 'parentId', :'accessories',
  'name', '{"ar": "جرابات", "en": "Cases"}'::jsonb, 'showInShop', true)) ->> 'ok', 'true', 'create a child category');
select tests.assert_equal(public.admin_delete_category(:'phones') ->> 'code', 'in_use', 'categories with products cannot be deleted');
select tests.su();
select tests.assert_equal(public.admin_delete_category((select id from public.categories where slug = 'cases')) ->> 'ok', 'true',
  'an empty category can be deleted');
select tests.resume();
select tests.assert_equal(public.admin_reorder_categories(null, array[:'phones'::uuid, :'macbook'::uuid]) ->> 'code', 'invalid_selection',
  'reordering is limited to siblings');
select tests.assert_equal(public.admin_delete_brand(:'apple') ->> 'code', 'in_use', 'brands with products cannot be deleted');
select tests.assert_equal(public.admin_save_brand(jsonb_build_object('slug', 'nothing', 'name', '{"ar": "نثنج", "en": "Nothing"}'::jsonb,
  'isFeatured', true, 'categoryIds', jsonb_build_array(:'phones'))) ->> 'ok', 'true', 'create a brand with category links');
select tests.su();
select tests.assert((select show_on_apple from public.brands where slug = 'nothing') = false, 'Apple landing participation defaults off');
select tests.resume();
reset role;

-- ══ Orders & customers ══════════════════════════════════════════════════════
select tests.act_as(:'alice');
select tests.assert_raises($$select public.admin_list_customers()$$, '42501', 'customers cannot list customers');
select tests.assert_raises(format($$select public.admin_get_customer(%L)$$, :'alice'), '42501', 'customers cannot open the admin customer view');
select tests.assert_raises($$select * from public.customer_notes$$, '42501', 'customer notes are not readable through the API');
reset role;
select tests.act_as(:'cs');
select tests.assert((public.admin_list_customers(jsonb_build_object('q', 'alice10')) ->> 'total')::integer = 1, 'customer service searches customers');
select tests.assert_raises(format($$select public.admin_save_customer_note(%L, null, 'VIP')$$, :'alice'), '42501',
  'customer service (no customers.manage) cannot write CRM notes');
select tests.assert_equal((public.admin_get_customer(:'alice') -> 'orders') is null, false, 'orders listed for staff with orders.view');
reset role;
select tests.act_as(:'manager');
select public.admin_save_customer_note(:'alice', null, 'Prefers WhatsApp in the evening', true) as note \gset
select tests.assert_equal((:'note'::jsonb) ->> 'ok', 'true', 'the manager adds a CRM note');
select tests.assert_equal(public.admin_save_customer_note(:'alice', ((:'note'::jsonb) ->> 'id')::uuid, 'Edited', true, now() - interval '1 day') ->> 'code',
  'stale', 'note edits detect staleness');
select tests.assert_equal(public.admin_save_customer_note(:'alice', ((:'note'::jsonb) ->> 'id')::uuid, 'Prefers WhatsApp after 6pm', true,
  ((:'note'::jsonb) ->> 'updatedAt')::timestamptz) ->> 'ok', 'true', 'note edited');
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where entity_type = 'public.customer_notes' and action = 'update'),
  'note edits are audited');
select tests.resume();
select tests.assert_equal(public.admin_get_customer(:'alice') -> 'notes' -> 0 ->> 'body', 'Prefers WhatsApp after 6pm', 'notes in the customer detail');
select tests.assert(not (public.admin_list_customers(jsonb_build_object('q', 'manager10')) ->> 'total')::integer > 0,
  'staff accounts are not listed as customers');
select tests.assert((public.staff_list_orders(jsonb_build_object('paymentMethod', 'cod', 'from', now() - interval '10 years')) ->> 'total')::integer >= 0,
  'order filters accept payment method and date range');
select tests.assert_equal((public.staff_list_orders(jsonb_build_object('assigned', 'me')) ->> 'total')::integer, 0, 'nothing assigned to the manager');
reset role;
select tests.act_as(:'alice');
select tests.assert(not (public.list_my_notifications(50, null, false)::text like '%WhatsApp after 6pm%'),
  'CRM notes never reach the customer');
reset role;

-- ══ Services: priority, SLA, filters ═══════════════════════════════════════
select id as demo_repair from public.service_requests where request_number = 'RP-2026-900001' \gset
update public.service_requests set created_at = now() - interval '5 days' where id = :'demo_repair';
delete from public.service_events where request_id = :'demo_repair';
select tests.act_as(:'tech');
select tests.assert_equal(public.admin_set_service_priority(:'demo_repair', 'urgent') ->> 'ok', 'true', 'technicians set priority');
select public.admin_list_service_requests('repair', '{"view": "open"}') as rq \gset
select tests.assert_equal((select x ->> 'priority' from jsonb_array_elements((:'rq'::jsonb) -> 'items') x where x ->> 'number' = 'RP-2026-900001'),
  'urgent', 'priority shown in the queue');
select tests.assert_equal((select x ->> 'sla' from jsonb_array_elements((:'rq'::jsonb) -> 'items') x where x ->> 'number' = 'RP-2026-900001'),
  'overdue', 'an untouched 5-day-old request is overdue');
select tests.assert(((:'rq'::jsonb) -> 'counts' ->> 'overdue')::integer >= 1, 'queue counts include overdue');
select tests.assert_equal((public.admin_list_service_requests('repair', '{"sla": "on_track"}') -> 'items') @> '[{"number": "RP-2026-900001"}]', false,
  'SLA filter');
select tests.assert(public.admin_service_context(:'demo_repair') ? 'notifications', 'staff see the notification history');
select tests.assert_raises($$select public.admin_list_service_requests('trade_in', '{}')$$, '42501', 'technicians cannot see trade-ins');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises(format($$select public.admin_set_service_priority(%L, 'low')$$, :'demo_repair'), '42501',
  'sales cannot touch repairs');
select tests.assert((public.admin_list_service_requests('used', '{"view": "all", "battery": "90_plus"}') ->> 'ok')::boolean,
  'used requests filter by battery preference');
reset role;

-- ══ Reviews, waitlists, notifications ═══════════════════════════════════════
select tests.act_as(:'cs');
select tests.assert((public.admin_list_reviews(jsonb_build_object('rating', 5)) ? 'items'), 'reviews filter by rating');
select tests.assert((public.admin_list_waitlist(jsonb_build_object('kind', 'notify')) ? 'items'), 'notify-me operations list');
select public.admin_list_notification_templates() as tpl \gset
select tests.assert(jsonb_array_length((:'tpl'::jsonb) -> 'templates') > 10, 'templates listed');
select (select x ->> 'updatedAt' from jsonb_array_elements((:'tpl'::jsonb) -> 'templates') x where x ->> 'key' = 'order.confirmed') as tpl_at \gset
select tests.assert_equal(public.admin_save_notification_template('order.confirmed', '{"ar": "تم تأكيد {{secret}}", "en": "x"}',
  '{"ar": "نص", "en": "Body"}', true, :'tpl_at'::timestamptz) ->> 'code', 'unknown_placeholder', 'only the closed placeholder set is allowed');
select tests.assert_equal(public.admin_save_notification_template('order.confirmed', '{"ar": "تم تأكيد طلبك {{order_number}}", "en": "Order {{order_number}} confirmed"}',
  '{"ar": "نص", "en": "Body"}', true, :'tpl_at'::timestamptz) ->> 'ok', 'true', 'template edited');
select tests.assert_equal(public.admin_send_notifications(array[:'alice'::uuid], '{"ar": "تحديث", "en": "Update"}', '{"ar": "طلبك جاهز", "en": "Ready"}', '/account') ->> 'sent',
  '1', 'manual in-app send');
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'notification.bulk_sent'), 'bulk sends audited');
select tests.resume();
reset role;
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_list_notification_templates()$$, '42501', 'sales cannot manage notifications');
reset role;

-- ══ Offers, entries, page sections ══════════════════════════════════════════
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_save_offer(jsonb_build_object('slug', 'eid-code', 'kind', 'promo_code', 'title', '{"ar": "كود العيد", "en": "Eid code"}'::jsonb,
  'badge', '{"ar": "كود", "en": "Code"}'::jsonb, 'promoCode', 'demo10', 'discountPercent', 5)) ->> 'code', 'code_taken',
  'promo codes are unique (case-insensitive)');
select tests.assert_equal(public.admin_save_offer(jsonb_build_object('slug', 'eid-code', 'kind', 'promo_code', 'title', '{"ar": "كود العيد", "en": "Eid code"}'::jsonb,
  'badge', '{"ar": "كود", "en": "Code"}'::jsonb, 'promoCode', 'x', 'discountPercent', 5)) ->> 'code', 'invalid_code', 'promo code format');
select tests.assert_equal(public.admin_save_offer(jsonb_build_object('slug', 'flash-x', 'kind', 'flash', 'title', '{"ar": "فلاش", "en": "Flash"}'::jsonb,
  'badge', '{"ar": "فلاش", "en": "Flash"}'::jsonb, 'discountPercent', 10)) ->> 'code', 'end_required', 'flash offers need an end time');
select public.admin_save_offer(jsonb_build_object('slug', 'eid-code', 'kind', 'promo_code', 'title', '{"ar": "كود العيد", "en": "Eid code"}'::jsonb,
  'badge', '{"ar": "كود", "en": "Code"}'::jsonb, 'promoCode', 'eid26', 'discountPercent', 5, 'status', 'published',
  'categoryIds', jsonb_build_array(:'accessories'))) as offer \gset
select tests.assert_equal((:'offer'::jsonb) ->> 'ok', 'true', 'promo code offer created');
select tests.su();
select tests.assert_equal((select promo_code from public.offers where slug = 'eid-code'), 'EID26', 'codes are stored upper-case');
select tests.resume();
reset role;
select tests.act_as(:'editor');
select tests.assert_raises($$select public.admin_save_offer('{}'::jsonb)$$, '42501', 'content editors cannot manage offers');
select tests.assert_equal(public.admin_save_entry(jsonb_build_object('slug', 'store-news-1', 'type', 'news', 'status', 'published',
  'title', '{"ar": "خبر", "en": "News"}'::jsonb)) ->> 'code', 'publish_forbidden', 'content editors cannot publish');
select public.admin_save_entry(jsonb_build_object('slug', 'store-news-1', 'type', 'news', 'status', 'draft',
  'title', '{"ar": "خبر", "en": "News"}'::jsonb, 'productIds', jsonb_build_array(:'ip17'))) as entry \gset
select tests.assert_equal((:'entry'::jsonb) ->> 'ok', 'true', 'content editors save drafts');
select tests.su();
select tests.assert_equal(public.admin_save_page_section((select id from public.page_sections where key = 'apple-authorized'), false, '{}',
  now()) ->> 'code', 'publish_forbidden', 'page sections are live: editing them needs content.publish');
select tests.resume();
reset role;
select tests.act_as(:'manager');
select tests.assert_equal(public.admin_set_entries_status(array[((:'entry'::jsonb) ->> 'id')::uuid], 'published') ->> 'updated', '1',
  'the manager publishes the entry');
select tests.su();
select id as sec, updated_at as sec_at, props as sec_props from public.page_sections where key = 'apple-authorized' \gset
select tests.resume();
select tests.assert_equal(public.admin_save_page_section(:'sec', false, :'sec_props'::jsonb, now() - interval '1 year') ->> 'code', 'stale',
  'stale section edits are refused');
select tests.assert_equal(public.admin_save_page_section(:'sec', false, :'sec_props'::jsonb, :'sec_at'::timestamptz) ->> 'ok', 'true',
  'the Apple Authorized Reseller section can be hidden');
select tests.su();
select tests.assert_equal((select is_visible from public.page_sections where id = :'sec'), false, 'section hidden');
select tests.resume();
reset role;

-- ══ Dashboard, analytics, exports, backup ═══════════════════════════════════
select tests.act_as(:'tech');
select public.admin_dashboard(now() - interval '7 days', now()) as dash \gset
select tests.assert((:'dash'::jsonb) -> 'orders' = 'null'::jsonb, 'technicians do not see order metrics');
select tests.assert(((:'dash'::jsonb) -> 'services') ? 'repair' and not (((:'dash'::jsonb) -> 'services') ? 'trade_in'),
  'dashboard services limited to what the role can see');
select tests.assert_raises($$select public.admin_analytics(now() - interval '7 days', now())$$, '42501', 'analytics needs analytics.view');
reset role;
select tests.act_as(:'manager');
select public.admin_analytics(now() - interval '30 days', now(), true) as an \gset
select tests.assert((:'an'::jsonb) -> 'totals' ? 'averageOrderValue' and (:'an'::jsonb) ? 'bestSellers' and (:'an'::jsonb) ? 'repeatCustomers',
  'analytics returns totals, best sellers and repeat customers');
select tests.assert(not ((:'an'::jsonb)::text ~ '@test\.local'), 'analytics never contains customer emails');
select tests.assert_raises($$select public.admin_analytics(now(), now() - interval '1 day')$$, '22023', 'invalid ranges are refused');
select tests.assert(jsonb_array_length(public.admin_export('variants') -> 'rows') > 100, 'variant export');
select tests.su();
select tests.assert(exists (select 1 from public.audit_logs where action = 'export.variants'), 'exports are audited');
select tests.resume();
select tests.assert_raises($$select public.admin_export_backup()$$, '42501', 'backup needs data.backup (owner-level)');
reset role;
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_export('orders')$$, '42501', 'sales cannot export');
reset role;
select tests.act_as(:'owner');
select public.admin_export_backup() as backup \gset
select tests.assert((:'backup'::jsonb) ? 'settings' and (:'backup'::jsonb) ? 'products' and not ((:'backup'::jsonb) -> 'settings' ? 'security'),
  'backup contains settings and catalog but not security settings');
select tests.assert(not ((:'backup'::jsonb)::text ~ '@test\.local'), 'backup contains no customer data');
reset role;

-- ══ Import ═══════════════════════════════════════════════════════════════════
select tests.act_as(:'cs');
select tests.assert_raises($$select public.admin_import_preview('x.csv', '[{"sku": "A1"}]')$$, '42501', 'import needs data.import');
reset role;
select tests.act_as(:'manager');
select public.admin_import_preview('catalog.csv', jsonb_build_array(
  jsonb_build_object('sku', 'IMP-A-128', 'productSlug', 'import-phone', 'nameAr', 'هاتف مستورد', 'nameEn', 'Import Phone',
                     'brand', 'samsung', 'category', 'phones', 'price', '15000', 'stock', '4', 'storage', '128GB', 'color', 'Mint'),
  jsonb_build_object('sku', 'IMP-A-256', 'productSlug', 'import-phone', 'nameAr', 'هاتف مستورد', 'brand', 'Samsung',
                     'category', 'phones', 'price', '17000', 'stock', '0', 'storage', '256GB', 'color', 'Mint'),
  jsonb_build_object('sku', 'IMP-A-256', 'productSlug', 'import-phone', 'price', '1'),
  jsonb_build_object('sku', 'TP10-128-BLK', 'productSlug', 'pixel-test-10', 'price', 'abc'),
  jsonb_build_object('sku', 'TP10-256-BLK', 'price', '23500', 'stock', '2'),
  jsonb_build_object('sku', '=HYPERLINK("x")', 'productSlug', 'x', 'price', '1'),
  jsonb_build_object('sku', 'IMP-B-1', 'productSlug', 'import-b', 'nameAr', 'منتج', 'brand', 'no-such-brand', 'category', 'phones', 'price', '10'),
  jsonb_build_object('sku', 'IMP-C-1', 'productSlug', 'import-c', 'nameAr', 'منتج', 'brand', 'apple', 'category', 'phones', 'price', '10', 'storage', 'huge')
)) as prev \gset
select tests.assert_equal((:'prev'::jsonb) -> 'summary' ->> 'createProduct', '1', 'one new product');
select tests.assert_equal((:'prev'::jsonb) -> 'summary' ->> 'createVariant', '1', 'its second row becomes a variant of it');
select tests.assert_equal((:'prev'::jsonb) -> 'summary' ->> 'update', '1', 'existing SKU is an update');
select tests.assert_equal((:'prev'::jsonb) -> 'summary' ->> 'errors', '5', 'invalid rows are flagged');
select tests.assert(((:'prev'::jsonb) -> 'rows' -> 2 -> 'errors') ? 'duplicate_in_file', 'duplicate SKU in the file');
select tests.assert(((:'prev'::jsonb) -> 'rows' -> 3 -> 'errors') ? 'invalid_price', 'price format');
select tests.assert(((:'prev'::jsonb) -> 'rows' -> 5 -> 'errors') ? 'formula_not_allowed', 'spreadsheet formulas are rejected, never evaluated');
select tests.assert(((:'prev'::jsonb) -> 'rows' -> 6 -> 'errors') ? 'unknown_brand', 'unknown brand');
select tests.assert(((:'prev'::jsonb) -> 'rows' -> 7 -> 'errors') ? 'invalid_storage', 'invalid storage value');
select tests.su();
select tests.assert(not exists (select 1 from public.product_variants where sku = 'IMP-A-128'), 'preview changes nothing');
select tests.resume();
select tests.assert_equal(public.admin_import_commit(((:'prev'::jsonb) ->> 'jobId')::uuid) ->> 'code', 'has_errors',
  'a file with errors is not applied unless "valid rows only" is chosen');
-- Partial-failure safety: a valid row becomes invalid before commit → nothing is applied.
reset role;
insert into public.product_variants (product_id, sku, price) values (:'ip17', 'IMP-A-256', 1);
select tests.act_as(:'manager');
select public.admin_import_commit(((:'prev'::jsonb) ->> 'jobId')::uuid, true) as failed \gset
select tests.assert_equal((:'failed'::jsonb) ->> 'code', 'failed', 'a conflict found at commit fails the whole job');
select tests.su();
select tests.assert(not exists (select 1 from public.products where slug = 'import-phone'), 'failed jobs leave no partial changes');
select tests.resume();
select tests.su();
select tests.assert_equal((select price from public.product_variants where sku = 'TP10-256-BLK'), 24000.00::numeric, 'no partial price updates either');
select tests.resume();
reset role;
delete from public.product_variants where sku = 'IMP-A-256';
select tests.act_as(:'manager');
select public.admin_import_preview('catalog-2.csv', jsonb_build_array(
  jsonb_build_object('sku', 'IMP-A-128', 'productSlug', 'import-phone', 'nameAr', 'هاتف مستورد', 'nameEn', 'Import Phone',
                     'brand', 'samsung', 'category', 'phones', 'price', '15000', 'stock', '4', 'storage', '128GB', 'color', 'Mint'),
  jsonb_build_object('sku', 'IMP-A-256', 'productSlug', 'import-phone', 'price', '17000', 'storage', '256GB', 'color', 'Mint'),
  jsonb_build_object('sku', 'TP10-256-BLK', 'price', '23500', 'stock', '2'),
  jsonb_build_object('sku', 'bad sku', 'price', '1')
)) as prev2 \gset
select public.admin_import_commit(((:'prev2'::jsonb) ->> 'jobId')::uuid, true) as done \gset
select tests.assert_equal((:'done'::jsonb) ->> 'applied', '3', 'valid rows applied');
select tests.su();
select tests.assert_equal((select status from public.products where slug = 'import-phone'), 'draft', 'imported products start as drafts');
select tests.resume();
select tests.su();
select tests.assert_equal((select count(*)::integer from public.product_variants v join public.products p on p.id = v.product_id
                           where p.slug = 'import-phone'), 2, 'both imported variants exist');
select tests.resume();
select tests.su();
select tests.assert_equal((select price from public.product_variants where sku = 'TP10-256-BLK'), 23500.00::numeric, 'price updated by import');
select tests.resume();
select tests.su();
select tests.assert_equal((select source from public.price_history h join public.product_variants v on v.id = h.variant_id
                           where v.sku = 'TP10-256-BLK' order by h.id desc limit 1), 'import', 'import price changes keep history');
select tests.resume();
select tests.su();
select tests.assert_equal((select reason from public.stock_movements sm join public.product_variants v on v.id = sm.variant_id
                           where v.sku = 'TP10-256-BLK' order by sm.id desc limit 1), 'import', 'import stock changes keep movements');
select tests.resume();
select tests.assert_equal(public.admin_import_commit(((:'prev2'::jsonb) ->> 'jobId')::uuid, true) ->> 'code', 'already_committed',
  'a job is applied once');
set constraints all immediate;
set constraints all deferred;
reset role;


-- ══ RBAC matrix: each system role sees / acts only where its permissions allow ══
create or replace function tests.allowed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;
grant execute on function tests.allowed(text) to authenticated;

create or replace function tests.rbac_row(p_user uuid) returns text language plpgsql as $$
declare
  v text := '';
  q text;
begin
  perform tests.act_as(p_user);
  foreach q in array array[
    'select public.admin_list_products()', 'select public.admin_list_customers()', 'select public.admin_list_audit_logs()',
    'select public.admin_analytics(now() - interval ''1 day'', now())', 'select public.admin_list_entries()',
    $q$select public.admin_list_service_requests('repair')$q$, $q$select public.admin_list_service_requests('trade_in')$q$,
    'select public.admin_list_staff()', 'select public.admin_export_backup()', 'select public.admin_list_offers()'] loop
    v := v || case when tests.allowed(q) then '1' else '0' end;
  end loop;
  perform set_config('role', 'none', true);
  return v;
end;
$$;
grant execute on function tests.rbac_row(uuid) to authenticated;

--                                            products customers audit analytics entries repair trade staff backup offers
select tests.assert_equal(tests.rbac_row(:'owner'),    '1111111111', 'owner: everything');
select tests.assert_equal(tests.rbac_row(:'super'),    '1111111111', 'super admin: everything');
select tests.assert_equal(tests.rbac_row(:'manager'),  '1111111101', 'store manager: all operations, no backup');
select tests.assert_equal(tests.rbac_row(:'sales'),    '1100001000', 'sales: catalog view, customers, trade-in');
select tests.assert_equal(tests.rbac_row(:'cs'),       '1100011000', 'customer service: catalog view, customers, repairs, trade-in');
select tests.assert_equal(tests.rbac_row(:'tech'),     '0100010000', 'repairs team: customers and repairs only');
select tests.assert_equal(tests.rbac_row(:'editor'),   '1000100001', 'content editor: catalog view, content, offers (read)');
select tests.assert_equal(tests.rbac_row(:'designer'), '0000100001', 'design editor: content view only');

-- ══ Audit viewer ═════════════════════════════════════════════════════════════
select tests.act_as(:'sales');
select tests.assert_raises($$select public.admin_list_audit_logs()$$, '42501', 'audit log needs audit.view');
reset role;
select tests.act_as(:'manager');
select tests.assert((public.admin_list_audit_logs(jsonb_build_object('module', 'catalog')) ->> 'total')::integer > 0, 'audit filters by module');
select tests.assert((public.admin_list_audit_logs(jsonb_build_object('actor', 'manager10', 'action', 'stock')) ->> 'total')::integer >= 3,
  'audit filters by actor and action');
select (public.admin_list_audit_logs(jsonb_build_object('action', 'price.changed')) -> 'items' -> 0 ->> 'id')::bigint as audit_id \gset
select tests.assert(public.admin_get_audit_log(:'audit_id') ? 'metadata', 'audit detail with before / after / metadata');
select tests.assert_equal(app.redact_secrets('{"a": 1, "claim_token_hash": "x", "nested": {"api_key": "k"}}') ->> 'claim_token_hash', '[redacted]',
  'secret-looking values are redacted');
select tests.assert_equal(app.redact_secrets('{"nested": {"api_key": "k", "b": 2}}') -> 'nested' ->> 'api_key', '[redacted]', 'redaction is recursive');
reset role;
select tests.assert_raises($$update public.audit_logs set action = 'x' where id = (select max(id) from public.audit_logs)$$, '42501',
  'audit rows stay immutable');
-- Every required sensitive change produced an audit record.
select tests.assert(exists (select 1 from public.audit_logs where action = 'price.changed')
  and exists (select 1 from public.audit_logs where action = 'stock.adjusted')
  and exists (select 1 from public.audit_logs where action = 'access.role_changed')
  and exists (select 1 from public.audit_logs where action = 'setting.publish')
  and exists (select 1 from public.audit_logs where action = 'service.priority_changed'), 'audit coverage for the Phase 06 actions');

-- Direct writes stay blocked for API roles.
select tests.act_as(:'manager');
select tests.assert_raises($$update public.product_variants set price = 1 where sku = 'TP10-128-BLK'$$, '42501', 'no direct price writes');
select tests.assert_raises($$insert into public.price_history (variant_id, product_id) values (gen_random_uuid(), gen_random_uuid())$$, '42501',
  'price history cannot be forged');
reset role;

rollback;
