import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/**
 * Phase 09 integrations center (demo mode): every provider is a deterministic MOCK — no network,
 * no credentials. Each test starts from a fresh browser (no integration configured).
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.describe.configure({ timeout: 120_000 });

async function staff(page: Page, role: string, path: string) {
  await page.goto('/admin');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/admin');
  await page.getByLabel('الدور').selectOption(role);
  await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto(path);
}

async function checkPage(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
}

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name === 'mobile', 'admin-heavy sync tables: tablet and desktop');
}

/** Configure an integration from its Configuration tab (public settings only). */
async function configure(
  page: Page,
  key: string,
  fields: Record<string, string>,
  options: { provider?: string; scenario?: string; selects?: Record<string, string> } = {},
) {
  await page.goto(`/admin/integrations/${key}?tab=configure`);
  await expect(page.getByRole('tab', { name: 'الإعداد', selected: true })).toBeVisible();
  if (options.provider)
    await page.getByLabel('المزوّد', { exact: true }).selectOption(options.provider);
  if (options.scenario)
    await page.getByLabel('سلوك المحاكاة (العرض فقط)').selectOption(options.scenario);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  for (const [label, value] of Object.entries(options.selects ?? {}))
    await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'حفظ الإعداد' }).click();
  await expect(page.getByText('تم حفظ الإعداد.')).toBeVisible();
}

async function enable(page: Page, key: string, name: string) {
  await page.goto('/admin/integrations');
  const card = page.getByTestId(`integration-card-${key}`);
  await card.getByRole('button', { name: new RegExp(`^تفعيل — ${name}`) }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تفعيل' }).click();
  await expect(card.getByText('تم التفعيل.')).toBeVisible();
}

const WHATSAPP = {
  'معرّف رقم الهاتف (Phone number ID)': '1234567890',
  'إصدار Graph API (مثل v21.0)': 'v21.0',
};
const ODOO = {
  'رابط الخادم (https)': 'https://erp.example.test',
  'اسم قاعدة البيانات': 'malek',
  'اسم المستخدم': 'sync',
};

test.describe('integrations center', () => {
  test('A. opens with the health overview and every optional integration', async ({ page }) => {
    await staff(page, 'owner', '/admin/integrations');
    await expect(page.getByRole('heading', { level: 1, name: 'التكاملات والخدمات' })).toBeVisible();
    await expect(page.getByText(/وضع العرض: كل مزوّد هنا محاكاة/)).toBeVisible();
    const health = page.getByTestId('integrations-health');
    await expect(health).toContainText('يحتاج إعداد');
    await expect(health).toContainText('12');
    await expect(page.locator('[data-testid^="integration-card-"]')).toHaveCount(12);
    await expect(
      page.getByRole('heading', { name: 'مركز المزامنة (ERP / نقاط البيع)' }),
    ).toBeVisible();
    await checkPage(page);
  });

  test('B. an unconfigured integration shows its manual fallback and cannot be tested', async ({
    page,
  }) => {
    await staff(page, 'owner', '/admin/integrations');
    const card = page.getByTestId('integration-card-whatsapp');
    await expect(card.getByText('غير مُعد')).toBeVisible();
    await expect(card.getByText('البديل اليدوي مفعّل')).toBeVisible();
    await expect(card).toContainText(
      'زر واتساب اليدوي (wa.me) بعد تأكيد الطلب يبقى متاحًا دائمًا.',
    );
    await expect(card.getByRole('button', { name: /^اختبار الاتصال/ })).toBeDisabled();
    await expect(card.getByRole('button', { name: /^تفعيل/ })).toBeDisabled();
    await expect(card.getByText('أكمل الإعداد لاختباره أو تفعيله.')).toBeVisible();
    await page.goto('/admin/integrations/whatsapp');
    await expect(page.getByTestId('secret-names')).toContainText('WHATSAPP_ACCESS_TOKEN');
    // Secrets are named, never typed: no password-like inputs anywhere on the page.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await checkPage(page);
  });

  test('C. a mock connection test succeeds and is labelled DEMO / MOCK', async ({ page }) => {
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'whatsapp', WHATSAPP);
    await page.getByRole('tab', { name: 'الاتصال' }).click();
    await page.getByRole('button', { name: 'اختبار الاتصال' }).click();
    await expect(page.getByText('نجح الاختبار (محاكاة — لا يوجد اتصال حقيقي).')).toBeVisible();
    await expect(page.getByTestId('integration-status')).toContainText('تجريبي / MOCK');
    await expect(page.getByRole('table', { name: 'سجل الاختبارات' })).toContainText('متصل');
    await checkPage(page);
  });

  test('D. a mock connection failure is reported safely', async ({ page }) => {
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'whatsapp', WHATSAPP, { scenario: 'auth_failed' });
    await page.goto('/admin/integrations');
    const card = page.getByTestId('integration-card-whatsapp');
    await card.getByRole('button', { name: /^اختبار الاتصال/ }).click();
    await expect(card.getByText(/فشل الاختبار: فشل المصادقة/)).toBeVisible();
    await expect(card.locator('dd').filter({ hasText: /فشل المصادقة — MOCK/ })).toBeVisible();
    await checkPage(page);
  });

  test('E. enable and disable with confirmation; fallback returns when disabled', async ({
    page,
  }) => {
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'whatsapp', WHATSAPP);
    await enable(page, 'whatsapp', 'واتساب');
    const card = page.getByTestId('integration-card-whatsapp');
    await expect(card.getByText('مُعد — لم يُختبر')).toBeVisible();
    await card.getByRole('button', { name: /^اختبار الاتصال/ }).click();
    await expect(card.getByText('متصل', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('البديل اليدوي مفعّل')).toHaveCount(0);
    await card.getByRole('button', { name: /^إيقاف/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('تتوقف الإجراءات التلقائية فورًا');
    await dialog.getByRole('button', { name: 'إيقاف' }).click();
    await expect(card.getByText('تم الإيقاف.')).toBeVisible();
    await expect(card.getByText('متوقف', { exact: true })).toBeVisible();
    await expect(card.getByText('البديل اليدوي مفعّل')).toBeVisible();
    await checkPage(page);
  });

  test('F. permissions: hidden from sales, read-only for customer service', async ({ page }) => {
    await staff(page, 'sales', '/admin/integrations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeVisible();
    await staff(page, 'customer_service', '/admin/integrations');
    await expect(page.getByRole('heading', { level: 1, name: 'التكاملات والخدمات' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^تفعيل/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^اختبار الاتصال/ })).toHaveCount(0);
    await page.goto('/admin/integrations/odoo?tab=configure');
    await expect(page.getByText('تقدر تشوف الإعداد فقط.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'حفظ الإعداد' })).toHaveCount(0);
    await checkPage(page);
  });

  test('G. Odoo dry run previews changes without touching data, then applies', async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'odoo', ODOO, { selects: { الأسعار: 'external_wins' } });
    await page.getByRole('tab', { name: 'المزامنة' }).click();
    await expect(page.getByRole('button', { name: 'مزامنة الآن' })).toBeDisabled();
    await expect(page.getByText('فعّل التكامل لتطبيق المزامنة. التجربة متاحة.')).toBeVisible();
    await page.getByLabel('نوع البيانات').selectOption('prices');
    await page.getByRole('button', { name: 'تجربة (بدون تعديل)' }).click();
    const details = page.getByTestId('sync-details');
    await expect(details).toBeVisible();
    await expect(details.getByText('تحديث', { exact: true }).first()).toBeVisible();
    await expect(details.getByText('مرفوض', { exact: true })).toBeVisible();
    await expect(details.getByText('لا يوجد SKU مطابق')).toBeVisible();
    await expect(details.getByRole('cell').getByText('طُبّق', { exact: true })).toHaveCount(0);
    await checkPage(page);

    await enable(page, 'odoo', 'Odoo');
    await page.goto('/admin/integrations/odoo?tab=sync');
    await page.getByLabel('نوع البيانات').selectOption('prices');
    await page.getByRole('button', { name: 'مزامنة الآن' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'مزامنة الآن' }).click();
    await expect(page.getByText(/انتهت المزامنة/)).toBeVisible();
    await expect(
      page
        .getByTestId('sync-details')
        .getByRole('cell')
        .getByText('طُبّق', { exact: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('table', { name: 'آخر عمليات المزامنة' })).toContainText('تطبيق');
  });

  test('H. conflicts are listed for review, never applied', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'odoo', ODOO, { selects: { الأسعار: 'external' } });
    await page.getByRole('tab', { name: 'المزامنة' }).click();
    await page.getByLabel('نوع البيانات').selectOption('prices');
    await expect(
      page.getByText('مصدر البيانات الأساسي: النظام الخارجي مع مراجعة التعارضات'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'تجربة (بدون تعديل)' }).click();
    const details = page.getByTestId('sync-details');
    await expect(details.getByText('تعارض', { exact: true })).toBeVisible();
    await expect(details.getByText('لا يوجد وقت تعديل لدى النظام الخارجي')).toBeVisible();
    await details.getByLabel('التعارضات فقط').check();
    await expect(details.getByRole('row')).toHaveCount(2); // header + the conflict
    await checkPage(page);
  });

  test('I. WhatsApp keeps its manual fallback; demo notifications never go out', async ({
    page,
  }) => {
    await staff(page, 'owner', '/admin/integrations/whatsapp?tab=messaging');
    await expect(page.getByText('إشعارات وضع العرض لا تُرسل أبدًا لقنوات خارجية.')).toBeVisible();
    await expect(page.getByTestId('routing-list')).toContainText('غير مربوط — يبقى يدويًا');
    await expect(page.getByRole('button', { name: 'إرسال الرسائل المستحقة الآن' })).toBeDisabled();
    await page.getByRole('tab', { name: 'نظرة عامة' }).click();
    await expect(
      page.getByText('زر واتساب اليدوي (wa.me) بعد تأكيد الطلب يبقى متاحًا دائمًا.'),
    ).toBeVisible();
    await checkPage(page);
  });

  test('J. analytics asks for consent, stays off private pages and never loads in demo', async ({
    page,
  }) => {
    const gaRequests: string[] = [];
    page.on('request', (r) => {
      if (/googletagmanager|google-analytics/.test(r.url())) gaRequests.push(r.url());
    });
    await staff(page, 'owner', '/admin/integrations');
    await configure(page, 'google_analytics', { 'Measurement ID (يبدأ بـ G-)': 'G-TEST1234' });
    await enable(page, 'google_analytics', 'Google Analytics 4');

    await page.goto('/');
    const banner = page.getByTestId('analytics-consent');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('وضع العرض: لن يتم إرسال أي بيانات تحليلية.');
    const reject = banner.getByRole('button', { name: 'رفض' });
    const accept = banner.getByRole('button', { name: 'السماح بالتحليلات' });
    const [r, a] = [await reject.boundingBox(), await accept.boundingBox()];
    expect(Math.abs((r?.height ?? 0) - (a?.height ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((r?.width ?? 0) - (a?.width ?? 0))).toBeLessThanOrEqual(2);
    await checkPage(page);
    await reject.click();
    await expect(banner).toBeHidden();

    await page.getByRole('button', { name: 'إعدادات ملفات الارتباط' }).click();
    await expect(banner).toContainText('اختيارك الحالي: مرفوض');
    await banner.getByRole('button', { name: 'السماح بالتحليلات' }).click();
    await expect(banner).toBeHidden();

    await page.goto('/checkout');
    await expect(page.getByTestId('analytics-consent')).toHaveCount(0);
    await page.goto('/en');
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await expect(page.getByRole('heading', { name: 'Analytics cookies' })).toBeVisible();
    await expect(page.getByText('Your current choice: Allowed')).toBeVisible();
    expect(gaRequests).toEqual([]);
  });

  test('K. Arabic integration screens are RTL without overflow', async ({ page }) => {
    await staff(page, 'owner', '/admin/integrations/odoo');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    for (const tab of ['نظرة عامة', 'الإعداد', 'الاتصال', 'المزامنة']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab, selected: true })).toBeVisible();
      await checkPage(page);
    }
  });

  test('L. English integration screens are LTR without overflow', async ({ page }) => {
    await staff(page, 'owner', '/admin');
    await page.getByRole('button', { name: 'Switch dashboard to English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.goto('/admin/integrations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Integrations & services' }),
    ).toBeVisible();
    await expect(page.getByTestId('integration-card-odoo')).toContainText('Not configured');
    await checkPage(page);
    await page.goto('/admin/integrations/whatsapp?tab=messaging');
    await expect(page.getByText('Not mapped — stays manual').first()).toBeVisible();
    await checkPage(page);
  });

  test('M. social sign-in buttons appear only when enabled; demo says it is simulated', async ({
    page,
  }) => {
    await page.goto('/account/sign-in');
    await expect(page.getByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeVisible();
    await expect(page.getByTestId('social-sign-in')).toHaveCount(0);
    await staff(page, 'owner', '/admin/integrations/social_auth?tab=configure');
    await page.getByLabel('إظهار «الدخول بحساب Google»').check();
    await page.getByRole('button', { name: 'حفظ الإعداد' }).click();
    await expect(page.getByText('تم حفظ الإعداد.')).toBeVisible();
    await enable(page, 'social_auth', 'الدخول بحساب');
    // Leave the staff preview: the sign-in page is for signed-out customers.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto('/account/sign-in');
    const social = page.getByTestId('social-sign-in');
    await expect(social.getByRole('button', { name: 'الدخول بحساب Google' })).toBeVisible();
    await expect(social.getByRole('button', { name: 'الدخول بحساب Apple' })).toHaveCount(0);
    await social.getByRole('button', { name: 'الدخول بحساب Google' }).click();
    await expect(
      social.getByText(/وضع العرض: الدخول بحساب Google أو Apple غير متاح/),
    ).toBeVisible();
    await checkPage(page);
  });

  test('N. AI suggestions fill a draft only — nothing is published', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await staff(page, 'owner', '/admin/products/new');
    await page.getByRole('tab', { name: 'SEO' }).click();
    await expect(page.getByTestId('ai-suggestion')).toHaveCount(0);
    await configure(page, 'ai', {
      'رابط الخادم (https)': 'https://ai.example.test',
      'اسم النموذج': 'demo-model',
    });
    await enable(page, 'ai', 'مساعد المحتوى');
    await page.goto('/admin/products/new');
    await page.getByRole('textbox', { name: /^الاسم \(العربية\)/ }).fill('هاتف تجريبي');
    await page.getByRole('tab', { name: 'SEO' }).click();
    await page.getByRole('button', { name: 'اقتراح وصف بالذكاء الاصطناعي (مسودة)' }).click();
    await expect(page.getByText(/تم وضع مسودة في حقلي الوصف/)).toBeVisible();
    await expect(page.getByText(/اقتراح تجريبي \(MOCK\)/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^وصف SEO \(العربية\)/ })).toHaveValue(
      /هاتف تجريبي/,
    );
    await expect(page.getByText('لديك تعديلات غير محفوظة.').first()).toBeVisible();
    await checkPage(page);
  });
});
