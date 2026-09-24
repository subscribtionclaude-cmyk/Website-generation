import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

describe('storefront shell', () => {
  it('renders Arabic RTL by default with settings-driven content and no login', async () => {
    renderApp('/');
    // Phase 02: the home is CMS-driven; its first section is the launch hero campaign (h1).
    expect(
      await screen.findByRole('heading', { level: 1, name: /iPhone 18 Pro/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar-EG');

    const nav = screen.getAllByRole('navigation', { name: 'التنقل الرئيسي' })[0];
    expect(nav).toBeDefined();
    const labels = within(nav as HTMLElement)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual([
      'الرئيسية',
      'Apple',
      'المتجر',
      'العروض',
      'الجديد',
      'Trade-In',
      'الصيانة',
      'المستعمل',
      'الأخبار',
      'تواصل معنا',
    ]);

    // Store details come from settings (footer + branch section), with tel: links.
    const callLinks = screen.getAllByRole('link', { name: /01212004229/ });
    expect(callLinks[0]).toHaveAttribute('href', 'tel:+201212004229');
    expect(screen.getAllByText('أمام مترو عبده باشا').length).toBeGreaterThan(0);
    expect(screen.getByText('وضع العرض التجريبي')).toBeInTheDocument();
  });

  it('serves English LTR under /en and switches language on the same page', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en');
    expect(
      await screen.findByRole('heading', { level: 1, name: /iPhone 18 Pro/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute(
      'href',
      '/en/product/iphone-18-pro',
    );

    await user.click(
      screen.getAllByRole('link', { name: 'التبديل إلى العربية' })[0] as HTMLElement,
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
  });

  it('keeps the visitor on the same section when switching language', async () => {
    renderApp('/en/trade-in');
    expect(await screen.findByRole('heading', { level: 1, name: 'Trade-In' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'التبديل إلى العربية' })[0]).toHaveAttribute(
      'href',
      '/trade-in',
    );
  });

  it('shows an honest placeholder for later-phase sections (phase badge only in demo mode)', async () => {
    renderApp('/repairs');
    expect(await screen.findByRole('heading', { level: 1, name: 'الصيانة' })).toBeInTheDocument();
    expect(screen.getAllByText('المرحلة 05').length).toBeGreaterThan(0);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: /تواصل معنا/ })).toHaveAttribute(
      'href',
      'tel:+201212004229',
    );
  });

  it('renders a 404 page with next actions', async () => {
    renderApp('/en/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/en');
  });

  it('never renders a broken WhatsApp link: hidden for customers in live mode when unconfigured', async () => {
    renderApp('/', { mode: 'live' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: /واتساب/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /واتساب/ })).not.toBeInTheDocument();
  });

  it('shows setup guidance instead of a link in demo mode when WhatsApp is unconfigured', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const button = await screen.findByRole('button', { name: 'رقم واتساب غير مُعد بعد' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/لن يظهر زر واتساب للعملاء/)).toBeInTheDocument();
  });

  it('builds a wa.me link once a WhatsApp number is configured', async () => {
    const { default: seed } = await import('@seed/base/site-settings.json');
    renderApp('/', {
      settings: { store: { ...seed.settings.store, whatsappNumber: '01212004229' } },
    });
    const link = await screen.findByRole('link', { name: /كلّمنا على واتساب/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/201212004229\?text=/);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('stays usable with bundled base settings when the backend is unavailable', async () => {
    renderApp('/', { settingsFail: true });
    // One retry happens first (React Query), then the warning appears with bundled base settings.
    expect(
      await screen.findByText(/تعذر تحميل بعض بيانات المتجر/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: /iPhone 18 Pro/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /01212004229/ }).length).toBeGreaterThan(0);
  });
});

describe('customer authentication (demo adapter)', () => {
  it('redirects account pages to sign-in and returns after verification', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/account');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account/sign-in');
    expect(router.state.location.search).toBe('?next=%2Faccount');

    await user.click(screen.getByRole('button', { name: 'ابعت كود الدخول' }));
    expect(await screen.findByText('اكتب بريد إلكتروني صحيح.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'Customer@Example.com');
    await user.click(screen.getByRole('button', { name: 'ابعت كود الدخول' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'راجع بريدك الإلكتروني' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /إعادة الإرسال بعد/ })).toBeDisabled();

    await user.type(screen.getByLabelText('كود التأكيد'), '12');
    await user.click(screen.getByRole('button', { name: 'تأكيد ودخول' }));
    expect(await screen.findByText('الكود يتكون من 6 أرقام.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('كود التأكيد'));
    await user.type(screen.getByLabelText('كود التأكيد'), '١٢٣٤٥٦'); // Arabic-Indic digits accepted
    await user.click(screen.getByRole('button', { name: 'تأكيد ودخول' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'حسابي' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
    expect(screen.getByText(/customer@example.com/)).toBeInTheDocument();
    expect(screen.getByText('لا توجد طلبات حتى الآن.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'لوحة التحكم' })).not.toBeInTheDocument();
  });

  it('rejects open redirects in ?next=', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/account/sign-in?next=//evil.example');
    await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'ابعت كود الدخول' }));
    await user.type(await screen.findByLabelText('كود التأكيد'), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد ودخول' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
  });
});
