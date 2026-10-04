import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  capacityGb,
  validateManifest,
  type IngestedImage,
  type Manifest,
  type SourceFile,
} from './manifest';

const IMG_BLACK = 'https://images.samsung.com/is/image/samsung/p6pim/eg/galaxy-x-black.png';
const IMG_SILVER = 'https://images.samsung.com/is/image/samsung/p6pim/eg/galaxy-x-silver.png';
const sha = (c: string) => c.repeat(64);
const stored = (c: string) =>
  `https://dialrvjkfiphftdwrvkh.supabase.co/storage/v1/object/public/products/catalog/samsung/${c.repeat(16)}`;

const ingested: IngestedImage[] = [
  {
    sourceUrl: IMG_BLACK,
    brand: 'samsung',
    sha256: sha('a'),
    width: 1200,
    height: 1200,
    files: { 480: `${stored('a')}-480.webp`, 1200: `${stored('a')}-1200.webp` },
  },
  {
    sourceUrl: IMG_SILVER,
    brand: 'samsung',
    sha256: sha('b'),
    width: 1200,
    height: 1200,
    files: { 480: `${stored('b')}-480.webp`, 1200: `${stored('b')}-1200.webp` },
  },
];

function source(): SourceFile {
  return {
    brand: {
      slug: 'samsung',
      name: { ar: 'سامسونج', en: 'Samsung' },
      sourceUrl: 'https://www.samsung.com/eg/',
      skuPrefix: 'SAM',
    },
    keywords: 'سامسونج جالاكسي',
    checkedAt: '2026-10-04',
    products: [
      {
        slug: 'galaxy-x',
        model: 'Galaxy X',
        family: 'Galaxy X series',
        sourceUrl: 'https://www.samsung.com/eg/smartphones/galaxy-x/',
        colors: [
          { key: 'black', en: 'Black', ar: 'أسود', hex: '#111111', images: [IMG_BLACK] },
          { key: 'silver', en: 'Silver', ar: 'فضي', hex: '#cccccc', images: [IMG_SILVER] },
        ],
        configs: [
          { ram: '8GB', storage: '128GB' },
          { ram: '8GB', storage: '256GB' },
          { ram: '12GB', storage: '256GB' },
        ],
        // Only black comes with 12GB RAM.
        combos: [
          { color: 'black', config: 0 },
          { color: 'black', config: 1 },
          { color: 'black', config: 2 },
          { color: 'silver', config: 0 },
          { color: 'silver', config: 1 },
        ],
        specs: {
          display_size: { ar: '6.7 بوصة', en: '6.7-inch' },
          chipset: 'Exynos 1580',
          rear_camera: { ar: '50 ميجابكسل رئيسية', en: '50MP main' },
          battery: { ar: '5000 مللي أمبير', en: '5,000mAh' },
          os: 'Android 16',
        },
      },
    ],
    skipped: [
      { model: 'Galaxy Y', sourceAttempted: 'https://www.samsung.com/eg/y/', blocker: 'HTTP 403' },
    ],
  };
}

function at<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`missing item ${index}`);
  return item;
}

const META = {
  batch: 'test-wave1',
  description: 'test',
  manifestPath: 'catalog/manifest/test.json',
  checkedAt: '2026-10-04T08:00:00Z',
};

describe('catalog manifest', () => {
  it('builds exact confirmed variants, options, media and specs without prices', () => {
    const { manifest, report } = buildManifest([source()], ingested, META);
    expect(validateManifest(manifest).filter((i) => i.level === 'error')).toEqual([]);
    const p = at(manifest.products, 0);
    expect(p.key).toBe('samsung/galaxy-x');
    expect(p.status).toBe('published');
    expect(p.options.map((o) => o.key)).toEqual(['color', 'storage', 'ram']);
    expect(at(p.options, 1).values.map((v) => v.label.en)).toEqual(['128GB', '256GB']);
    expect(at(p.options, 2).values.map((v) => v.label.ar)).toEqual(['8 جيجابايت', '12 جيجابايت']);
    // Only confirmed combinations: 5, not 2 × 3 = 6.
    expect(p.variants.map((v) => v.sku)).toEqual([
      'SAM-GALAXYX-8GB-128GB-BLACK',
      'SAM-GALAXYX-8GB-256GB-BLACK',
      'SAM-GALAXYX-12GB-256GB-BLACK',
      'SAM-GALAXYX-8GB-128GB-SILVER',
      'SAM-GALAXYX-8GB-256GB-SILVER',
    ]);
    for (const v of p.variants) {
      expect(v).not.toHaveProperty('price');
      expect(v).not.toHaveProperty('stock');
    }
    expect(p.media.map((m) => [m.color, m.isCover, m.url])).toEqual([
      ['black', true, `${stored('a')}-1200.webp`],
      ['silver', false, `${stored('b')}-1200.webp`],
    ]);
    expect(at(p.media, 0).alt).toEqual({
      ar: 'سامسونج Galaxy X — اللون أسود',
      en: 'Samsung Galaxy X — Black',
    });
    expect(p.specs.map((g) => g.key)).toEqual([
      'display',
      'performance',
      'camera',
      'battery',
      'software',
    ]);
    expect(p.subtitle).toEqual({ ar: '6.7 بوصة · Exynos 1580', en: '6.7-inch · Exynos 1580' });
    expect(p.description?.en).toContain('Colours: Black, Silver');
    expect(report).toMatchObject({ brands: 1, products: 1, variants: 5, imagesUsed: 2 });
    expect(report.skipped).toEqual([
      {
        brand: 'samsung',
        model: 'Galaxy Y',
        sourceAttempted: 'https://www.samsung.com/eg/y/',
        blocker: 'HTTP 403',
      },
    ]);
  });

  it('keeps a model without an ingested official image as a hidden draft and reports it', () => {
    const { manifest, report } = buildManifest([source()], [], META);
    const p = at(manifest.products, 0);
    expect(p.status).toBe('draft');
    expect(p.media).toEqual([]);
    expect(report.draftsWithoutImages).toEqual(['samsung/galaxy-x']);
    expect(report.missingImages).toHaveLength(2);
    const issues = validateManifest(manifest);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.some((i) => i.level === 'warning' && /hidden draft/.test(i.message))).toBe(true);
  });

  it('reports missing core specs instead of inventing them', () => {
    const s = source();
    at(s.products, 0).specs = { chipset: 'Exynos 1580' };
    const { report, manifest } = buildManifest([s], ingested, META);
    expect(report.missingSpecs).toEqual([
      { product: 'samsung/galaxy-x', fields: ['display_size', 'rear_camera', 'battery', 'os'] },
    ]);
    expect(at(manifest.products, 0).specs).toEqual([
      {
        key: 'performance',
        title: { ar: 'الأداء', en: 'Performance' },
        items: [
          {
            key: 'chipset',
            label: { ar: 'المعالج', en: 'Chipset' },
            value: { ar: 'Exynos 1580', en: 'Exynos 1580' },
          },
        ],
      },
    ]);
  });

  it('flags the same image file used for two colours', () => {
    const s = source();
    at(at(s.products, 0).colors, 1).images = [IMG_BLACK];
    const { report } = buildManifest([s], ingested, META);
    expect(report.duplicateImages).toEqual([
      {
        sha256: sha('a'),
        uses: ['media/samsung/galaxy-x/black/1', 'media/samsung/galaxy-x/silver/1'],
      },
    ]);
  });

  it('rejects duplicates, prices, foreign sources and broken references', () => {
    const { manifest } = buildManifest([source()], ingested, META);
    const broken: Manifest = structuredClone(manifest);
    const p = at(broken.products, 0);
    broken.products.push(structuredClone(p)); // duplicate key / slug / SKUs
    (p.variants[0] as Record<string, unknown>).price = 0; // a fake price, even 0
    at(p.variants, 1).options.color = 'gold'; // unknown colour
    p.sourceUrl = 'https://some-shop.example.eg/galaxy-x'; // not an official source
    at(p.media, 0).url = 'https://images.samsung.com/hotlinked.png'; // hot-linked, not our copy
    at(p.media, 1).isCover = true; // two covers
    broken.brands.push({ ...at(broken.brands, 0), slug: 'samsung-eg' }); // same brand, other slug
    const messages = validateManifest(broken)
      .filter((i) => i.level === 'error')
      .map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'duplicate brand name "Samsung"',
        'duplicate product key',
        'duplicate slug "galaxy-x"',
        'duplicate SKU "SAM-GALAXYX-8GB-128GB-BLACK"',
        'variant SAM-GALAXYX-8GB-128GB-BLACK carries price (manifests never set prices/stock)',
        'variant SAM-GALAXYX-8GB-256GB-BLACK uses unknown color=gold',
        'product source must be an official manufacturer https URL',
        'media media/samsung/galaxy-x/black/1 is not one of our stored derivatives',
        'more than one cover image',
      ]),
    );
  });

  it('orders capacities numerically', () => {
    expect(
      ['1TB', '256GB', '512GB', '128GB'].sort((a, b) => capacityGb(a) - capacityGb(b)),
    ).toEqual(['128GB', '256GB', '512GB', '1TB']);
  });
});
