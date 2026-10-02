import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectNoSeriousA11yViolations,
  scrollThrough,
} from './helpers';

/**
 * Phase 08: SEO (prerendered pages, published metadata, sitemap, robots), PWA (install, offline,
 * cache boundaries), accessibility / motion / layout regressions, Admin → SEO and the setup wizard.
 * The E2E build is a demo deployment, so every page must say noindex and robots.txt blocks all.
 */

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Load a page the way a crawler without JavaScript sees it: the prerendered HTML only. */
async function gotoWithoutScripts(page: Page, path: string) {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = (await response.text()).replace(/<script[\s\S]*?<\/script>/g, '');
    return route.fulfill({ response, body: html });
  });
  await page.goto(path);
}

test.describe('search engines', () => {
  test('robots.txt blocks a demo deployment and the sitemap stays empty', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain('User-agent: *');
    expect(text).toMatch(/^Disallow: \/$/m);
    expect(text).not.toContain('Sitemap:');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).not.toContain('<url>');
    expect(xml).toContain('Demo deployment: never indexed.');
  });

  test('public pages are prerendered in Arabic and English with their own head', async ({
    request,
  }) => {
    const en = await (await request.get('/en/product/iphone-18-pro')).text();
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain('<title>iPhone 18 Pro | MALEK STORE</title>');
    expect(en).toContain('<h1>iPhone 18 Pro</h1>');
    expect(en).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(en).not.toContain('"@type":"Product"'); // demo data never gets Product markup
    const ar = await (await request.get('/store')).text();
    expect(ar).toContain('<html lang="ar-EG" dir="rtl">');
    expect(ar).toContain('<title>المتجر | MALEK STORE</title>');
    // Private areas are never prerendered: they get the plain app shell.
    for (const path of ['/account', '/checkout', '/admin', '/en/cart']) {
      const html = await (await request.get(path)).text();
      expect(html, path).not.toContain('class="pr"');
      expect(html, path).toContain('<div id="root">');
    }
  });

  test('without JavaScript the prerendered page is readable and accessible', async ({ page }) => {
    await gotoWithoutScripts(page, '/en/product/iphone-18-pro');
    await expect(page.getByRole('heading', { level: 1, name: 'iPhone 18 Pro' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByText(/Demo prices and stock/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
    await gotoWithoutScripts(page, '/news');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('the running app sets the same metadata: canonical, hreflang, robots, JSON-LD', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/en/product/iphone-18-pro');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('iPhone 18 Pro');
    await expect(page).toHaveTitle('iPhone 18 Pro | MALEK STORE');
    // Exactly one h1: React replaced the prerendered body.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const head = await page.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      alternates: [...document.querySelectorAll('link[rel="alternate"]')].map(
        (l) => `${l.getAttribute('hreflang')} ${new URL(l.getAttribute('href') ?? '').pathname}`,
      ),
      jsonLd: document.getElementById('page-json-ld')?.textContent ?? '',
    }));
    expect(head.robots).toBe('noindex, nofollow');
    expect(new URL(head.canonical ?? '').pathname).toBe('/en/product/iphone-18-pro');
    expect(head.alternates).toEqual(
      expect.arrayContaining([
        'ar-EG /product/iphone-18-pro',
        'en /en/product/iphone-18-pro',
        'x-default /product/iphone-18-pro',
      ]),
    );
    expect(JSON.parse(head.jsonLd)['@type']).toBe('BreadcrumbList');
    expect(head.jsonLd).not.toContain('"Product"');
    expect(errors).toEqual([]);
  });
});

test.describe('progressive web app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('manifest is installable and the install button follows the browser prompt', async ({
    page,
    request,
  }) => {
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      display: string;
      icons: { sizes: string }[];
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i) => i.sizes)).toContain('512x512');
    await page.goto('/en');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    const install = page.getByRole('button', { name: 'Install the app' });
    await expect(install).toHaveCount(0);
    // Simulate the browser offering installation (headless Chromium never fires it by itself).
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: () => {
          (window as unknown as { prompted: boolean }).prompted = true;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });
    await install.scrollIntoViewIfNeeded();
    await install.click();
    expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(
      true,
    );
    await expect(install).toHaveCount(0);
  });

  test('offline: visited public pages still open, everything else gets the offline page', async ({
    page,
    context,
  }) => {
    await page.goto('/en');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    // Visit while online (cached on the way), including a private page (never cached).
    await page.goto('/en/store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Store');
    await page.goto('/en/account');
    await page.waitForLoadState('networkidle');

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      return urls.map((u) => new URL(u).pathname);
    });
    expect(cached).toContain('/en/store');
    expect(cached).toContain('/offline.html');
    for (const path of cached)
      expect(path, path).not.toMatch(/^\/(en\/)?(admin|account|checkout|cart|order|wishlist)/);

    // Offline: every request fails, including the service worker's own (see playwright.config).
    await context.setOffline(true);
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await page.goto('/en/store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Store');
    await page.goto('/en/account');
    await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
    await page.goto('/en/news');
    await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.goto('/checkout');
    await expect(
      page.getByRole('heading', { level: 1, name: 'أنت غير متصل بالإنترنت' }),
    ).toBeVisible();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.setOffline(false);
  });
});

test.describe('accessibility, motion and layout', () => {
  test('landmark and overflow regressions (demo banner, search landmarks, contact)', async ({
    page,
  }) => {
    await page.goto('/en/store');
    await expect(page.getByRole('complementary', { name: 'Demo mode' })).toBeVisible();
    await expect(page.getByRole('search', { name: 'Search products' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    for (const path of ['/en/contact', '/contact']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousA11yViolations(page);
    }
  });

  test('reduced motion stops campaign animations', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const animations = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="hero"]')].map(
        (el) => getComputedStyle(el).animationName,
      ),
    );
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.every((name) => name === 'none')).toBe(true);
    await context.close();
  });

  test('home and product pages keep layout stable (CLS) and paint quickly (LCP)', async ({
    page,
  }) => {
    for (const path of ['/', '/en/product/iphone-18-pro']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await scrollThrough(page);
      const vitals = await page.evaluate(
        () =>
          new Promise<{ cls: number; lcp: number }>((resolve) => {
            let cls = 0;
            let lcp = 0;
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as (PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
              })[])
                if (!e.hadRecentInput) cls += e.value;
            }).observe({ type: 'layout-shift', buffered: true });
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
            }).observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => resolve({ cls, lcp }), 500);
          }),
      );
      expect(vitals.cls, `${path} CLS`).toBeLessThan(0.1);
      expect(vitals.lcp, `${path} LCP`).toBeLessThan(4000);
    }
  });
});

async function staff(page: Page, role: string, path: string) {
  await page.goto('/admin');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/admin');
  await page.getByLabel('الدور').selectOption(role);
  await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto(path);
}

test.describe('admin: SEO overview and setup wizard', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('SEO overview reuses the SEO preview and states the indexing status', async ({ page }) => {
    await staff(page, 'content_editor', '/admin/seo');
    await expect(page.getByRole('heading', { level: 1, name: 'تحسين محركات البحث' })).toBeVisible();
    await expect(page.getByTestId('seo-checks')).toContainText('نسخة عرض');
    await expect(page.getByTestId('seo-serp')).toBeVisible();
    await page.getByRole('radio', { name: 'Apple' }).check();
    await expect(page.getByTestId('seo-serp')).toContainText('Apple');
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('setup wizard: four steps, keyboard focus, review and finish (audited)', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await staff(page, 'owner', '/admin');
    await expect(page.getByText('أكمل إعداد المتجر')).toBeVisible();
    await page.getByRole('link', { name: 'بدء الإعداد' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'إعداد المتجر' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'الهوية والألوان' })).toBeFocused();
    await page.getByRole('radio', { name: /MALEK الأصلي/ }).check();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'التالي' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'بيانات العرض' })).toBeFocused();
    await page.getByRole('radio', { name: /الإبقاء عليها الآن/ }).check();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'التالي' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'المراجعة' })).toBeFocused();
    await expect(page.getByTestId('setup-checklist')).toContainText('قرار بيانات العرض');
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'إنهاء الإعداد ونشره' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'إنهاء الإعداد ونشره' })
      .click();
    await expect(page.getByText('تم إنهاء الإعداد', { exact: true })).toBeVisible();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('أكمل إعداد المتجر')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
