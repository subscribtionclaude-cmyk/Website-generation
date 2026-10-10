import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { login, cairoDate, USERS } from './helpers';
import { tokenFor, rpc } from './api';

// Excel workbook → { sheetName: [[cell, …], …] } (inline-string / number cells as written by src/lib/xlsx.ts)
function readXlsx(path: string) {
  const z = unzipSync(readFileSync(path));
  const names = [...strFromU8(z['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const sheets: Record<string, string[][]> = {}; const xml: Record<string, string> = {};
  names.forEach((n, i) => {
    const x = strFromU8(z[`xl/worksheets/sheet${i + 1}.xml`]); xml[n] = x;
    sheets[n] = [...x.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)<\/c>)/g)].map((c) => (c[1] ?? c[2] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')));
  });
  const all = Object.values(z).map((u) => strFromU8(u)).join('\n');
  return { names, sheets, xml, all };
}
async function runExport(page: Page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible();
  return { name: dl.suggestedFilename(), x: readXlsx((await dl.path())!) };
}
const SECRETS = /eyJ[A-Za-z0-9_-]{10,}\.eyJ|service_role|BEGIN [A-Z ]*PRIVATE KEY|sb_secret_|e2e-only-jwt|Pass-12345/;
const dataRows = (rows: string[][]) => rows.slice(1).filter((r) => r.some((c) => c !== ''));

test.describe.serial('exports and language switch', () => {
  test.beforeAll(async () => {
    // make sure there is at least one call today regardless of which specs ran before
    const bd = await tokenFor(...USERS.bd1 as [string, string]);
    const r = await rpc(bd, 'log_call', { p_lead_id: '11111111-1111-1111-1111-111111111111', p_outcome: 'responded' });
    expect(r.status).toBeLessThan(300);
  });

  test('language quick switch after login keeps the page and route', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/?q=amer');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leads');
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('العملاء المحتملون');
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/leads/?q=amer');
    await expect(page.getByRole('link', { name: 'Amer Group' })).toBeVisible();
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leads');
  });

  test('language switch keeps an open dialog and its unsaved values (EN → AR → EN)', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/');
    await page.getByRole('button', { name: 'New lead' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'New lead' })).toBeVisible();
    const company = dlg.getByLabel('Company *');
    const notes = dlg.getByRole('textbox', { name: 'Notes', exact: true });
    const website = dlg.getByLabel('Website');
    await company.fill('Unsaved Draft Co');
    await website.fill('draft.example');
    await notes.fill('Meeting notes typed but not saved\nsecond line');
    await dlg.locator('select').first().selectOption({ index: 1 });
    const temp = await dlg.locator('select').first().inputValue();
    // the toggle sits under the dialog overlay; switch the language exactly as the app does, without closing the dialog
    await page.getByTestId('lang-toggle').first().dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(dlg.getByRole('heading', { name: 'عميل جديد' })).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: 'ملاحظات', exact: true })).toHaveValue('Meeting notes typed but not saved\nsecond line');
    await expect(dlg.getByRole('textbox', { name: 'الموقع الإلكتروني' })).toHaveValue('draft.example');
    await expect(dlg.locator('input').first()).toHaveValue('Unsaved Draft Co');
    await expect(dlg.locator('select').first()).toHaveValue(temp);
    // keep typing in Arabic mode, then switch back
    await dlg.getByRole('textbox', { name: 'ملاحظات', exact: true }).press('End');
    await dlg.getByRole('textbox', { name: 'ملاحظات', exact: true }).pressSequentially(' +AR');
    await page.getByTestId('lang-toggle').first().dispatchEvent('click');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(dlg.getByRole('heading', { name: 'New lead' })).toBeVisible();
    await expect(company).toHaveValue('Unsaved Draft Co');
    await expect(website).toHaveValue('draft.example');
    await expect(notes).toHaveValue('Meeting notes typed but not saved\nsecond line +AR');
    await expect(dlg.locator('select').first()).toHaveValue(temp);
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('admin full CRM export: one workbook, all sheets, real data, no secrets, audited', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/export/');
    await page.getByTestId('open-export-full').click();
    await expect(page.getByTestId('export-active-filters')).toContainText('All time');
    const { name, x } = await runExport(page);
    expect(name).toBe(`ACCORD_CRM_FULL_EXPORT_${cairoDate(0)}.xlsx`);
    expect(x.names).toEqual(['Leads', 'Contacts', 'Calls', 'Follow-Ups', 'Meetings', 'Meeting Minutes', 'Forms', 'Proposals', 'Pipeline', 'Activities', 'Projects']);
    expect(x.sheets.Leads[0]).toEqual(expect.arrayContaining(['Lead ID', 'Company', 'Temperature', 'Pipeline stage', 'Assigned user', 'Current milestone']));
    expect(x.sheets.Leads.map((r) => r[1])).toContain('Amer Group');
    expect(dataRows(x.sheets.Calls).length).toBeGreaterThan(0);
    expect(x.sheets.Calls[0]).toEqual(expect.arrayContaining(['Outcome', 'Result', 'Detail']));
    expect(x.sheets['Meeting Minutes'][0]).toEqual(expect.arrayContaining(['Minutes of meeting', 'Outcome', 'Next step']));
    expect(x.sheets.Proposals[0]).toEqual(expect.arrayContaining(['Proposal', 'Status', 'Client response', 'Decision']));
    expect(x.sheets.Meetings[0]).toEqual(expect.arrayContaining(['Attendance', 'Replacement for', 'Next meeting']));
    expect(x.all).not.toMatch(SECRETS);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByRole('table', { name: 'Recent exports' })).toContainText('full');
  });

  test('period filter: calls outside the range are excluded', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/export/');
    await page.getByTestId('open-export-leads').click();
    await page.getByTestId('export-type-calls').click();
    await page.getByRole('radio', { name: 'Custom' }).click();
    await page.getByTestId('export-from').fill('2020-01-01'); await page.getByTestId('export-to').fill('2020-01-31');
    await expect(page.getByTestId('export-active-filters')).toContainText('2020');
    const past = await runExport(page);
    expect(past.name).toMatch(/^ACCORD_CRM_Calls_.*__period_2020-01-01_to_2020-01-31\.xlsx$/);
    expect(dataRows(past.x.sheets.Calls)).toHaveLength(0);
    await page.getByRole('radio', { name: 'Today' }).click();
    const now = await runExport(page);
    expect(dataRows(now.x.sheets.Calls).length).toBeGreaterThan(0);
  });

  for (const [kind, label, re] of [['daily', 'Daily', /^ACCORD_Board_Report_Daily_\d{4}-\d\d-\d\d\.xlsx$/], ['weekly', 'Weekly', /^ACCORD_Board_Report_Weekly_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.xlsx$/], ['monthly', 'Monthly', /^ACCORD_Board_Report_Monthly_\d{4}-\d\d\.xlsx$/]] as const) {
    test(`board report ${kind}: Excel with executive summary, BD performance and risks`, async ({ page }) => {
      await login(page, 'admin');
      await page.goto('/admin/reports/board/');
      await page.getByTestId('board-export').click();
      await page.getByRole('radio', { name: label, exact: true }).click();
      await page.getByRole('radio', { name: /Excel/ }).click();
      const { name, x } = await runExport(page);
      expect(name).toMatch(re);
      expect(x.names).toEqual(['Executive Summary', 'BD Performance', 'Pipeline', 'Meetings', 'Proposals', 'Follow-Ups', 'Next Actions & Risks']);
      const summary = x.sheets['Executive Summary'].map((r) => r.join(' | ')).join('\n');
      expect(summary).toContain('Board Members Report'); expect(summary).toContain('Africa/Cairo');
      for (const k of ['Total leads', 'Total call attempts', 'Response rate', 'Meetings held', 'Overdue follow-ups (now)', 'Accepted proposals']) expect(summary).toContain(k);
      expect(x.sheets['BD Performance'].map((r) => r[0])).toContain('Bob Dealer');
      expect(x.all).not.toMatch(SECRETS);
    });
  }

  test('board report PDF: branded print document with the right file name, renders to a real PDF', async ({ page, browser }) => {
    await login(page, 'admin');
    await page.goto('/admin/reports/weekly/');
    await page.getByTestId('board-export').click();
    await expect(page.getByRole('radio', { name: 'Weekly', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('export-run').click();
    await expect(page.getByTestId('export-done')).toContainText(/ACCORD_Board_Report_Weekly_.*\.pdf/);
    const frame = page.getByTestId('board-report-print');
    const html = await frame.getAttribute('srcdoc');
    expect(html).toContain('Board Members Report'); expect(html).toContain('BD performance'); expect(html).toContain('/brand/accord-logo-light.png');
    expect(await frame.getAttribute('title')).toMatch(/^ACCORD_Board_Report_Weekly_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d$/);
    const p2 = await browser.newPage();
    await p2.setContent(html!.replace(/http:\/\/127\.0\.0\.1:4173/g, 'http://127.0.0.1:4173'), { waitUntil: 'load' });
    const pdf = await p2.pdf({ format: 'A4', printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(20_000);
    await p2.close();
  });

  test('Arabic export: Arabic headers, RTL sheets and an Arabic RTL PDF document', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/reports/board/');
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('board-export').click();
    await page.getByRole('radio', { name: 'شهري', exact: true }).click();
    await page.getByRole('radio', { name: /Excel/ }).click();
    const board = await runExport(page);
    expect(board.x.names).toContain('الملخص التنفيذي');
    expect(board.x.xml['الملخص التنفيذي']).toContain('rightToLeft="1"');
    expect(board.x.sheets['الملخص التنفيذي'].flat().join(' ')).toContain('تقرير أعضاء مجلس الإدارة');
    await page.getByRole('radio', { name: 'PDF' }).click();
    await page.getByTestId('export-run').click();
    const html = await page.getByTestId('board-report-print').getAttribute('srcdoc');
    expect(html).toContain('dir="rtl"'); expect(html).toContain('الملخص التنفيذي');
    await page.keyboard.press('Escape');
    await page.goto('/admin/export/');
    await page.getByTestId('open-export-leads').click();
    const leads = await runExport(page);
    expect(leads.x.sheets[leads.x.names[0]][0]).toEqual(expect.arrayContaining(['رقم العميل', 'الشركة', 'درجة الاهتمام']));
    expect(leads.x.sheets[leads.x.names[0]].flat()).toContain('Amer Group'); // data stays as entered
    await page.keyboard.press('Escape');
    await page.getByTestId('lang-toggle').first().click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('permissions: BD exports only datasets; viewer has no export at all (UI and API)', async ({ page, browser }) => {
    await login(page, 'bd1');
    await page.goto('/leads/');
    await page.getByTestId('leads-export').click();
    await expect(page.getByTestId('export-type-leads')).toBeVisible();
    await expect(page.getByTestId('export-type-full')).toHaveCount(0);
    await expect(page.getByTestId('export-type-board')).toHaveCount(0);
    const { x } = await runExport(page);
    expect(x.sheets.Leads.length).toBeGreaterThan(1);
    await page.keyboard.press('Escape');
    await page.goto('/admin/export/');
    await expect(page).toHaveURL(/\/dashboard\//);
    const bd = await tokenFor(...USERS.bd1 as [string, string]);
    expect((await rpc(bd, 'log_export', { p_kind: 'full', p_format: 'xlsx' })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(bd, 'log_export', { p_kind: 'board', p_format: 'pdf' })).status).toBeGreaterThanOrEqual(400);

    const vp = await (await browser.newContext()).newPage();
    await login(vp, 'viewer');
    await vp.goto('/leads/');
    await expect(vp.getByRole('heading', { level: 1 })).toHaveText('Leads');
    await expect(vp.getByTestId('leads-export')).toHaveCount(0);
    await vp.goto('/admin/export/');
    await expect(vp).toHaveURL(/\/dashboard\//);
    const v = await tokenFor(...USERS.viewer as [string, string]);
    expect((await rpc(v, 'log_export', { p_kind: 'leads', p_format: 'xlsx' })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(null, 'log_export', { p_kind: 'leads', p_format: 'xlsx' })).status).toBeGreaterThanOrEqual(400);
  });
});
