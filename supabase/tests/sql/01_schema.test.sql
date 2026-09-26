-- Schema integrity, seeds and conventions.
begin;

select tests.assert_equal(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'every public table has Row Level Security enabled');

select tests.assert_equal((select count(*)::int from public.roles where is_system), 8, '8 system roles seeded');
select tests.assert_equal((select count(*)::int from public.roles where grants_all), 1, 'exactly one grants-all role');
select tests.assert_equal((select key from public.roles where grants_all), 'owner', 'owner is the grants-all role');
select tests.assert_equal((select count(*)::int from public.permissions), 43, '43 permissions seeded');
select tests.assert_equal(
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = 'super_admin'),
  (select count(*)::int from public.permissions), 'super admin holds every permission');
select tests.assert_equal(
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = 'owner'), 0,
  'owner permissions are implicit (no explicit grants)');

select tests.assert_equal((select count(*)::int from public.setting_definitions), 23, '23 setting definitions (Phase 06 adds shipping, receipt, legal, loyalty, service_sla)');
select tests.assert_equal((select count(*)::int from public.site_settings), 23, 'base seed published 23 settings');
select tests.assert_equal((select count(*)::int from public.site_settings_versions), 23, 'initial versions recorded');
select tests.assert_equal(
  (select value -> 'branches' -> 0 -> 'phones' ->> 0 from public.site_settings where key = 'store'), '01212004229',
  'store phone seeded from base settings');
select tests.assert(
  (select value -> 'whatsappNumber' = 'null'::jsonb from public.site_settings where key = 'store'),
  'WhatsApp number is NOT assumed (null until configured)');

-- localized_text domain
select tests.assert_raises($$select '{"en": "only english"}'::public.localized_text$$, '23514', 'localized_text requires Arabic');
select tests.assert_raises($$select '{"ar": "  "}'::public.localized_text$$, '23514', 'localized_text rejects blank Arabic');
select tests.assert_raises($$select '{"ar": "x", "fr": "y"}'::public.localized_text$$, '23514', 'localized_text rejects unknown locales');
select tests.assert_equal(('{"ar": "مرحبا", "en": "Hello"}'::public.localized_text ->> 'en'), 'Hello', 'localized_text accepts ar+en');
select tests.assert_equal(app.localized('{"ar": "مرحبا"}'::jsonb, 'en'), 'مرحبا', 'localized() falls back to Arabic');

-- Storage
select tests.assert_equal((select count(*)::int from storage.buckets), 10, '10 storage buckets (used-requests added in Phase 05, private)');
select tests.assert_equal(
  (select string_agg(id, ',' order by id) from storage.buckets where public), 'banners,products,site-media',
  'only catalog/marketing buckets are public');

-- Auth trigger provisions profiles with a validated locale
select tests.create_user('meta@test.local');
select tests.assert_equal((select preferred_locale from public.profiles where email = 'meta@test.local'), 'ar', 'profile created with default locale');
insert into auth.users (email, raw_user_meta_data) values ('en@test.local', '{"locale": "en"}');
select tests.assert_equal((select preferred_locale from public.profiles where email = 'en@test.local'), 'en', 'profile locale from sign-up metadata');
insert into auth.users (email, raw_user_meta_data) values ('bad@test.local', '{"locale": "fr"}');
select tests.assert_equal((select preferred_locale from public.profiles where email = 'bad@test.local'), 'ar', 'invalid locale falls back to Arabic');

rollback;
