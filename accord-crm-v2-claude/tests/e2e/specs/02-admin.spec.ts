import { test, expect } from '@playwright/test';
import { login, USERS } from './helpers';
import { G, tokenFor, rpc, fn, count } from './api';

test.describe.serial('Admin / management control centre', () => {
  test('overview, users: invite + temporary-password user, forced password change, deactivate', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'Management overview' })).toBeVisible();
    await expect(page.getByText('Team calls today')).toBeVisible();

    await page.goto('/admin/users/');
    await expect(page.getByRole('row').filter({ hasText: 'bd1@accord.test' })).toContainText('BD Executive');
    // 1) invitation
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Email').fill('invitee@accord.test');
    await page.getByLabel('Full name').fill('Ines Invitee');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation email sent')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'invitee@accord.test' })).toBeVisible();
    // 2) temporary password (weak one is rejected server-side)
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Email').fill('temp@accord.test');
    await page.getByLabel('Full name').fill('Tom Temp');
    await page.getByRole('dialog').getByRole('button', { name: 'Temporary password', exact: true }).click();
    await page.getByLabel(/Temporary password \(/).fill('weak');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('Temporary password must be 12–72 characters')).toBeVisible();
    await page.getByLabel(/Temporary password \(/).fill('Temp-Passw0rd-12');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('User created')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'temp@accord.test' });
    await expect(row).toContainText('must change pw');
    await expect(row).toContainText('100'); // default target

    // the new user is forced to choose a new password at first sign-in
    const ctx = await page.context().browser()!.newContext();
    const p2 = await ctx.newPage();
    await p2.goto('http://127.0.0.1:4173/login/');
    await p2.getByLabel('Email').fill('temp@accord.test');
    await p2.getByLabel('Password').fill('Temp-Passw0rd-12');
    await p2.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p2).toHaveURL(/\/set-password\//);
    await p2.goto('http://127.0.0.1:4173/leads/');
    await expect(p2).toHaveURL(/\/set-password\//); // cannot reach the CRM before changing it
    await p2.getByLabel('New password').fill('Brand-New-Passw0rd-1');
    await p2.getByLabel('Repeat password').fill('Brand-New-Passw0rd-1');
    await p2.getByRole('button', { name: 'Save password' }).click();
    await expect(p2).toHaveURL(/\/dashboard\//);
    await ctx.close();

    // deactivate => blocked immediately and cannot sign in again
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('User deactivated')).toBeVisible();
    await expect(row).toContainText('Deactivated');
    const r = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'temp@accord.test', password: 'Brand-New-Passw0rd-1' }) });
    expect(r.status).toBe(400);
    // cannot demote or deactivate yourself
    await expect(page.getByRole('row').filter({ hasText: 'admin@accord.test' }).getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  });

  test('targets: effective-dated history', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/targets/');
    const bob = page.getByRole('table', { name: 'Current targets' }).getByRole('row').filter({ hasText: 'Bob Dealer' });
    await expect(bob).toContainText('5');
    await bob.getByRole('button', { name: 'Set target' }).click();
    await page.getByLabel('Calls per day').fill('200');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Target saved')).toBeVisible();
    await expect(bob).toContainText('200');
    await expect(page.getByRole('cell', { name: 'ended', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'current', exact: true }).first()).toBeVisible();
  });

  test('reports: daily / weekly / monthly / board render, repeated calls are separate attempts; CSV export', async ({ page }) => {
    const bd = await tokenFor(...USERS.bd2 as [string, string]);
    const lead = '44444444-4444-4444-4444-444444444444';
    for (let i = 0; i < 4; i++) expect((await rpc(bd, 'log_call', { p_lead_id: lead, p_outcome: i % 2 ? 'responded' : 'did_not_respond' })).status).toBe(200);
    const admin = await tokenFor(...USERS.admin as [string, string]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const rep = (await rpc(admin, 'admin_report', { p_from: today, p_to: today })).body;
    const carol = rep.calls.by_user.find((u: any) => u.name === 'Carol Closer');
    expect(carol.total).toBe(4); expect(carol.responded).toBe(2); expect(carol.unique_leads).toBe(1); expect(carol.target).toBe(4);
    expect(carol.achievement_pct).toBe(100); expect(carol.remaining).toBe(0);

    await login(page, 'admin');
    for (const mode of ['daily', 'weekly', 'monthly', 'board', 'custom']) {
      await page.goto(`/admin/reports/${mode}/`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/report/i);
      await expect(page.getByRole('table', { name: 'Calls by user' })).toBeVisible();
    }
    await page.goto('/admin/reports/board/');
    await expect(page.getByText('Executive summary')).toBeVisible();
    await page.goto('/admin/reports/daily/');
    await expect(page.getByRole('table', { name: 'Calls by user' }).getByRole('row').filter({ hasText: 'Carol Closer' })).toContainText('100%');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^accord-daily-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    const fs = await import('node:fs'); const text = fs.readFileSync(await dl.path(), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff); expect(text).toContain('CALLS BY USER'); expect(text).toContain('Carol Closer');
  });

  test('Google sync: preview writes nothing, sync imports, second sync changes nothing; Sheet2 projects; conflicts surfaced', async ({ page }) => {
    const admin = await tokenFor(...USERS.admin as [string, string]);
    const leadsBefore = await count(admin, 'leads');
    await login(page, 'admin');
    await page.goto('/admin/sync/');
    await page.getByRole('button', { name: 'Scan sheet' }).click();
    await expect(page.getByRole('heading', { name: 'Accord New Data' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview (dry run)' }).click();
    await expect(page.getByText('Preview result (nothing written)')).toBeVisible();
    expect(await count(admin, 'leads')).toBe(leadsBefore);
    expect(await count(admin, 'projects')).toBe(0);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Sync now' }).click();
    const res = page.locator('.card', { hasText: 'Sync result' }).first();
    await expect(res).toBeVisible({ timeout: 60_000 });
    const sheet1 = res.getByRole('row').filter({ hasText: 'Sheet1' });
    await expect(sheet1).toContainText('success');
    const cells = async () => (await sheet1.locator('td').allInnerTexts()).map((t) => t.trim());
    let c = await cells();                     // Sheet, Status, Scanned, Inserted, Updated, Skipped, Conflicts, Rejected, Errors
    expect(Number(c[2])).toBe(310); expect(Number(c[3])).toBe(307); expect(Number(c[4])).toBe(1); expect(Number(c[6])).toBe(2);
    const leadsAfter = await count(admin, 'leads');
    expect(leadsAfter).toBe(leadsBefore + 307);
    expect(await count(admin, 'projects')).toBe(6);
    const contactsAfter = await count(admin, 'contacts'); const fuAfter = await count(admin, 'follow_ups', 'origin=eq.google_sheet');

    // run it again: nothing may change
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect.poll(async () => (await page.locator('.card', { hasText: 'Sync result' }).first().getByRole('row').filter({ hasText: 'Sheet1' }).locator('td').allInnerTexts()).map((t) => t.trim())[5], { timeout: 60_000 }).toBe('308');
    c = (await page.locator('.card', { hasText: 'Sync result' }).first().getByRole('row').filter({ hasText: 'Sheet1' }).locator('td').allInnerTexts()).map((t) => t.trim());
    expect(Number(c[3])).toBe(0); expect(Number(c[4])).toBe(0); expect(Number(c[6])).toBe(2);
    expect(await count(admin, 'leads')).toBe(leadsAfter);
    expect(await count(admin, 'contacts')).toBe(contactsAfter);
    expect(await count(admin, 'follow_ups', 'origin=eq.google_sheet')).toBe(fuAfter);
    expect(await count(admin, 'projects')).toBe(6);
    expect(await count(admin, 'call_attempts', 'source=eq.import')).toBe(0); // legacy "Called" is not call history
    const sheet2 = page.locator('.card', { hasText: 'Sync result' }).first().getByRole('row').filter({ hasText: 'Sheet2' });
    expect((await sheet2.locator('td').allInnerTexts()).map((t) => t.trim())[3]).toBe('0');

    // history lists both runs; conflicts are inspectable
    await page.reload();
    const hist = page.getByRole('table', { name: 'Sync history' });
    await expect(hist.getByRole('row').filter({ hasText: 'Sheet1' }).first()).toBeVisible();
    await hist.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByText('already belongs to a different, manually created company').first()).toBeVisible();

    // parsed data is correct (multi-contact, multi-email/phone, LinkedIn cleaned)
    const il = (await (await fetch(`${G}/rest/v1/contacts?select=full_name,job_title,emails,phones,linkedin,dedupe_key&lead_id=in.(${(await (await fetch(`${G}/rest/v1/leads?select=id&external_lead_id=eq.2`, { headers: { Authorization: `Bearer ${admin}`, apikey: 'x' } })).json())[0].id})`, { headers: { Authorization: `Bearer ${admin}`, apikey: 'x' } })).json());
    const general = il.find((x: any) => x.dedupe_key === 'general');
    expect(general.emails).toEqual(['info@ilcazar.com', 'marieelwy@gmail.com']);
    expect(general.phones).toEqual(['01025408565', '01287777850', '01000774338']);
    expect(general.linkedin).toEqual(['https://www.linkedin.com/in/ahmed-elwy-ali-marie-b25072112']);
    expect(il.filter((x: any) => x.full_name).map((x: any) => `${x.full_name}|${x.job_title}`).sort()).toEqual(['Ahmed Elwy|CDO', 'Ahmed Morsi|Sales Director']);
  });

  test('audit log, configuration and system status', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/audit/');
    await page.getByLabel('Action').fill('google_import');
    await expect(page.getByRole('table', { name: 'Audit log' }).getByRole('row').nth(1)).toContainText('google_import');
    await page.getByLabel('Action').fill('target');
    await expect(page.getByRole('table', { name: 'Audit log' })).toContainText('target_');
    await page.getByLabel('Action').fill('role_changed');
    await page.getByLabel('Action').fill('user_');
    await expect(page.getByRole('table', { name: 'Audit log' })).toContainText('user_');
    await page.getByLabel('Action').fill('');
    await page.getByRole('button', { name: 'Diff' }).first().click();
    await expect(page.getByText('Old').first()).toBeVisible();

    await page.goto('/admin/config/');
    await page.getByRole('button', { name: 'Fri', exact: true }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.getByRole('button', { name: 'Fri', exact: true }).click();

    await page.goto('/admin/status/');
    await expect(page.getByText('Reachable')).toBeVisible();
    await expect(page.getByText('Working')).toBeVisible();
    await expect(page.getByText('Online')).toBeVisible();
  });

  test('google function reports a clear, safe error when credentials are missing', async () => {
    const admin = await tokenFor(...USERS.admin as [string, string]);
    const r = await fn(admin, 'google-sheet-sync', { action: 'scan' }, { 'x-test-no-creds': '1' });
    expect(r.status).toBe(412);
    expect(JSON.stringify(r.body)).toMatch(/not configured/i);
    expect(JSON.stringify(r.body)).not.toMatch(/PRIVATE KEY/);
  });
});
