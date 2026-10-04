-- Reverses ONE import batch using its catalog_sources record (the reversible import record).
-- Destructive: run only with the owner's explicit approval, in psql:  \set batch '<batch id>'
-- Refuses when anything from the batch has been ordered or priced, so staff work is never lost.
begin;
select set_config('catalog.batch', :'batch', true);

do $$
begin
  if exists (select 1 from public.order_items oi
             join public.catalog_sources s on s.entity_type = 'variant' and s.entity_id = oi.variant_id
             where s.batch_id = current_setting('catalog.batch')) then
    raise exception 'batch has ordered variants; archive the products instead of deleting them';
  end if;
  if exists (select 1 from public.product_variants pv
             join public.catalog_sources s on s.entity_type = 'variant' and s.entity_id = pv.id
             where s.batch_id = current_setting('catalog.batch') and (pv.price is not null or pv.stock_quantity > 0)) then
    raise exception 'batch has priced or stocked variants; review them first';
  end if;
end;
$$;

-- Products cascade to their options, variants, media, specs and category links.
delete from public.products
where id in (select entity_id from public.catalog_sources where entity_type = 'product' and batch_id = :'batch');
delete from public.brands b
where b.id in (select entity_id from public.catalog_sources where entity_type = 'brand' and batch_id = :'batch')
  and not exists (select 1 from public.products p where p.brand_id = b.id);
delete from public.categories c
where c.id in (select entity_id from public.catalog_sources where entity_type = 'category' and batch_id = :'batch')
  and not exists (select 1 from public.product_categories pc where pc.category_id = c.id);
delete from public.catalog_sources where batch_id = :'batch';

commit;
