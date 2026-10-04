/**
 * Catalog import manifest.
 *
 *   scripts/catalog/sources/<brand>.json   verified facts per model (official source URL, colours,
 *                                          confirmed memory configurations, specs, official images)
 * + catalog/media/ingested.json            official images already copied into our storage by the
 *                                          catalog-media-ingest Edge Function (hash, size, our URLs)
 * → buildManifest()                        → catalog/manifest/<batch>.json
 * → validateManifest()                     → errors block the import; warnings go to the report
 * → app_private.catalog_import(manifest)   (dry run first, then the real run)
 *
 * Pure functions with relative imports only, so Node scripts can import this file directly.
 * Manifests never carry prices or stock: every imported variant starts as "Ask for price".
 */
import { isOfficialImageUrl } from './media.ts';

export interface Pair {
  ar: string;
  en: string;
}
export type SpecValue = string | Pair;

export const SPEC_GROUPS = {
  display: { ar: 'الشاشة', en: 'Display' },
  performance: { ar: 'الأداء', en: 'Performance' },
  camera: { ar: 'الكاميرا', en: 'Camera' },
  battery: { ar: 'البطارية والشحن', en: 'Battery & charging' },
  connectivity: { ar: 'الاتصال', en: 'Connectivity' },
  design: { ar: 'التصميم', en: 'Design' },
  software: { ar: 'النظام', en: 'Software' },
} as const satisfies Record<string, Pair>;

export type SpecGroupKey = keyof typeof SPEC_GROUPS;

/** Structured fields we import when the official source confirms them; anything else stays empty. */
export const SPEC_FIELDS = {
  display_size: { group: 'display', ar: 'حجم الشاشة', en: 'Screen size' },
  display_type: { group: 'display', ar: 'نوع الشاشة', en: 'Display type' },
  resolution: { group: 'display', ar: 'الدقة', en: 'Resolution' },
  refresh_rate: { group: 'display', ar: 'معدل التحديث', en: 'Refresh rate' },
  chipset: { group: 'performance', ar: 'المعالج', en: 'Chipset' },
  rear_camera: { group: 'camera', ar: 'الكاميرا الخلفية', en: 'Rear camera' },
  front_camera: { group: 'camera', ar: 'الكاميرا الأمامية', en: 'Front camera' },
  battery: { group: 'battery', ar: 'البطارية', en: 'Battery' },
  charging: { group: 'battery', ar: 'الشحن', en: 'Charging' },
  network: { group: 'connectivity', ar: 'الشبكة', en: 'Network' },
  sim: { group: 'connectivity', ar: 'الشريحة', en: 'SIM' },
  water_resistance: { group: 'design', ar: 'مقاومة الماء والغبار', en: 'Water & dust resistance' },
  os: { group: 'software', ar: 'نظام التشغيل', en: 'Operating system' },
  model_code: { group: 'software', ar: 'رقم الموديل', en: 'Model code' },
} as const satisfies Record<string, { group: SpecGroupKey; ar: string; en: string }>;

export type SpecKey = keyof typeof SPEC_FIELDS;

// ── Source files (hand-verified) ──────────────────────────────────────────────

export interface SourceColor {
  key: string;
  en: string;
  ar: string;
  hex?: string | null;
  /** Official product images for this colour, best first (front / hero first). */
  images?: string[];
}

export interface SourceConfig {
  ram?: string | null;
  storage: string;
}

export interface SourceProduct {
  slug: string;
  model: string;
  family?: string;
  name?: Partial<Pair>;
  subtitle?: Pair;
  sourceUrl: string;
  checkedAt?: string;
  availability?: 'available' | 'coming_soon' | 'pre_order';
  colors: SourceColor[];
  configs: SourceConfig[];
  /** Colour × configuration pairs that exist (default: every pair). Keys: colour key + config index. */
  combos?: { color: string; config: number }[];
  specs: Partial<Record<SpecKey, SpecValue>>;
  keywords?: string;
}

export interface SkippedModel {
  model: string;
  sourceAttempted: string;
  blocker: string;
}

export interface SourceFile {
  brand: { slug: string; name: Pair; sourceUrl: string; sortOrder?: number; skuPrefix: string };
  keywords?: string;
  checkedAt: string;
  products: SourceProduct[];
  skipped?: SkippedModel[];
}

/** One row of the media-ingest log (official image copied into our storage). */
export interface IngestedImage {
  sourceUrl: string;
  brand: string;
  sha256: string;
  width: number;
  height: number;
  files: Record<string, string>;
}

// ── Manifest (what the database import consumes) ──────────────────────────────

export interface ManifestOptionValue {
  key: string;
  label: Pair;
  swatchHex?: string | null;
}

export interface ManifestProduct {
  key: string;
  brand: string;
  slug: string;
  family: string | null;
  model: string;
  name: Pair;
  subtitle: Pair | null;
  description: Pair | null;
  keywords: string;
  status: 'published' | 'draft';
  availability: 'available' | 'coming_soon' | 'pre_order';
  sourceUrl: string;
  checkedAt: string;
  options: { key: string; name: Pair; values: ManifestOptionValue[] }[];
  variants: { sku: string; options: Record<string, string> }[];
  media: {
    key: string;
    color: string | null;
    url: string;
    sourceUrl: string;
    sha256: string;
    width: number;
    height: number;
    isCover: boolean;
    alt: Pair;
  }[];
  specs: { key: string; title: Pair; items: { key: string; label: Pair; value: Pair }[] }[];
}

export interface Manifest {
  version: 1;
  batch: string;
  description: string;
  manifestPath: string;
  checkedAt: string;
  category: { slug: string; name: Pair; icon: string; sortOrder: number };
  brands: { slug: string; name: Pair; sourceUrl: string; sortOrder: number }[];
  products: ManifestProduct[];
}

export interface BuildReport {
  brands: number;
  products: number;
  variants: number;
  imagesUsed: number;
  draftsWithoutImages: string[];
  missingImages: { product: string; color: string; reason: string }[];
  missingSpecs: { product: string; fields: SpecKey[] }[];
  duplicateImages: { sha256: string; uses: string[] }[];
  skipped: (SkippedModel & { brand: string })[];
}

export const SMARTPHONES_CATEGORY = {
  slug: 'phones',
  name: { ar: 'الهواتف الذكية', en: 'Smartphones' },
  icon: 'phone',
  sortOrder: 1,
} as const;

const DETAIL_SIZE = 1200;
const MAX_IMAGES_PER_COLOR = 3;
const MAX_IMAGES_PER_PRODUCT = 12;
const CORE_SPECS: SpecKey[] = ['display_size', 'chipset', 'rear_camera', 'battery', 'os'];

const keyOf = (value: string) =>
  value
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const skuPart = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '');

const pair = (value: SpecValue): Pair =>
  typeof value === 'string' ? { ar: value, en: value } : { ar: value.ar, en: value.en };

/** "256GB" → 256, "1TB" → 1024 (sort key only). */
export function capacityGb(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(GB|TB)$/i.exec(value.trim());
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * ((m[2] ?? '').toUpperCase() === 'TB' ? 1024 : 1);
}

const capacityLabel = (value: string): Pair => {
  const m = /^(\d+(?:\.\d+)?)\s*(GB|TB)$/i.exec(value.trim());
  if (!m) return { ar: value, en: value };
  const unit = (m[2] ?? '').toUpperCase();
  return { ar: `${m[1]} ${unit === 'TB' ? 'تيرابايت' : 'جيجابايت'}`, en: `${m[1]}${unit}` };
};

function buildProduct(
  source: SourceFile,
  p: SourceProduct,
  images: Map<string, IngestedImage>,
  report: BuildReport,
): ManifestProduct {
  const brand = source.brand;
  const key = `${brand.slug}/${p.slug}`;
  const name: Pair = { ar: p.name?.ar ?? p.model, en: p.name?.en ?? p.model };
  const storages = [...new Set(p.configs.map((c) => c.storage))].sort(
    (a, b) => capacityGb(a) - capacityGb(b),
  );
  const rams = [...new Set(p.configs.map((c) => c.ram).filter((r): r is string => !!r))].sort(
    (a, b) => capacityGb(a) - capacityGb(b),
  );

  const options: ManifestProduct['options'] = [];
  if (p.colors.length > 0)
    options.push({
      key: 'color',
      name: { ar: 'اللون', en: 'Color' },
      values: p.colors.map((c) => ({
        key: c.key,
        label: { ar: c.ar, en: c.en },
        swatchHex: c.hex ?? null,
      })),
    });
  if (storages.length > 0)
    options.push({
      key: 'storage',
      name: { ar: 'السعة', en: 'Storage' },
      values: storages.map((s) => ({ key: keyOf(s), label: capacityLabel(s) })),
    });
  if (rams.length > 0)
    options.push({
      key: 'ram',
      name: { ar: 'الرام', en: 'RAM' },
      values: rams.map((r) => ({ key: keyOf(r), label: capacityLabel(r) })),
    });

  const combos =
    p.combos ?? p.colors.flatMap((c) => p.configs.map((_, config) => ({ color: c.key, config })));
  const ordered = [...combos].sort(
    (a, b) =>
      p.colors.findIndex((c) => c.key === a.color) - p.colors.findIndex((c) => c.key === b.color) ||
      a.config - b.config,
  );
  const variants = ordered.map(({ color, config }) => {
    const cfg = p.configs[config];
    const selection: Record<string, string> = {};
    if (p.colors.length > 0) selection.color = color;
    if (cfg) {
      selection.storage = keyOf(cfg.storage);
      if (cfg.ram) selection.ram = keyOf(cfg.ram);
    }
    const sku = [
      brand.skuPrefix,
      skuPart(p.slug.replace(new RegExp(`^${brand.slug}-`), '')),
      cfg?.ram ? skuPart(cfg.ram) : null,
      cfg ? skuPart(cfg.storage) : null,
      p.colors.length > 0 ? skuPart(color) : null,
    ]
      .filter(Boolean)
      .join('-');
    return { sku, options: selection };
  });

  const media: ManifestProduct['media'] = [];
  for (const color of p.colors) {
    const urls = (color.images ?? []).slice(0, MAX_IMAGES_PER_COLOR);
    if (urls.length === 0)
      report.missingImages.push({
        product: key,
        color: color.key,
        reason: 'no official image found',
      });
    urls.forEach((url, i) => {
      const img = images.get(url);
      if (!img) {
        report.missingImages.push({
          product: key,
          color: color.key,
          reason: `not ingested: ${url}`,
        });
        return;
      }
      if (media.length >= MAX_IMAGES_PER_PRODUCT) return;
      media.push({
        key: `media/${key}/${color.key}/${i + 1}`,
        color: color.key,
        url: img.files[String(DETAIL_SIZE)] ?? '',
        sourceUrl: url,
        sha256: img.sha256,
        width: DETAIL_SIZE,
        height: DETAIL_SIZE,
        isCover: media.length === 0,
        alt: {
          ar: `${brand.name.ar} ${p.model} — اللون ${color.ar}`,
          en: `${brand.name.en} ${p.model} — ${color.en}`,
        },
      });
    });
  }
  if (media.length === 0) report.draftsWithoutImages.push(key);

  const groups = new Map<SpecGroupKey, ManifestProduct['specs'][number]>();
  for (const field of Object.keys(SPEC_FIELDS) as SpecKey[]) {
    const value = p.specs[field];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
      continue;
    const def = SPEC_FIELDS[field];
    let group = groups.get(def.group);
    if (!group) {
      group = { key: def.group, title: { ...SPEC_GROUPS[def.group] }, items: [] };
      groups.set(def.group, group);
    }
    group.items.push({ key: field, label: { ar: def.ar, en: def.en }, value: pair(value) });
  }
  const specs = (Object.keys(SPEC_GROUPS) as SpecGroupKey[])
    .map((g) => groups.get(g))
    .filter((g): g is ManifestProduct['specs'][number] => !!g);
  const missing = CORE_SPECS.filter((f) => p.specs[f] === undefined);
  if (missing.length > 0) report.missingSpecs.push({ product: key, fields: missing });

  const size = p.specs.display_size ? pair(p.specs.display_size) : null;
  const chip = p.specs.chipset ? pair(p.specs.chipset) : null;
  const subtitle =
    p.subtitle ??
    (size || chip
      ? {
          ar: [size?.ar, chip?.ar].filter(Boolean).join(' · '),
          en: [size?.en, chip?.en].filter(Boolean).join(' · '),
        }
      : null);
  const storageText = storages.map((s) => capacityLabel(s));
  const description: Pair = {
    ar: [
      `هاتف ${brand.name.ar} ${p.model}`,
      size ? `بشاشة ${size.ar}` : null,
      chip ? `ومعالج ${chip.ar}` : null,
    ]
      .filter(Boolean)
      .join(' ')
      .concat(
        p.colors.length > 0 ? `. متوفر بالألوان: ${p.colors.map((c) => c.ar).join('، ')}` : '',
        storageText.length > 0 ? `، وبسعات ${storageText.map((s) => s.ar).join(' و')}` : '',
        '.',
      ),
    en: [
      `${brand.name.en} ${p.model}`,
      size ? `with a ${size.en} display` : null,
      chip ? `and the ${chip.en} chip` : null,
    ]
      .filter(Boolean)
      .join(' ')
      .concat(
        p.colors.length > 0 ? `. Colours: ${p.colors.map((c) => c.en).join(', ')}` : '',
        storageText.length > 0 ? `; storage: ${storageText.map((s) => s.en).join(', ')}` : '',
        '.',
      ),
  };

  return {
    key,
    brand: brand.slug,
    slug: p.slug,
    family: p.family ?? null,
    model: p.model,
    name,
    subtitle,
    description,
    keywords: [source.keywords, p.family, p.keywords].filter(Boolean).join(' ').slice(0, 1000),
    status: media.length > 0 ? 'published' : 'draft',
    availability: p.availability ?? 'available',
    sourceUrl: p.sourceUrl,
    checkedAt: p.checkedAt ?? source.checkedAt,
    options,
    variants,
    media,
    specs,
  };
}

export function buildManifest(
  sources: SourceFile[],
  ingested: IngestedImage[],
  meta: { batch: string; description: string; manifestPath: string; checkedAt: string },
): { manifest: Manifest; report: BuildReport } {
  const images = new Map(ingested.map((i) => [i.sourceUrl, i]));
  const report: BuildReport = {
    brands: 0,
    products: 0,
    variants: 0,
    imagesUsed: 0,
    draftsWithoutImages: [],
    missingImages: [],
    missingSpecs: [],
    duplicateImages: [],
    skipped: [],
  };
  const products: ManifestProduct[] = [];
  for (const source of sources) {
    for (const p of source.products) products.push(buildProduct(source, p, images, report));
    for (const s of source.skipped ?? []) report.skipped.push({ ...s, brand: source.brand.slug });
  }
  const bySha = new Map<string, string[]>();
  for (const p of products)
    for (const m of p.media) bySha.set(m.sha256, [...(bySha.get(m.sha256) ?? []), m.key]);
  report.duplicateImages = [...bySha]
    .filter(([, uses]) => uses.length > 1)
    .map(([sha256, uses]) => ({ sha256, uses }));
  report.brands = sources.length;
  report.products = products.length;
  report.variants = products.reduce((n, p) => n + p.variants.length, 0);
  report.imagesUsed = products.reduce((n, p) => n + p.media.length, 0);
  const manifest: Manifest = {
    version: 1,
    ...meta,
    category: { ...SMARTPHONES_CATEGORY, name: { ...SMARTPHONES_CATEGORY.name } },
    brands: sources.map((s, i) => ({
      slug: s.brand.slug,
      name: s.brand.name,
      sourceUrl: s.brand.sourceUrl,
      sortOrder: s.brand.sortOrder ?? (i + 1) * 10,
    })),
    products,
  };
  return { manifest, report };
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

const SLUG = /^[a-z0-9-]{1,60}$/;
const PRODUCT_SLUG = /^[a-z0-9-]{1,80}$/;
const BATCH = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SKU = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const OPTION_KEY = /^[a-z][a-z0-9_-]{0,30}$/;
const VALUE_KEY = /^[a-z0-9-]{1,40}$/;
const SPEC_KEY = /^[a-z][a-z0-9_-]{0,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
const OUR_IMAGE =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/products\/catalog\/[a-z0-9-]+\/[0-9a-f]{16}-1200\.webp$/;
const FORBIDDEN_VARIANT_FIELDS = ['price', 'compareAtPrice', 'stock', 'initialStock'];

const filled = (p: unknown): p is Pair =>
  !!p &&
  typeof p === 'object' &&
  typeof (p as Pair).ar === 'string' &&
  (p as Pair).ar.trim().length > 0 &&
  typeof (p as Pair).en === 'string' &&
  (p as Pair).en.trim().length > 0;

/** Errors block the import; warnings are listed in the dry-run report. */
export function validateManifest(m: Manifest): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  if (m.version !== 1) err('version', 'unsupported manifest version');
  if (!BATCH.test(m.batch ?? '')) err('batch', 'invalid batch id');
  if (!SLUG.test(m.category?.slug ?? '') || !filled(m.category?.name))
    err('category', 'category needs a slug and AR/EN names');

  const brandSlugs = new Set<string>();
  const brandNames = new Set<string>();
  m.brands.forEach((b, i) => {
    const path = `brands[${i}]`;
    if (!SLUG.test(b.slug)) err(path, `invalid brand slug "${b.slug}"`);
    if (brandSlugs.has(b.slug)) err(path, `duplicate brand slug "${b.slug}"`);
    const normalized = b.name?.en?.trim().toLowerCase();
    if (normalized && brandNames.has(normalized)) err(path, `duplicate brand name "${b.name.en}"`);
    brandSlugs.add(b.slug);
    if (normalized) brandNames.add(normalized);
    if (!filled(b.name)) err(path, 'brand needs AR/EN names');
    if (!isOfficialImageUrl(b.sourceUrl)) err(path, 'brand source must be an official https URL');
  });

  const keys = new Set<string>();
  const slugs = new Set<string>();
  const skus = new Set<string>();
  m.products.forEach((p, i) => {
    const path = `products[${i}] ${p.key}`;
    if (keys.has(p.key)) err(path, 'duplicate product key');
    keys.add(p.key);
    if (!PRODUCT_SLUG.test(p.slug)) err(path, `invalid slug "${p.slug}"`);
    if (slugs.has(p.slug)) err(path, `duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    if (!brandSlugs.has(p.brand)) err(path, `unknown brand "${p.brand}"`);
    if (!filled(p.name)) err(path, 'product needs AR/EN names');
    if (!isOfficialImageUrl(p.sourceUrl))
      err(path, 'product source must be an official manufacturer https URL');
    if (Number.isNaN(Date.parse(p.checkedAt))) err(path, 'checkedAt must be a date');

    const optionValues = new Map<string, Set<string>>();
    const optionKeys = new Set<string>();
    for (const o of p.options) {
      if (!OPTION_KEY.test(o.key)) err(path, `invalid option key "${o.key}"`);
      if (optionKeys.has(o.key)) err(path, `duplicate option "${o.key}"`);
      optionKeys.add(o.key);
      if (!filled(o.name)) err(path, `option "${o.key}" needs AR/EN names`);
      if (o.values.length === 0) err(path, `option "${o.key}" has no values`);
      const values = new Set<string>();
      for (const v of o.values) {
        if (!VALUE_KEY.test(v.key)) err(path, `invalid value key "${o.key}=${v.key}"`);
        if (values.has(v.key)) err(path, `duplicate value "${o.key}=${v.key}"`);
        values.add(v.key);
        if (!filled(v.label)) err(path, `value "${o.key}=${v.key}" needs AR/EN labels`);
        if (v.swatchHex && !HEX.test(v.swatchHex))
          err(path, `invalid swatch "${v.swatchHex}" for ${v.key}`);
        if (o.key === 'color' && !v.swatchHex) warn(path, `colour "${v.key}" has no swatch colour`);
      }
      optionValues.set(o.key, values);
    }

    if (p.variants.length === 0) err(path, 'product has no variants');
    const combos = new Set<string>();
    for (const v of p.variants) {
      const extra = FORBIDDEN_VARIANT_FIELDS.filter((f) => f in (v as object));
      if (extra.length > 0)
        err(
          path,
          `variant ${v.sku} carries ${extra.join(', ')} (manifests never set prices/stock)`,
        );
      if (!SKU.test(v.sku)) err(path, `invalid SKU "${v.sku}"`);
      if (skus.has(v.sku)) err(path, `duplicate SKU "${v.sku}"`);
      skus.add(v.sku);
      const selected = Object.keys(v.options);
      if (selected.length !== optionKeys.size || selected.some((k) => !optionKeys.has(k)))
        err(path, `variant ${v.sku} must pick exactly one value per option`);
      for (const [k, value] of Object.entries(v.options))
        if (!optionValues.get(k)?.has(value))
          err(path, `variant ${v.sku} uses unknown ${k}=${value}`);
      const signature = Object.keys(v.options)
        .sort()
        .map((k) => `${k}=${v.options[k]}`)
        .join(',');
      if (combos.has(signature)) err(path, `duplicate combination ${signature}`);
      combos.add(signature);
    }

    let covers = 0;
    const mediaKeys = new Set<string>();
    for (const media of p.media) {
      if (mediaKeys.has(media.key)) err(path, `duplicate media key ${media.key}`);
      mediaKeys.add(media.key);
      if (!OUR_IMAGE.test(media.url))
        err(path, `media ${media.key} is not one of our stored derivatives`);
      if (!isOfficialImageUrl(media.sourceUrl))
        err(path, `media ${media.key} source is not an official manufacturer URL`);
      if (!SHA.test(media.sha256)) err(path, `media ${media.key} has no valid SHA-256`);
      if (media.color !== null && !optionValues.get('color')?.has(media.color))
        err(path, `media ${media.key} references unknown colour ${media.color}`);
      if (!filled(media.alt)) err(path, `media ${media.key} needs AR/EN alt text`);
      if (media.isCover) covers += 1;
    }
    if (covers > 1) err(path, 'more than one cover image');
    if (p.media.length === 0) warn(path, 'no official image yet: imported as a hidden draft');
    if (p.status === 'published' && p.media.length === 0)
      err(path, 'a product without images cannot be published');

    for (const g of p.specs) {
      if (!SPEC_KEY.test(g.key) || !filled(g.title)) err(path, `invalid spec group ${g.key}`);
      const itemKeys = new Set<string>();
      for (const s of g.items) {
        if (!SPEC_KEY.test(s.key)) err(path, `invalid spec key ${s.key}`);
        if (itemKeys.has(s.key)) err(path, `duplicate spec ${s.key}`);
        itemKeys.add(s.key);
        if (!filled(s.label) || !filled(s.value))
          err(path, `spec ${s.key} needs AR/EN label and value`);
      }
    }
  });
  return issues;
}
