import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

test.describe('storefront', () => {
  test('Arabic home is RTL, has no console errors and passes axe (WCAG A/AA)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    await page.goto('/');
    // Phase 02: CMS home opens with the launch hero campaign.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('iPhone 18 Pro');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
    await expect(page).toHaveTitle(/MALEK STORE/);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
    expect(errors).toEqual([]);
  });

  test('English home is LTR and hreflang alternates are set', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('link', { name: 'Shop now' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('link[rel="alternate"][hreflang="ar-EG"]')).toHaveAttribute(
      'href',
      /\/$/,
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('deep links work (SPA fallback) and language switch keeps the section', async ({ page }) => {
    await page.goto('/en/trade-in');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trade in your device' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'التبديل إلى العربية' }).first().click();
    await expect(page).toHaveURL(/\/trade-in$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('mobile menu opens as a modal drawer and closes with Escape', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile navigation only');
    await page.goto('/');
    await page.getByRole('button', { name: 'افتح القائمة' }).click();
    const drawer = page.getByRole('dialog', { name: 'القائمة' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Trade-In' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // Phones get the app-like bottom tab bar; tablets keep header icons instead.
    const width = page.viewportSize()?.width ?? 0;
    const tabBar = page.getByRole('navigation', { name: 'التنقل السريع' });
    if (width < 768) await expect(tabBar).toBeVisible();
    else await expect(tabBar).toBeHidden();
  });

  test('sign-in page passes axe', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Faccount$/);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('admin', () => {
  test('demo owner preview reaches the dashboard and role matrix; passes axe', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    await page.getByLabel('الدور').selectOption('owner');
    await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('أهلًا');
    await expectNoSeriousA11yViolations(page);

    await page.goto('/admin/access/roles');
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('button', { name: 'Switch dashboard to English' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Roles & permissions' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
