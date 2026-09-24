-- Storage folder isolation and demo-data deletion.
begin;

create temporary table ids on commit drop as
select
  tests.create_user('owner4@test.local', 'owner') as owner_id,
  tests.create_user('manager4@test.local', 'store_manager') as manager_id,
  tests.create_user('tech4@test.local', 'repairs_team') as tech_id,
  tests.create_user('alice4@test.local') as alice_id,
  tests.create_user('bob4@test.local') as bob_id;
grant select on ids to authenticated, anon;

-- ── Storage ───────────────────────────────────────────────────────────────
select tests.act_as((select alice_id from ids));
insert into storage.objects (bucket_id, name) values ('repairs', (select alice_id from ids)::text || '/screen.jpg');
select tests.assert_raises(
  format($$insert into storage.objects (bucket_id, name) values ('repairs', %L)$$, (select bob_id from ids)::text || '/x.jpg'),
  '42501', 'customer cannot upload into another customer''s folder');
select tests.assert_raises($$insert into storage.objects (bucket_id, name) values ('products', 'iphone.webp')$$, '42501', 'customer cannot upload catalog media');
select tests.assert_raises($$insert into storage.objects (bucket_id, name) values ('invoices', 'x.pdf')$$, '42501', 'customer cannot write invoices');
select tests.assert_equal((select count(*)::int from storage.objects), 1, 'customer sees own upload');
reset role;

select tests.act_as((select bob_id from ids));
select tests.assert_equal((select count(*)::int from storage.objects), 0, 'other customers cannot see the upload');
reset role;

select tests.act_as((select tech_id from ids));
select tests.assert_equal((select count(*)::int from storage.objects where bucket_id = 'repairs'), 1, 'repairs team can read repair media');
select tests.assert_raises($$insert into storage.objects (bucket_id, name) values ('products', 'p.webp')$$, '42501', 'repairs team cannot upload catalog media');
reset role;

select tests.act_as((select manager_id from ids));
insert into storage.objects (bucket_id, name) values ('products', 'iphone-18-pro/cover.webp');
select tests.assert(true, 'store manager (catalog.manage) can upload catalog media');
reset role;

select tests.act_as_anon();
select tests.assert_raises($$insert into storage.objects (bucket_id, name) values ('repairs', 'anon/x.jpg')$$, '42501', 'anonymous uploads are rejected');
select tests.assert_equal((select count(*)::int from storage.objects), 0, 'anon cannot list objects');
reset role;

-- ── Demo data registry ─────────────────────────────────────────────────────
create table public.demo_probe (id int primary key, is_demo boolean not null default false);
insert into public.demo_probe values (1, true), (2, true), (3, false);
select app.register_demo_table('public.demo_probe', 10);

create table public.no_demo_flag (id int);
select tests.assert_raises($$select app.register_demo_table('public.no_demo_flag')$$, 'P0001', 'tables without is_demo cannot be registered');

select tests.act_as((select alice_id from ids));
select tests.assert_raises($$select public.delete_all_demo_data()$$, '42501', 'customers cannot delete demo data');
reset role;
select tests.act_as((select manager_id from ids));
select tests.assert_raises($$select public.delete_all_demo_data()$$, '42501', 'store manager lacks demo.manage');
reset role;

select tests.act_as((select owner_id from ids));
select tests.assert_equal((public.demo_data_summary() ->> 'public.demo_probe')::int, 2, 'summary counts demo rows');
select tests.assert_equal((public.delete_all_demo_data() ->> 'public.demo_probe')::int, 2, 'owner deleted 2 demo rows');
reset role;
select tests.assert_equal((select count(*)::int from public.demo_probe), 1, 'real (non-demo) rows are untouched');
select tests.assert(exists (select 1 from public.audit_logs where action = 'demo.delete_all'), 'demo deletion audited');

rollback;
