import { describe, expect, it } from 'vitest';
import demoCatalogJson from '@seed/demo/catalog.json';
import { createCatalogEngine } from '@/domain/catalog/engine';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import { shouldReduceMotion } from '@/features/theme/adaptiveMotion';
import { splitBidiRuns } from '@/lib/bidi';
import { breadcrumbJsonLd, productJsonLd } from './structuredData';

const engine = createCatalogEngine(
  rawCatalogSchema.parse(demoCatalogJson),
  new Date('2026-09-25T12:00:00Z'),
);
const ctx = { origin: 'https://malek.test', locale: 'en' as const };

describe('structured data contracts', () => {
  const product = engine.product('iphone-18-pro');

  it('never emits Product markup for demo data or in demo mode', () => {
    expect(product).not.toBeNull();
    if (!product) return;
    expect(productJsonLd(product, { ...ctx, mode: 'demo' })).toBeNull();
    expect(productJsonLd(product, { ...ctx, mode: 'live' })).toBeNull(); // still flagged demo
  });

  it('emits per-variant EGP offers for a real live product', () => {
    if (!product) throw new Error('missing');
    const ld = productJsonLd({ ...product, isDemo: false }, { ...ctx, mode: 'live' }) as Record<
      string,
      unknown
    >;
    expect(ld['@type']).toBe('Product');
    expect(ld.url).toBe('https://malek.test/en/product/iphone-18-pro');
    const offers = ld.offers as { priceCurrency: string; sku: string; availability: string }[];
    expect(offers).toHaveLength(12);
    expect(offers.every((o) => o.priceCurrency === 'EGP')).toBe(true);
    expect(offers.find((o) => o.sku === 'IP18P-1TB-ORANGE')?.availability).toBe(
      'https://schema.org/OutOfStock',
    );
  });

  it('omits offers for upcoming products (no price commitments)', () => {
    const duo = engine.product('iphone-duo');
    if (!duo) throw new Error('missing');
    const ld = productJsonLd({ ...duo, isDemo: false }, { ...ctx, mode: 'live' }) as Record<
      string,
      unknown
    >;
    expect(ld.offers).toBeUndefined();
  });

  it('builds breadcrumb lists with localized absolute URLs', () => {
    const ld = breadcrumbJsonLd(
      [{ label: 'Home', href: '/' }, { label: 'Phones', href: '/category/phones' }, { label: 'X' }],
      ctx,
    ) as {
      itemListElement: { position: number; item?: string }[];
    };
    expect(ld.itemListElement.map((i) => i.item)).toEqual([
      'https://malek.test/en',
      'https://malek.test/en/category/phones',
      undefined,
    ]);
  });
});

describe('bidi isolation', () => {
  it('isolates Latin product names inside Arabic text only', () => {
    expect(splitBidiRuns('iPhone 18 Pro و iPhone 18 Pro Max')).toEqual([
      { text: 'iPhone 18 Pro', latin: true },
      { text: ' و ', latin: false },
      { text: 'iPhone 18 Pro Max', latin: true },
    ]);
    expect(splitBidiRuns('Galaxy S26 Ultra')).toEqual([{ text: 'Galaxy S26 Ultra', latin: false }]);
  });
});

describe('adaptive motion', () => {
  it('reduces motion on constrained devices or data saver', () => {
    expect(shouldReduceMotion({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(shouldReduceMotion({ hardwareConcurrency: 2 })).toBe(true);
    expect(shouldReduceMotion({ deviceMemory: 1 })).toBe(true);
    expect(shouldReduceMotion({ connection: { saveData: true } })).toBe(true);
  });
});
