-- Run ONCE in the Supabase SQL editor of the CLAUDE project, after the migrations.
-- 1) Dashboard → Authentication → Users → "Add user" (tick "Auto Confirm User"), choose a strong password yourself.
-- 2) Put that email below and run this script. It grants CRM access (admin) to that existing Auth user.
--    Nobody gets CRM access by merely existing in Auth — an active row in public.profiles is required.
do $$
declare v_email text := 'REPLACE-WITH-ADMIN-EMAIL@accord.example'; v_name text := 'REPLACE WITH FULL NAME'; v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then raise exception 'No Auth user with email %. Create it in Authentication → Users first.', v_email; end if;
  insert into public.profiles (id, email, full_name, role, active) values (v_id, lower(v_email), v_name, 'admin', true)
  on conflict (id) do update set role = 'admin', active = true;
  raise notice 'Admin profile ready for % (%).', v_email, v_id;
end $$;
