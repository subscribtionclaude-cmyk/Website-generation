import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { login, USERS } from './helpers';
import { G, tokenFor, rest, rpc, fn } from './api';

// V6 governance: role templates, Management Viewer privacy (department only by default — enforced by the server),
// user overrides, preview-as-role (read-only), terminology, role-change summary, direct API bypass attempts.
const NAMES = /Bob Dealer|Carol Closer|bd1@accord\.test|bd2@accord\.test/;
const tok = (who: keyof typeof USERS) => tokenFor(...USERS[who] as unknown as [string, string]);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const xlsxText = (path: string) => Object.values(unzipSync(readFileSync(path))).map((u) => strFromU8(u)).join('\n');
async function viewerId() { return (await rest(await tok('admin'), 'profiles?select=id&email=eq.viewer@accord.test')).body[0].id as string; }
async function mgmtResponse(page: Page, action: () => Promise<unknown>) {
  const [r] = await Promise.all([page.waitForResponse((x) => x.url().includes('/rpc/management_report')), action()]);
  return r.json() as Promise<Record<string, any>>;
}

test.describe.serial('governance, roles & permissions', () => {
  test.beforeAll(async () => {
    const r = await rpc(await tok('bd1'), 'log_call', { p_lead_id: '11111111-1111-1111-1111-111111111111', p_outcome: 'responded' });
    expect(r.status).toBeLessThan(300); // there is activity today for the department totals
  });

  test('management viewer default: department totals only — no employee rows or names in the API response or the page', async ({ page }) => {
    await login(page, 'admin'); // sanity: admin reaches the same page with the individual table
    const adminBody = await mgmtResponse(page, () => page.goto('/management/'));
    expect(adminBody.calls.by_user.length).toBeGreaterThan(0);
    await expect(page.getByTestId('mgmt-individual')).toContainText('Bob Dealer');
    await page.evaluate(() => localStorage.clear());

    const body = await mgmtResponse(page, () => login(page, 'viewer', /\/management\//));
    expect(body.calls).not.toHaveProperty('by_user');
    expect(body.scope).toEqual({ individual: false, names: false, targets: false });
    expect(JSON.stringify(body)).not.toMatch(NAMES);
    expect(body).not.toHaveProperty('critical_follow_ups');
    expect(body.calls.total).toBeGreaterThan(0);
    await expect(page.getByTestId('mgmt-snapshot')).toBeVisible();
    await expect(page.getByTestId('mgmt-department')).toContainText('Department call target');
    await expect(page.getByTestId('mgmt-department-only')).toBeVisible();
    await expect(page.getByTestId('mgmt-individual')).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toMatch(NAMES);
    // periods (Cairo): today / this week / this month / custom
    for (const p of ['this_week', 'this_month']) {
      const b = await mgmtResponse(page, () => page.getByTestId(`mgmt-period-${p}`).click());
      expect(b.range.timezone).toBe('Africa/Cairo');
      expect(b.calls).not.toHaveProperty('by_user');
    }
  });

  test('viewer reports + management summary export follow the privacy settings (no names)', async ({ page }) => {
    await login(page, 'viewer', /\/management\//);
    await expect(page.getByTestId('mgmt-reports')).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mgmt-export').click()]);
    expect(dl.suggestedFilename()).toBe(`ACCORD_Management_Summary_${today()}.xlsx`);
    const x = xlsxText((await dl.path())!);
    expect(x).toContain('Department call target');
    expect(x).not.toMatch(NAMES);
    const [d2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mgmt-report-weekly-xlsx').click()]);
    expect(d2.suggestedFilename()).toMatch(/^ACCORD_Management_Weekly_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(xlsxText((await d2.path())!)).not.toMatch(NAMES);
    await page.evaluate(() => { (window as unknown as { print: () => void }).print = () => {}; });
    await page.getByTestId('mgmt-report-board-pdf').click();
    const frame = page.getByTestId('board-report-print');
    await expect(frame).toHaveCount(1);
    const html = await frame.evaluate((f) => (f as HTMLIFrameElement).srcdoc);
    expect(html).toContain('Board / executive summary');
    expect(html).not.toMatch(NAMES);
    // audited as a management export
    const audit = (await rest(await tok('admin'), 'audit_logs?select=entity_id,meta&entity=eq.export&entity_id=eq.management&order=id.desc&limit=3')).body;
    expect(audit.length).toBeGreaterThan(0);
  });

  test('roles page: Individual breakdown for the viewer role; names are a separate switch; dependencies switch off together', async ({ page, browser }) => {
    await login(page, 'admin');
    await page.goto('/admin/roles/');
    await expect(page.getByTestId('visibility-mode')).toBeVisible();
    await expect(page.getByTestId('perm-export.full')).toContainText('Admin only');
    await expect(page.getByTestId('perm-admin.users')).toContainText('Admin only');
    await page.getByTestId('visibility-mode').getByRole('radio', { name: 'Individual breakdown' }).click();
    await expect(page.getByText('Permission saved')).toBeVisible();

    const v = await (await browser.newContext()).newPage();
    let body = await mgmtResponse(v, () => login(v, 'viewer', /\/management\//));
    expect(body.calls.by_user.length).toBeGreaterThan(0);
    expect(body.calls.by_user[0]).toHaveProperty('member');
    expect(body.calls.by_user[0]).not.toHaveProperty('name');
    expect(JSON.stringify(body)).not.toMatch(NAMES);
    await expect(v.getByTestId('mgmt-individual')).toContainText('Sales member 1');

    await page.getByTestId('perm-perf.names').getByRole('switch').click(); // saved server-side, then reflected
    await expect(page.getByTestId('perm-perf.names').getByRole('switch')).toBeChecked();
    body = await mgmtResponse(v, () => v.reload());
    expect(JSON.stringify(body)).toMatch(/Bob Dealer|Carol Closer/);
    // back to Department only → names switch off with it (dependency)
    await page.getByTestId('visibility-mode').getByRole('radio', { name: 'Department only' }).click();
    await expect(page.getByText(/dependent permissions also turned off/)).toBeVisible();
    await expect(page.getByTestId('perm-perf.names').getByRole('switch')).not.toBeChecked();
    body = await mgmtResponse(v, () => v.reload());
    expect(body.calls).not.toHaveProperty('by_user');
    await v.context().close();
  });

  test('user override: Manage permissions shows inherited / override / effective; reset to role defaults', async ({ page, browser }) => {
    await login(page, 'admin');
    await page.goto('/admin/users/');
    await page.getByRole('searchbox', { name: 'Search users' }).fill('viewer@accord.test');
    const row = page.getByRole('row').filter({ hasText: 'viewer@accord.test' });
    await row.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Manage permissions' }).click();
    const dlg = page.getByRole('dialog');
    const ind = dlg.getByTestId('uperm-perf.individual');
    await expect(ind).toContainText('Role default: Denied');
    await ind.getByRole('radio', { name: 'Allow' }).click();
    await expect(ind).toContainText('Effective: Allowed');
    await expect(ind).toContainText('Override');
    await expect(dlg.getByTestId('uperm-export.full')).toContainText('Not available');
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(row.getByTestId('badge-overrides')).toBeVisible();

    const v = await (await browser.newContext()).newPage();
    const body = await mgmtResponse(v, () => login(v, 'viewer', /\/management\//));
    expect(body.calls.by_user.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(NAMES); // names still need their own permission
    expect((await rest(await tok('viewer'), 'call_attempts?select=id')).body).toEqual([]); // raw still denied
    await v.context().close();

    await row.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Manage permissions' }).click();
    await dlg.getByTestId('reset-overrides').click();
    await expect(dlg.getByTestId('uperm-perf.individual')).toContainText('Effective: Denied');
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(row.getByTestId('badge-overrides')).toHaveCount(0);
  });

  test('preview as Management Viewer: UI-only, read-only, admin identity unchanged', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/roles/');
    const body = await mgmtResponse(page, () => page.getByTestId('preview-role').click());
    await expect(page).toHaveURL(/\/management\//);
    await expect(page.getByTestId('preview-banner')).toContainText('Previewing Management Viewer');
    expect(body.calls).not.toHaveProperty('by_user'); // rendered as the viewer template, even though the caller is admin
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Leads', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Admin dashboard' })).toHaveCount(0);
    // writes are refused while previewing (nothing executes as anyone). In-app navigation: a reload ends the preview.
    const a = await tok('admin');
    try {
      await page.locator('.sidebar .usercard').click();
      await page.getByLabel('Phone').fill('+20 100 000 0000');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/Preview mode is read-only/)).toBeVisible();
      expect((await rest(a, 'profiles?select=phone&email=eq.admin@accord.test')).body[0].phone).not.toBe('+20 100 000 0000');
      // a reload ends the preview (it is never persisted)
    } finally {
      await rest(a, 'profiles?email=eq.admin@accord.test', { method: 'PATCH', body: JSON.stringify({ phone: null }) });
    }
    await page.getByTestId('exit-preview').click();
    await expect(page).toHaveURL(/\/admin\/roles\//);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
  });

  test('terminology: custom English / Arabic labels, blank Arabic falls back to the product translation, role keys unchanged', async ({ page, browser }) => {
    await login(page, 'admin');
    await page.goto('/admin/terminology/');
    await page.getByLabel('Sales — English').fill('Business Development');
    await page.getByLabel('Management Dashboard — English').fill('Executive Dashboard');
    await page.getByLabel('Management Dashboard — العربية').fill('لوحة التنفيذيين');
    await page.getByTestId('terminology-save').click();
    await expect(page.getByText('Terminology saved')).toBeVisible();
    await page.goto('/admin/users/');
    await expect(page.getByRole('row').filter({ hasText: 'bd1@accord.test' })).toContainText('Business Development');
    expect((await rest(await tok('admin'), 'profiles?select=role&email=eq.bd1@accord.test')).body[0].role).toBe('bd_executive');

    const v = await (await browser.newContext()).newPage();
    await login(v, 'viewer', /\/management\//);
    await expect(v.getByRole('heading', { level: 1 })).toHaveText('Executive Dashboard');
    await v.getByTestId('lang-toggle').first().click();
    await expect(v.getByRole('heading', { level: 1 })).toHaveText('لوحة التنفيذيين');
    await v.goto('/settings/');
    await expect(v.locator('.sidebar .usercard')).toContainText('مشاهد الإدارة'); // viewer role label: product Arabic default
    await v.getByTestId('lang-toggle').first().click();
    await v.context().close();
    // restore defaults
    await page.goto('/admin/terminology/');
    for (const l of ['Sales — English', 'Management Dashboard — English', 'Management Dashboard — العربية']) await page.getByLabel(l).fill('');
    await page.getByTestId('terminology-save').click();
    await expect(page.getByText('Terminology saved')).toBeVisible();
    const aud = (await rest(await tok('admin'), 'audit_logs?select=action&entity=eq.settings&entity_id=eq.terminology')).body;
    expect(aud.length).toBeGreaterThanOrEqual(2);
  });

  test('role change shows access gained / lost and needs confirmation', async ({ page }) => {
    const a = await tok('admin');
    const mk = await fn(a, 'admin-users', { action: 'create', email: 'rolechange@accord.test', full_name: 'Rolf Change', role: 'viewer', temporary_password: 'Rolf-Passw0rd-123' });
    expect(mk.status).toBe(200);
    await login(page, 'admin');
    await page.goto('/admin/users/');
    await page.getByRole('searchbox', { name: 'Search users' }).fill('rolechange');
    await page.getByRole('row').filter({ hasText: 'rolechange@accord.test' }).getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Edit user' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('select').first().selectOption('bd_executive');
    await dlg.getByTestId('edit-user-save').click();
    const sum = dlg.getByTestId('role-change-summary');
    await expect(sum).toContainText('Changing role from Management Viewer to Sales');
    await expect(sum).toContainText('Raw call records');   // gained
    await expect(sum).toContainText('Management dashboard'); // lost
    expect((await rest(a, `profiles?select=role&id=eq.${mk.body.user_id}`)).body[0].role).toBe('viewer'); // nothing saved yet
    await dlg.getByRole('button', { name: 'Confirm role change' }).click();
    await expect(page.getByText('User updated')).toBeVisible();
    expect((await rest(a, `profiles?select=role&id=eq.${mk.body.user_id}`)).body[0].role).toBe('bd_executive');
    expect((await fn(a, 'admin-users', { action: 'delete', user_id: mk.body.user_id })).status).toBe(200);
  });

  test('sales: operational CRM only — no management dashboard, no admin', async ({ page }) => {
    await login(page, 'bd1');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Leads', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Management Dashboard' })).toHaveCount(0);
    await page.goto('/management/');
    await expect(page).toHaveURL(/\/dashboard\//);
    await page.goto('/admin/roles/');
    await expect(page).toHaveURL(/\/dashboard\//);
  });

  test('direct API bypass attempts are refused by the database', async () => {
    const v = await tok('viewer'); const s = await tok('bd1'); const vid = await viewerId();
    const d = today();
    // viewer: aggregates yes, employee rows / raw rows / config no
    const mr = await rpc(v, 'management_report', { p_from: d, p_to: d });
    expect(mr.status).toBe(200); expect(mr.body.calls.by_user).toBeUndefined(); expect(JSON.stringify(mr.body)).not.toMatch(NAMES);
    expect((await rpc(v, 'management_report', { p_from: d, p_to: d, p_preview_role: 'admin' })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(v, 'admin_report', { p_from: d, p_to: d })).status).toBeGreaterThanOrEqual(400);
    for (const table of ['leads', 'contacts', 'call_attempts', 'meetings', 'proposals', 'follow_ups', 'activities']) expect((await rest(v, `${table}?select=id`)).body, table).toEqual([]);
    expect((await rpc(v, 'admin_set_role_permission', { p_role: 'viewer', p_perm: 'perf.individual', p_allowed: true })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(v, 'admin_set_user_override', { p_user: vid, p_perm: 'perf.names', p_allowed: true })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(v, 'role_template', { p_role: 'admin' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(v, 'role_permissions', { method: 'POST', body: JSON.stringify({ role: 'viewer', perm: 'perf.individual', allowed: true }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(v, 'user_permission_overrides', { method: 'POST', body: JSON.stringify({ user_id: vid, perm: 'perf.individual', allowed: true }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(v, 'log_export', { p_kind: 'full', p_format: 'xlsx' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(v, 'leads', { method: 'POST', body: JSON.stringify({ name: 'nope' }) })).status).toBeGreaterThanOrEqual(400);
    // sales: no management / permission administration
    expect((await rpc(s, 'management_report', { p_from: d, p_to: d })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(s, 'admin_set_user_override', { p_user: vid, p_perm: 'perf.individual', p_allowed: true })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(s, 'admin_set_terminology', { p_labels: { role_sales: { en: 'x' } } })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(s, 'user_effective_permissions', { p_user: vid })).status).toBeGreaterThanOrEqual(400);
    // anonymous
    for (const f of ['my_permissions', 'has_perm', 'management_report']) expect((await rpc(null, f, f === 'has_perm' ? { p: 'mgmt.dashboard' } : f === 'management_report' ? { p_from: d, p_to: d } : {})).status, f).toBeGreaterThanOrEqual(400);
    // the viewer's own effective permissions
    const mp = await rpc(v, 'my_permissions');
    expect(mp.body.role).toBe('viewer'); expect(mp.body.perms['perf.individual']).toBe(false); expect(mp.body.perms['export.full']).toBe(false);
    void G;
  });
});
