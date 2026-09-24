import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

async function previewAs(role: string, path = '/admin') {
  const user = userEvent.setup();
  const view = renderApp(path);
  await user.selectOptions(await screen.findByLabelText('الدور'), role);
  await user.click(screen.getByRole('button', { name: 'معاينة بهذا الدور' }));
  return { ...view, user };
}

describe('admin shell', () => {
  it('requires sign-in (never public)', async () => {
    const { router } = renderApp('/admin/orders');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/sign-in'));
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Forders');
    expect(await screen.findByText('معاينة لوحة التحكم (وضع تجريبي)')).toBeInTheDocument();
  });

  it('owner sees every module, the dashboard status cards and the role matrix', async () => {
    const { user } = await previewAs('owner');
    expect(await screen.findByRole('heading', { level: 1, name: /أهلًا/ })).toBeInTheDocument();
    expect(screen.getByText('تجريبي')).toBeInTheDocument();
    expect(screen.getByText('غير متصل (وضع تجريبي)')).toBeInTheDocument();
    expect(screen.getByText('رقم واتساب للتواصل')).toBeInTheDocument();

    const sidebar = screen.getAllByRole('navigation', {
      name: 'أقسام لوحة التحكم',
    })[0] as HTMLElement;
    expect(within(sidebar).getByRole('link', { name: /التكاملات والخدمات/ })).toBeInTheDocument();
    await user.click(within(sidebar).getByRole('link', { name: /الأدوار والصلاحيات/ }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /محرر التصميم/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /تأكيد استلام المدفوعات/ })).toBeInTheDocument();
  });

  it('sales only sees modules its permissions allow, and is blocked from others', async () => {
    const { router } = await previewAs('sales');
    const sidebar = (
      await screen.findAllByRole('navigation', { name: 'أقسام لوحة التحكم' })
    )[0] as HTMLElement;
    expect(within(sidebar).getByRole('link', { name: /الطلبات/ })).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('link', { name: /الأدوار والصلاحيات/ }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: /التكاملات/ })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: /المخزون/ })).not.toBeInTheDocument();

    await router.navigate('/admin/access/roles');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeInTheDocument();
    await router.navigate('/admin/integrations');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeInTheDocument();
  });

  it('planned modules say which phase delivers them', async () => {
    await previewAs('store_manager', '/admin/orders');
    expect(await screen.findByRole('heading', { level: 1, name: 'الطلبات' })).toBeInTheDocument();
    expect(screen.getByText('هذا القسم مجدول للمرحلة 03')).toBeInTheDocument();
  });

  it('store details page is read-only and shows the published values', async () => {
    await previewAs('store_manager', '/admin/settings/store');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'بيانات المتجر' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/العرض الحالي للقراءة فقط/)).toBeInTheDocument();
    expect(screen.getAllByText('غير مُعد').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('each admin user switches the dashboard language independently of the storefront', async () => {
    const { user } = await previewAs('owner');
    await screen.findByRole('heading', { level: 1, name: /أهلًا/ });
    await user.click(screen.getByRole('button', { name: 'Switch dashboard to English' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Welcome/ })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(window.localStorage.getItem('malek:v1:admin-locale:demo-owner')).toBe('"en"');
  });

  it('signed-in customers without a staff role are denied', async () => {
    const user = userEvent.setup();
    renderApp('/admin/sign-in');
    await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'shopper@example.com');
    await user.click(screen.getByRole('button', { name: 'ابعت كود الدخول' }));
    await user.type(await screen.findByLabelText('كود التأكيد'), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد ودخول' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية الدخول' }),
    ).toBeInTheDocument();
  });
});
