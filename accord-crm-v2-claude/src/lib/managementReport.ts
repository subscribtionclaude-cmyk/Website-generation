import { supabase } from './supabase';
import { currentLang, t, personName } from './i18n';
import { term } from './terminology';
import { fmtDate, fmtDateTime } from './cairo';
import { STAGE_LABEL } from './labels';
import type { Cell, Sheet } from './xlsx';

// Management reporting built ONLY from management_report(): the database decides what the caller may see (department
// aggregates always; employee rows only with the individual-performance permission; names / individual targets only
// with their own permissions). Nothing here re-adds or derives employee data.
export interface MgmtMember {
  name?: string; member?: number; active: boolean; total: number; responded: number; did_not_respond: number; unique_leads: number;
  response_rate: number | null; meetings_generated: number; proposals_generated: number;
  follow_ups_due?: number; follow_ups_completed?: number; follow_ups_overdue?: number; won?: number; lost?: number; target?: number; achievement_pct?: number | null; remaining?: number;
}
export interface Mgmt {
  range: { from: string; to: string; timezone: string; generated_at: string };
  scope: { individual: boolean; names: boolean; targets: boolean };
  calls: { total: number; responded: number; did_not_respond: number; unique_leads: number; response_rate: number | null; target: number; achievement_pct: number | null; remaining: number;
    by_day: { date: string; total: number; responded: number; did_not_respond: number; unique_leads: number; target: number }[]; by_user?: MgmtMember[] };
  meetings: Record<string, number>;
  commercial: Record<string, number>;
  follow_ups: Record<string, number>;
  pipeline: { stage: string; label: string; current: number; entered: number }[];
  period: { leads_new: number; won: number; lost: number };
  snapshot: { leads: Record<string, number>; follow_ups: Record<string, number>; meetings: Record<string, number>; proposals: Record<string, number> };
}
export type MgmtKind = 'daily' | 'weekly' | 'monthly' | 'board' | 'summary';

export async function fetchManagement(from: string, to: string, previewRole?: string | null): Promise<Mgmt> {
  const { data, error } = await supabase.rpc('management_report', { p_from: from, p_to: to, ...(previewRole ? { p_preview_role: previewRole } : {}) });
  if (error) throw new Error(error.message);
  return data as unknown as Mgmt;
}

export const memberName = (m: MgmtMember) => (m.name !== undefined ? personName(m.name) : t('Sales member {n}', { n: m.member ?? '' }));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Metric blocks — the same content for screen, Excel and PDF. */
export function mgmtBlocks(D: Mgmt): { title: string; rows: [string, Cell][] }[] {
  const c = D.calls; const m = D.meetings; const co = D.commercial; const f = D.follow_ups;
  const s = D.snapshot; const sp = s.proposals;
  return [
    { title: t('Current snapshot — leads'), rows: [['Total leads', s.leads.total], ['Active leads', s.leads.active], ['Hot', s.leads.hot], ['Warm', s.leads.warm], ['Cold', s.leads.cold], ['Closed / won', s.leads.closed], ['Lost', s.leads.lost]] },
    { title: t('Current snapshot — follow-ups, meetings, proposals'), rows: [['Open follow-ups', s.follow_ups.open], ['Overdue follow-ups (now)', s.follow_ups.overdue], ['Upcoming meetings', s.meetings.upcoming], ['Meetings awaiting outcome', s.meetings.awaiting_outcome],
      ['Proposals preparing', sp.preparing], ['Proposals sent', sp.sent], ['Proposals under review', sp.under_review], ['Proposals awaiting response', sp.awaiting_response], ['Revision requested', sp.revision_requested], ['Accepted', sp.accepted], ['Rejected', sp.rejected]] },
    { title: t('{dept} performance (period)', { dept: term('sales_department') }), rows: [['Department call target', c.target], ['Total call attempts', c.total], ['Target achievement', pct(c.achievement_pct)], ['Responded', c.responded], ["Didn't respond", c.did_not_respond], ['Response rate', pct(c.response_rate)], ['Unique leads called', c.unique_leads], ['Meetings generated from calls', m.generated_from_calls], ['Proposals sent', co.proposals_sent]] },
    { title: t('Meetings (period)'), rows: [['Meetings scheduled', m.scheduled], ['Confirmed', m.confirmed], ['Attended', m.attended], ['Missed', m.not_attended], ['Rescheduled', m.rescheduled], ['Cancelled', m.cancelled], ['Awaiting outcome', m.awaiting_outcome]] },
    { title: t('Follow-ups (period)'), rows: [['Due', f.due], ['Completed', f.completed], ['Overdue (in range)', f.overdue]] },
    { title: t('Commercial (period)'), rows: [['New leads', D.period.leads_new], ['Forms sent', co.forms_sent], ['Forms completed', co.forms_completed], ['Client responses', co.proposal_responses], ['Negotiations', co.negotiations], ['Won', D.period.won], ['Lost', D.period.lost]] },
  ];
}

export function memberHeader(D: Mgmt): string[] {
  return [term('role_sales'), t('Calls'), t('Responded'), t("Didn't respond"), t('Response rate'), t('Unique leads'), ...(D.scope.targets ? [t('Target'), t('Achievement'), t('Remaining')] : []), t('Meetings'), t('Proposals'), t('Follow-ups due'), t('Follow-ups completed'), t('Follow-ups overdue'), t('Won'), t('Lost')];
}
export function memberRows(D: Mgmt): Cell[][] {
  return (D.calls.by_user ?? []).map((u) => [memberName(u), u.total, u.responded, u.did_not_respond, pct(u.response_rate), u.unique_leads,
    ...(D.scope.targets ? [u.target ?? '—', pct(u.achievement_pct), u.remaining ?? '—'] : []), u.meetings_generated, u.proposals_generated,
    u.follow_ups_due ?? 0, u.follow_ups_completed ?? 0, u.follow_ups_overdue ?? 0, u.won ?? 0, u.lost ?? 0]);
}

const TITLES: Record<MgmtKind, string> = { daily: 'Daily management report', weekly: 'Weekly management report', monthly: 'Monthly management report', board: 'Board / executive summary', summary: 'Management summary' };
const FILE_KIND: Record<MgmtKind, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', board: 'Board', summary: 'Summary' };
export const mgmtTitle = (k: MgmtKind) => t(TITLES[k]);
export function mgmtFileName(k: MgmtKind, r: { from: string; to: string }, ext: 'xlsx' | 'pdf'): string {
  const span = k === 'daily' || r.from === r.to ? r.from : k === 'monthly' ? r.from.slice(0, 7) : `${r.from}_to_${r.to}`;
  return `ACCORD_Management_${FILE_KIND[k]}_${span}.${ext}`;
}
const periodText = (r: { from: string; to: string }) => (r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`);

export function mgmtSheets(D: Mgmt, k: MgmtKind): Sheet[] {
  const head = ['ACCORD', mgmtTitle(k), `${t('Period')}: ${periodText(D.range)}`, `${t('Generated at')}: ${fmtDateTime(D.range.generated_at)}`, `${t('Time zone')}: Africa/Cairo`];
  const rows: Cell[][] = []; const sec: number[] = [];
  for (const b of mgmtBlocks(D)) { sec.push(rows.length); rows.push([b.title]); rows.push(...b.rows.map(([l, v]) => [t(l), v] as Cell[])); rows.push([]); }
  const sheets: Sheet[] = [
    { name: t('Summary'), title: head, header: [t('Metric'), t('Value')], rows, sectionRows: sec },
    { name: t('Pipeline'), title: head.slice(1, 3), header: [t('Stage'), t('Current leads'), t('Entered in period')], rows: D.pipeline.map((p) => [STAGE_LABEL[p.stage] ?? t(p.label), p.current, p.entered]) },
    { name: t('Calls per day'), title: head.slice(1, 3), header: [t('Date'), t('Calls'), t('Responded'), t("Didn't respond"), t('Unique leads'), t('Department target')], rows: D.calls.by_day.map((d) => [d.date, d.total, d.responded, d.did_not_respond, d.unique_leads, d.target]) },
  ];
  if (D.calls.by_user) sheets.push({ name: t('{team} performance', { team: term('sales_team') }), title: head.slice(1, 3), header: memberHeader(D), rows: memberRows(D) });
  return sheets;
}

const esc = (v: Cell) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const table = (head: string[], rows: Cell[][]) => rows.length
  ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : `<p class="empty">${esc(t('None in this period.'))}</p>`;

/** Print-ready A4 HTML (browser Save as PDF keeps Arabic shaping / RTL exact). */
export function mgmtHtml(D: Mgmt, k: MgmtKind, origin = window.location.origin): string {
  const ar = currentLang() === 'ar';
  const blocks = mgmtBlocks(D).map((b) => `<h2>${esc(b.title)}</h2><div class="kpis">${b.rows.map(([l, v]) => `<div class="k"><span>${esc(t(l))}</span><b>${esc(v)}</b></div>`).join('')}</div>`).join('');
  const members = D.calls.by_user ? `<h2 class="page">${esc(t('{team} performance', { team: term('sales_team') }))}</h2>${table(memberHeader(D), memberRows(D))}` : '';
  return `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(mgmtFileName(k, D.range, 'pdf').replace(/\.pdf$/, ''))}</title>
<style>
@page { size: A4; margin: 14mm 12mm; } * { box-sizing: border-box; }
body { margin: 0; color: #0f1830; font: 10.5pt/1.45 ${ar ? "'IBM Plex Sans Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif" : "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 3px solid #d4af37; margin-bottom: 14px; }
header img { height: 46px; } header h1 { margin: 0; font-size: 18pt; color: #062d8f; } header .meta { font-size: 9pt; color: #5a6584; }
h2 { font-size: 12pt; color: #062d8f; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e7f0; break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.k { border: 1px solid #e2e7f0; border-radius: 6px; padding: 6px 8px; background: #f7f9fc; break-inside: avoid; }
.k span { display: block; font-size: 8.3pt; color: #5a6584; } .k b { font-size: 14pt; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; } thead { display: table-header-group; }
th { background: #062d8f; color: #fff; text-align: start; padding: 5px 6px; } td { padding: 4px 6px; border-bottom: 1px solid #e2e7f0; } td.n { text-align: end; }
tr { break-inside: avoid; } .empty { color: #8590ab; font-style: italic; } .page { break-before: page; }
footer { margin-top: 18px; font-size: 8pt; color: #8590ab; border-top: 1px solid #e2e7f0; padding-top: 6px; }
</style></head><body>
<header><div><img src="${origin}/brand/accord-logo-light.png" alt="ACCORD"></div><div><h1>${esc(mgmtTitle(k))}</h1><div class="meta"><div>${esc(t('Period'))}: ${esc(periodText(D.range))}</div><div>${esc(t('Generated at'))}: ${esc(fmtDateTime(D.range.generated_at))}</div><div>${esc(t('Time zone'))}: Africa/Cairo</div></div></div></header>
${blocks}
<h2>${esc(t('Pipeline'))}</h2>${table([t('Stage'), t('Current leads'), t('Entered in period')], D.pipeline.map((p) => [STAGE_LABEL[p.stage] ?? t(p.label), p.current, p.entered]))}
${members}
<footer>${esc(t('Figures are computed from recorded activity only — nothing is estimated.'))} · ACCORD CRM</footer>
</body></html>`;
}
