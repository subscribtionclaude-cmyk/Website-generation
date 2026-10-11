-- Hosted (production) export-permission check for migration 10. SAFE TO RUN ON THE LIVE PROJECT:
-- everything happens inside one DO block that ALWAYS ends with an exception, so the temporary test users, profiles and
-- audit rows are rolled back and no CRM record is touched. The PASS/FAIL report is the exception message.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); v uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  res text := ''; ok boolean; msg text; n0 int; n1 int;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'zz-export-test-admin@test.invalid', 'authenticated', 'authenticated'), (b, 'zz-export-test-bd@test.invalid', 'authenticated', 'authenticated'),
    (v, 'zz-export-test-viewer@test.invalid', 'authenticated', 'authenticated'), (d, 'zz-export-test-inactive@test.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email, full_name, role, active) values
    (a, 'zz-export-test-admin@test.invalid', 'T Admin', 'admin', true), (b, 'zz-export-test-bd@test.invalid', 'T BD', 'bd_executive', true),
    (v, 'zz-export-test-viewer@test.invalid', 'T Viewer', 'viewer', true), (d, 'zz-export-test-inactive@test.invalid', 'T Inactive', 'bd_executive', false);
  select count(*) into n0 from audit_logs where entity = 'export';

  -- ADMIN: full + board daily/weekly/monthly + dataset allowed
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_export('full','xlsx',null,null,'{"period":"all"}'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s admin full export allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('board','pdf','2026-10-10','2026-10-10','{"period":"daily"}'); perform public.admin_report('2026-10-10','2026-10-10'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s admin board daily allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('board','xlsx','2026-10-04','2026-10-10','{"period":"weekly"}'); perform public.admin_report('2026-10-04','2026-10-10'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s admin board weekly allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('board','pdf','2026-10-01','2026-10-31','{"period":"monthly"}'); perform public.admin_report('2026-10-01','2026-10-31'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s admin board monthly allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('leads','xlsx','2026-10-01','2026-10-10','{"temperature":"hot"}'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s admin dataset export allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('passwords','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s unknown export type rejected\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.log_export('leads','csv'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s unknown format rejected\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- BD EXECUTIVE: datasets only
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_export('leads','xlsx',null,null,'{}'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s BD dataset export (leads) allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('meetings','xlsx',null,null,'{}'); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  res := res || format(E'%s BD dataset export (meetings) allowed\n', case when ok then 'PASS' else 'FAIL '||msg end);
  begin perform public.log_export('full','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s BD full export denied by RPC\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.log_export('board','pdf'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s BD board export denied by RPC\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.admin_report('2026-10-01','2026-10-31'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s BD direct admin_report (board data) denied\n', case when ok then 'PASS' else 'FAIL' end);
  begin select count(*) into n1 from audit_logs; ok := n1 = 0; exception when others then ok := true; end;
  res := res || format(E'%s BD cannot read the audit log\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- VIEWER
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_export('leads','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s viewer dataset export denied\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.log_export('full','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s viewer full export denied\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.admin_report('2026-10-01','2026-10-31'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s viewer admin_report denied\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- INACTIVE
  perform set_config('request.jwt.claim.sub', d::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_export('leads','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s inactive user export denied\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- ANONYMOUS
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin perform public.log_export('leads','xlsx'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s anonymous export denied\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.admin_report('2026-10-01','2026-10-31'); ok := false; exception when others then ok := true; end;
  res := res || format(E'%s anonymous admin_report denied\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  -- AUDIT: exactly the 7 allowed calls (5 admin + 2 BD)
  select count(*) into n1 from audit_logs where entity = 'export';
  res := res || format(E'%s exactly the 7 allowed exports audited (got %s)\n', case when n1 - n0 = 7 then 'PASS' else 'FAIL' end, n1 - n0);
  select (actor_id = b and actor_email = 'zz-export-test-bd@test.invalid' and action = 'data_export' and meta->>'format' = 'xlsx'
          and meta->>'timezone' = 'Africa/Cairo' and old_value is null and new_value is null)
    into ok from audit_logs where entity = 'export' and entity_id = 'meetings' and actor_id = b order by id desc limit 1;
  res := res || format(E'%s audit row records who/what/format/timezone, no data\n', case when ok then 'PASS' else 'FAIL' end);
  select (meta->>'to' = '2026-10-31' and meta->'filters'->>'period' = 'monthly') into ok
    from audit_logs where entity = 'export' and entity_id = 'board' and actor_id = a and meta->>'from' = '2026-10-01' limit 1;
  res := res || format(E'%s audit row records period + filters\n', case when ok then 'PASS' else 'FAIL' end);
  begin update audit_logs set action = 'x' where entity = 'export' and actor_id = a; ok := false; exception when others then ok := true; end;
  res := res || format(E'%s export audit rows immutable\n', case when ok then 'PASS' else 'FAIL' end);

  raise exception E'ROLLBACK-ONLY TEST RUN\n%', res;
end $$;
