import { test, expect } from '@playwright/test';
import { login } from './helpers';

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

test('viewer sees files but has no upload control', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/leads/view/?id=11111111-1111-1111-1111-111111111111');
  await page.getByRole('tab', { name: 'Files' }).click();
  await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
});
