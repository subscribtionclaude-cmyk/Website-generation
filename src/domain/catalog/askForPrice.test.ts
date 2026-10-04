import { describe, expect, it } from 'vitest';
import demoCatalogJson from '@seed/demo/catalog.json';
import { productJsonLd } from '@/domain/seo/structuredData';
import { createCatalogEngine } from './engine';
import { rawCatalogSchema } from './raw';
import { findVariant, initialSelection, optionValueState, purchaseState } from './variants';

/**
 * "Ask for price" = a published product whose variants have no price yet (NULL, never 0). It stays
 * visible and selectable, is never purchasable, and never claims a price anywhere (card, filters,
 * structured data).
 */
const NOW = new Date('2026-09-25T12:00:00Z');
const SLUG = 'iphone-18-pro';

function engineWithUnpriced() {
  const raw = rawCatalogSchema.parse(structuredClone(demoCatalogJson));
  const product = raw.products.find((p) => p.slug === SLUG);
  if (!product) throw new Error('fixture missing');
  for (const v of product.variants) {
    v.price = null;
    v.compareAtPrice = null;
  }
  return createCatalogEngine(raw, NOW);
}

describe('ask for price', () => {
  const engine = engineWithUnpriced();
  const product = engine.product(SLUG);
  if (!product) throw new Error('product missing');

  it('resolves to ask_for_price (not "unavailable") for an existing unpriced variant', () => {
    const variant = findVariant(product, initialSelection(product));
    expect(variant?.price).toBeNull();
    expect(purchaseState(product, variant)).toEqual({ kind: 'ask_for_price' });
    // A combination that doesn't exist is still "unavailable".
    expect(purchaseState(product, null)).toEqual({ kind: 'unavailable' });
  });

  it('keeps every real option selectable instead of marking it sold out', () => {
    for (const option of product.options)
      for (const value of option.values) {
        const state = optionValueState(product, initialSelection(product), option.key, value.key);
        expect(state === 'available' || state === 'unavailable').toBe(true);
      }
  });

  it('never reports a price of 0 and drops out of price filters', () => {
    expect(product.price).toEqual({ min: null, max: null, compareAt: null });
    const priced = engine.search({ minPrice: 0 }).items.map((p) => p.slug);
    expect(priced).not.toContain(SLUG);
    const card = engine.search({ q: 'iphone 18 pro' }).items.find((p) => p.slug === SLUG);
    expect(card?.price.min).toBeNull();
  });

  it('emits Product JSON-LD without an Offer (no fake price)', () => {
    const ld = productJsonLd(
      { ...product, isDemo: false },
      { origin: 'https://malek.test', locale: 'en', mode: 'live' },
    ) as Record<string, unknown> | null;
    expect(ld).not.toBeNull();
    expect(ld?.['@type']).toBe('Product');
    expect(ld).not.toHaveProperty('offers');
    expect(JSON.stringify(ld)).not.toMatch(/"price"\s*:\s*0\b/);
  });
});
