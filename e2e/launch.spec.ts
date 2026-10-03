import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers';

/**
 * Phase 10 launch checks against the production build. `vite preview` applies the same
 * public/_headers and public/_redirects rules the static host does, so these cover what ships:
 * real 404 statuses (no misleading 200s), the SPA shell only for known routes, the security headers,
 * and no Content-Security-Policy violation on the storefront, admin and Site Editor preview.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.describe.configure({ timeout: 120_000 });

/** Records CSP violations in every frame (the Site Editor preview is a same-origin frame). */
async function watchCsp(page: Page) {
  const logged: string[] = [];
  page.on('console', (message) => {
    if (
      /Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(message.text())
    )
      logged.push(message.text());
  });
  await page.addInitScript(() => {
    const store = window as unknown as { __csp: string[] };
    store.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => {
    const fromFrames = await Promise.all(
      page
        .frames()
        .map((frame) =>
          frame
            .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
            .catch(() => [] as string[]),
        ),
    );
    return [...fromFrames.flat(), ...logged];
  };
}

test.describe('404 semantics', () => {
  test('unknown URLs answer a real 404 with the bilingual not-found page', async ({ page }) => {
    const ar = await page.goto('/this-page-does-not-exist');
    expect(ar?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'الصفحة دي مش موجودة' }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectNoSeriousA11yViolations(page);

    const en = await page.goto('/en/missing/deep/link');
    expect(en?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: "This page doesn't exist" }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('known app routes and prerendered pages answer 200', async ({ request }) => {
    for (const path of [
      '/',
      '/en',
      '/store',
      '/en/store',
      '/cart',
      '/en/checkout',
      '/repairs/request',
      '/account',
      '/order/MS-0001',
      '/admin',
      '/admin/site-editor',
      '/product/iphone-18-pro',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });

  test('a content URL not in the build gets the app (it may be newer than the build) but is never indexed', async ({
    page,
  }) => {
    // Products, offers and news published after the last build have no prerendered file yet, so
    // the host serves the app; a slug that does not exist renders the not-found state with noindex.
    const response = await page.goto('/product/not-a-real-product');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('every response carries the security headers; the service worker is never cached', async ({
    request,
  }) => {
    const page = await request.get('/');
    const headers = page.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache');
    expect((await request.get('/robots.txt')).status()).toBe(200);
  });
});

test.describe('Content-Security-Policy', () => {
  test('storefront pages run without a single CSP violation', async ({ page }) => {
    const violations = await watchCsp(page);
    for (const path of [
      '/',
      '/en',
      '/store',
      '/product/iphone-18-pro',
      '/cart',
      '/checkout',
      '/repairs/request',
      '/trade-in',
      '/en/contact',
      '/account',
    ]) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }
    expect(await violations()).toEqual([]);
  });

  test('admin and the Site Editor preview frame run without a CSP violation', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/admin');
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto('/admin');
    await page.getByLabel('الدور').selectOption('owner');
    await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/admin/site-editor');
    await expect(page.getByRole('toolbar', { name: 'أدوات المحرر' })).toBeVisible();
    const preview = page.getByRole('group', { name: 'عرض الأجزاء' }).getByRole('button', {
      name: 'المعاينة',
    });
    if ((await preview.count()) > 0) await preview.click();
    await expect(
      page.frameLocator('iframe[name^="malek-preview"]').locator('main section').first(),
    ).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});

test.describe('Scroll position', () => {
  test('a freshly loaded page starts at the top, whatever the previous page was scrolled to', async ({
    page,
  }) => {
    await page.goto('/en/category/phones');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300); // let the position be saved on unload
    await page.goto('/en/category/audio');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(800); // a restored position would scroll (smoothly) by now
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('Core Web Vitals', () => {
  test('home stays layout-stable while web fonts are slow to arrive', async ({ page }) => {
    // A slow device or network gets the fonts after the first paint; text must not reflow then.
    await page.route(/\.woff2?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.addInitScript(() => {
      const store = window as unknown as { __cls: number };
      store.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[])
          if (!entry.hadRecentInput) store.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1500); // past the delayed font responses
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);
  });
});
