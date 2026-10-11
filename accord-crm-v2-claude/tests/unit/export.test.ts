import { describe, expect, it, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

// modules that import the Supabase client expect a browser-like global
(globalThis as unknown as { window: unknown }).window = { location: { origin: 'https://crm.example' } };
let X: typeof import('../../src/lib/xlsx');
let E: typeof import('../../src/lib/exportData');
let B: typeof import('../../src/lib/boardReport');
beforeAll(async () => {
  X = await import('../../src/lib/xlsx');
  E = await import('../../src/lib/exportData');
  B = await import('../../src/lib/boardReport');
});

describe('export periods (Africa/Cairo)', () => {
  it('resolves presets on the Cairo calendar', () => {
    expect(E.resolvePeriod({ kind: 'all' }, '2026-10-10')).toBeNull();
    expect(E.resolvePeriod({ kind: 'today' }, '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(E.resolvePeriod({ kind: 'this_week' }, '2026-10-10')).toEqual({ from: '2026-10-04', to: '2026-10-10' }); // Sun–Sat
    expect(E.resolvePeriod({ kind: 'this_month' }, '2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(E.resolvePeriod({ kind: 'custom', from: '2026-10-09', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-09' });
  });
  it('day bounds are Cairo midnight to Cairo midnight (UTC+3 in summer, UTC+2 in winter)', () => {
    expect(E.instantBounds({ from: '2026-07-10', to: '2026-07-10' })).toEqual({ gte: '2026-07-09T21:00:00.000Z', lt: '2026-07-10T21:00:00.000Z' });
    expect(E.instantBounds({ from: '2026-01-10', to: '2026-01-10' })).toEqual({ gte: '2026-01-09T22:00:00.000Z', lt: '2026-01-10T22:00:00.000Z' });
    // a call at 23:59 Cairo belongs to that day, 00:00 Cairo of the next day does not
    const b = E.instantBounds({ from: '2026-10-10', to: '2026-10-10' });
    expect('2026-10-10T20:59:00.000Z' >= b.gte && '2026-10-10T20:59:00.000Z' < b.lt).toBe(true);
    expect('2026-10-10T21:00:00.000Z' < b.lt).toBe(false);
  });
  it('board report periods and file names', () => {
    expect(B.boardPeriod('daily', '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(B.boardPeriod('weekly', '2026-10-07')).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    expect(B.boardPeriod('monthly', '2026-10-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(B.boardPeriod('custom', '2026-10-09', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-09' });
    expect(B.boardFileName('daily', { from: '2026-10-10', to: '2026-10-10' }, 'pdf')).toBe('ACCORD_Board_Report_Daily_2026-10-10.pdf');
    expect(B.boardFileName('weekly', { from: '2026-10-04', to: '2026-10-10' }, 'xlsx')).toBe('ACCORD_Board_Report_Weekly_2026-10-04_to_2026-10-10.xlsx');
    expect(B.boardFileName('monthly', { from: '2026-10-01', to: '2026-10-31' }, 'pdf')).toBe('ACCORD_Board_Report_Monthly_2026-10.pdf');
    expect(E.exportFileName('full', { kind: 'all' }, '2026-10-10')).toBe('ACCORD_CRM_FULL_EXPORT_2026-10-10.xlsx');
  });
});

describe('xlsx writer', () => {
  it('writes a valid workbook: sheets, header, escaping, numbers, RTL, safe sheet names', () => {
    const bytes = X.buildXlsx([
      { name: 'Leads', header: ['Company', 'Calls'], rows: [['A & B <Co>', 3], ['شركة الأمل', 0], [null, undefined]] },
      { name: 'Bad/Name:*?[x]', rows: [['x']] },
      { name: 'Leads', rows: [] },
    ], { rtl: true });
    const z = unzipSync(bytes);
    const wb = strFromU8(z['xl/workbook.xml']);
    expect(wb).toContain('name="Leads"'); expect(wb).toMatch(/name="Bad Name\s+x"/); expect(wb).not.toMatch(/name="[^"]*[\/:*?[\]]/); expect(wb).toContain('name="Leads 2"');
    const s1 = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(s1).toContain('rightToLeft="1"');
    expect(s1).toContain('A &amp; B &lt;Co&gt;');
    expect(s1).toContain('شركة الأمل');
    expect(s1).toContain('<c r="B2"><v>3</v></c>');
    expect(s1).toContain('state="frozen"');
    expect(strFromU8(z['[Content_Types].xml'])).toContain('sheet3.xml');
  });
});
