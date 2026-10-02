import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/**
 * Phase 07 Visual Site Editor (demo mode) on mobile, tablet, desktop and large desktop.
 * The preview is the real storefront in a same-origin frame; drafts never reach the storefront
 * until they are published, and every publish / rollback is versioned and audited.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.describe.configure({ timeout: 180_000 });

const NEW_RELEASES = /^\d+\. وصل حديثًا/;

async function staff(page: Page, role: string, path = '/admin/site-editor') {
  await page.goto('/admin');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/admin');
  await page.getByLabel('الدور').selectOption(role);
  await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto(path);
}

async function openEditor(page: Page, role = 'design_editor') {
  await staff(page, role);
  await expect(page.getByRole('heading', { level: 1, name: 'محرر الموقع' })).toBeVisible();
  // The loading skeleton shares the heading; wait for the editor itself.
  await expect(page.getByRole('toolbar', { name: 'أدوات المحرر' })).toBeVisible();
}

/** Narrow layouts show one pane at a time: switch to it when the switch exists. */
async function showPane(page: Page, name: 'الأقسام' | 'المعاينة' | 'تعديل القسم') {
  const toggle = page.getByRole('group', { name: 'عرض الأجزاء' }).getByRole('button', { name });
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-pressed')) !== 'true')
    await toggle.click();
}

const frame = (page: Page) => page.frameLocator('iframe[name^="malek-preview"]');

async function previewSectionIds(page: Page) {
  await showPane(page, 'المعاينة');
  const ids = await frame(page)
    .locator('main section[aria-labelledby]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-labelledby')));
  return ids;
}

async function storefrontFirstSection(page: Page) {
  const shop = await page.context().newPage();
  await shop.goto('/');
  const first = shop.locator('main section[aria-labelledby]').first();
  await expect(first).toBeVisible();
  // The hero is labelled only once its campaign has loaded: wait for every placeholder to resolve.
  await expect(shop.locator('main [aria-busy="true"]')).toHaveCount(0);
  const id = await first.getAttribute('aria-labelledby');
  await shop.close();
  return id;
}

async function moveNewReleasesToTop(page: Page) {
  await showPane(page, 'الأقسام');
  const handle = page.getByRole('button', { name: 'إعادة ترتيب: وصل حديثًا' });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(page.getByText('تم وضع «وصل حديثًا» في الموضع 1.')).toBeAttached();
  await expect(
    page.getByRole('list', { name: 'أقسام صفحة الرئيسية' }).getByRole('listitem').first(),
  ).toContainText('وصل حديثًا');
}

test.describe('visual site editor', () => {
  test('A. opens with page structure, inspector and a real storefront preview', async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.getByRole('tab', { name: 'الرئيسية' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await showPane(page, 'الأقسام');
    await expect(page.getByRole('list', { name: 'أقسام صفحة الرئيسية' })).toBeVisible();
    await showPane(page, 'المعاينة');
    await expect(frame(page).locator('[data-preview-banner]')).toContainText(
      'Preview — not published',
    );
    await expect(frame(page).getByRole('heading', { level: 1 })).toContainText('iPhone 18 Pro');
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('B. edits a homepage section with undo / redo and a live preview', async ({ page }) => {
    await openEditor(page);
    await showPane(page, 'الأقسام');
    await page.getByRole('button', { name: NEW_RELEASES }).click();
    await showPane(page, 'تعديل القسم');
    const title = page.getByRole('textbox', { name: /^العنوان \(العربية\)/ });
    await title.fill('وصل حديثًا — تجربة المحرر');
    await expect(page.getByText('تعديلات غير محفوظة (1)')).toBeVisible();
    await showPane(page, 'المعاينة');
    await expect(
      frame(page).getByRole('heading', { name: 'وصل حديثًا — تجربة المحرر' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'تراجع' }).click();
    await expect(
      frame(page).getByRole('heading', { name: 'وصل حديثًا', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'إعادة', exact: true }).click();
    await expect(
      frame(page).getByRole('heading', { name: 'وصل حديثًا — تجربة المحرر' }),
    ).toBeVisible();

    // Section design is structured (no CSS): background and spacing choices only.
    await showPane(page, 'تعديل القسم');
    await page.getByLabel('الخلفية').selectOption('muted');
    await showPane(page, 'المعاينة');
    await expect(frame(page).locator('[data-background="muted"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test('C. reorders with the keyboard, buttons and hide / show', async ({ page }) => {
    await openEditor(page);
    await moveNewReleasesToTop(page);
    await expect
      .poll(async () => (await previewSectionIds(page))[0])
      .toBe('s-home-new-releases-title');

    await showPane(page, 'الأقسام');
    await page.getByRole('button', { name: /^تحريك لأسفل: وصل حديثًا$/ }).click();
    await expect(
      page.getByRole('list', { name: 'أقسام صفحة الرئيسية' }).getByRole('listitem').nth(1),
    ).toContainText('وصل حديثًا');
    await page.getByRole('button', { name: /^إخفاء\s*: وصل حديثًا$/ }).click();
    await expect.poll(() => previewSectionIds(page)).not.toContain('s-home-new-releases-title');
    await showPane(page, 'الأقسام');
    await page.getByRole('button', { name: /^إظهار\s*: وصل حديثًا$/ }).click();
    await expect.poll(() => previewSectionIds(page)).toContain('s-home-new-releases-title');
  });

  test('D. a saved draft shows in the preview but never on the storefront', async ({ page }) => {
    await openEditor(page);
    await moveNewReleasesToTop(page);
    await page.getByRole('button', { name: 'حفظ كمسودة' }).click();
    await expect(page.getByText('تم حفظ المسودات.')).toBeVisible();
    await expect(page.getByText('مسودات جاهزة للنشر (1)')).toBeVisible();
    await expect
      .poll(async () => (await previewSectionIds(page))[0])
      .toBe('s-home-new-releases-title');
    await expect.poll(() => storefrontFirstSection(page)).toBe('s-home-hero-title');
  });

  test('E. switches preview devices (true CSS widths)', async ({ page }) => {
    await openEditor(page);
    await showPane(page, 'المعاينة');
    const iframe = page.locator('iframe[name="malek-preview"]');
    for (const [label, width] of [
      ['موبايل', 390],
      ['تابلت', 820],
      ['كمبيوتر', 1280],
    ] as const) {
      await page.getByRole('radio', { name: label }).check({ force: true });
      await expect(iframe).toHaveAttribute('style', new RegExp(`width: ${width}px`));
      await expect(frame(page).locator('html')).toHaveAttribute('dir', 'rtl');
    }
    await page.getByRole('radio', { name: 'موبايل' }).check({ force: true });
    const frameOverflow = await page
      .frameLocator('iframe[name="malek-preview"]')
      .locator('html')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(frameOverflow).toBeLessThanOrEqual(0);
    await expectNoHorizontalOverflow(page);
  });

  test('F. Arabic preview is RTL', async ({ page }) => {
    await openEditor(page);
    await showPane(page, 'المعاينة');
    await expect(frame(page).locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(frame(page).locator('html')).toHaveAttribute('lang', 'ar-EG');
    await page.getByRole('tab', { name: 'Apple' }).click();
    await showPane(page, 'المعاينة');
    await expect(frame(page).getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      frame(page)
        .getByText(/Apple Authorized Reseller/)
        .first(),
    ).toBeVisible();
  });

  test('G. English preview is LTR and follows unsaved edits', async ({ page }) => {
    await openEditor(page);
    await showPane(page, 'الأقسام');
    await page.getByRole('button', { name: NEW_RELEASES }).click();
    await showPane(page, 'تعديل القسم');
    await page.getByRole('textbox', { name: /^العنوان \(English\)/ }).fill('Fresh arrivals E2E');
    await showPane(page, 'المعاينة');
    await page.getByRole('radio', { name: 'English' }).check({ force: true });
    await expect(frame(page).locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(frame(page).locator('html')).toHaveAttribute('lang', 'en');
    await expect(frame(page).getByRole('heading', { name: 'Fresh arrivals E2E' })).toBeVisible();
  });

  test('H + I. publish reaches the storefront; rollback restores the previous version', async ({
    page,
  }) => {
    await openEditor(page);
    await moveNewReleasesToTop(page);
    await page.getByRole('button', { name: 'نشر…' }).click();
    const dialog = page.getByRole('dialog', { name: 'نشر التعديلات' });
    await expect(dialog.getByRole('checkbox', { name: /صفحة الرئيسية/ })).toBeChecked();
    await dialog.getByLabel(/^ملاحظة النسخة/).fill('E2E: new releases first');
    await dialog.getByRole('button', { name: /^نشر \(1\)$/ }).click();
    await expect(dialog.getByText('تم النشر.')).toBeVisible();
    await dialog.getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByText('كل التعديلات منشورة')).toBeVisible();
    await expect.poll(() => storefrontFirstSection(page)).toBe('s-home-new-releases-title');

    await page.getByRole('button', { name: 'النسخ', exact: true }).click();
    const versions = page.getByRole('dialog', { name: 'نسخ صفحة الرئيسية' });
    await expect(versions.getByText('E2E: new releases first')).toBeVisible();
    await versions.getByRole('button', { name: /^مقارنة بالمنشور\s*: النسخة 1$/ }).click();
    await expect(versions.getByRole('table')).toContainText('تغيّر ترتيبه');
    await versions.getByRole('button', { name: /^استعادة\s*: النسخة 1$/ }).click();
    await versions.getByRole('button', { name: 'استعادة النسخة 1' }).click();
    await expect(versions.getByText('تمت الاستعادة ونُشرت كنسخة جديدة.')).toBeVisible();
    await expect(versions.getByText('Restored version 1')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await versions.getByRole('button', { name: 'إغلاق' }).click();
    await expect.poll(() => storefrontFirstSection(page)).toBe('s-home-hero-title');
  });

  test('J. permissions: no access without design.view; view-only without design.edit', async ({
    page,
  }) => {
    await staff(page, 'sales');
    await expect(
      page.getByRole('heading', { level: 1, name: 'ليس لديك صلاحية لهذا القسم' }),
    ).toBeVisible();

    await staff(page, 'store_manager');
    await expect(page.getByRole('heading', { level: 1, name: 'محرر الموقع' })).toBeVisible();
    await expect(page.getByText(/عرض فقط — يمكنك المعاينة ومراجعة النسخ/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'إضافة قسم' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'حفظ كمسودة' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'نشر…' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  });

  test('K. publishing is recorded in the audit log under "design"', async ({ page }) => {
    await openEditor(page, 'owner');
    await moveNewReleasesToTop(page);
    await page.getByRole('button', { name: 'نشر…' }).click();
    const dialog = page.getByRole('dialog', { name: 'نشر التعديلات' });
    await dialog.getByRole('button', { name: /^نشر \(\d+\)$/ }).click();
    await expect(dialog.getByText('تم النشر.').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'إغلاق' }).click();

    await page.goto('/admin/audit-log?module=design');
    await expect(page.getByRole('heading', { level: 1, name: 'سجل التدقيق' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table).toContainText('site_editor.published');
    await expect(table).toContainText('site_editor.draft_saved');
    await expectNoHorizontalOverflow(page);
  });

  test('sample store preview uses demo data, marked DEMO CONTENT', async ({ page }) => {
    await openEditor(page);
    await showPane(page, 'المعاينة');
    await page.getByRole('checkbox', { name: 'معاينة متجر تجريبي' }).check();
    await expect(page.locator('iframe[name="malek-preview-sample"]')).toBeAttached();
    await expect(frame(page).locator('[data-preview-banner="sample"]')).toContainText(
      'DEMO CONTENT',
    );
    await expect(frame(page).getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/محتوى تجريبي \(DEMO CONTENT\)/)).toBeVisible();
  });

  test('design presets and footer settings preview without publishing', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('tab', { name: 'التصميم والهوية' }).click();
    await showPane(page, 'الأقسام');
    await page.getByRole('radio', { name: /ليلي/ }).check();
    await page.getByLabel('المسافات بين الأقسام').selectOption('compact');
    await showPane(page, 'المعاينة');
    await expect(frame(page).locator('html')).toHaveAttribute('data-spacing', 'compact');
    const inverse = await frame(page)
      .locator('html')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-surface-inverse').trim());
    expect(inverse).toBe('#17171a');
    await expect(page.getByText('تعديلات غير محفوظة (1)')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
  });
  test('L. SEO preview: page SEO drafts, preview frame title, Arabic / English, canonical', async ({
    page,
  }) => {
    await openEditor(page);
    await page.getByRole('tab', { name: 'Apple' }).click();
    await showPane(page, 'الأقسام');
    await page.getByRole('button', { name: 'البحث والمشاركة لهذه الصفحة' }).click();
    await expect(page.getByRole('tab', { name: 'الظهور في البحث' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const preview = page.getByRole('region', { name: 'معاينة الظهور: Apple' });
    const serp = preview.getByTestId('seo-serp');
    await expect(serp).toContainText('Apple في MALEK STORE | MALEK STORE');
    await expect(preview.getByTestId('seo-urls')).toContainText('/apple');

    // Editing page SEO (existing page_seo setting) updates the preview and the real preview frame.
    const apple = page.getByRole('group', { name: 'صفحة Apple' });
    await apple.getByRole('textbox', { name: /^العنوان \(العربية\)/ }).fill('آبل الأصلية');
    await expect(serp).toContainText('آبل الأصلية | MALEK STORE');
    await expect(preview.getByText('من إعداد الصفحة').first()).toBeVisible();
    await expect(preview.getByText('المنشور الآن:')).toBeVisible();
    await expect
      .poll(() => page.frame({ name: 'malek-preview' })?.title())
      .toBe('آبل الأصلية | MALEK STORE');

    await preview.getByRole('radio', { name: 'English' }).check({ force: true });
    await expect(preview.getByTestId('seo-urls')).toContainText('/en/apple');
    await expect(preview.getByText(/لا يوجد عنوان إنجليزي/)).toBeVisible();
    await apple.getByRole('textbox', { name: /^العنوان \(English\)/ }).fill('Apple originals');
    await expect(serp).toContainText('Apple originals | MALEK STORE');
    await expect(preview.getByTestId('seo-share')).toContainText('Apple originals');
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
  });
});
