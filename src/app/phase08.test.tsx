import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

const T = { timeout: 4000 };

async function previewAs(role: string, path = '/admin') {
  const user = userEvent.setup();
  const view = renderApp(path);
  await user.selectOptions(await screen.findByLabelText('الدور'), role);
  await user.click(screen.getByRole('button', { name: 'معاينة بهذا الدور' }));
  return { ...view, user };
}

describe('Phase 08 accessibility regressions', () => {
  it('the demo banner is a labelled landmark (no content outside landmarks)', async () => {
    renderApp('/en/store');
    const banner = await screen.findByRole('complementary', { name: 'Demo mode' }, T);
    expect(banner).toHaveTextContent('Everything shown is sample data');
  });

  it('the header search and the catalog search are distinct, named search landmarks', async () => {
    renderApp('/en/store');
    await screen.findByRole('search', { name: 'Search products' }, T);
    expect(screen.getByRole('search', { name: 'Search the store' })).toBeInTheDocument();
    const names = screen.getAllByRole('search').map((s) => s.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('performance settings', () => {
  it('reduced motion and campaign effects follow the published performance setting', async () => {
    const { unmount } = renderApp('/en', {
      settings: { performance: { motion: 'reduced', campaignEffects: false } },
    });
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'), T);
    expect(document.documentElement.dataset.campaignEffects).toBe('off');
    unmount();
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(document.documentElement.dataset.campaignEffects).toBeUndefined();
  });

  it('full motion by default', async () => {
    renderApp('/en');
    await screen.findByRole('complementary', { name: 'Demo mode' }, T);
    expect(document.documentElement.dataset.campaignEffects).toBeUndefined();
  });
});

describe('Admin → SEO overview', () => {
  it('content staff see indexing status, page SEO, the shared SEO preview and demo counts', async () => {
    await previewAs('content_editor', '/admin/seo');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'تحسين محركات البحث' }, T),
    ).toBeInTheDocument();
    const checks = await screen.findByTestId('seo-checks', {}, T);
    expect(within(checks).getByText(/نسخة عرض: لا تُؤرشف أبدًا/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /خريطة الموقع \(sitemap.xml\)/ })).toHaveAttribute(
      'href',
      '/sitemap.xml',
    );
    expect(screen.getByRole('table', { name: 'تحسين الظهور للصفحات' })).toBeInTheDocument();
    // The Phase 07 SEO preview, reused (not a second SEO system).
    expect(await screen.findByTestId('seo-serp', {}, T)).toBeInTheDocument();
    expect(screen.getByTestId('seo-urls')).toHaveTextContent('noindex, nofollow');
    expect(screen.getByText(/منتجات: 28/)).toBeInTheDocument();
  });

  it('is refused without content.view', async () => {
    await previewAs('sales', '/admin/seo');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }, T),
    ).toBeInTheDocument();
  });
});

describe('Admin → first-run setup wizard', () => {
  it('is refused without settings.manage', async () => {
    await previewAs('store_manager', '/admin/setup');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }, T),
    ).toBeInTheDocument();
  });

  it('owner walks the four steps, keeps demo data and finishes; audited and remembered', async () => {
    const { user, router } = await previewAs('owner', '/admin');
    expect(await screen.findByText('أكمل إعداد المتجر', {}, T)).toBeInTheDocument();
    await router.navigate('/admin/setup');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'إعداد المتجر' }, T),
    ).toBeInTheDocument();
    const steps = screen.getByRole('navigation', { name: 'خطوات الإعداد' });
    expect(within(steps).getByRole('button', { name: /بيانات المتجر/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(within(steps).getByRole('button', { name: /المراجعة/ })).toBeDisabled();

    // 1 → 2: store details are valid as shipped.
    await user.click(screen.getByRole('button', { name: 'التالي' }));
    const branding = await screen.findByRole('heading', { level: 2, name: 'الهوية والألوان' }, T);
    await waitFor(() => expect(branding).toHaveFocus());
    await user.click(screen.getByRole('radio', { name: /MALEK الأصلي/ }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    // 3: demo decision required before continuing.
    await screen.findByRole('heading', { level: 2, name: 'بيانات العرض' }, T);
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /الإبقاء عليها الآن/ }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    // 4: review → finish.
    await screen.findByRole('heading', { level: 2, name: 'المراجعة' }, T);
    const list = screen.getByTestId('setup-checklist');
    expect(within(list).getByText('قرار بيانات العرض')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'إنهاء الإعداد ونشره' }));
    const dialog = await screen.findByRole('alertdialog', {}, T);
    await user.click(within(dialog).getByRole('button', { name: 'إنهاء الإعداد ونشره' }));
    expect(await screen.findByText('تم إنهاء الإعداد', {}, T)).toBeInTheDocument();

    // Audited as a settings event.
    await router.navigate('/admin/audit-log');
    expect(await screen.findByText('setup.completed', {}, T)).toBeInTheDocument();
  });
});
