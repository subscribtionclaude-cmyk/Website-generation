-- E2E fixtures (local stub only). Passwords are plain text in the STUB auth table; real Supabase hashes them.
insert into auth.users (id, email, password) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@accord.test', 'Admin-Pass-12345'),
  ('00000000-0000-0000-0000-0000000000b1', 'bd1@accord.test', 'Bd1-Pass-12345'),
  ('00000000-0000-0000-0000-0000000000b2', 'bd2@accord.test', 'Bd2-Pass-12345'),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@accord.test', 'Viewer-Pass-12345'),
  ('00000000-0000-0000-0000-0000000000d1', 'inactive@accord.test', 'Inactive-Pass-12345'),
  ('00000000-0000-0000-0000-0000000000e1', 'noprofile@accord.test', 'NoProfile-Pass-12345');
insert into profiles (id, email, full_name, role, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@accord.test', 'Alice Admin', 'admin', true),
  ('00000000-0000-0000-0000-0000000000b1', 'bd1@accord.test', 'Bob Dealer', 'bd_executive', true),
  ('00000000-0000-0000-0000-0000000000b2', 'bd2@accord.test', 'Carol Closer', 'bd_executive', true),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@accord.test', 'Vic Viewer', 'viewer', true),
  ('00000000-0000-0000-0000-0000000000d1', 'inactive@accord.test', 'Ian Inactive', 'bd_executive', false);
insert into user_targets (user_id, daily_call_target, effective_from, created_by) values
  ('00000000-0000-0000-0000-0000000000b1', 5, current_date - 30, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', 4, current_date - 30, '00000000-0000-0000-0000-0000000000a1');
insert into leads (id, name, external_lead_id, temperature, pipeline_stage, owner_id, created_by, source) values
  ('11111111-1111-1111-1111-111111111111', 'Amer Group', '5', 'warm', 'outreach', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'manual'),
  ('22222222-2222-2222-2222-222222222222', 'Palm Hills', '6', 'cold', 'research', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'manual'),
  ('33333333-3333-3333-3333-333333333333', 'Orascom Development', '7', 'hot', 'qualified', null, '00000000-0000-0000-0000-0000000000a1', 'manual'),
  ('44444444-4444-4444-4444-444444444444', 'SODIC', '8', 'cold', 'research', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'manual');
insert into contacts (lead_id, full_name, job_title, emails, phones, is_primary, dedupe_key) values
  ('11111111-1111-1111-1111-111111111111', 'Hossam Abu Elmagd', 'Commercial Director', '{hossam@amer.test}', '{01117456677,01110124469}', true, 'n:hossam'),
  ('22222222-2222-2222-2222-222222222222', 'Laila Hassan', 'Head of Sales', '{laila@palmhills.test}', '{01000000001}', true, 'n:laila'),
  ('33333333-3333-3333-3333-333333333333', 'Omar Fathy', 'CCO', '{omar@orascom.test}', '{01000000002}', true, 'n:omar'),
  ('44444444-4444-4444-4444-444444444444', 'Sara Nabil', 'GM', '{sara@sodic.test}', '{01000000003}', true, 'n:sara');
insert into follow_ups (lead_id, owner_id, due_date, notes, origin, created_by) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', current_date - 3, 'Send the company profile', 'manual', '00000000-0000-0000-0000-0000000000b1'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000b1', (now() at time zone 'Africa/Cairo')::date, 'Call back the CFO', 'manual', '00000000-0000-0000-0000-0000000000b1');
