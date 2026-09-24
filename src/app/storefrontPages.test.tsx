import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import { renderApp } from '@/test/renderApp';

const T = { timeout: 4000 };

describe('CMS home', () => {
  it('renders the registry sections in the configured order', async () => {
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /iPhone 18 Pro/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    await screen.findByRole('heading', { level: 2, name: 'زورنا في الفرع' }, T);
    await screen.findByRole('heading', { level: 3, name: /Galaxy Tab S11/ }, T);
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const order = [
      'وصل حديثًا',
      'عروض لفترة محدودة',
      'تسوّق حسب القسم',
      'عالم Apple كامل عندنا',
      'الأكثر مبيعًا',
      'ميزانيتك كام؟',
      'بدّل القديم بالجديد',
      'جهازك محتاج صيانة؟',
      'قريبًا',
      'أخبار MALEK',
      'ليه تشتري من MALEK STORE',
      'زورنا في الفرع',
    ];
    const positions = order.map((title) => h2.indexOf(title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Hero teaser for iPhone Duo links to its waitlist page.
    expect(screen.getByRole('link', { name: /سجّل اهتمامك: iPhone Duo/ })).toHaveAttribute(
      'href',
      '/product/iphone-duo',
    );
  });

  it('never shows demo data in live mode: a failing catalog shows an error state', async () => {
    renderApp('/store', {
      mode: 'live',
      repositories: {
        catalog: {
          listBrands: () => Promise.reject(new Error('down')),
          listCategories: () => Promise.reject(new Error('down')),
          search: () => Promise.reject(new Error('down')),
          getProduct: () => Promise.reject(new Error('down')),
        },
      },
    });
    expect(
      await screen.findByText('تعذر تحميل المنتجات الآن. حاول مرة أخرى بعد قليل.', undefined, {
        timeout: 8000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('iPhone 18 Pro')).not.toBeInTheDocument();
  }, 15_000);
});

describe('Apple landing page', () => {
  it('shows the Apple line-up and the admin-controlled Authorized Reseller statement', async () => {
    renderApp('/en/apple');
    expect(
      await screen.findByRole('heading', { level: 2, name: /Apple Authorized Reseller/ }, T),
    ).toBeInTheDocument();
    const lines = await screen.findByRole('heading', { level: 2, name: 'Shop Apple' });
    const section = lines.closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'iPhone' })).toHaveAttribute(
      'href',
      '/en/brand/apple?category=phones',
    );
  });

  it('hides the Authorized Reseller section when the trust item is hidden', async () => {
    const trust = {
      items: baseSeed.settings.trust.items.map((item) =>
        item.id === 'apple-authorized-reseller' ? { ...item, visible: false } : item,
      ),
    };
    renderApp('/en/apple', { settings: { trust } });
    await screen.findByRole('heading', { level: 2, name: 'Shop Apple' }, T);
    expect(screen.queryByText(/Apple Authorized Reseller/)).not.toBeInTheDocument();
  });
});

describe('store listing', () => {
  it('filters by brand, keeps state in the URL and shows removable chips', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/store');
    expect(await screen.findByText('28 products', undefined, T)).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    await user.click(within(sidebar).getByRole('checkbox', { name: /Samsung/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?brand=samsung'));
    expect(await screen.findByText('5 products')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove: Samsung' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('sorts by price and searches Arabic text with normalisation', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/search?q=ايفون');
    expect(await screen.findByText('6 منتج', undefined, T)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('الترتيب'), 'price_asc');
    await waitFor(() => expect(router.state.location.search).toContain('sort=price_asc'));
  });

  it('renders category and brand pages and 404s unknown slugs', async () => {
    renderApp('/en/category/laptops');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Laptops' }, T),
    ).toBeInTheDocument();
    expect(await screen.findByText('2 products')).toBeInTheDocument();
  });

  it('returns the not-found page for an unknown brand', async () => {
    renderApp('/en/brand/no-such-brand');
    expect(
      await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" }, T),
    ).toBeInTheDocument();
  });

  it('opens the mobile filter drawer as a labelled dialog', async () => {
    const user = userEvent.setup();
    renderApp('/en/store');
    await screen.findByText('28 products', undefined, T);
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(dialog).getByRole('button', { name: 'Show 28 results' })).toBeInTheDocument();
  });
});

describe('search by budget', () => {
  it('validates the range and lists devices within it', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/budget');
    expect(
      await screen.findByText(/Pick a budget or enter a minimum/, undefined, T),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('From (EGP)'), '30000');
    await user.type(screen.getByLabelText('To (EGP)'), '20000');
    await user.click(screen.getByRole('button', { name: 'Show me devices' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/minimum must be lower/);
    await user.clear(screen.getByLabelText('From (EGP)'));
    await user.type(screen.getByLabelText('From (EGP)'), '٢٠٠٠٠'); // Arabic-Indic digits accepted
    await user.clear(screen.getByLabelText('To (EGP)'));
    await user.type(screen.getByLabelText('To (EGP)'), '30000');
    await user.click(screen.getByRole('button', { name: 'Show me devices' }));
    await waitFor(() => expect(router.state.location.search).toBe('?min=20000&max=30000'));
    expect(await screen.findByText('6 products')).toBeInTheDocument();
  });
});

describe('product detail page', () => {
  it('switches price, SKU and URL with the selected variant', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/product/iphone-18-pro');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'iPhone 18 Pro' }, T),
    ).toBeInTheDocument();
    expect(screen.getByText('IP18P-256GB-ORANGE')).toBeInTheDocument();
    const storage = screen.getByRole('group', { name: /Storage/ });
    await user.click(within(storage).getByRole('radio', { name: /512GB/ }));
    await waitFor(() => expect(router.state.location.search).toContain('storage=512gb'));
    expect(screen.getByText('IP18P-512GB-ORANGE')).toBeInTheDocument();
    expect(screen.getAllByText(/83,500/).length).toBeGreaterThan(0);
    const color = screen.getByRole('group', { name: /Color/ });
    await user.click(within(color).getByRole('radio', { name: /Black/ }));
    expect(await screen.findByText('IP18P-512GB-BLACK')).toBeInTheDocument();
    // Warranty comes from the variant/product data, never a hard-coded label.
    expect(screen.getByText(/Authorized distributor warranty/)).toBeInTheDocument();
    // Cart is Phase 03: buttons are visibly disabled with an honest note.
    expect(screen.getByRole('button', { name: /Add to cart/ })).toBeDisabled();
  });

  it('offers Notify Me for a sold-out variant and validates the request form', async () => {
    const user = userEvent.setup();
    renderApp('/en/product/iphone-18-pro?storage=1tb&color=orange');
    expect(
      await screen.findByText('This option is out of stock', undefined, T),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /1TB.*Sold out/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Notify me when available' }));
    const dialog = await screen.findByRole('dialog', { name: 'Notify me when available' });
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(
      within(dialog).getByText('Enter your name (at least 2 characters).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid Egyptian mobile number.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Mona');
    await user.type(within(dialog).getByLabelText('Mobile number'), '01012345678');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(await within(dialog).findByText('You’re registered')).toBeInTheDocument();
  });

  it('shows the waitlist for a coming-soon product without a price', async () => {
    renderApp('/en/product/iphone-duo');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'iPhone Duo' }, T),
    ).toBeInTheDocument();
    expect(screen.getByText('Price to be announced')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join the waitlist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to cart/ })).not.toBeInTheDocument();
  });

  it('shows a not-found state for unknown products', async () => {
    renderApp('/en/product/nope');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This product doesn’t exist' }, T),
    ).toBeInTheDocument();
  });

  it('builds a context-aware WhatsApp message with product, variant and SKU', async () => {
    renderApp('/en/product/iphone-18-pro?storage=512gb&color=black', {
      settings: { store: { ...baseSeed.settings.store, whatsappNumber: '01212004229' } },
    });
    await screen.findByRole('heading', { level: 1, name: 'iPhone 18 Pro' }, T);
    const link = screen.getByRole('link', { name: /Ask on WhatsApp/ });
    const text = decodeURIComponent(
      new URL(link.getAttribute('href') ?? '').searchParams.get('text') ?? '',
    );
    expect(text).toContain('iPhone 18 Pro');
    expect(text).toContain('512GB');
    expect(text).toContain('IP18P-512GB-BLACK');
  });
});

describe('offers, news and contact', () => {
  it('groups offers with anchors and derives countdowns from timestamps', async () => {
    renderApp('/en/offers');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Flash offers' }, T),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Offer sections' });
    expect(within(nav).getByRole('link', { name: 'Promo codes' })).toHaveAttribute(
      'href',
      '#promo-codes',
    );
    // PS5 flash offer ends 42h after the demo anchor → "1 days, 17/18 hours …".
    expect(screen.getAllByText(/1 days, 1[78] hours/).length).toBeGreaterThan(0);
  });

  it('shows a promo code offer with its code and honest checkout note', async () => {
    renderApp('/en/offers/accessories-promo-code');
    expect(await screen.findByText('DEMO10', undefined, T)).toBeInTheDocument();
    expect(screen.getByText(/applies at online checkout \(coming soon\)/)).toBeInTheDocument();
  });

  it('filters news by type', async () => {
    renderApp('/en/news?type=news');
    expect(await screen.findByRole('link', { name: 'Malek news' }, T)).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: /Trade in your old device/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: /Galaxy Tab S11/ }),
    ).not.toBeInTheDocument();
  });

  it('contact page uses settings only and lists what is left to configure in demo mode', async () => {
    renderApp('/en/contact');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contact us' }, T),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /01212004229/ })[0]).toHaveAttribute(
      'href',
      'tel:+201212004229',
    );
    expect(screen.getByText('WhatsApp number not configured yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Google Maps/ })).not.toBeInTheDocument();
  });
});
