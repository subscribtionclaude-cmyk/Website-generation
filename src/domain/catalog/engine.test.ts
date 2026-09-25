import { describe, expect, it } from 'vitest';
import demoCatalogJson from '@seed/demo/catalog.json';
import { createCatalogEngine } from './engine';
import { parseCatalogQuery, serializeCatalogQuery, activeFilterCount } from './queryParams';
import { rawCatalogSchema } from './raw';
import { normalizeSearchText, searchTokens } from './search';
import { discountPercent, stockStateFor } from './stock';
import {
  findVariant,
  initialSelection,
  mediaForSelection,
  optionValueState,
  purchaseState,
  selectOption,
} from './variants';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const NOW = new Date('2026-09-25T12:00:00Z');
const raw = rawCatalogSchema.parse(demoCatalogJson);
const engine = createCatalogEngine(raw, NOW);
const slugs = (items: { slug: string }[]) => items.map((i) => i.slug);

/**
 * These expectations are mirrored 1:1 in supabase/tests/sql/05_catalog.test.sql so the demo adapter
 * and the Postgres RPCs are proven to implement the same catalog semantics.
 */
describe('demo catalog data', () => {
  it('is valid, flagged demo, and every variant combination is unique', () => {
    expect(raw.products).toHaveLength(28);
    for (const product of raw.products) {
      const combos = new Set(product.variants.map((v) => JSON.stringify(v.options)));
      expect(combos.size, product.slug).toBe(product.variants.length);
      for (const variant of product.variants) {
        expect(Object.keys(variant.options).sort(), variant.sku).toEqual(
          product.options.map((o) => o.key).sort(),
        );
      }
    }
    expect(engine.search({ pageSize: 48 }).items.every((p) => p.isDemo)).toBe(true);
  });

  it('never invents specs for the owner-supplied campaign names', () => {
    const product = engine.product('iphone-18-pro');
    const values = product?.specGroups.flatMap((g) => g.items.map((i) => i.value.en));
    expect(values?.every((v) => v === 'To be confirmed at launch')).toBe(true);
    expect(engine.product('iphone-duo')?.variants).toEqual([]);
  });
});

describe('search, filters, sorting, facets', () => {
  it('returns all 28 products, paginated', () => {
    const page1 = engine.search({ pageSize: 12 });
    expect(page1.total).toBe(28);
    expect(page1.items).toHaveLength(12);
    expect(engine.search({ pageSize: 12, page: 3 }).items).toHaveLength(4);
  });

  it('normalises Arabic and matches name, model, brand, category and transliterations', () => {
    expect(normalizeSearchText('آيفون ١٨ بـرو')).toBe('ايفون 18 برو');
    expect(searchTokens('  iPhone-18  ')).toEqual(['iphone', '18']);
    expect(engine.search({ q: 'ايفون', pageSize: 48 }).total).toBe(6);
    expect(slugs(engine.search({ q: 'آيفون 18', sort: 'price_asc', pageSize: 48 }).items)).toEqual([
      'magsafe-clear-case-18-pro',
      'iphone-18-pro',
      'iphone-18-pro-max',
    ]);
    expect(engine.search({ q: 'Samsung' }).total).toBe(5);
    expect(engine.search({ q: 'سماعات' }).total).toBe(3);
    expect(engine.search({ q: 'zzzz-nothing' }).total).toBe(0);
  });

  it('filters by brand, category (incl. sub-categories), availability and offers', () => {
    expect(engine.search({ brands: ['samsung'] }).total).toBe(5);
    expect(slugs(engine.search({ categories: ['laptops'] }).items).sort()).toEqual([
      'macbook-air-13',
      'macbook-pro-14',
    ]);
    expect(engine.search({ categories: ['playstation-5'] }).total).toBe(1);
    expect(slugs(engine.search({ availability: ['coming_soon'] }).items)).toEqual(['iphone-duo']);
    expect(engine.search({ onOffer: true, pageSize: 48 }).total).toBe(10);
    expect(engine.search({ newOnly: true, pageSize: 48 }).total).toBe(7);
  });

  it('applies variant-level filters to the SAME variant (price + storage + colour + stock)', () => {
    const budget = engine.search({
      minPrice: 20000,
      maxPrice: 30000,
      sort: 'price_asc',
      pageSize: 48,
    });
    expect(budget.total).toBe(6);
    expect(
      budget.items.every((p) => (p.price.min ?? 0) >= 20000 && (p.price.max ?? 0) <= 30000),
    ).toBe(true);
    const ipad = budget.items.find((p) => p.slug === 'ipad-11');
    expect(ipad?.price).toEqual({ min: 21000, max: 26000, compareAt: null });

    // iPhone 18 Pro: 1TB exists, orange exists, but 1TB+orange is sold out.
    const soldOut = engine.search({
      q: 'iphone 18 pro',
      storage: ['1tb'],
      colors: ['orange'],
      inStockOnly: true,
      pageSize: 48,
    });
    expect(slugs(soldOut.items)).toEqual(['iphone-18-pro-max']);
    const orange = engine.search({ colors: ['orange'], storage: ['512gb'], pageSize: 48 });
    expect(orange.items.find((p) => p.slug === 'iphone-18-pro')?.price.min).toBe(83500);
    expect(orange.items.find((p) => p.slug === 'iphone-18-pro')?.image?.colorKey).toBe('orange');
  });

  it('sorts by price, newest and best selling', () => {
    expect(engine.search({ sort: 'price_asc' }).items[0]?.slug).toBe('usb-c-cable');
    expect(engine.search({ sort: 'price_desc' }).items[0]?.slug).toBe('macbook-pro-14');
    expect(engine.search({ sort: 'best_selling' }).items[0]?.slug).toBe('iphone-18-pro');
    expect(engine.search({ sort: 'newest' }).items[0]?.slug).toBe('magsafe-clear-case-18-pro');
    expect(engine.search({ sort: 'price_asc', pageSize: 48 }).items.at(-1)?.slug).toBe(
      'iphone-duo',
    );
  });

  it('computes facets that ignore their own dimension', () => {
    const facets = engine.search({ brands: ['samsung'] }).facets;
    expect(facets.brands).toHaveLength(7);
    expect(facets.brands.find((b) => b.key === 'apple')?.count).toBe(16);
    expect(facets.storage.map((s) => s.key)).toEqual(['128gb', '256gb', '512gb']);
    expect(facets.price).toEqual({ min: 9000, max: 70000 });
    const all = engine.search({}).facets;
    expect(all.storage.map((s) => s.key)).toEqual(['128gb', '256gb', '512gb', '1tb']);
    expect(all.categories.map((c) => c.key).slice(0, 4)).toEqual([
      'phones',
      'tablets',
      'laptops',
      'macbook',
    ]);
    expect(all.colors[0]).toMatchObject({ key: 'black', count: 14 });
  });
});

describe('product detail & variants', () => {
  const product = must(engine.product('iphone-18-pro'));

  it('exposes stock states, never quantities', () => {
    expect(JSON.stringify(product)).not.toMatch(/"stock"|quantity/i);
    const sku = (s: string) => product.variants.find((v) => v.sku === s);
    expect(sku('IP18P-1TB-ORANGE')?.stockState).toBe('out_of_stock');
    expect(sku('IP18P-512GB-BLUE')?.stockState).toBe('low_stock');
    expect(sku('IP18P-256GB-BLACK')?.stockState).toBe('in_stock');
  });

  it('prices each exact combination independently', () => {
    expect(findVariant(product, { storage: '512gb', color: 'orange' })?.price).toBe(83500);
    expect(findVariant(product, { storage: '512gb', color: 'black' })?.price).toBe(82000);
    expect(findVariant(product, { storage: '9tb', color: 'black' })).toBeNull();
  });

  it('switches media with colour and keeps other choices when possible', () => {
    const selection = initialSelection(product);
    expect(selection).toEqual({ storage: '256gb', color: 'orange' });
    expect(
      mediaForSelection(product, { ...selection, color: 'blue' }).every(
        (m) => m.colorKey === 'blue',
      ),
    ).toBe(true);
    expect(selectOption(product, selection, 'storage', '1tb')).toEqual({
      storage: '1tb',
      color: 'orange',
    });
    expect(optionValueState(product, { storage: '1tb', color: 'black' }, 'color', 'orange')).toBe(
      'out_of_stock',
    );
    const watch = must(engine.product('airpods-4'));
    expect(optionValueState(watch, { model: 'standard', color: 'white' }, 'model', 'anc')).toBe(
      'available',
    );
  });

  it('decides the purchase CTA from availability and stock', () => {
    expect(
      purchaseState(product, findVariant(product, { storage: '1tb', color: 'orange' })),
    ).toEqual({ kind: 'out_of_stock' });
    expect(
      purchaseState(product, findVariant(product, { storage: '256gb', color: 'black' })),
    ).toEqual({
      kind: 'purchasable',
      stockState: 'in_stock',
    });
    const duo = must(engine.product('iphone-duo'));
    expect(purchaseState(duo, null)).toEqual({ kind: 'coming_soon' });
    const ultra = must(engine.product('apple-watch-ultra-3'));
    expect(ultra.stockState).toBe('out_of_stock');
  });

  it('returns related products and null for unknown slugs', () => {
    expect(slugs(product.relations.accessories)).toContain('magsafe-clear-case-18-pro');
    expect(engine.product('no-such-product')).toBeNull();
  });
});

describe('offers & content windows', () => {
  it('lists active offers with badges and countdown timestamps', () => {
    const offers = engine.offers();
    expect(offers).toHaveLength(7);
    const flash = must(offers.find((o) => o.slug === 'ps5-flash-offer'));
    expect(new Date(must(flash.endsAt)).getTime() - NOW.getTime()).toBe(42 * 3_600_000);
    expect(engine.search({ q: 'airpods pro 3' }).items[0]?.offer?.slug).toBe(
      'airpods-pro-3-limited',
    );
    const gift = must(engine.offer('macbook-air-free-charger'));
    expect(gift.productRoles['apple-20w-usb-c-adapter']).toBe('gift');
    // A gift item doesn't get the offer badge itself.
    expect(engine.search({ q: '20W' }).items[0]?.offer).toBeNull();
  });

  it('filters published entries by type', () => {
    expect(engine.entries()).toHaveLength(7);
    expect(engine.entries({ types: ['news'] })).toHaveLength(2);
    expect(engine.entry('iphone-duo-teaser')?.products[0]?.availabilityState).toBe('coming_soon');
  });
});

describe('helpers', () => {
  it('stock and discount rules', () => {
    expect(stockStateFor(0, 2, true)).toBe('out_of_stock');
    expect(stockStateFor(5, 2, false)).toBe('out_of_stock');
    expect(stockStateFor(2, 2, true)).toBe('low_stock');
    expect(stockStateFor(3, 2, true)).toBe('in_stock');
    expect(discountPercent(62000, 66000)).toBe(6);
    expect(discountPercent(100, 90)).toBeNull();
  });

  it('round-trips catalog queries through the URL and rejects junk', () => {
    const params = new URLSearchParams(
      'q=iphone&brand=apple,SAMSUNG,<x>&min=30000&max=20000&storage=256gb&stock=1&sort=price_asc&page=2&sort2=x',
    );
    const query = parseCatalogQuery(params);
    expect(query).toEqual({
      q: 'iphone',
      brands: ['apple', 'samsung'],
      minPrice: 20000,
      maxPrice: 30000,
      storage: ['256gb'],
      inStockOnly: true,
      sort: 'price_asc',
      page: 2,
    });
    expect(parseCatalogQuery(serializeCatalogQuery(query))).toEqual(query);
    expect(activeFilterCount(query)).toBe(5);
    expect(parseCatalogQuery(new URLSearchParams('sort=evil&page=-4&min=abc'))).toEqual({});
  });
});

describe('demo catalog bilingual content', () => {
  it('never shows Arabic text in an English field (e.g. spec values in compare)', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (typeof record.ar === 'string' && typeof record.en === 'string') {
        if (/[؀-ۿ]/.test(record.en)) offenders.push(`${path}: ${record.en}`);
      }
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };
    walk(demoCatalogJson, 'catalog');
    expect(offenders).toEqual([]);
  });
});
