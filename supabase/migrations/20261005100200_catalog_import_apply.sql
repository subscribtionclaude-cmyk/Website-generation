-- ════════════════════════════════════════════════════════════════════════════
-- MALEK STORE · Catalog bulk import (additive, idempotent)
--
-- app_private.catalog_import(manifest, dry_run) applies a validated catalog manifest (built and
-- checked by scripts/catalog, stored in catalog/manifest/) to the catalog tables:
--
--   • Idempotent: every brand / product / variant / image is keyed by its manifest key (recorded
--     in catalog_sources) or SKU, so a re-run MERGES into the rows it created instead of
--     duplicating them. Options, values and specs upsert on their natural keys.
--   • Never touches commerce data: prices stay NULL ("Ask for price") and stock 0 on insert, and a
--     re-run never changes price, compare-at price, stock, status, visibility or availability, so
--     staff edits made after the import survive it.
--   • Never adopts or overwrites content it did not create: an existing demo brand/category, or a
--     product/SKU with the same slug that the import does not own, is reported as a conflict and
--     left untouched (a matching real brand or category is reused as-is).
--   • Real catalog content: is_demo = false everywhere.
--   • Dry run (the default) performs the full write inside a subtransaction, checks deferred
--     constraints, then rolls it back and returns the same report — nothing is kept.
--
-- Only a database operator can run it (app_private has no API grants). Every entity it creates
-- gets a catalog_sources row (batch, official source URL, image source URL, SHA-256, checked_at),
-- which is also the reversible record of the batch.
-- ════════════════════════════════════════════════════════════════════════════

-- Results of the catalog-media-ingest Edge Function, one row per attempt (latest wins). The manifest
-- builder exports the successful rows to catalog/media/ingested.json; failures go to the report.
create table if not exists app_private.catalog_media_ingest_log (
  id          bigint generated always as identity primary key,
  source_url  text not null check (source_url ~ '^https://' and char_length(source_url) <= 1000),
  brand       text not null check (brand ~ '^[a-z0-9-]{1,60}$'),
  ok          boolean not null,
  sha256      text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  width       integer check (width is null or width > 0),
  height      integer check (height is null or height > 0),
  bytes       integer check (bytes is null or bytes > 0),
  files       jsonb,
  error       text check (error is null or char_length(error) <= 100),
  created_at  timestamptz not null default now(),
  check (not ok or (sha256 is not null and files is not null))
);

create index if not exists catalog_media_ingest_log_source_idx
  on app_private.catalog_media_ingest_log (source_url, created_at desc);

revoke all on app_private.catalog_media_ingest_log from public, anon, authenticated, service_role;

create or replace function app_private.catalog_import(p_manifest jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_batch        text := p_manifest ->> 'batch';
  v_checked      timestamptz := coalesce(nullif(p_manifest ->> 'checkedAt', '')::timestamptz, now());
  v_cat          jsonb := p_manifest -> 'category';
  v_cat_id       uuid;
  v_cat_demo     boolean;
  v_brand        jsonb;
  v_brand_id     uuid;
  v_brand_demo   boolean;
  v_brand_ids    jsonb := '{}'::jsonb;
  v_brand_names  jsonb := '{}'::jsonb;
  v_p            jsonb;
  v_pid          uuid;
  v_owner        uuid;
  v_opt          jsonb;
  v_opt_id       uuid;
  v_val          jsonb;
  v_var          jsonb;
  v_vid          uuid;
  v_vprod        uuid;
  v_m            jsonb;
  v_mid          uuid;
  v_value_id     uuid;
  v_g            jsonb;
  v_gid          uuid;
  v_s            jsonb;
  v_idx          integer;
  v_jdx          integer;
  v_rows         integer;
  v_cover_set    boolean;
  v_key          text;
  v_sku          text;
  v_exists       boolean;
  v_conflicts    jsonb := '[]'::jsonb;
  c_brand_new    integer := 0;
  c_brand_reuse  integer := 0;
  c_prod_new     integer := 0;
  c_prod_upd     integer := 0;
  c_prod_same    integer := 0;
  c_var_new      integer := 0;
  c_var_same     integer := 0;
  c_media_new    integer := 0;
  c_media_upd    integer := 0;
  c_media_same   integer := 0;
  c_spec_new     integer := 0;
  c_spec_upd     integer := 0;
  v_report       jsonb;
begin
  -- Manifest envelope ---------------------------------------------------------------
  if coalesce(p_manifest ->> 'version', '') <> '1' then
    raise exception 'catalog_import: unsupported manifest version' using errcode = '22023';
  end if;
  if v_batch is null or v_batch !~ '^[a-z0-9][a-z0-9._-]{2,63}$' then
    raise exception 'catalog_import: invalid batch id' using errcode = '22023';
  end if;
  if jsonb_typeof(p_manifest -> 'brands') <> 'array' or jsonb_typeof(p_manifest -> 'products') <> 'array'
     or v_cat is null or coalesce(v_cat ->> 'slug', '') !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'catalog_import: manifest needs category, brands and products' using errcode = '22023';
  end if;
  -- Commerce fields are never imported: no prices, no stock.
  if exists (select 1 from jsonb_array_elements(p_manifest -> 'products') p,
                           jsonb_array_elements(coalesce(p -> 'variants', '[]')) v
             where v ? 'price' or v ? 'compareAtPrice' or v ? 'stock' or v ? 'initialStock') then
    raise exception 'catalog_import: manifests must not carry prices or stock' using errcode = '22023';
  end if;

  begin  -- subtransaction: rolled back at the end of a dry run
    perform app.set_change_context('catalog import ' || v_batch, 'import');

    insert into public.catalog_import_batches (id, description, manifest)
    values (v_batch, left(coalesce(nullif(p_manifest ->> 'description', ''), 'Catalog import'), 500),
            left(coalesce(nullif(p_manifest ->> 'manifestPath', ''), 'catalog/manifest'), 200))
    on conflict (id) do nothing;

    -- Category: reuse a real one with the same slug; create it otherwise ------------------
    select id, is_demo into v_cat_id, v_cat_demo
    from public.categories where slug = v_cat ->> 'slug' and deleted_at is null;
    if v_cat_id is not null and v_cat_demo then
      raise exception 'catalog_import: category % is demo content', v_cat ->> 'slug' using errcode = '23505';
    end if;
    if v_cat_id is null then
      insert into public.categories (slug, name, icon, sort_order, is_visible, show_in_nav, show_on_home,
                                     show_in_shop, show_in_category_grid, is_demo)
      values (v_cat ->> 'slug', app.json_lt(v_cat -> 'name'), nullif(v_cat ->> 'icon', ''),
              coalesce(nullif(v_cat ->> 'sortOrder', '')::integer, 100), true, true, true, true, true, false)
      returning id into v_cat_id;
      insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, checked_at)
      values ('category', v_cat_id, v_batch, 'category/' || (v_cat ->> 'slug'), v_checked)
      on conflict (entity_type, manifest_key) do nothing;
    end if;

    -- Brands: reuse a real brand with the same slug or English name; never a demo one ------
    for v_brand in select * from jsonb_array_elements(p_manifest -> 'brands') loop
      v_brand_id := null;
      select b.id, b.is_demo into v_brand_id, v_brand_demo
      from public.brands b
      where b.deleted_at is null
        and (b.slug = v_brand ->> 'slug' or lower(btrim(b.name ->> 'en')) = lower(btrim(v_brand -> 'name' ->> 'en')))
      order by (b.slug = v_brand ->> 'slug') desc
      limit 1;
      if v_brand_id is not null and v_brand_demo then
        v_conflicts := v_conflicts || jsonb_build_object('type', 'brand', 'key', v_brand ->> 'slug',
                                                         'reason', 'a demo brand uses this slug or name');
        continue;
      end if;
      if v_brand_id is null then
        insert into public.brands (slug, name, sort_order, is_visible, is_demo)
        values (v_brand ->> 'slug', app.json_lt(v_brand -> 'name'),
                coalesce(nullif(v_brand ->> 'sortOrder', '')::integer, 100), true, false)
        returning id into v_brand_id;
        c_brand_new := c_brand_new + 1;
        insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_brand, source_url,
                                            checked_at)
        values ('brand', v_brand_id, v_batch, 'brand/' || (v_brand ->> 'slug'), v_brand -> 'name' ->> 'en',
                nullif(v_brand ->> 'sourceUrl', ''), v_checked);
      else
        -- An existing real brand is reused unchanged; only a brand this import created is re-stamped.
        c_brand_reuse := c_brand_reuse + 1;
        update public.catalog_sources
           set batch_id = v_batch, source_url = nullif(v_brand ->> 'sourceUrl', ''), checked_at = v_checked,
               updated_at = now()
         where entity_type = 'brand' and entity_id = v_brand_id;
      end if;
      v_brand_ids := v_brand_ids || jsonb_build_object(v_brand ->> 'slug', v_brand_id);
      v_brand_names := v_brand_names || jsonb_build_object(v_brand ->> 'slug', v_brand -> 'name' ->> 'en');
    end loop;

    -- Products ----------------------------------------------------------------------------
    for v_p in select * from jsonb_array_elements(p_manifest -> 'products') loop
      v_key := v_p ->> 'key';
      v_brand_id := nullif(v_brand_ids ->> (v_p ->> 'brand'), '')::uuid;
      if v_brand_id is null then
        v_conflicts := v_conflicts || jsonb_build_object('type', 'product', 'key', v_key,
                                                         'reason', 'brand not imported: ' || (v_p ->> 'brand'));
        continue;
      end if;

      select s.entity_id into v_pid from public.catalog_sources s
      where s.entity_type = 'product' and s.manifest_key = v_key;
      if v_pid is not null and not exists (select 1 from public.products where id = v_pid and deleted_at is null) then
        v_conflicts := v_conflicts || jsonb_build_object('type', 'product', 'key', v_key,
                                                         'reason', 'the imported product was deleted by staff');
        continue;
      end if;
      if exists (select 1 from public.products where slug = v_p ->> 'slug' and id is distinct from v_pid) then
        v_conflicts := v_conflicts || jsonb_build_object('type', 'product', 'key', v_key,
                                                         'reason', 'slug already used by a product the import does not own');
        continue;
      end if;
      select v.sku into v_sku
      from jsonb_array_elements(v_p -> 'variants') x
      join public.product_variants v on v.sku = x ->> 'sku'
      where v.product_id is distinct from v_pid
      limit 1;
      if v_sku is not null then
        v_conflicts := v_conflicts || jsonb_build_object('type', 'product', 'key', v_key,
                                                         'reason', 'SKU already used by another product: ' || v_sku);
        continue;
      end if;

      if v_pid is null then
        insert into public.products (slug, brand_id, model, name, subtitle, description, availability_state, status,
                                     is_visible, release_date, keywords, spec_source, seo_title, seo_description,
                                     published_at, is_demo)
        values (v_p ->> 'slug', v_brand_id, nullif(v_p ->> 'model', ''), app.json_lt(v_p -> 'name'),
                app.json_lt(v_p -> 'subtitle'), app.json_lt(v_p -> 'description'),
                coalesce(nullif(v_p ->> 'availability', ''), 'available'),
                coalesce(nullif(v_p ->> 'status', ''), 'published'), true,
                nullif(v_p ->> 'releaseDate', '')::date, left(coalesce(v_p ->> 'keywords', ''), 1000), 'assisted',
                app.json_lt(v_p -> 'seoTitle'), app.json_lt(v_p -> 'seoDescription'),
                case when coalesce(nullif(v_p ->> 'status', ''), 'published') = 'published' then now() end, false)
        returning id into v_pid;
        c_prod_new := c_prod_new + 1;
      else
        update public.products set
          slug = v_p ->> 'slug', brand_id = v_brand_id, model = nullif(v_p ->> 'model', ''),
          name = app.json_lt(v_p -> 'name'), subtitle = app.json_lt(v_p -> 'subtitle'),
          description = app.json_lt(v_p -> 'description'), release_date = nullif(v_p ->> 'releaseDate', '')::date,
          keywords = left(coalesce(v_p ->> 'keywords', ''), 1000),
          seo_title = app.json_lt(v_p -> 'seoTitle'), seo_description = app.json_lt(v_p -> 'seoDescription')
        where id = v_pid
          and (slug, brand_id, model, name::jsonb, subtitle::jsonb, description::jsonb, release_date, keywords,
               seo_title::jsonb, seo_description::jsonb)
              is distinct from
              (v_p ->> 'slug', v_brand_id, nullif(v_p ->> 'model', ''), app.json_lt(v_p -> 'name')::jsonb,
               app.json_lt(v_p -> 'subtitle')::jsonb, app.json_lt(v_p -> 'description')::jsonb,
               nullif(v_p ->> 'releaseDate', '')::date, left(coalesce(v_p ->> 'keywords', ''), 1000),
               app.json_lt(v_p -> 'seoTitle')::jsonb, app.json_lt(v_p -> 'seoDescription')::jsonb);
        get diagnostics v_rows = row_count;
        if v_rows > 0 then c_prod_upd := c_prod_upd + 1; else c_prod_same := c_prod_same + 1; end if;
      end if;

      insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_brand, source_url,
                                          checked_at)
      values ('product', v_pid, v_batch, v_key, v_brand_names ->> (v_p ->> 'brand'), v_p ->> 'sourceUrl',
              coalesce(nullif(v_p ->> 'checkedAt', '')::timestamptz, v_checked))
      on conflict (entity_type, manifest_key) do update
        set batch_id = excluded.batch_id, source_url = excluded.source_url, checked_at = excluded.checked_at,
            updated_at = now()
      where public.catalog_sources.entity_id = excluded.entity_id;

      insert into public.product_categories (product_id, category_id, is_primary, sort_order)
      select v_pid, v_cat_id, not exists (select 1 from public.product_categories where product_id = v_pid and is_primary), 0
      on conflict (product_id, category_id) do nothing;

      -- Options & values (natural keys) --------------------------------------------------
      v_idx := 0;
      for v_opt in select * from jsonb_array_elements(coalesce(v_p -> 'options', '[]')) loop
        v_idx := v_idx + 1;
        insert into public.product_options (product_id, key, name, sort_order)
        values (v_pid, v_opt ->> 'key', app.json_lt(v_opt -> 'name'), v_idx)
        on conflict (product_id, key) do update set name = excluded.name, sort_order = excluded.sort_order
        where (public.product_options.name::jsonb, public.product_options.sort_order)
              is distinct from (excluded.name::jsonb, excluded.sort_order);
        select id into v_opt_id from public.product_options where product_id = v_pid and key = v_opt ->> 'key';
        v_jdx := 0;
        for v_val in select * from jsonb_array_elements(v_opt -> 'values') loop
          v_jdx := v_jdx + 1;
          insert into public.product_option_values (option_id, key, label, swatch_hex, sort_order)
          values (v_opt_id, v_val ->> 'key', app.json_lt(v_val -> 'label'), nullif(v_val ->> 'swatchHex', ''), v_jdx)
          on conflict (option_id, key) do update
            set label = excluded.label, swatch_hex = excluded.swatch_hex, sort_order = excluded.sort_order
          where (public.product_option_values.label::jsonb, public.product_option_values.swatch_hex,
                 public.product_option_values.sort_order)
                is distinct from (excluded.label::jsonb, excluded.swatch_hex, excluded.sort_order);
        end loop;
      end loop;

      -- Variants (SKU): never price or stock --------------------------------------------
      v_idx := 0;
      for v_var in select * from jsonb_array_elements(v_p -> 'variants') loop
        v_idx := v_idx + 1;
        select id into v_vid from public.product_variants where sku = v_var ->> 'sku';
        if v_vid is null then
          insert into public.product_variants (product_id, sku, price, compare_at_price, stock_quantity, is_active,
                                               is_default, sort_order, is_demo)
          values (v_pid, v_var ->> 'sku', null, null, 0, true, false, v_idx, false)
          returning id into v_vid;
          c_var_new := c_var_new + 1;
        else
          c_var_same := c_var_same + 1;
        end if;
        insert into public.variant_option_values (variant_id, option_id, option_value_id)
        select v_vid, o.id, ov.id
        from jsonb_each_text(v_var -> 'options') sel (option_key, value_key)
        join public.product_options o on o.product_id = v_pid and o.key = sel.option_key
        join public.product_option_values ov on ov.option_id = o.id and ov.key = sel.value_key
        on conflict (variant_id, option_id) do update set option_value_id = excluded.option_value_id
        where public.variant_option_values.option_value_id is distinct from excluded.option_value_id;
        insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_brand, source_url,
                                            checked_at)
        values ('variant', v_vid, v_batch, 'variant/' || (v_var ->> 'sku'), v_brand_names ->> (v_p ->> 'brand'),
                v_p ->> 'sourceUrl', coalesce(nullif(v_p ->> 'checkedAt', '')::timestamptz, v_checked))
        on conflict (entity_type, manifest_key) do update
          set batch_id = excluded.batch_id, source_url = excluded.source_url, checked_at = excluded.checked_at,
              updated_at = now()
        where public.catalog_sources.entity_id = excluded.entity_id;
      end loop;
      -- Exactly one default variant: keep a staff choice, else the manifest's first.
      if not exists (select 1 from public.product_variants where product_id = v_pid and is_default and deleted_at is null) then
        update public.product_variants set is_default = true
        where product_id = v_pid and sku = (v_p -> 'variants' -> 0 ->> 'sku');
      end if;

      -- Media (manifest key) -------------------------------------------------------------
      v_cover_set := exists (select 1 from public.product_media pm where pm.product_id = v_pid and pm.is_cover
                             and not exists (select 1 from public.catalog_sources s
                                             where s.entity_type = 'media' and s.entity_id = pm.id));
      v_idx := 0;
      for v_m in select * from jsonb_array_elements(coalesce(v_p -> 'media', '[]')) loop
        v_idx := v_idx + 1;
        v_value_id := null;
        if nullif(v_m ->> 'color', '') is not null then
          select ov.id into v_value_id
          from public.product_option_values ov join public.product_options o on o.id = ov.option_id
          where o.product_id = v_pid and o.key = 'color' and ov.key = v_m ->> 'color';
        end if;
        select s.entity_id into v_mid from public.catalog_sources s
        where s.entity_type = 'media' and s.manifest_key = v_m ->> 'key';
        if v_mid is not null and not exists (select 1 from public.product_media where id = v_mid) then
          v_mid := null;  -- staff removed it: leave it removed
          c_media_same := c_media_same + 1;
          continue;
        end if;
        if v_mid is null then
          insert into public.product_media (product_id, option_value_id, kind, url, alt, width, height, sort_order,
                                            is_cover, is_demo)
          values (v_pid, v_value_id, 'image', v_m ->> 'url', app.json_lt(v_m -> 'alt'),
                  nullif(v_m ->> 'width', '')::integer, nullif(v_m ->> 'height', '')::integer, v_idx,
                  not v_cover_set and coalesce((v_m ->> 'isCover')::boolean, false), false)
          returning id into v_mid;
          c_media_new := c_media_new + 1;
        else
          update public.product_media set
            option_value_id = v_value_id, url = v_m ->> 'url', alt = app.json_lt(v_m -> 'alt'),
            width = nullif(v_m ->> 'width', '')::integer, height = nullif(v_m ->> 'height', '')::integer,
            sort_order = v_idx
          where id = v_mid
            and (option_value_id, url, alt::jsonb, width, height, sort_order)
                is distinct from (v_value_id, v_m ->> 'url', app.json_lt(v_m -> 'alt')::jsonb,
                                  nullif(v_m ->> 'width', '')::integer,
                                  nullif(v_m ->> 'height', '')::integer, v_idx);
          get diagnostics v_rows = row_count;
          if v_rows > 0 then c_media_upd := c_media_upd + 1; else c_media_same := c_media_same + 1; end if;
        end if;
        insert into public.catalog_sources (entity_type, entity_id, batch_id, manifest_key, source_brand, source_url,
                                            image_source_url, sha256, checked_at)
        values ('media', v_mid, v_batch, v_m ->> 'key', v_brand_names ->> (v_p ->> 'brand'), v_p ->> 'sourceUrl',
                v_m ->> 'sourceUrl', nullif(v_m ->> 'sha256', ''),
                coalesce(nullif(v_p ->> 'checkedAt', '')::timestamptz, v_checked))
        on conflict (entity_type, manifest_key) do update
          set batch_id = excluded.batch_id, source_url = excluded.source_url,
              image_source_url = excluded.image_source_url, sha256 = excluded.sha256,
              checked_at = excluded.checked_at, updated_at = now()
        where public.catalog_sources.entity_id = excluded.entity_id;
      end loop;

      -- Specifications (natural keys; approved, marked as assisted) -----------------------
      v_idx := 0;
      for v_g in select * from jsonb_array_elements(coalesce(v_p -> 'specs', '[]')) loop
        v_idx := v_idx + 1;
        insert into public.product_spec_groups (product_id, key, title, sort_order)
        values (v_pid, v_g ->> 'key', app.json_lt(v_g -> 'title'), v_idx)
        on conflict (product_id, key) do update set title = excluded.title, sort_order = excluded.sort_order
        where (public.product_spec_groups.title::jsonb, public.product_spec_groups.sort_order)
              is distinct from (excluded.title::jsonb, excluded.sort_order);
        select id into v_gid from public.product_spec_groups where product_id = v_pid and key = v_g ->> 'key';
        v_jdx := 0;
        for v_s in select * from jsonb_array_elements(coalesce(v_g -> 'items', '[]')) loop
          v_jdx := v_jdx + 1;
          v_exists := exists (select 1 from public.product_specs where group_id = v_gid and key = v_s ->> 'key');
          insert into public.product_specs (group_id, key, label, value, sort_order, status, source)
          values (v_gid, v_s ->> 'key', app.json_lt(v_s -> 'label'), app.json_lt(v_s -> 'value'), v_jdx,
                  'approved', 'assisted')
          on conflict (group_id, key) do update
            set label = excluded.label, value = excluded.value, sort_order = excluded.sort_order
          where (public.product_specs.label::jsonb, public.product_specs.value::jsonb, public.product_specs.sort_order)
                is distinct from (excluded.label::jsonb, excluded.value::jsonb, excluded.sort_order);
          get diagnostics v_rows = row_count;
          if not v_exists then c_spec_new := c_spec_new + 1;
          elsif v_rows > 0 then c_spec_upd := c_spec_upd + 1;
          end if;
        end loop;
      end loop;
    end loop;

    v_report := jsonb_build_object(
      'batch', v_batch,
      'dryRun', p_dry_run,
      'category', jsonb_build_object('slug', v_cat ->> 'slug', 'id', v_cat_id),
      'brands', jsonb_build_object('created', c_brand_new, 'reused', c_brand_reuse),
      'products', jsonb_build_object('created', c_prod_new, 'updated', c_prod_upd, 'unchanged', c_prod_same),
      'variants', jsonb_build_object('created', c_var_new, 'existing', c_var_same),
      'media', jsonb_build_object('created', c_media_new, 'updated', c_media_upd, 'unchanged', c_media_same),
      'specs', jsonb_build_object('created', c_spec_new, 'updated', c_spec_upd),
      'conflicts', v_conflicts,
      'totals', jsonb_build_object(
        'products', (select count(*) from public.catalog_sources where entity_type = 'product' and batch_id = v_batch),
        'variants', (select count(*) from public.catalog_sources where entity_type = 'variant' and batch_id = v_batch),
        'media', (select count(*) from public.catalog_sources where entity_type = 'media' and batch_id = v_batch),
        'askForPriceVariants', (select count(*) from public.product_variants pv
                                join public.catalog_sources s on s.entity_type = 'variant' and s.entity_id = pv.id
                                where s.batch_id = v_batch and pv.price is null and pv.deleted_at is null)));

    if p_dry_run then
      set constraints all immediate;  -- surface deferred variant-combination errors in the dry run
      raise exception using errcode = 'MSDRY', message = 'catalog_import dry run';
    end if;
  exception when sqlstate 'MSDRY' then
    null;  -- dry run: everything above is rolled back; the report is kept
  end;

  return v_report;
end;
$$;

revoke all on function app_private.catalog_import(jsonb, boolean) from public, anon, authenticated, service_role;
