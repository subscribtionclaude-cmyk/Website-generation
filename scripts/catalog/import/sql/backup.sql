-- Pre-import snapshot of the real (non-demo) catalog, saved as catalog/backups/<batch>-pre-import.json
-- before the first real run of a batch. Prices and stock are included so nothing can be lost.
select jsonb_build_object(
  'takenAt', now(),
  'counts', jsonb_build_object(
    'brands', (select count(*) from public.brands where not is_demo),
    'categories', (select count(*) from public.categories where not is_demo),
    'products', (select count(*) from public.products where not is_demo),
    'variants', (select count(*) from public.product_variants where not is_demo),
    'media', (select count(*) from public.product_media where not is_demo),
    'catalogSources', (select count(*) from public.catalog_sources)),
  'brands', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'is_visible', is_visible,
                                                          'updated_at', updated_at) order by slug), '[]')
             from public.brands where not is_demo),
  'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'parent_id', parent_id,
                                                              'updated_at', updated_at) order by slug), '[]')
                 from public.categories where not is_demo),
  'products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'brand_id', brand_id, 'status', status,
                                                            'is_visible', is_visible, 'updated_at', updated_at) order by slug), '[]')
               from public.products where not is_demo),
  'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'product_id', product_id, 'sku', sku, 'price', price,
                                                            'compare_at_price', compare_at_price, 'stock_quantity', stock_quantity,
                                                            'updated_at', updated_at) order by sku), '[]')
               from public.product_variants where not is_demo)) as snapshot;
