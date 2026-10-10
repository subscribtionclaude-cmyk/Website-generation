import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { login } from './helpers';

const routes = [...readFileSync('src/routes.ts', 'utf8').matchAll(/'(\/[a-z0-9\-/]*\/)'/g)].map((m) => m[1]);
const VIEWPORTS = [
  { name: '1440-desktop', width: 1440, height: 900 },
  { name: '1024-ipad-landscape', width: 1024, height: 768 },
  { name: '768-ipad-portrait', width: 768, height: 1024 },
  { name: '390-mobile', width: 390, height: 844 },
];
const SHOTS = 'test-results/shots';
mkdirSync(SHOTS, { recursive: true });
const AMER = '11111111-1111-1111-1111-111111111111';

async function visit(page: Page, route: string, problems: string[]) {
  const url = route === '/leads/view/' ? `${route}?id=${AMER}` : route;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main, .auth-wrap').first()).toBeVisible();
  // no horizontal page scroll, all images decode (no broken ACCORD logo / "?" icon)
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src) }));
  expect(m.sw, `${route} horizontal overflow`).toBeLessThanOrEqual(m.iw + 1);
  expect(m.broken, `${route} broken images`).toEqual([]);
  expect(problems, route).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`static export @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test(`every route loads from a plain static server, no broken chunks/assets, no overflow (${vp.name})`, async ({ page }) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1:4173')) problems.push(`HTTP ${r.status()} ${r.url()}`); });
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      await login(page, 'admin');
      for (const r of routes.filter((x) => !['/login/', '/set-password/'].includes(x))) {
        problems.length = 0;
        await visit(page, r, problems);
        if (['/dashboard/', '/leads/', '/leads/view/', '/pipeline/', '/follow-ups/', '/meetings/', '/proposals/', '/calls/', '/admin/', '/admin/users/', '/admin/reports/daily/', '/admin/reports/board/', '/admin/sync/'].includes(r))
          await page.screenshot({ path: `${SHOTS}/${vp.name}${r.replace(/\//g, '_')}.png`, fullPage: false });
      }
    });

    test(`call dialog, lead profile and meeting dialogs are usable (${vp.name})`, async ({ page }) => {
      await login(page, 'bd1');
      await page.goto('/leads/');
      await page.waitForLoadState('networkidle');
      await page.locator('[data-testid="lead-call"]:visible').first().click();
      await expect(page.getByTestId('call-responded')).toBeVisible();
      const box = await page.getByTestId('call-responded').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44); // touch target
      await page.screenshot({ path: `${SHOTS}/${vp.name}_call-dialog.png` });
      await page.keyboard.press('Escape');
      await page.goto(`/leads/view/?id=${AMER}`);
      await page.getByRole('button', { name: 'Meeting', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const dlg = await page.getByRole('dialog').boundingBox();
      expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(vp.width + 1);
      await page.screenshot({ path: `${SHOTS}/${vp.name}_meeting-dialog.png` });
    });
  });
}

test.describe('static hosting & PWA', () => {
  test('refresh / bookmark / deep link work with no rewrites; unknown paths are plain 404 (no hidden SPA fallback)', async ({ page, request }) => {
    for (const r of routes) expect((await request.get(r)).status(), r).toBe(200);
    expect((await request.get('/leads/view')).status()).toBe(200); // directory redirect followed by the server
    expect((await request.get('/no/such/page/', { failOnStatusCode: false })).status()).toBe(404);
    await login(page, 'bd1');
    await page.goto(`/leads/view/?id=${AMER}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Amer Group');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Amer Group');
  });
  test('manifest, icons, favicon and apple-touch-icon are real images (no "?" Home-Screen icon)', async ({ page, request }) => {
    await page.goto('/login/');
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/dashboard/', scope: '/', name: 'ACCORD CRM' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of manifest.icons) {
      const r = await request.get(i.src); expect(r.status(), i.src).toBe(200); expect(r.headers()['content-type']).toBe('image/png');
      expect((await r.body()).subarray(1, 4).toString()).toBe('PNG');
    }
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]')].map((l) => (l as HTMLLinkElement).getAttribute('href')));
    expect(links).toEqual(expect.arrayContaining(['/icons/apple-touch-icon.png', '/manifest.webmanifest', '/icons/favicon-32.png']));
    for (const l of links) expect((await request.get(l!)).status(), l!).toBe(200);
    expect(await page.evaluate(() => document.querySelector('meta[name="viewport"]')!.getAttribute('content'))).toContain('viewport-fit=cover');
    expect((await request.get('/sw.js')).status()).toBe(200);
  });
  test('theme toggle persists and dark mode renders', async ({ page }) => {
    await login(page, 'bd1');
    await page.getByRole('button', { name: 'Toggle theme' }).first().click();
    const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.reload(); await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(t);
    await page.screenshot({ path: `${SHOTS}/theme-${t}.png` });
  });
  test('Arabic RTL + dark mode follow the user to another device (server-side preference)', async ({ page, browser }) => {
    await login(page, 'bd2');
    await page.goto('/settings/?section=language');
    await page.getByRole('radio', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإعدادات');
    await page.goto('/settings/?section=appearance');
    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.sidebar .brand .full')).toHaveAttribute('src', /accord-logo-dark/);
    await page.waitForTimeout(500); // let the preference write reach the server
    // a second, fresh device (empty localStorage) gets the same language, direction and theme after sign-in
    const other = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p2 = await other.newPage();
    await login(p2, 'bd2');
    await expect(p2.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(p2.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(p2.locator('.sidebar .brand .mark')).toHaveAttribute('src', /accord-icon-dark/);
    const ov = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(ov).toBeLessThanOrEqual(1);
    await other.close();
    // switch back so later suites run in English / light
    await page.goto('/settings/?section=language');
    await page.getByRole('radio', { name: 'English' }).click();
    await page.goto('/settings/?section=appearance');
    await page.getByTestId('theme-light').click();
    await page.waitForTimeout(500);
  });
});
