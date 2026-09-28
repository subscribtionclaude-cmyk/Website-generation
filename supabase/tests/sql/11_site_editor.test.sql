-- Visual Site Editor (Phase 07): design permissions, draft isolation from the storefront,
-- structural validation, stale drafts, publish → version, rollback, Phase 06 edits recorded as
-- versions, direct-table protection and audit records.
begin;

select tests.create_user('owner11@test.local', 'owner') as owner \gset
select tests.create_user('designer11@test.local', 'design_editor') as designer \gset
select tests.create_user('designer11b@test.local', 'design_editor') as designer2 \gset
select tests.create_user('manager11@test.local', 'store_manager') as manager \gset
select tests.create_user('editor11@test.local', 'content_editor') as editor \gset
select tests.create_user('sales11@test.local', 'sales') as sales \gset
select tests.create_user('alice11@test.local') as alice \gset

create temp table layout_fixture as
select app.page_layout_rows('home') as published_home;
grant select on layout_fixture to anon, authenticated;

-- ══ Permissions ════════════════════════════════════════════════════════════
select tests.assert((select count(*) from public.permissions where key = 'design.view') = 1, 'design.view exists');
select tests.assert(exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                            where r.key = 'design_editor' and rp.permission_key = 'design.view'),
  'design editors can open the editor');

select tests.act_as_anon();
select tests.assert_raises($$select public.site_editor_overview()$$, '42501', 'anon cannot call the editor');
select tests.assert_raises($$select * from public.page_layout_drafts$$, '42501', 'anon cannot read drafts');
reset role;

select tests.act_as(:'alice');
select tests.assert_raises($$select public.site_editor_get_page('home')$$, '42501', 'customers cannot read layouts');
reset role;

select tests.act_as(:'sales');
select tests.assert_raises($$select public.site_editor_overview()$$, '42501', 'sales has no design.view');
select tests.assert_equal((select count(*) from public.page_layout_drafts), 0::bigint, 'RLS hides drafts without design.view');
reset role;

select tests.act_as(:'editor');
select tests.assert_equal(jsonb_array_length(public.site_editor_overview()), 3, 'content editors see Home, Apple and Offers');
select tests.assert_equal((public.site_editor_get_page('home') ->> 'canEdit')::boolean, false, 'view is not edit');
select tests.assert_raises($$select public.site_editor_save_draft('home', '[]'::jsonb, null)$$, '42501',
  'design.view cannot save a draft');
select tests.assert((select count(*) from jsonb_array_elements(public.admin_settings_overview()) x
                     where x ->> 'key' in ('theme', 'navigation', 'brand', 'page_seo')) = 4,
  'design settings are visible to design.view (for previews)');
reset role;

-- ══ Validation ═════════════════════════════════════════════════════════════
select tests.act_as(:'designer');
select tests.assert_equal(public.site_editor_save_draft('about', '[]'::jsonb, null) ->> 'code', 'invalid_page',
  'only Home / Apple / Offers are editable');
select tests.assert_equal(public.site_editor_save_draft('home',
  '[{"key": "x", "type": "script_tag", "isVisible": true, "props": {}}]'::jsonb, null) ->> 'code', 'unknown_type',
  'unknown section types are refused');
select tests.assert_equal(public.site_editor_save_draft('home',
  '[{"key": "a", "type": "budget_search", "isVisible": true, "props": {}},
    {"key": "a", "type": "budget_search", "isVisible": true, "props": {}}]'::jsonb, null) ->> 'code', 'duplicate_key',
  'section keys are unique');
select tests.assert_equal(public.site_editor_save_draft('home',
  '[{"key": "a", "type": "budget_search", "isVisible": true, "props": {}, "design": {"css": "body{}"}}]'::jsonb, null) ->> 'code',
  'invalid_design', 'no free-form CSS in section design');
select tests.assert_equal(public.site_editor_save_draft('home',
  '[{"key": "Bad Key", "type": "budget_search", "isVisible": true, "props": {}}]'::jsonb, null) ->> 'code', 'invalid_key',
  'keys are slugs');

-- ══ Draft isolation ════════════════════════════════════════════════════════
-- Draft: hide the first section, add a new budget section on top with a design.
select jsonb_build_array(jsonb_build_object('key', 'draft-budget', 'type', 'budget_search', 'isVisible', true,
         'props', '{"title": {"ar": "مسودة", "en": "Draft"}, "subtitle": null}'::jsonb,
         'design', '{"background": "muted", "spacing": "compact"}'::jsonb))
       || (select published_home from layout_fixture) as draft_layout \gset
select public.site_editor_save_draft('home', :'draft_layout'::jsonb, null) as saved \gset
select tests.assert_equal(:'saved'::jsonb ->> 'ok', 'true', 'the designer saves a draft');
select tests.assert_equal((:'saved'::jsonb ->> 'baseVersion'), null, 'the first draft is based on "no version yet"');
reset role;

select tests.act_as_anon();
select tests.assert(not exists (select 1 from jsonb_array_elements(public.storefront_page_sections('home')) s
                                where s ->> 'id' = 'draft-budget'), 'the storefront never sees a draft');
reset role;

select tests.act_as(:'designer2');
select tests.assert_equal(public.site_editor_save_draft('home', '[]'::jsonb, null) ->> 'code', 'draft_conflict',
  'a second designer starting from "no draft" cannot overwrite it');
reset role;

-- ══ Publish ════════════════════════════════════════════════════════════════
select tests.act_as(:'manager');
select tests.assert_raises($$select public.site_editor_publish('home', null, false)$$, '42501',
  'design.view cannot publish');
reset role;

select tests.act_as(:'designer');
select (public.site_editor_publish('home', 'Budget first', false)) as published \gset
select tests.assert_equal(:'published'::jsonb ->> 'version', '2', 'publishing records the initial layout (v1) and the new one (v2)');
select tests.assert_equal(public.site_editor_get_page('home') -> 'draft', 'null'::jsonb, 'the draft is consumed');
select tests.assert_equal(jsonb_array_length(public.site_editor_versions('home', 10)), 2, 'two versions');
select tests.assert_equal(public.site_editor_publish('home', null, false) ->> 'code', 'no_draft', 'nothing left to publish');
reset role;

select tests.act_as_anon();
select tests.assert_equal(public.storefront_page_sections('home') -> 0 ->> 'id', 'draft-budget',
  'the published layout reaches the storefront in the new order');
select tests.assert_equal(public.storefront_page_sections('home') -> 0 -> 'design' ->> 'background', 'muted',
  'section design is published with it');
reset role;

-- ══ Stale draft ════════════════════════════════════════════════════════════
select tests.act_as(:'designer');
select public.site_editor_save_draft('home', (select published_home from layout_fixture), null) ->> 'draftUpdatedAt' as draft_at \gset
reset role;
select tests.act_as(:'owner');
-- Phase 06 structured edit (live) creates a new version, making the draft stale.
select id as hero_id, updated_at as hero_at from public.page_sections where page_key = 'home' and key = 'home-hero' \gset
select tests.assert_equal(public.admin_save_page_section(:'hero_id', true,
  (select props from public.page_sections where id = :'hero_id'), :'hero_at') ->> 'ok', 'true', 'owner edits a section live');
reset role;
select tests.assert_equal(app.layout_current_version('home'), 3, 'the live edit is recorded as version 3');
select tests.act_as(:'owner');
select tests.assert_equal(public.site_editor_publish('home', null, false) ->> 'code', 'draft_conflict',
  'a draft based on an older version is not published silently');
select tests.assert_equal(public.site_editor_publish('home', 'Restore original order', true) ->> 'version', '4',
  'force publish creates version 4');
reset role;

-- ══ Rollback ═══════════════════════════════════════════════════════════════
select tests.act_as(:'designer');
select tests.assert_equal(public.site_editor_rollback('home', 99, null) ->> 'code', 'version_not_found', 'unknown version');
select tests.assert_equal(public.site_editor_rollback('home', 2, null) ->> 'version', '5', 'rollback publishes a new version');
select tests.assert_equal((select page_sections.key from public.page_sections where page_key = 'home' order by sort_order limit 1),
  'draft-budget', 'rollback restores the version-2 layout');
select tests.assert_equal(public.site_editor_versions('home', 1) -> 0 ->> 'note', 'Restored version 2', 'rollback note');
reset role;

-- ══ Direct table access ════════════════════════════════════════════════════
select tests.act_as(:'designer');
select tests.assert_raises($$insert into public.page_layout_drafts (page_key, sections) values ('apple', '[]')$$, '42501',
  'drafts are written only through the RPCs');
select tests.assert_raises($$delete from public.page_layout_versions$$, '42501', 'versions cannot be deleted directly');
reset role;
select tests.assert_raises($$update public.page_layout_versions set note = 'x'$$, '42501', 'versions are append-only');

-- ══ Discard ════════════════════════════════════════════════════════════════
select app.page_layout_rows('offers') as offers_layout \gset
select tests.act_as(:'designer');
select tests.assert_equal(public.site_editor_save_draft('offers', :'offers_layout'::jsonb, null) ->> 'ok', 'true', 'offers draft');
select tests.assert_equal(public.site_editor_discard_draft('offers') ->> 'ok', 'true', 'discard');
select tests.assert_equal(public.site_editor_discard_draft('offers') ->> 'code', 'no_draft', 'discard twice');
reset role;

-- ══ Audit ══════════════════════════════════════════════════════════════════
select tests.assert(exists (select 1 from public.audit_logs where action = 'site_editor.draft_saved' and entity_id = 'home'),
  'draft saves are audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'site_editor.published' and entity_id = 'home'
                            and before_data is not null and after_data is not null), 'publishes are audited with before / after');
select tests.assert(exists (select 1 from public.audit_logs where action = 'site_editor.rolled_back'), 'rollbacks are audited');
select tests.assert(exists (select 1 from public.audit_logs where action = 'site_editor.draft_discarded'), 'discards are audited');
select tests.assert_equal(app.audit_module('public.page_layout_versions', 'site_editor.published'), 'design',
  'editor events are filed under "design"');
select tests.act_as(:'owner');
select tests.assert((public.admin_list_audit_logs('{"module": "design"}'::jsonb) ->> 'total')::integer >= 4,
  'the audit viewer filters editor events');
reset role;

rollback;
