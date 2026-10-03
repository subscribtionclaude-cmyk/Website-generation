-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Demo / live contamination audit (READ-ONLY — changes nothing)
--
-- Run in Supabase → SQL Editor (or psql) on a live / staging database after "Delete demo data".
-- Every row must say ok = true before launch. Re-run any time; it is safe on production.
-- ════════════════════════════════════════════════════════════════════════════
with demo_columns as (
  select c.oid::regclass as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'is_demo' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
),
demo_rows as (
  select 'demo rows in ' || tbl::text as check_name,
         (xpath('/row/n/text()',
                query_to_xml(format('select count(*) as n from %s where is_demo', tbl), false, true, '')))[1]::text::bigint as found
  from demo_columns
),
unregistered as (
  select 'is_demo table not registered for cleanup: ' || d.tbl::text as check_name, 1::bigint as found
  from demo_columns d
  where not exists (select 1 from app.demo_tables t where t.table_name = d.tbl)
),
references_to_demo_media as (
  select 'live rows pointing at demo media (/demo/media/)' as check_name,
         (select count(*) from public.product_media t where not is_demo and t::text like '%/demo/media/%')
       + (select count(*) from public.brands t where not is_demo and t::text like '%/demo/media/%')
       + (select count(*) from public.categories t where not is_demo and t::text like '%/demo/media/%')
       + (select count(*) from public.offers t where not is_demo and t::text like '%/demo/media/%')
       + (select count(*) from public.content_entries t where not is_demo and t::text like '%/demo/media/%')
       + (select count(*) from public.site_settings t where t::text like '%/demo/media/%')
       + (select count(*) from public.page_sections t where t::text like '%/demo/media/%')
       + (select count(*) from public.page_layout_versions t where t::text like '%/demo/media/%') as found
),
settings as (
  select 'published setting features.showDemoCatalog is on' as check_name,
         (select count(*) from public.site_settings
           where key = 'features' and coalesce((value ->> 'showDemoCatalog')::boolean, false))::bigint as found
),
public_index as (
  select 'demo slugs in the public index (sitemap / prerender source)' as check_name,
         (select count(*) from public.products p where p.is_demo
            and p.slug in (select jsonb_array_elements(public.seo_public_index() -> 'products') ->> 'slug'))::bigint as found
)
select check_name, found, found = 0 as ok
from (
  select * from demo_rows
  union all select * from unregistered
  union all select * from references_to_demo_media
  union all select * from settings
  union all select * from public_index
) checks
order by ok, check_name;
