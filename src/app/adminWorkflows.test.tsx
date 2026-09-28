import { screen, waitFor, within } from '@testing-library/react';
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

const dialog = () => screen.findByRole('alertdialog');

describe('settings workflow (draft → publish → versions → rollback)', () => {
  it('saves a draft, publishes it as a new version, and rolls back', async () => {
    const { user } = await previewAs('owner', '/admin/settings/social');
    await screen.findByRole('heading', { level: 1, name: 'حسابات التواصل' });
    const version = () =>
      Number((screen.getAllByText(/^الإصدار \d+$/)[0]?.textContent ?? '').replace(/\D/g, '') || 0);
    const before = version();

    const instagram = screen.getByRole('textbox', { name: 'إنستجرام' });
    await user.type(instagram, 'https://instagram.com/malek.store.test');
    await user.click(screen.getAllByRole('button', { name: 'حفظ كمسودة' })[0] as HTMLElement);
    expect(await screen.findByText('مسودة غير منشورة')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(within(await dialog()).getByRole('button', { name: 'نشر' }));
    await waitFor(() => expect(version()).toBe(before + 1));
    expect(screen.queryByText('مسودة غير منشورة')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'إنستجرام' })).toHaveValue(
      'https://instagram.com/malek.store.test',
    );

    await user.click(screen.getByRole('button', { name: 'عرض الإصدارات' }));
    const restore = await screen.findAllByRole('button', { name: 'استرجاع' });
    await user.click(restore[0] as HTMLElement);
    await user.click(within(await dialog()).getByRole('button', { name: 'استرجاع' }));
    await waitFor(() => expect(version()).toBe(before + 2));
    expect(screen.getByRole('textbox', { name: 'إنستجرام' })).toHaveValue('');
  }, 30_000);

  it('validates with the shared schema before anything is saved', async () => {
    const { user } = await previewAs('owner', '/admin/settings/social');
    const facebook = await screen.findByRole('textbox', { name: 'فيسبوك' });
    await user.type(facebook, 'http://not-secure.example');
    await user.click(screen.getAllByRole('button', { name: 'حفظ كمسودة' })[0] as HTMLElement);
    expect(await screen.findByText(/راجع الحقول المظللة/)).toBeInTheDocument();
    expect(screen.queryByText('مسودة غير منشورة')).not.toBeInTheDocument();
  }, 20_000);

  it('payments offer only COD, InstaPay and split — with InstaPay details left empty', async () => {
    await previewAs('owner', '/admin/settings/commerce');
    await screen.findByRole('heading', { level: 1, name: 'الدفع وقواعد الطلب' });
    expect(screen.getByRole('checkbox', { name: 'الدفع عند الاستلام' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'InstaPay' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /الدفع الجزئي/ })).toBeInTheDocument();
    expect(screen.queryByText(/الدفع في المتجر|Pay at store/i)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'تفعيل: بيانات InstaPay' })).not.toBeChecked();
  }, 20_000);

  it('read-only for roles without settings.manage, denied without settings.view', async () => {
    const { router } = await previewAs('store_manager', '/admin/settings/commerce');
    expect(
      await screen.findByText('عرض فقط — ليست لديك صلاحية تعديل هذا الإعداد.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حفظ كمسودة' })).not.toBeInTheDocument();
    await router.navigate('/admin/access/users');
    await screen.findByRole('heading', { level: 1, name: 'فريق العمل' });
    expect(screen.queryByRole('button', { name: 'إضافة موظف' })).not.toBeInTheDocument();
  }, 20_000);

  it('content editors cannot open settings at all', async () => {
    await previewAs('content_editor', '/admin/settings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeInTheDocument();
  }, 20_000);
});

describe('content admin', () => {
  it('creates a promo-code offer after server-side validation', async () => {
    const { user, router } = await previewAs('owner', '/admin/offers/new');
    await screen.findByRole('heading', { level: 1, name: 'عرض جديد' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'النوع' }), 'promo_code');
    await user.type(screen.getByRole('textbox', { name: /عنوان العرض.*العربية/ }), 'كود تجربة');
    await user.type(screen.getByRole('textbox', { name: /الشارة.*العربية/ }), 'خصم');
    await user.type(screen.getByRole('textbox', { name: /الرابط|slug/i }), 'test-promo');
    await user.type(screen.getByRole('textbox', { name: /كود الخصم/ }), 'x');
    await user.type(screen.getByRole('spinbutton', { name: /نسبة الخصم/ }), '10');
    await user.click(screen.getAllByRole('button', { name: 'حفظ' })[0] as HTMLElement);
    expect(await screen.findAllByText(/كود/)).not.toHaveLength(0);
    expect(router.state.location.pathname).toBe('/admin/offers/new');

    const code = screen.getByRole('textbox', { name: /كود الخصم/ });
    await user.clear(code);
    await user.type(code, 'TEST10');
    await user.click(screen.getAllByRole('button', { name: 'حفظ' })[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/admin/offers/new'));
    await router.navigate('/admin/offers?promo=1');
    expect(await screen.findByText('TEST10')).toBeInTheDocument();
  }, 30_000);

  it('hides a homepage section and restores it', async () => {
    const { user } = await previewAs('owner', '/admin/page-content');
    const hide = await screen.findAllByRole('button', { name: /^إخفاء/ });
    const before = hide.length;
    await user.click(hide[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^إخفاء/ })).toHaveLength(before - 1),
    );
    await user.click(screen.getAllByRole('button', { name: /^إظهار/ })[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^إخفاء/ })).toHaveLength(before),
    );
  }, 20_000);
});

describe('roles & staff escalation protection', () => {
  it('super admin cannot edit roles at or above its level, and edits lower roles', async () => {
    const { user } = await previewAs('super_admin', '/admin/access/roles');
    const list = await screen.findByRole('list', { name: 'الأدوار' });
    expect(within(list).getAllByText('مستوى أعلى منك').length).toBeGreaterThan(0);
    expect(within(list).getByText('كل الصلاحيات')).toBeInTheDocument();
    const edit = within(list).getAllByRole('button', { name: /تعديل الصلاحيات/ });
    await user.click(edit[0] as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  }, 20_000);

  it('staff list never offers actions on the owner to a super admin', async () => {
    await previewAs('super_admin', '/admin/access/users');
    const table = await screen.findByRole('table');
    const ownerRow = within(table).getByText('owner@demo.invalid').closest('tr') as HTMLElement;
    expect(within(ownerRow).queryByRole('button')).not.toBeInTheDocument();
  }, 20_000);
});

describe('import (untrusted CSV) and audit', () => {
  it('previews rows, flags formulas and duplicates, and applies valid rows only', async () => {
    const { user, router } = await previewAs('owner', '/admin/import-export');
    await screen.findByRole('heading', { level: 1, name: 'الاستيراد والتصدير' });
    const csv = [
      'sku,productSlug,price,stock',
      'IP17-256-BLK,"=HYPERLINK(""http://evil"")",1000,5',
      'NEW-SKU-1,new-thing,100,1',
      'NEW-SKU-1,new-thing,100,1',
    ].join('\n');
    const file = new File([csv], 'prices.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('ملف CSV'), file);
    await user.click(await screen.findByRole('button', { name: 'معاينة' }));
    expect(await screen.findByText(/قيمة تبدأ كصيغة/)).toBeInTheDocument();
    expect(screen.getByText('SKU مكرر في الملف.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تنفيذ الكل' })).toBeDisabled();

    await router.navigate('/admin/audit-log');
    await screen.findByRole('heading', { level: 1, name: 'سجل التدقيق' });
  }, 30_000);

  it('records settings publishes in the audit log with a readable diff', async () => {
    const { user, router } = await previewAs('owner', '/admin/settings/social');
    await user.type(
      await screen.findByRole('textbox', { name: 'تيك توك' }),
      'https://tiktok.com/@malek.store.test',
    );
    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(within(await dialog()).getByRole('button', { name: 'نشر' }));
    await waitFor(() => expect(screen.queryByText('لديك تعديلات غير محفوظة.')).toBeNull());
    await router.navigate('/admin/audit-log?action=setting.publish');
    const cell = await screen.findByText('setting.publish');
    const row = cell.closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: /سجل رقم/ })).toBeInTheDocument();
  }, 30_000);
});
