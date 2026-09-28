import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

async function previewAs(role: string, path: string) {
  const user = userEvent.setup();
  const view = renderApp(path);
  await user.selectOptions(await screen.findByLabelText('الدور'), role);
  await user.click(screen.getByRole('button', { name: 'معاينة بهذا الدور' }));
  return { ...view, user };
}

/** Every Phase 06 module screen renders its heading for the owner (no crash, no error boundary). */
const PAGES: [string, string][] = [
  ['/admin/products', 'المنتجات'],
  ['/admin/products/new', 'منتج جديد'],
  ['/admin/categories', 'الأقسام'],
  ['/admin/brands', 'العلامات التجارية'],
  ['/admin/inventory', 'المخزون'],
  ['/admin/offers', 'العروض وأكواد الخصم'],
  ['/admin/offers/new', 'عرض جديد'],
  ['/admin/news', 'الأخبار والإصدارات'],
  ['/admin/news/new', 'خبر جديد'],
  ['/admin/page-content', 'محتوى الصفحات'],
  ['/admin/customers', 'العملاء'],
  ['/admin/waitlists', 'قوائم الانتظار'],
  ['/admin/notifications', 'الإشعارات'],
  ['/admin/settings', 'إعدادات الموقع'],
  ['/admin/settings/commerce', 'الدفع وقواعد الطلب'],
  ['/admin/settings/store', 'بيانات المتجر والفروع'],
  ['/admin/settings/loyalty', 'برنامج الولاء (أساس)'],
  ['/admin/settings/repair_catalog', 'دليل الصيانة'],
  ['/admin/shipping', 'الشحن والاستلام'],
  ['/admin/receipts', 'الإيصالات والفواتير'],
  ['/admin/legal', 'السياسات والشروط'],
  ['/admin/analytics', 'التحليلات'],
  ['/admin/import-export', 'الاستيراد والتصدير'],
  ['/admin/backups', 'النسخ الاحتياطي'],
  ['/admin/demo-data', 'البيانات التجريبية'],
  ['/admin/access/roles', 'الأدوار والصلاحيات'],
  ['/admin/access/users', 'فريق العمل'],
  ['/admin/audit-log', 'سجل التدقيق'],
];

describe('Phase 06 admin modules', () => {
  it('render for the owner', async () => {
    const { router } = await previewAs('owner', '/admin');
    await screen.findByRole('heading', { level: 1, name: /أهلًا/ });
    for (const [path, name] of PAGES) {
      await router.navigate(path);
      await waitFor(
        () => expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument(),
        { timeout: 8000 },
      );
      expect(screen.queryByText(/حدث خطأ غير متوقع/)).not.toBeInTheDocument();
    }
  }, 120_000);
});
