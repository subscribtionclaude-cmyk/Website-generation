import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectNoSeriousA11yViolations,
  scrollThrough,
} from './helpers';

/** Every Phase 02 page: renders its h1, no sideways scroll, axe WCAG 2.1 A/AA, no console errors. */
const PAGES: { path: string; h1: RegExp }[] = [
  { path: '/', h1: /iPhone 18 Pro/ },
  { path: '/apple', h1: /Apple في MALEK STORE/ },
  { path: '/store', h1: /المتجر/ },
  { path: '/category/phones', h1: /موبايلات/ },
  { path: '/brand/samsung', h1: /Samsung/ },
  { path: '/search?q=%D8%A7%D9%8A%D9%81%D9%88%D9%86', h1: /ايفون/ },
  { path: '/budget?min=20000&max=30000', h1: /20,000/ },
  { path: '/product/iphone-18-pro', h1: /iPhone 18 Pro/ },
  { path: '/product/iphone-duo', h1: /iPhone Duo/ },
  { path: '/offers', h1: /العروض/ },
  { path: '/offers/ps5-flash-offer', h1: /PlayStation 5 Slim/ },
  { path: '/new', h1: /الجديد/ },
  { path: '/coming-soon', h1: /قريبًا/ },
  { path: '/news', h1: /أخبار/ },
  { path: '/news/iphone-18-pro-launch', h1: /iPhone 18 Pro/ },
  { path: '/contact', h1: /تواصل/ },
  { path: '/en', h1: /iPhone 18 Pro/ },
  { path: '/en/apple', h1: /Apple at MALEK STORE/ },
  { path: '/en/store', h1: /Store/ },
  { path: '/en/product/iphone-18-pro-max', h1: /iPhone 18 Pro Max/ },
  { path: '/en/offers', h1: /Offers/ },
];

test.describe('storefront pages', () => {
  for (const { path, h1 } of PAGES) {
    test(`${path} renders, fits the viewport and passes axe`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(h1);
      await scrollThrough(page);
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousA11yViolations(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('storefront interactions', () => {
  test('product variants are keyboard-selectable and sync price, SKU and URL', async ({ page }) => {
    await page.goto('/en/product/iphone-18-pro');
    await expect(page.getByText('IP18P-256GB-ORANGE')).toBeVisible();
    const storage = page.getByRole('group', { name: /Storage/ });
    await storage.getByRole('radio', { name: /256GB/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/storage=512gb/);
    await expect(page.getByText('IP18P-512GB-ORANGE')).toBeVisible();
    await page.getByRole('group', { name: /Color/ }).getByRole('radio', { name: /Black/ }).click();
    await expect(page.getByText('IP18P-512GB-BLACK')).toBeVisible();
    await expect(page).toHaveURL(/color=black/);
  });

  test('sold-out variant offers Notify Me in an accessible dialog', async ({ page }) => {
    await page.goto('/en/product/iphone-18-pro?storage=1tb&color=orange');
    await page.getByRole('button', { name: 'Notify me when available' }).click();
    const dialog = page.getByRole('dialog', { name: 'Notify me when available' });
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'dialog');
    await dialog.getByLabel('Name').fill('Mona');
    await dialog.getByLabel('Mobile number').fill('01012345678');
    await dialog.getByRole('button', { name: 'Register' }).click();
    await expect(dialog.getByText('You’re registered')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('filters work from the mobile drawer and update the URL', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width >= 1024, 'filter drawer is for phones and tablets');
    await page.goto('/en/store');
    await expect(page.getByText('28 products')).toBeVisible();
    await page.getByRole('button', { name: 'Filters' }).click();
    const dialog = page.getByRole('dialog', { name: 'Filters' });
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'dialog');
    const apple = dialog.getByRole('checkbox', { name: /Apple/ });
    await apple.click();
    await expect(page).toHaveURL(/brand=apple/);
    await expect(apple).toBeChecked();
    await dialog.getByRole('button', { name: /Show 16 results/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('16 products')).toBeVisible();
  });

  test('desktop filter sidebar filters by storage and sorts by price', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width < 1024, 'sidebar is desktop only');
    await page.goto('/en/category/phones');
    const sidebar = page.getByRole('complementary', { name: 'Filters' });
    await sidebar.getByRole('checkbox', { name: /1TB/ }).click();
    await expect(page).toHaveURL(/storage=1tb/);
    await page.getByLabel('Sort by').selectOption('price_desc');
    await expect(page).toHaveURL(/sort=price_desc/);
    await expect(page.getByRole('button', { name: /Remove: 1TB/ })).toBeVisible();
  });

  test('storefront pages never download the admin bundle', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url());
    });
    await page.goto('/store');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/product/iphone-18-pro');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(scripts.filter((url) => /Admin/.test(url))).toEqual([]);
  });

  test('offers page jump links and live countdowns', async ({ page }) => {
    await page.goto('/en/offers');
    await page
      .getByRole('navigation', { name: 'Offer sections' })
      .getByRole('link', { name: 'Promo codes' })
      .click();
    await expect(page).toHaveURL(/#promo-codes$/);
    await expect(page.getByLabel('Promo codes').getByText('DEMO10', { exact: true })).toBeVisible();
    await expect(page.getByText(/Ends in/).first()).toBeVisible();
  });
});
