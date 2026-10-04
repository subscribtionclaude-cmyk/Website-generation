-- Body of catalog/media/ingested.json: the latest successful ingest of every official image URL.
select jsonb_build_object(
  'exportedAt', now(),
  'images', coalesce(jsonb_agg(jsonb_build_object(
      'sourceUrl', source_url, 'brand', brand, 'sha256', sha256, 'width', width, 'height', height,
      'bytes', bytes, 'files', files) order by brand, source_url), '[]'::jsonb)) as ingested
from (select distinct on (source_url) *
      from app_private.catalog_media_ingest_log
      order by source_url, created_at desc) latest
where ok;

-- Images whose latest attempt failed (listed in the import report as rejected / pending):
-- select source_url, brand, error, created_at
-- from (select distinct on (source_url) * from app_private.catalog_media_ingest_log
--       order by source_url, created_at desc) latest
-- where not ok order by brand, source_url;
