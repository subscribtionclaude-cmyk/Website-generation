-- LOCAL TESTING ONLY. One checkout session; run twice in parallel
-- (who=a|b|c, sku=variant SKU, key=uuid or '' for a fresh one, hold=seconds to keep the transaction open).
select id as variant_id from public.product_variants where sku = :'sku' \gset
select id as user_id from auth.users where email = :'who' || '@race.local' \gset
begin;
select tests.act_as(:'user_id');
select 'RESULT:' || coalesce(r ->> 'code', 'ok') || case when (r ->> 'duplicate')::boolean then ':duplicate' else '' end
from (select tests.checkout(tests.items(:'variant_id', '1'), '{"method": "pickup"}', '{"method": "cod"}', null,
                            coalesce(nullif(:'key', '')::uuid, gen_random_uuid())) as r) x;
select pg_sleep(:hold);
commit;
