-- Runs a committed manifest against the database. The manifest is fetched at an exact commit and
-- its SHA-256 checked, so what runs is exactly what was reviewed. Run with p_dry_run = true first;
-- switch to false only after the dry-run report is clean.
--
-- Replace <commit>, <batch> and <sha256> (sha256sum catalog/manifest/<batch>.json).
select case
  when r.status = 200 and encode(extensions.digest(r.content, 'sha256'), 'hex') = '<sha256>'
    then app_private.catalog_import(r.content::jsonb, true)
  else jsonb_build_object('error', 'manifest integrity check failed', 'status', r.status)
end as report
from extensions.http_get(
  'https://raw.githubusercontent.com/subscribtionclaude-cmyk/website-generation/<commit>/catalog/manifest/<batch>.json') r;
