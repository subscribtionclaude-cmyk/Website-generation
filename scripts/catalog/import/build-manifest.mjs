#!/usr/bin/env node
// Builds and validates the catalog import manifest (the local dry run).
//
//   node scripts/catalog/import/build-manifest.mjs --batch 2026-10-04-wave1 [--brands apple,samsung]
//
// Reads scripts/catalog/sources/*.json + catalog/media/ingested.json, writes
// catalog/manifest/<batch>.json and catalog/manifest/<batch>.report.json, prints the dry-run report
// and exits 1 when the manifest has errors. The database dry run (app_private.catalog_import with
// p_dry_run = true) is the second check, against the live catalog.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, validateManifest } from '../../../src/domain/catalog/import/manifest.ts';
import { arg, loadIngested, loadSources, ROOT } from '../lib.mjs';

const batch = arg('batch');
if (!batch) {
  console.error('usage: build-manifest.mjs --batch <id> [--brands a,b]');
  process.exit(2);
}
const brands = (arg('brands', '') ?? '').split(',').filter(Boolean);
const manifestPath = `catalog/manifest/${batch}.json`;
const sources = loadSources(brands);
const { manifest, report } = buildManifest(sources, loadIngested(), {
  batch,
  description: `Smartphone catalog import ${batch} (${sources.map((s) => s.brand.name.en).join(', ')})`,
  manifestPath,
  checkedAt: new Date().toISOString(),
});
const issues = validateManifest(manifest);
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

mkdirSync(join(ROOT, 'catalog/manifest'), { recursive: true });
writeFileSync(join(ROOT, manifestPath), JSON.stringify(manifest, null, 2) + '\n');
const summary = {
  batch,
  brands: manifest.brands.map((b) => b.slug),
  counts: {
    brands: report.brands,
    products: report.products,
    published: manifest.products.filter((p) => p.status === 'published').length,
    draftsWithoutImages: report.draftsWithoutImages.length,
    variants: report.variants,
    images: report.imagesUsed,
  },
  perBrand: Object.fromEntries(
    manifest.brands.map((b) => {
      const ps = manifest.products.filter((p) => p.brand === b.slug);
      return [
        b.slug,
        {
          products: ps.length,
          variants: ps.reduce((n, p) => n + p.variants.length, 0),
          images: ps.reduce((n, p) => n + p.media.length, 0),
        },
      ];
    }),
  ),
  missingImages: report.missingImages,
  draftsWithoutImages: report.draftsWithoutImages,
  missingSpecs: report.missingSpecs,
  duplicateImages: report.duplicateImages,
  skipped: report.skipped,
  errors,
  warnings,
};
writeFileSync(
  join(ROOT, `catalog/manifest/${batch}.report.json`),
  JSON.stringify(summary, null, 2) + '\n',
);

console.log(`Catalog dry run — batch ${batch}`);
console.log(`  brands discovered    ${summary.counts.brands}`);
console.log(
  `  products discovered  ${summary.counts.products} (${summary.counts.published} published, ${summary.counts.draftsWithoutImages} draft: image pending)`,
);
console.log(`  variants discovered  ${summary.counts.variants}`);
console.log(`  images validated     ${summary.counts.images}`);
console.log(`  images missing       ${report.missingImages.length}`);
console.log(`  duplicate images     ${report.duplicateImages.length}`);
console.log(`  missing core specs   ${report.missingSpecs.length} products`);
console.log(`  models skipped       ${report.skipped.length}`);
console.log(`  errors               ${errors.length}`);
console.log(`  warnings             ${warnings.length}`);
for (const e of errors) console.log(`  ✗ ${e.path}: ${e.message}`);
console.log(`→ ${manifestPath}`);
process.exit(errors.length > 0 ? 1 : 0);
