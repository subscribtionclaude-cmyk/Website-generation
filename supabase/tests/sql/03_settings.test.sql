-- Site settings: public vs private visibility, draft isolation, publish workflow, versions, rollback.
begin;

create temporary table ids on commit drop as
select
  tests.create_user('owner3@test.local', 'owner') as owner_id,
  tests.create_user('manager3@test.local', 'store_manager') as manager_id,
  tests.create_user('editor3@test.local', 'content_editor') as editor_id,
  tests.create_user('designer3@test.local', 'design_editor') as designer_id,
  tests.create_user('customer3@test.local') as customer_id;
grant select on ids to authenticated, anon;

-- ── Public visibility ─────────────────────────────────────────────────────
select tests.act_as_anon();
select tests.assert_equal((select count(*)::int from public.site_settings), 11, 'anon reads the 11 public settings');
select tests.assert(not exists (select 1 from public.site_settings where key = 'security'), 'anon cannot read private settings');
select tests.assert_raises($$select count(*) from public.site_setting_drafts$$, '42501', 'anon cannot read drafts');
select tests.assert_raises($$update public.site_settings set value = '{}' where key = 'brand'$$, '42501', 'anon cannot write settings');
select tests.assert_raises($$select public.save_setting_draft('seo', '{}')$$, '42501', 'anon cannot call draft RPC');
reset role;

select tests.act_as((select customer_id from ids));
select tests.assert_equal((select count(*)::int from public.site_settings), 11, 'customers read only public settings');
select tests.assert_raises($$select public.save_setting_draft('seo', '{"x": 1}')$$, '42501', 'customer cannot save drafts');
select tests.assert_raises($$delete from public.site_settings$$, '42501', 'customer cannot delete settings');
reset role;

-- ── Draft → publish with permission split ─────────────────────────────────
select tests.act_as((select editor_id from ids));
select public.save_setting_draft('seo', '{"allowIndexing": false, "draft": true}');
select tests.assert_equal((select count(*)::int from public.site_setting_drafts where key = 'seo'), 1, 'content editor saved an seo draft');
select tests.assert_raises($$select public.save_setting_draft('store', '{"x": 1}')$$, '42501', 'content editor cannot edit store settings');
select tests.assert_raises($$select public.publish_setting('seo')$$, '42501', 'content editor cannot publish (no content.publish)');
select tests.assert_raises($$select public.save_setting_draft('seo', '[1,2]')$$, '22023', 'setting values must be JSON objects');
select tests.assert_raises($$select public.save_setting_draft('nope', '{}')$$, 'P0002', 'unknown setting keys rejected');
reset role;

select tests.act_as((select customer_id from ids));
select tests.assert_equal((select count(*)::int from public.site_setting_drafts), 0, 'drafts are invisible to customers');
reset role;
select tests.act_as_anon();
select tests.assert(
  (select value -> 'draft' from public.site_settings where key = 'seo') is null,
  'unpublished draft content never reaches the public table');
reset role;

select tests.act_as((select manager_id from ids));
select tests.assert_equal(public.publish_setting('seo', 'Hide from search engines during setup'), 2, 'store manager published seo as version 2');
reset role;

select tests.act_as_anon();
select tests.assert_equal((select value ->> 'allowIndexing' from public.site_settings where key = 'seo'), 'false', 'published value is public');
reset role;
select tests.assert_equal((select count(*)::int from public.site_setting_drafts where key = 'seo'), 0, 'draft removed after publish');
select tests.assert_equal((select note from public.site_settings_versions where key = 'seo' and version = 2), 'Hide from search engines during setup', 'publish note stored with version');
select tests.assert(exists (select 1 from public.audit_logs where action = 'setting.publish' and entity_id = 'seo'), 'publish audited');

-- Design scope uses design permissions.
select tests.act_as((select designer_id from ids));
select public.save_setting_draft('theme', '{"tokens": {"brandPrimary": "#F65311"}}');
select tests.assert_equal(public.publish_setting('theme'), 2, 'design editor can publish theme');
select tests.assert_raises($$select public.save_setting_draft('seo', '{}')$$, '42501', 'design editor cannot edit seo');
reset role;

-- ── Concurrency: stale drafts are rejected unless forced ──────────────────
select tests.act_as((select manager_id from ids));
select public.save_setting_draft('seo', '{"allowIndexing": true}');
reset role;
update public.site_settings set value = value || '{"changedElsewhere": true}', version = version + 1 where key = 'seo';
select tests.act_as((select manager_id from ids));
select tests.assert_raises($$select public.publish_setting('seo')$$, '40001', 'stale draft conflicts with a newer publish');
select tests.assert_equal(public.publish_setting('seo', null, true), 4, 'forced publish after review');
reset role;

-- ── Rollback creates a new version with an old value ─────────────────────
select tests.act_as((select manager_id from ids));
select tests.assert_equal(public.rollback_setting('seo', 1), 5, 'rollback publishes version 5');
reset role;
select tests.assert_equal(
  (select value from public.site_settings where key = 'seo'),
  (select value from public.site_settings_versions where key = 'seo' and version = 1),
  'rolled-back value equals version 1');
select tests.assert_equal((select count(*)::int from public.site_settings_versions where key = 'seo'), 5, 'history is append-only (5 versions)');

-- ── Private setting (security) ───────────────────────────────────────────
select tests.act_as((select manager_id from ids));
select tests.assert(exists (select 1 from public.site_settings where key = 'security'), 'staff with settings.view can read private settings');
select tests.assert_raises($$select public.save_setting_draft('security', '{"adminMfaRequired": true}')$$, '42501', 'only security.manage may change security settings');
reset role;
select tests.act_as((select owner_id from ids));
select public.save_setting_draft('security', '{"adminMfaRequired": false}');
select tests.assert_equal(public.publish_setting('security'), 2, 'owner can publish security settings');
reset role;

rollback;
