import { describe, expect, it } from 'vitest';
import demoCatalogJson from '@seed/demo/catalog.json';
import pageSections from '@seed/base/page-sections.json';
import { createCatalogEngine } from '@/domain/catalog/engine';
import { parseAmount } from '@/domain/catalog/amount';
import { rawCatalogSchema } from '@/domain/catalog/raw';
import { filterOffers } from './offers';
import { productSourceQuery, resolveSections, SECTION_TYPES } from './sections';
import { countdownParts, offerPhase } from './time';

const NOW = new Date('2026-09-25T12:00:00Z');
const engine = createCatalogEngine(rawCatalogSchema.parse(demoCatalogJson), NOW);

describe('page section registry', () => {
  const rows = pageSections.sections.map((s) => ({ id: s.key, ...s }));

  it('validates every seeded section and keeps the required home order', () => {
    const invalid: string[] = [];
    const home = resolveSections(
      rows.filter((r) => r.pageKey === 'home'),
      (id) => invalid.push(id),
    );
    expect(invalid).toEqual([]);
    expect(home.map((s) => s.type)).toEqual([
      'hero_campaign',
      'product_rail',
      'offer_rail',
      'category_grid',
      'brand_lines',
      'product_rail',
      'budget_search',
      'promo_banner',
      'promo_banner',
      'coming_soon',
      'content_rail',
      'trust_strip',
      'branch_contact',
    ]);
    for (const page of ['apple', 'offers']) {
      expect(
        resolveSections(
          rows.filter((r) => r.pageKey === page),
          (id) => invalid.push(id),
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(invalid).toEqual([]);
  });

  it('drops hidden, unknown and invalid sections instead of crashing the page', () => {
    const skipped: string[] = [];
    const resolved = resolveSections(
      [
        {
          id: 'a',
          type: 'budget_search',
          isVisible: true,
          sortOrder: 2,
          props: { title: { ar: 'x' }, subtitle: null },
        },
        {
          id: 'b',
          type: 'budget_search',
          isVisible: false,
          sortOrder: 1,
          props: { title: { ar: 'y' }, subtitle: null },
        },
        { id: 'c', type: 'marquee', isVisible: true, sortOrder: 3, props: {} },
        { id: 'd', type: 'promo_banner', isVisible: true, sortOrder: 4, props: { tone: 'neon' } },
        {
          id: 'e',
          type: 'trust_strip',
          isVisible: true,
          sortOrder: 0,
          props: { title: null, itemIds: null },
        },
      ],
      (id) => skipped.push(id),
    );
    expect(resolved.map((s) => s.id)).toEqual(['e', 'a']);
    expect(skipped).toEqual(['c', 'd']);
    expect(SECTION_TYPES).toContain('hero_campaign');
  });

  it('rejects unsafe CTA links in section props', () => {
    const skipped: string[] = [];
    resolveSections(
      [
        {
          id: 'x',
          type: 'promo_banner',
          isVisible: true,
          sortOrder: 1,
          props: {
            tone: 'dark',
            illustration: 'none',
            eyebrow: null,
            title: { ar: 't' },
            body: null,
            points: [],
            cta: { label: { ar: 'l' }, href: 'javascript:alert(1)' },
            secondaryCta: null,
          },
        },
      ],
      (id) => skipped.push(id),
    );
    expect(skipped).toEqual(['x']);
  });

  it('maps rail sources to catalog queries', () => {
    expect(productSourceQuery({ kind: 'new' }, 4)).toMatchObject({
      newOnly: true,
      sort: 'newest',
      pageSize: 4,
    });
    expect(productSourceQuery({ kind: 'coming_soon' }, 3).availability).toEqual([
      'coming_soon',
      'waitlist_only',
      'pre_order',
    ]);
    expect(productSourceQuery({ kind: 'best_sellers', brands: ['apple'] }, 8)).toMatchObject({
      brands: ['apple'],
      availability: ['available'],
      sort: 'best_selling',
    });
    const newDevices = engine.search(
      productSourceQuery(
        { kind: 'new', categories: ['phones', 'tablets', 'laptops', 'watches', 'audio', 'gaming'] },
        4,
      ),
    );
    expect(newDevices.items.every((p) => !p.categorySlugs.includes('accessories'))).toBe(true);
  });
});

describe('offers', () => {
  const offers = engine.offers();

  it('filters groups by kind, brand and category', () => {
    expect(filterOffers(offers, { kinds: ['flash'] }).map((o) => o.slug)).toEqual([
      'ps5-flash-offer',
    ]);
    expect(filterOffers(offers, { kinds: ['promo_code'] }).map((o) => o.promoCode)).toEqual([
      'DEMO10',
    ]);
    expect(filterOffers(offers, { brands: ['apple'] }).length).toBeGreaterThanOrEqual(3);
    expect(filterOffers(offers, { categories: ['accessories'] }).map((o) => o.slug)).toContain(
      'magsafe-case-price-drop',
    );
    expect(filterOffers(offers, null)).toBe(offers);
  });

  it('derives countdowns and phases from timestamps only', () => {
    expect(countdownParts('2026-09-27T06:00:00Z', NOW)).toMatchObject({
      days: 1,
      hours: 18,
      minutes: 0,
    });
    expect(countdownParts('2026-09-25T11:00:00Z', NOW)).toBeNull();
    expect(offerPhase('2026-09-26T00:00:00Z', null, NOW)).toBe('upcoming');
    expect(offerPhase(null, '2026-09-24T00:00:00Z', NOW)).toBe('expired');
    expect(offerPhase(null, null, NOW)).toBe('active');
  });
});

describe('budget amounts', () => {
  it('accepts Latin and Arabic-Indic digits and thousands separators', () => {
    expect(parseAmount('20,000')).toBe(20000);
    expect(parseAmount('٢٠٬٠٠٠')).toBe(20000);
    expect(parseAmount('۳۰۰۰۰')).toBe(30000);
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('12abc')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
  });
});
