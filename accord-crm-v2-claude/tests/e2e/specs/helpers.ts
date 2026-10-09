import { expect, type Page } from '@playwright/test';

export const USERS = {
  admin: ['admin@accord.test', 'Admin-Pass-12345'],
  bd1: ['bd1@accord.test', 'Bd1-Pass-12345'],
  bd2: ['bd2@accord.test', 'Bd2-Pass-12345'],
  viewer: ['viewer@accord.test', 'Viewer-Pass-12345'],
  inactive: ['inactive@accord.test', 'Inactive-Pass-12345'],
  noprofile: ['noprofile@accord.test', 'NoProfile-Pass-12345'],
} as const;

export async function login(page: Page, who: keyof typeof USERS, expectUrl: RegExp | null = /\/dashboard\//) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(USERS[who][0]);
  await page.getByLabel('Password').fill(USERS[who][1]);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (expectUrl) await expect(page).toHaveURL(expectUrl);
}

export const cairoDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

export async function kpi(page: Page, id: string): Promise<number> {
  const t = await page.getByTestId(id).innerText();
  return Number(t.replace(/[^0-9.]/g, ''));
}

/** Collects console errors + failed requests so tests can assert a clean page. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(40[0-9])/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && u.startsWith('http://127.0.0.1:4173')) problems.push(`HTTP ${r.status()} ${u}`); });
  return problems;
}
