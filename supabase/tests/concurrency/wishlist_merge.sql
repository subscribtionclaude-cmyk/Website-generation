-- LOCAL TESTING ONLY. One sign-in merging the same guest wishlist; run twice in parallel
-- (two tabs signing in at once). hold = seconds to keep the transaction open.
select id as user_id from auth.users where email = 'w@race.local' \gset
select id as p1 from public.products where slug = 'usb-c-cable' \gset
select id as p2 from public.products where slug = 'airpods-4' \gset
begin;
select tests.act_as(:'user_id');
select 'RESULT:' || case when (public.wishlist_merge(jsonb_build_array(
  jsonb_build_object('productId', :'p1'), jsonb_build_object('productId', :'p2'))) ->> 'ok')::boolean then 'ok' else 'error' end;
select pg_sleep(:hold);
commit;
