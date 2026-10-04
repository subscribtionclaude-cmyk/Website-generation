import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductDetail, ProductSummary } from '@/domain/catalog/types';
import type { CatalogRepository } from '@/repositories/types';
import { createDemoRuntime } from '@/runtime/demoRuntime';
import { DEMO_CONFIG, renderApp } from '@/test/renderApp';
import baseSeed from '@seed/base/site-settings.json';

/**
 * "Ask for price": a real catalog product whose price is not published yet (variant price NULL).
 * It must look intentional (never EGP 0 / NaN), offer no cart or checkout, and send the customer to
 * the store through a channel that is actually configured.
 */
const SLUG = 'iphone-18-pro';

function unpriceSummary<T extends ProductSummary>(p: T): T {
  return p.slug === SLUG ? { ...p, price: { min: null, max: null, compareAt: null } } : p;
}

function unpricedCatalog(): CatalogRepository {
  const base = createDemoRuntime(DEMO_CONFIG).repositories.catalog;
  return {
    ...base,
    search: async (q) => {
      const page = await base.search(q);
      return { ...page, items: page.items.map(unpriceSummary) };
    },
    getProductsByIds: async (ids) => (await base.getProductsByIds(ids)).map(unpriceSummary),
    getProduct: async (slug) => {
      const p = await base.getProduct(slug);
      if (!p || slug !== SLUG) return p;
      const detail: ProductDetail = {
        ...unpriceSummary(p),
        variants: p.variants.map((v) => ({ ...v, price: null, compareAtPrice: null })),
      };
      return detail;
    },
  };
}

const store = baseSeed.settings.store as Record<string, unknown>;

describe('Ask for price', () => {
  it('product page: shows the label and an Ask-for-price call CTA, never a cart button', async () => {
    renderApp(`/product/${SLUG}`, { repositories: { catalog: unpricedCatalog() } });
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 4000 })).toBeVisible();
    // Price block: the intentional label, no money value.
    expect(screen.getAllByText('اسأل عن السعر').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/(EGP|ج\.م\.?)\s*0(?![\d.,])|NaN|undefined/);
    // WhatsApp isn't configured in the base settings, so the CTA calls the store.
    const cta = screen.getByRole('link', { name: 'اسأل عن السعر' });
    expect(cta).toHaveAttribute('href', 'tel:+201212004229');
    expect(
      screen.getByText('السعر مش منشور لسه. اسألنا وهنقولك السعر الحالي والتوفر.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'أبلغني عند توفر السعر' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /أضف للسلة/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /اشتري الآن/ })).toBeNull();
    // Stock is not advertised for an unpriced product.
    expect(screen.queryByText('غير متوفر حاليًا')).toBeNull();
  });

  it('product page: with WhatsApp configured the CTA prefills brand, model and variant', async () => {
    renderApp(`/product/${SLUG}`, {
      repositories: { catalog: unpricedCatalog() },
      settings: { store: { ...store, whatsappNumber: '01212004229' } },
    });
    const cta = await screen.findByRole('link', { name: /اسأل عن السعر/ }, { timeout: 4000 });
    const href = cta.getAttribute('href') ?? '';
    expect(href).toMatch(/^https:\/\/wa\.me\/201212004229\?text=/);
    const text = decodeURIComponent(href.split('text=')[1] ?? '');
    expect(text).toMatch(/^مرحبًا، أريد معرفة سعر Apple iPhone 18 Pro .+\.$/);
    // The call channel stays available as a secondary action.
    expect(screen.getByRole('link', { name: 'اتصل للطلب' })).toHaveAttribute(
      'href',
      'tel:+201212004229',
    );
    expect(screen.queryByRole('button', { name: /أضف للسلة/ })).toBeNull();
  });

  it('English product page uses the English label and CTA', async () => {
    renderApp(`/en/product/${SLUG}`, { repositories: { catalog: unpricedCatalog() } });
    expect(
      await screen.findByRole('link', { name: 'Ask for Price' }, { timeout: 4000 }),
    ).toHaveAttribute('href', 'tel:+201212004229');
    expect(
      screen.getByRole('button', { name: 'Notify me when the price is available' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Add to cart/ })).toBeNull();
  });

  it('store card: shows "اسأل عن السعر" without a stock badge or a price', async () => {
    renderApp('/store?q=iphone%2018%20pro', { repositories: { catalog: unpricedCatalog() } });
    const links = await screen.findAllByRole('link', { name: 'iPhone 18 Pro' }, { timeout: 4000 });
    const link = links.find((l) => l.closest('article')) as HTMLElement;
    const card = link.closest('article') as HTMLElement;
    expect(within(card).getByText('اسأل عن السعر')).toBeVisible();
    expect(within(card).queryByText(/متوفر|غير متوفر|كمية محدودة/)).toBeNull();
    expect(card.textContent).not.toMatch(/(EGP|ج\.م\.?)\s*0(?![\d.,])|NaN|undefined|null/);
  });
});
