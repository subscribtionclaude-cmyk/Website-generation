import { test, expect } from '@playwright/test';
import { login, USERS } from './helpers';
import { tokenFor, rest, rpc } from './api';

test('lead files: upload to private storage, open via signed link, delete', async ({ page, context }) => {
  await login(page, 'bd1');
  await page.goto('/leads/view/?id=11111111-1111-1111-1111-111111111111');
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'company-profile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await expect(page.getByText('File uploaded')).toBeVisible();
  await expect(page.getByRole('cell', { name: /company-profile\.pdf/ })).toBeVisible();
  const signed = context.waitForEvent('request', (r) => r.method() === 'GET' && r.url().includes('/storage/v1/object/sign/crm-files/11111111-1111-1111-1111-111111111111/attachment/'));
  await page.getByRole('button', { name: 'Open' }).click();
  expect((await signed).url()).toContain('token=');   // opened through a short-lived signed URL, not a public link
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete file' }).click();
  await expect(page.getByText('No files yet')).toBeVisible();
});

test('viewer: never any lead files — raw lead data cannot be granted to a Management Viewer', async ({ page }) => {
  await login(page, 'viewer', /\/management\//);
  await page.goto('/leads/view/?id=11111111-1111-1111-1111-111111111111');
  await expect(page).toHaveURL(/\/management\//); // raw lead data is never part of a viewer's access
  const adm = await tokenFor(...USERS.admin as unknown as [string, string]);
  const vid = (await rest(adm, 'profiles?select=id&email=eq.viewer@accord.test')).body[0].id;
  expect((await rpc(adm, 'admin_set_user_override', { p_user: vid, p_perm: 'raw.leads', p_allowed: true })).status).toBeGreaterThanOrEqual(400); // hard rule
  const v = await tokenFor(...USERS.viewer as unknown as [string, string]);
  expect((await rest(v, 'attachments?select=id,file_name')).body).toEqual([]);
  expect((await rest(adm, 'attachments?select=id')).status).toBe(200);
});
