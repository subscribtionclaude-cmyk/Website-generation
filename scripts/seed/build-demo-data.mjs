// Expands scripts/seed/demo-catalog.source.mjs into:
//   supabase/seed/data/demo/catalog.json   (consumed by the demo frontend + demo.sql generator)
//   public/demo/media/*.svg                (generic device illustrations, tinted per colour)
// Usage: node scripts/seed/build-demo-data.mjs [--check]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVICE_VIEWS, renderDeviceSvg } from './demo-media.mjs';
import {
  BRANDS,
  CATEGORIES,
  COLORS,
  ENTRIES,
  OFFERS,
  PRODUCTS,
  REVIEWS,
  SEARCH_ALIASES,
} from './demo-catalog.source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalogFile = path.join(root, 'supabase/seed/data/demo/catalog.json');
const mediaDir = path.join(root, 'public/demo/media');
const checkOnly = process.argv.includes('--check');

const svgFiles = new Map();
function mediaUrl(view, colorKey) {
  const hex = COLORS[colorKey]?.hex ?? '#1d1d1f';
  const file = `${view}-${colorKey}.svg`;
  if (!svgFiles.has(file)) svgFiles.set(file, renderDeviceSvg(view, hex));
  return `/demo/media/${file}`;
}

function buildProduct(p) {
  const colorOption = p.options.find((o) => o.key === 'color');
  const colorKeys = colorOption
    ? colorOption.values.map((v) => v.key)
    : [p.previewColor ?? 'black'];
  const views = DEVICE_VIEWS[p.device];
  if (!views) throw new Error(`Unknown device ${p.device} for ${p.slug}`);
  const media = [];
  colorKeys.forEach((colorKey, ci) => {
    views.forEach((view, vi) => {
      const colorLabel = COLORS[colorKey]?.label;
      media.push({
        id: `demo-media-${p.slug}-${colorKey}-${vi}`,
        kind: 'image',
        url: mediaUrl(view, colorKey),
        posterUrl: null,
        alt: {
          ar: `${p.name.ar}${colorOption ? ` — ${colorLabel.ar}` : ''} (صورة توضيحية)`,
          en: `${p.name.en}${colorOption ? ` — ${colorLabel.en}` : ''} (illustration)`,
        },
        width: 800,
        height: 800,
        colorKey: colorOption ? colorKey : null,
        isCover: ci === 0 && vi === 0,
        sortOrder: ci * 10 + vi,
      });
    });
  });
  const relations = Object.entries(p.relations ?? {}).flatMap(([kind, slugs]) =>
    slugs.map((slug, i) => ({ kind, slug, sortOrder: i })),
  );
  return {
    id: `demo-product-${p.slug}`,
    slug: p.slug,
    brandSlug: p.brand,
    categorySlugs: p.categories,
    model: p.model,
    name: p.name,
    subtitle: p.subtitle ?? null,
    description: p.description ?? null,
    availabilityState: p.availability,
    isNew: p.isNew,
    isFeatured: p.isFeatured,
    releaseDate: p.releaseDate,
    warranty: p.warranty ?? null,
    bestSellerScore: p.bestSeller,
    keywords: Object.entries(SEARCH_ALIASES)
      .filter(([term]) => `${p.model} ${p.name.en} ${p.brand}`.toLowerCase().includes(term))
      .map(([, alias]) => alias)
      .join(' '),
    options: p.options,
    variants: p.variants.map((v) => ({
      id: `demo-variant-${v.sku.toLowerCase()}`,
      sku: v.sku,
      options: v.options,
      price: v.price,
      compareAtPrice: v.compareAtPrice ?? null,
      stock: v.stock,
      lowStockThreshold: 2,
      isActive: true,
      isDefault: v.isDefault,
      warranty: null,
    })),
    media,
    specGroups: p.specGroups ?? [],
    relations,
    seo: { title: null, description: null },
  };
}

function buildCatalog() {
  const products = PRODUCTS.map(buildProduct);
  const slugs = new Set(products.map((p) => p.slug));
  for (const p of products) {
    for (const r of p.relations)
      if (!slugs.has(r.slug)) throw new Error(`${p.slug} relates to unknown ${r.slug}`);
    const combos = new Set(p.variants.map((v) => JSON.stringify(v.options)));
    if (combos.size !== p.variants.length)
      throw new Error(`${p.slug} has duplicate variant combinations`);
  }
  return {
    $comment:
      'GENERATED DEMO DATA — do not edit; edit scripts/seed/demo-catalog.source.mjs and run npm run seed:generate. Sample prices/stock/specs only (not real Malek Store data). Relative dates like "+5d" resolve against the current time.',
    version: 1,
    brands: BRANDS.map((b) => ({
      id: `demo-brand-${b.slug}`,
      logoUrl: null,
      description: null,
      ...b,
    })),
    categories: CATEGORIES.map((c) => ({
      id: `demo-category-${c.slug}`,
      description: null,
      imageUrl: null,
      showInNav: c.parentSlug === null,
      showOnHome: c.showOnHome ?? c.parentSlug === null,
      showInShop: true,
      showInCategoryGrid: c.showOnHome ?? c.parentSlug === null,
      ...c,
    })),
    products,
    offers: OFFERS.map((o) => ({
      id: `demo-offer-${o.slug}`,
      subtitle: null,
      description: null,
      media: null,
      discountPercent: null,
      discountAmount: null,
      bundlePrice: null,
      promoCode: null,
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
      minSubtotal: null,
      ...o,
      products: o.products.map((x) => {
        if (!slugs.has(x.slug)) throw new Error(`Offer ${o.slug} references unknown ${x.slug}`);
        return x;
      }),
    })),
    entries: ENTRIES.map((e) => ({
      id: `demo-entry-${e.slug}`,
      eyebrow: null,
      subtitle: null,
      excerpt: null,
      body: null,
      secondaryCta: null,
      state: null,
      releaseDate: null,
      expiresAt: null,
      ...e,
      media: e.media
        ? {
            kind: e.media.kind,
            url: mediaUrl(e.media.device, e.media.color),
            posterUrl: null,
            alt: e.media.alt,
          }
        : null,
      products: e.products.map((slug) => {
        if (!slugs.has(slug)) throw new Error(`Entry ${e.slug} references unknown ${slug}`);
        return slug;
      }),
    })),
    reviews: REVIEWS.map((r) => {
      if (!slugs.has(r.product))
        throw new Error(`Review ${r.slug} references unknown ${r.product}`);
      return { id: `demo-review-${r.slug}`, ...r };
    }),
  };
}

async function main() {
  const catalog = buildCatalog();
  const json = `${JSON.stringify(catalog, null, 2)}\n`;
  if (checkOnly) {
    const current = await readFile(catalogFile, 'utf8').catch(() => '');
    const existing = new Set(await readdir(mediaDir).catch(() => []));
    const missing = [...svgFiles.keys()].filter((f) => !existing.has(f));
    if (current !== json || missing.length > 0) {
      console.error('✗ demo catalog/media out of date — run npm run seed:generate');
      process.exit(1);
    }
    console.log(
      `✓ demo catalog up to date (${catalog.products.length} products, ${svgFiles.size} media files)`,
    );
    return;
  }
  await mkdir(path.dirname(catalogFile), { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  await writeFile(catalogFile, json);
  for (const [file, svg] of svgFiles) await writeFile(path.join(mediaDir, file), svg);
  console.log(
    `✓ wrote demo catalog (${catalog.products.length} products) and ${svgFiles.size} media files`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
