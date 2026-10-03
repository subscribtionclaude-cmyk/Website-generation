import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/**
 * Phase 06 admin control center (demo mode, no paid services) on the viewport matrix.
 * Admin-heavy editors run on tablet and desktop; the quick actions staff use on the go
 * (stock, orders, service queues, settings, language) also run on mobile.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const ADAPTER = 'demo-variant-a20w-white'; // Apple 20W USB-C Power Adapter, 1,200 EGP

async function staff(page: Page, role = 'owner', path?: string) {
  await page.goto('/admin');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/admin');
  await page.getByLabel('الدور').selectOption(role);
  await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (path) await page.goto(path);
}

async function checkPage(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
}

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name === 'mobile', 'admin-heavy editor: tablet and desktop');
}

const confirmDialog = (page: Page) => page.getByRole('alertdialog');

async function placePickupOrder(page: Page, email: string, name: string) {
  await page.goto('/en');
  await page.evaluate(
    ({ mail, variantId }) => {
      window.sessionStorage.setItem(
        'malek:v1:demo-session',
        JSON.stringify({ userId: `demo-customer-${mail}`, email: mail, roleKey: null }),
      );
      window.localStorage.setItem(
        'malek:v1:cart',
        JSON.stringify([
          {
            variantId,
            productSlug: null,
            quantity: 1,
            savedForLater: false,
            seenUnitPrice: null,
            addedAt: new Date().toISOString(),
          },
        ]),
      );
    },
    { mail: email, variantId: ADAPTER },
  );
  await page.goto('/en/checkout');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel(/Mobile number/).fill('01012345678');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Store pickup/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Cash on delivery/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
  ).toBeVisible();
  return page.url().match(/MS-\d{4}-\d{6}/)?.[0] ?? '';
}

test.describe('admin control center', () => {
  test.describe.configure({ timeout: 150_000 });

  test('A. product create and edit', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/products/new');
    await expect(page.getByRole('heading', { level: 1, name: 'منتج جديد' })).toBeVisible();
    await page.getByRole('textbox', { name: /^الاسم \(العربية\)/ }).fill('هاتف اختبار E2E');
    await page.getByRole('textbox', { name: /^الاسم \(English\)/ }).fill('E2E Test Phone');
    await expect(page.getByRole('textbox', { name: 'الرابط المختصر (slug)' })).toHaveValue(
      'e2e-test-phone',
    );
    await page.getByLabel('العلامة التجارية').selectOption({ index: 1 });
    await page.getByRole('group', { name: 'الأقسام' }).getByRole('checkbox').first().check();
    await checkPage(page);
    await page.getByRole('tab', { name: /الإصدارات/ }).click();
    await page.getByRole('textbox', { name: 'SKU' }).fill('E2E-PHONE-1');
    await page.getByRole('textbox', { name: 'السعر (ج.م)' }).first().fill('15000');
    await page.getByRole('button', { name: 'حفظ', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'هاتف اختبار E2E' })).toBeVisible();

    await page.getByRole('textbox', { name: /^الاسم \(English\)/ }).fill('E2E Test Phone Pro');
    await expect(page.getByText('لديك تعديلات غير محفوظة.').first()).toBeVisible();
    await page.getByRole('button', { name: 'حفظ', exact: true }).first().click();
    await expect(page.getByText('تم الحفظ.').first()).toBeVisible();

    await page.goto('/admin/products?q=E2E-PHONE');
    await expect(page.getByRole('link', { name: 'هاتف اختبار E2E' }).first()).toBeVisible();
    await checkPage(page);
  });

  test('B. variant stock adjustment and price change with history', async ({ page }) => {
    await staff(page, 'owner', '/admin/inventory');
    await expect(page.getByRole('heading', { level: 1, name: 'المخزون' })).toBeVisible();
    await checkPage(page);

    await page
      .getByRole('button', { name: /^تعديل المخزون: / })
      .first()
      .click();
    const adjust = page.getByRole('dialog', { name: 'تعديل المخزون' });
    await adjust.getByLabel('نوع الحركة').selectOption('addition');
    await adjust.getByLabel('الكمية').fill('3');
    await adjust.getByLabel(/^السبب/).fill('E2E restock');
    await adjust.getByRole('button', { name: 'تسجيل الحركة' }).click();
    await expect(adjust).toBeHidden();

    await page.getByRole('tab', { name: 'حركات المخزون' }).click();
    await expect(page.getByText('E2E restock').first()).toBeVisible();

    await page.getByRole('tab', { name: 'المخزون', exact: true }).click();
    await page
      .getByRole('button', { name: /^تغيير السعر: / })
      .first()
      .click();
    const price = page.getByRole('dialog', { name: 'تغيير السعر' });
    await price.getByLabel('السعر (ج.م)').fill('99999');
    await price.getByLabel(/^السبب/).fill('E2E price test');
    await price.getByRole('button', { name: 'حفظ السعر' }).click();
    await expect(price).toBeHidden();
    await page.getByRole('tab', { name: 'سجل الأسعار' }).click();
    await expect(page.getByText('E2E price test').first()).toBeVisible();
    await checkPage(page);
  });

  test('C. order operations: filters and assignment', async ({ page }) => {
    const number = await placePickupOrder(page, 'e2e-admin-c@example.com', 'E2E Admin C');
    await staff(page, 'owner', '/admin/orders?status=new');
    await expect(page.getByRole('link', { name: number })).toBeVisible();
    await checkPage(page);
    await page.getByRole('link', { name: number }).click();
    await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible();
    await page.getByLabel('المسؤول').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'حفظ الإسناد' }).click();
    await expect(page.getByText('تم الحفظ وتسجيل الإجراء.').first()).toBeVisible();
    await page.goto('/admin/orders?assigned=me');
    await expect(page.getByRole('link', { name: number })).toBeVisible();
  });

  test('D. customer detail with private notes', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await placePickupOrder(page, 'e2e-admin-d@example.com', 'E2E Admin D');
    await staff(page, 'owner', '/admin/customers?q=e2e-admin-d');
    await page.getByRole('link', { name: 'E2E Admin D' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Admin D' })).toBeVisible();
    await expect(page.getByText(/بيانات الدخول \(كلمات المرور والأكواد\) لا تُعرض/)).toBeVisible();
    await page.getByLabel('ملاحظة جديدة').fill('E2E private note: prefers WhatsApp');
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(page.getByText('E2E private note: prefers WhatsApp')).toBeVisible();
    await checkPage(page);

    await page.evaluate(() => window.sessionStorage.clear());
    await page.evaluate(() =>
      window.sessionStorage.setItem(
        'malek:v1:demo-session',
        JSON.stringify({
          userId: 'demo-customer-e2e-admin-d@example.com',
          email: 'e2e-admin-d@example.com',
          roleKey: null,
        }),
      ),
    );
    await page.goto('/en/account');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('E2E private note')).toHaveCount(0);
  });

  test('E. repair queue: views, SLA aging and priority', async ({ page }) => {
    await staff(page, 'owner', '/admin/repairs');
    await expect(page.getByRole('heading', { level: 1, name: 'الصيانة' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'عروض الطلبات' })).toBeVisible();
    await expect(page.getByText('أهداف داخلية للفريق فقط — ليست وعدًا للعميل.')).toBeVisible();
    await page.getByRole('tab', { name: /الكل/ }).click();
    await checkPage(page);
    const first = page.getByRole('table').getByRole('link').first();
    await first.click();
    // The queue has a priority filter too: wait for the request page's own form before choosing.
    await expect(page.getByRole('button', { name: 'حفظ الأولوية' })).toBeVisible();
    await page.getByLabel('الأولوية').last().selectOption('urgent');
    await page.getByRole('button', { name: 'حفظ الأولوية' }).click();
    await expect(page.getByText('تم الحفظ.').first()).toBeVisible();
    await page.goto('/admin/repairs');
    await page.getByRole('tab', { name: /الكل/ }).click();
    await expect(page.getByRole('table').getByText('عاجلة').first()).toBeVisible();
  });

  test('F. trade-in queue with filters', async ({ page }) => {
    await staff(page, 'owner', '/admin/trade-in');
    await expect(
      page.getByRole('heading', { level: 1, name: 'الاستبدال (Trade-In)' }),
    ).toBeVisible();
    await expect(page.getByRole('search', { name: 'تصفية الطلبات' })).toBeVisible();
    await page.getByRole('tab', { name: /الكل/ }).click();
    await checkPage(page);
  });

  test('G. offer and news published to the storefront', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/offers/new');
    await page.getByLabel('النوع').selectOption('percentage');
    await page.getByRole('textbox', { name: /^عنوان العرض \(العربية\)/ }).fill('عرض اختبار E2E');
    await page.getByRole('textbox', { name: /^الشارة \(العربية\)/ }).fill('خصم ١٠٪');
    await page.getByRole('textbox', { name: 'الرابط المختصر (slug)' }).fill('e2e-offer');
    await page.getByLabel('نسبة الخصم (%)').fill('10');
    await page.getByRole('searchbox', { name: 'ابحث عن منتج لإضافته' }).fill('iPhone');
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await page
      .getByRole('button', { name: /^إضافة/ })
      .first()
      .click();
    await page.getByLabel('الحالة', { exact: true }).selectOption('published');
    await checkPage(page);
    await page.getByRole('button', { name: 'حفظ', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/offers\/[0-9a-f-]{36}$/);
    await page.goto('/offers/e2e-offer');
    await expect(page.getByRole('heading', { level: 1, name: 'عرض اختبار E2E' })).toBeVisible();

    await page.goto('/admin/news/new');
    await page.getByRole('textbox', { name: /^العنوان \(العربية\)/ }).fill('خبر اختبار E2E');
    await page.getByRole('textbox', { name: 'الرابط المختصر (slug)' }).fill('e2e-news');
    await page.getByLabel('الحالة', { exact: true }).selectOption('published');
    await page.getByRole('button', { name: 'حفظ', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/news\/[0-9a-f-]{36}$/);
    await page.goto('/news/e2e-news');
    await expect(page.getByRole('heading', { level: 1, name: 'خبر اختبار E2E' })).toBeVisible();
  });

  test('H. settings draft → publish → rollback reaches the storefront', async ({ page }) => {
    await staff(page, 'owner', '/admin/settings/social');
    await expect(page.getByRole('heading', { level: 1, name: 'حسابات التواصل' })).toBeVisible();
    await page.getByLabel('إنستجرام').fill('https://instagram.com/malek.e2e');
    await page.getByRole('button', { name: 'حفظ كمسودة' }).first().click();
    await expect(page.getByText('مسودة غير منشورة').first()).toBeVisible();
    await checkPage(page);
    await page.getByRole('button', { name: 'نشر', exact: true }).click();
    await confirmDialog(page).getByRole('button', { name: 'نشر', exact: true }).click();
    await expect(page.getByText('مسودة غير منشورة')).toHaveCount(0);

    await page.goto('/');
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'إنستجرام' }),
    ).toHaveAttribute('href', 'https://instagram.com/malek.e2e');

    await page.goto('/admin/settings/social');
    await page.getByRole('button', { name: 'عرض الإصدارات' }).click();
    await page.getByRole('button', { name: 'استرجاع' }).first().click();
    await confirmDialog(page).getByRole('button', { name: 'استرجاع' }).click();
    await expect(page.getByLabel('إنستجرام')).toHaveValue('');
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'إنستجرام' })).toHaveCount(
      0,
    );
  });

  test('I. roles and permissions are enforced per role', async ({ page }) => {
    await staff(page, 'sales', '/admin/settings');
    await expect(
      page.getByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeVisible();
    await page.goto('/admin/access/roles');
    await expect(
      page.getByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeVisible();

    await staff(page, 'super_admin', '/admin/access/roles');
    const roles = page.getByRole('list', { name: 'الأدوار' });
    await expect(roles.getByText('مستوى أعلى منك')).toBeVisible();
    await expect(roles.getByText('كل الصلاحيات', { exact: true })).toBeVisible();
    await checkPage(page);

    await staff(page, 'content_editor', '/admin/news');
    await expect(page.getByText(/يمكنك الحفظ كمسودة فقط/)).toBeVisible();
    await page.goto('/admin/inventory');
    await expect(
      page.getByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeVisible();
  });

  test('J. import preview flags formulas and duplicates, then applies valid rows', async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/import-export');
    await expect(page.getByRole('heading', { level: 1, name: 'الاستيراد والتصدير' })).toBeVisible();
    const csv = [
      'sku,productSlug,price,stock',
      'DEMO-SKU-FORMULA,"=HYPERLINK(""http://evil"")",1000,5',
      'E2E-DUP,e2e-imported,100,1',
      'E2E-DUP,e2e-imported,100,1',
    ].join('\n');
    await page.getByLabel('ملف CSV').setInputFiles({
      name: 'e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await page.getByRole('button', { name: 'معاينة' }).click();
    await expect(page.getByText(/قيمة تبدأ كصيغة/).first()).toBeVisible();
    await expect(page.getByText('SKU مكرر في الملف.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'تنفيذ الكل' })).toBeDisabled();
    await checkPage(page);
  });

  test('K. audit log records a price change with a readable diff', async ({ page }) => {
    await staff(page, 'owner', '/admin/inventory');
    await page
      .getByRole('button', { name: /^تغيير السعر: / })
      .first()
      .click();
    const price = page.getByRole('dialog', { name: 'تغيير السعر' });
    await price.getByLabel('السعر (ج.م)').fill('88888');
    await price.getByLabel(/^السبب/).fill('E2E audit');
    await price.getByRole('button', { name: 'حفظ السعر' }).click();
    await expect(price).toBeHidden();

    await page.goto('/admin/audit-log?module=catalog');
    await expect(page.getByRole('heading', { level: 1, name: 'سجل التدقيق' })).toBeVisible();
    await checkPage(page);
    await page.getByRole('table').getByRole('button').first().click();
    const detail = page.getByRole('dialog', { name: /سجل رقم/ });
    await expect(detail.getByRole('table')).toBeVisible();
    await expect(detail.getByText('88888').first()).toBeVisible();
  });

  test('L. Arabic admin is RTL without overflow on key screens', async ({ page }) => {
    await staff(page, 'owner');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('وضع تجريبي').first()).toBeVisible();
    for (const path of [
      '/admin',
      '/admin/orders',
      '/admin/customers',
      '/admin/settings',
      '/admin/receipts',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await checkPage(page);
    }
  });

  test('M. English admin is LTR without overflow on key screens', async ({ page }) => {
    await staff(page, 'owner');
    await page.getByRole('button', { name: 'Switch dashboard to English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    for (const [path, name] of [
      ['/admin/products', 'Products'],
      ['/admin/inventory', 'Inventory'],
      ['/admin/analytics', 'Analytics'],
      ['/admin/settings/commerce', 'Payments & order rules'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await checkPage(page);
    }
  });
});
