#!/usr/bin/env node
// Lists the official product images named in scripts/catalog/sources that are not yet in our
// storage, and writes the SQL an operator runs on the database to ingest them: the database calls
// the catalog-media-ingest Edge Function (2 images per request) with the newest ingest token and
// records every result in app_private.catalog_media_ingest_log. Nothing here downloads images.
//
//   node scripts/catalog/images/plan-ingest.mjs --brand apple --per-call 6 --out /tmp/ingest.sql \
//        --url "$VITE_SUPABASE_URL" --apikey "$VITE_SUPABASE_ANON_KEY"
import { writeFileSync } from 'node:fs';
import { isOfficialImageUrl } from '../../../src/domain/catalog/import/media.ts';
import { arg, loadIngested, loadSources } from '../lib.mjs';

const brand = arg('brand');
const perCall = Number(arg('per-call', '6'));
const out = arg('out');
const url = arg('url', process.env.VITE_SUPABASE_URL ?? '');
const apikey = arg('apikey', process.env.VITE_SUPABASE_ANON_KEY ?? '');

const done = new Set(loadIngested().map((i) => i.sourceUrl));
const pending = [];
const rejected = [];
for (const source of loadSources(brand ? [brand] : [])) {
  for (const p of source.products)
    for (const c of p.colors)
      for (const image of (c.images ?? []).slice(0, 3)) {
        if (!isOfficialImageUrl(image)) rejected.push({ product: p.slug, image });
        else if (!done.has(image) && !pending.some((x) => x.url === image))
          pending.push({ brand: source.brand.slug, url: image });
      }
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const blocks = [];
for (let i = 0; i < pending.length; i += perCall) {
  const items = pending.slice(i, i + perCall);
  blocks.push(`do $ingest$
declare
  v_items jsonb := ${q(JSON.stringify(items))}::jsonb;
  v_token text := (select token from app_private.catalog_media_tokens
                   where expires_at > now() and uses < max_uses order by created_at desc limit 1);
  v_pair jsonb;
  v_res record;
  v_row jsonb;
  v_src text;
begin
  if v_token is null then raise exception 'no valid catalog media token'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '55000');
  for v_pair in
    select jsonb_agg(x order by n) from jsonb_array_elements(v_items) with ordinality t (x, n)
    group by x ->> 'brand', (n - 1) / 2
  loop
    begin
      select status, content into v_res from extensions.http((
        'POST', ${q(`${url}/functions/v1/catalog-media-ingest`)},
        array[extensions.http_header('apikey', ${q(apikey)})], 'application/json',
        jsonb_build_object('token', v_token, 'brand', v_pair -> 0 ->> 'brand',
          'items', (select jsonb_agg(jsonb_build_object('key', 'i' || (n - 1), 'url', x ->> 'url'))
                    from jsonb_array_elements(v_pair) with ordinality t (x, n)))::text)::extensions.http_request);
      if v_res.status <> 200 then
        insert into app_private.catalog_media_ingest_log (source_url, brand, ok, error)
        select x ->> 'url', x ->> 'brand', false, 'function_http_' || v_res.status from jsonb_array_elements(v_pair) x;
        continue;
      end if;
      for v_row in select * from jsonb_array_elements(v_res.content::jsonb -> 'results') loop
        v_src := v_pair -> (substr(v_row ->> 'key', 2)::int) ->> 'url';
        insert into app_private.catalog_media_ingest_log (source_url, brand, ok, sha256, width, height, bytes, files, error)
        values (v_src, v_pair -> 0 ->> 'brand', (v_row ->> 'ok')::boolean, v_row ->> 'sha256',
                (v_row ->> 'width')::int, (v_row ->> 'height')::int, (v_row ->> 'bytes')::int, v_row -> 'files',
                left(v_row ->> 'error', 100));
      end loop;
    exception when others then
      insert into app_private.catalog_media_ingest_log (source_url, brand, ok, error)
      select x ->> 'url', x ->> 'brand', false, left('call_failed: ' || sqlerrm, 100) from jsonb_array_elements(v_pair) x;
    end;
  end loop;
end
$ingest$;`);
}

const sql = blocks.join('\n\n');
if (out) writeFileSync(out, sql + '\n');
console.log(
  JSON.stringify(
    { pending: pending.length, calls: blocks.length, rejected, out: out ?? null },
    null,
    2,
  ),
);
if (!out && sql) console.log(sql);
