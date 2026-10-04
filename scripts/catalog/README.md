# Catalog import pipeline

Bulk-loads the real smartphone catalog from official manufacturer sources. Nothing is typed into the
admin by hand and nothing is invented: every model, colour, memory configuration, spec and image
comes from the manufacturer's own site, and prices and stock are never imported (every imported
variant starts as **Ask for price** and can't be checked out).

```
scripts/catalog/sources/<brand>.json      1. discover + normalize  (verified facts, official URLs)
scripts/catalog/images/plan-ingest.mjs    2. images: SQL that copies official images into our storage
catalog/media/ingested.json               3. ingest results (hash, size, our WebP URLs)
scripts/catalog/import/build-manifest.mjs 4. validate + local dry run → catalog/manifest/<batch>.json
scripts/catalog/import/sql/import.sql     5. database dry run, then the real import
```

## 1. Sources

One JSON file per brand (`SourceFile` in `src/domain/catalog/import/manifest.ts`):

- `brand`: slug, AR/EN name, official site, SKU prefix.
- Per model: `slug`, `model`, official `sourceUrl` (the spec page used), `colors` (official names,
  swatch colour, official product image URLs), `configs` (confirmed RAM/storage pairs), optional
  `combos` (when not every colour comes in every configuration) and `specs`.
- Only the fields in `SPEC_FIELDS` exist. A spec the official page doesn't confirm stays absent;
  the report lists missing core specs.
- `skipped`: models that were checked but not imported, with the source tried and the exact blocker.

## 2–3. Images

Official images are never hot-linked. The `catalog-media-ingest` Edge Function fetches an image
from an allow-listed manufacturer domain (no redirects), checks its type and size, and stores
transparent square WebP files (480 px for cards, 1200 px for the product page). The files are
addressed by the SHA-256 of the source file, so the same image is stored once. The function only
runs with a short-lived, use-limited token that a database operator creates in
`app_private.catalog_media_tokens`.

```bash
node scripts/catalog/images/plan-ingest.mjs --brand apple --out /tmp/ingest.sql \
  --url "$VITE_SUPABASE_URL" --apikey "$VITE_SUPABASE_ANON_KEY"
```

Run the generated SQL on the database. Each call is logged in
`app_private.catalog_media_ingest_log`. Then export `sql/export-ingested.sql` into
`catalog/media/ingested.json`.

## 4. Manifest and local dry run

```bash
node scripts/catalog/import/build-manifest.mjs --batch 2026-10-04-wave1 --brands apple,samsung
```

This prints the brands, products, variants, validated and missing images, duplicates, missing specs
and skipped models. It writes `catalog/manifest/<batch>.json` and `<batch>.report.json`, and exits
1 on any error. Errors include a duplicate slug or SKU, an unknown option value, a non-official
source, a hot-linked image, any price or stock field, or two cover images. A model without an ingested image is
kept as a hidden draft (image pending), never given a placeholder.

## 5. Database dry run and import

Commit and push the manifest, then:

1. `sql/backup.sql`: save the snapshot as `catalog/backups/<batch>-pre-import.json`.
2. `sql/import.sql` with `p_dry_run = true`. This fetches the manifest at the exact commit, checks
   its SHA-256 and returns the report. Everything is rolled back.
3. The same call with `false` once the report is clean.

`app_private.catalog_import` is idempotent. Re-running merges into the rows it created: products by
manifest key, variants by SKU, images by manifest key, and options and specs by their natural keys.
It never changes price, stock, status, visibility or availability, so staff edits survive. It never
adopts content it did not create: demo brands and categories, or foreign slugs and SKUs, are
reported as conflicts. Every created entity gets a `catalog_sources` row (batch, official page,
image source URL, SHA-256, checked date). That row is the reversible record that `sql/rollback.sql`
uses. Rollback is destructive and needs the owner's approval.
