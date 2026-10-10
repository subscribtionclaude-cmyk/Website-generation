import { supabase, unwrap } from './supabase';
import { currentLang, t } from './i18n';
import { cairoToday, fmtDate, fmtDateTime, monthRange, weekRange, daysBetween } from './cairo';
import { STAGES, STAGE_LABEL, TEMPERATURES, TEMP_LABEL, PROPOSAL_STATUS, label, proposalCode, CONFIRMATION } from './labels';
import { instantBounds } from './exportData';
import type { Sheet, Cell } from './xlsx';
import type { Report } from '../pages/admin/shared';

// Board Members Report: built ONLY from figures the database records (admin_report RPC + direct reads under the
// admin's own session). Periods are Cairo calendar dates; weeks follow the CRM week (Sunday–Saturday, see cairo.ts).

export type BoardKind = 'daily' | 'weekly' | 'monthly' | 'custom';
export function boardPeriod(kind: BoardKind, anchor: string, to?: string): { from: string; to: string } {
  if (kind === 'daily') return { from: anchor, to: anchor };
  if (kind === 'weekly') return weekRange(anchor);
  if (kind === 'monthly') return monthRange(anchor);
  const b = to ?? anchor; return anchor <= b ? { from: anchor, to: b } : { from: b, to: anchor };
}
export function boardFileName(kind: BoardKind, r: { from: string; to: string }, ext: 'pdf' | 'xlsx'): string {
  const base = kind === 'daily' ? `Daily_${r.from}` : kind === 'monthly' ? `Monthly_${r.from.slice(0, 7)}` : `${kind === 'weekly' ? 'Weekly' : 'Custom'}_${r.from}_to_${r.to}`;
  return `ACCORD_Board_Report_${base}.${ext}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export interface BoardData {
  kind: BoardKind; range: { from: string; to: string }; generatedAt: string; rep: Report;
  summary: [string, Cell][];
  temperature: [string, number][];
  bd: { name: string; calls: number; target: number; pct: number | null; responded: number; unique: number; meetings: number; proposals: number; fuDone: number; fuOverdue: number }[];
  proposalsAwaiting: Row[]; meetingsToConfirm: Row[]; stale: Row[]; staleCount: number;
}

async function all(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data ?? [])); if (!data || data.length < 1000) return out; }
}

export async function gatherBoard(kind: BoardKind, range: { from: string; to: string }): Promise<BoardData> {
  const b = instantBounds(range); const today = cairoToday();
  const staleBefore = new Date(Date.now() - 30 * 86400000).toISOString();
  const [rep, leads, fus, awaiting, toConfirm] = await Promise.all([
    supabase.rpc('admin_report', { p_from: range.from, p_to: range.to }).then((x) => unwrap(x) as unknown as Report),
    all(() => supabase.from('lead_list_v').select('id,name,temperature,pipeline_stage,archived,created_at,last_activity_at,owner_name').order('id')),
    all(() => supabase.from('follow_ups').select('id,owner_id,status,due_date,completed_at').order('id')),
    all(() => supabase.from('proposals').select('proposal_no,title,status,sent_on,next_follow_up_date,owner_id,response_state,leads(name)').in('status', ['sent', 'under_review']).order('sent_on')),
    all(() => supabase.from('meetings').select('id,scheduled_at,confirmation_status,meeting_with,leads(name)').eq('status', 'scheduled').neq('confirmation_status', 'confirmed').gte('scheduled_at', new Date().toISOString()).order('scheduled_at')),
  ]);
  const live = leads.filter((l) => !l.archived);
  const count = (f: (l: Row) => boolean) => live.filter(f).length;
  const underReview = awaiting.filter((p) => p.status === 'under_review').length;
  const c = rep.calls; const m = rep.meetings; const co = rep.commercial; const fu = rep.follow_ups;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
  const summary: [string, Cell][] = [
    ['Total leads', live.length],
    ['New leads', leads.filter((l) => l.created_at >= b.gte && l.created_at < b.lt).length],
    ['Active leads', count((l) => !['won', 'lost'].includes(l.pipeline_stage) && !['lost', 'closed'].includes(l.temperature))],
    ['Hot', count((l) => l.temperature === 'hot')], ['Warm', count((l) => l.temperature === 'warm')], ['Cold', count((l) => l.temperature === 'cold')],
    ['Won (in period)', co.won], ['Lost (in period)', co.lost],
    ['Total call attempts', c.total], ['Unique leads called', c.unique_leads], ['Responded', c.responded], ["Didn't respond", c.did_not_respond], ['Response rate', pct(c.response_rate)],
    ['Meetings scheduled', m.scheduled], ['Meetings held', m.attended], ['Meetings missed', m.not_attended], ['Meetings rescheduled', m.rescheduled],
    ['Follow-ups due', fu.due], ['Overdue follow-ups (now)', fu.open_overdue_total],
    ['Proposals created', co.proposals_prepared], ['Proposals sent', co.proposals_sent], ['Proposals under review (now)', underReview],
    ['Accepted proposals', co.accepted], ['Rejected proposals', co.rejected],
  ];
  const ownerName = new Map<string, string>(c.by_user.map((u) => [u.user_id, u.name]));
  const bd = c.by_user.map((u) => ({
    name: u.name, calls: u.total, target: u.target, pct: u.achievement_pct, responded: u.responded, unique: u.unique_leads,
    meetings: u.meetings_generated, proposals: u.proposals_generated,
    fuDone: fus.filter((x) => x.owner_id === u.user_id && x.completed_at && x.completed_at >= b.gte && x.completed_at < b.lt).length,
    fuOverdue: fus.filter((x) => x.owner_id === u.user_id && x.status === 'open' && x.due_date < today).length,
  }));
  const staleAll = live.filter((l) => !['won', 'lost'].includes(l.pipeline_stage) && (!l.last_activity_at || l.last_activity_at < staleBefore))
    .sort((a, z) => String(a.last_activity_at ?? '').localeCompare(String(z.last_activity_at ?? '')));
  return {
    kind, range, generatedAt: new Date().toISOString(), rep, summary,
    temperature: TEMPERATURES.map((k) => [k, count((l) => l.temperature === k)]),
    bd, proposalsAwaiting: awaiting.filter((p) => p.response_state !== 'responded').map((p) => ({ ...p, owner: ownerName.get(p.owner_id) ?? '' })),
    meetingsToConfirm: toConfirm, stale: staleAll.slice(0, 15), staleCount: staleAll.length,
  };
}

const TYPE_LABEL: Record<BoardKind, string> = { daily: 'Daily report', weekly: 'Weekly report', monthly: 'Monthly report', custom: 'Custom range report' };
const periodText = (r: { from: string; to: string }) => (r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`);
const pctTxt = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);

function sections(D: BoardData) {
  const co = D.rep.commercial; const m = D.rep.meetings;
  return {
    pipeline: STAGES.map((s) => { const p = D.rep.pipeline.find((x) => x.stage === s); return [STAGE_LABEL[s], p?.current ?? 0, p?.entered ?? 0] as Cell[]; }),
    temperature: D.temperature.map(([k, n]) => [TEMP_LABEL[k], n] as Cell[]),
    bd: D.bd.map((u) => [u.name, u.calls, u.target || '—', pctTxt(u.pct), u.responded, u.unique, u.meetings, u.proposals, u.fuDone, u.fuOverdue] as Cell[]),
    meetings: ([['Meetings scheduled', m.scheduled], ['Confirmed', m.confirmed], ['Unconfirmed', m.unconfirmed], ['Meetings held', m.attended], ['Meetings missed', m.not_attended],
      ['Meetings rescheduled', m.rescheduled], ['Cancelled', m.cancelled], ['Awaiting outcome', m.awaiting_outcome], ['Meeting requests', m.requested], ['Generated from calls', m.generated_from_calls]] as [string, number][]).map(([k, v]) => [t(k), v] as Cell[]),
    commercial: ([['Forms sent', co.forms_sent], ['Forms completed', co.forms_completed], ['Forms awaiting client (now)', co.forms_awaiting_client], ['Proposals created', co.proposals_prepared],
      ['Proposals sent', co.proposals_sent], ['Client responses received', co.proposal_responses], ['Awaiting client response (now)', co.awaiting_responses], ['Negotiation actions', co.negotiations],
      ['Accepted proposals', co.accepted], ['Rejected proposals', co.rejected], ['Won (in period)', co.won], ['Lost (in period)', co.lost], ['Proposal value sent', Number(co.proposal_value_sent)]] as [string, number][]).map(([k, v]) => [t(k), v] as Cell[]),
    followups: ([['Follow-ups due', D.rep.follow_ups.due], ['Completed', D.rep.follow_ups.completed], ['Overdue (in range)', D.rep.follow_ups.overdue], ['Overdue follow-ups (now)', D.rep.follow_ups.open_overdue_total]] as [string, number][]).map(([k, v]) => [t(k), v] as Cell[]),
    critical: D.rep.critical_follow_ups.map((f) => [f.lead, f.due_date, f.days_overdue, f.owner ?? '', f.notes ?? ''] as Cell[]),
    awaiting: D.proposalsAwaiting.map((p) => [proposalCode(p.proposal_no), p.leads?.name ?? '', label(PROPOSAL_STATUS, p.status), p.sent_on ?? '', p.sent_on ? daysBetween(p.sent_on, cairoToday()) : '', p.next_follow_up_date ?? '', p.owner] as Cell[]),
    confirm: D.meetingsToConfirm.map((x) => [fmtDateTime(x.scheduled_at), x.leads?.name ?? '', x.meeting_with ?? '', label(CONFIRMATION, x.confirmation_status)] as Cell[]),
    stale: D.stale.map((l) => [l.name, STAGE_LABEL[l.pipeline_stage], TEMP_LABEL[l.temperature], l.last_activity_at ? fmtDate(l.last_activity_at) : t('Never'), l.owner_name ?? ''] as Cell[]),
  };
}

const HEAD = {
  pipeline: ['Stage', 'Current leads', 'Entered in period'], temperature: ['Temperature', 'Leads'],
  bd: ['BD executive', 'Calls', 'Call target', 'Achievement', 'Responded', 'Unique leads', 'Meetings', 'Proposals', 'Follow-ups completed', 'Overdue follow-ups'],
  metric: ['Metric', 'Value'], critical: ['Lead', 'Due', 'Days overdue', 'Owner', 'Note'],
  awaiting: ['Proposal', 'Company', 'Status', 'Sent date', 'Days since sent', 'Next follow-up', 'Owner'],
  confirm: ['Scheduled (Cairo)', 'Company', 'Meeting with', 'Confirmation'], stale: ['Company', 'Stage', 'Temperature', 'Last activity', 'Owner'],
};
const H = (k: keyof typeof HEAD) => HEAD[k].map((x) => t(x));

export function boardHeaderLines(D: BoardData): string[] {
  return ['ACCORD', t('Board Members Report'), `${t('Report type')}: ${t(TYPE_LABEL[D.kind])}`, `${t('Period')}: ${periodText(D.range)}`,
    `${t('Generated at')}: ${fmtDateTime(D.generatedAt)}`, `${t('Time zone')}: Africa/Cairo`];
}

export function boardSheets(D: BoardData): Sheet[] {
  const S = sections(D); const head = boardHeaderLines(D);
  const withSection = (name: string, blocks: { title: string; header: string[]; rows: Cell[][] }[]): Sheet => {
    const rows: Cell[][] = []; const sec: number[] = [];
    for (const bl of blocks) { sec.push(rows.length); rows.push([t(bl.title)]); sec.push(rows.length); rows.push(bl.header); rows.push(...(bl.rows.length ? bl.rows : [[t('None in this period.')]])); rows.push([]); }
    return { name, title: [head[1], head[3]], rows, sectionRows: sec };
  };
  return [
    { name: t('Executive Summary'), title: head, header: H('metric'), rows: D.summary.map(([k, v]) => [t(k), v]) },
    { name: t('BD Performance'), title: [head[1], head[3]], header: H('bd'), rows: S.bd },
    withSection(t('Pipeline'), [{ title: 'Pipeline summary', header: H('pipeline'), rows: S.pipeline }, { title: 'Temperature summary', header: H('temperature'), rows: S.temperature }]),
    withSection(t('Meetings'), [{ title: 'Meetings', header: H('metric'), rows: S.meetings }, { title: 'Meetings requiring confirmation', header: H('confirm'), rows: S.confirm }]),
    withSection(t('Proposals'), [{ title: 'Commercial activity', header: H('metric'), rows: S.commercial }, { title: 'Proposals awaiting client response', header: H('awaiting'), rows: S.awaiting }]),
    withSection(t('Follow-Ups'), [{ title: 'Follow-ups', header: H('metric'), rows: S.followups }, { title: 'Critical follow-ups (overdue)', header: H('critical'), rows: S.critical }]),
    withSection(t('Next Actions & Risks'), [
      { title: 'Critical follow-ups (overdue)', header: H('critical'), rows: S.critical.slice(0, 15) },
      { title: 'Proposals awaiting client response', header: H('awaiting'), rows: S.awaiting },
      { title: 'Meetings requiring confirmation', header: H('confirm'), rows: S.confirm },
      { title: 'Leads with no activity in 30 days', header: H('stale'), rows: S.stale },
    ]),
  ];
}

const esc = (v: Cell) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const table = (head: string[], rows: Cell[][], empty = t('None in this period.')) => rows.length
  ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : `<p class="empty">${esc(empty)}</p>`;

/** Self-contained, print-ready HTML (A4). Printed to PDF by the browser, so Arabic shaping and RTL are exact. */
export function boardHtml(D: BoardData, origin = window.location.origin): string {
  const ar = currentLang() === 'ar'; const S = sections(D); const head = boardHeaderLines(D);
  const kpis: [string, Cell][] = D.summary;
  const kpi = (k: string, v: Cell) => `<div class="k"><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`;
  const group = (title: string, keys: string[]) => `<h3>${esc(t(title))}</h3><div class="kpis">${keys.map((k) => kpi(k, kpis.find((x) => x[0] === k)?.[1] ?? '—')).join('')}</div>`;
  return `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(boardFileName(D.kind, D.range, 'pdf').replace(/\.pdf$/, ''))}</title>
<style>
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #0f1830; font: 10.5pt/1.45 ${ar ? "'IBM Plex Sans Arabic','Noto Sans Arabic','Segoe UI',Tahoma,'Geeza Pro',sans-serif" : "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 3px solid #d4af37; margin-bottom: 14px; }
header img { height: 46px; }
header h1 { margin: 0; font-size: 18pt; color: #062d8f; }
header .meta { font-size: 9pt; color: #5a6584; }
header .meta div { white-space: nowrap; }
h2 { font-size: 12.5pt; color: #062d8f; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e7f0; break-after: avoid; }
h3 { font-size: 10pt; color: #5a6584; margin: 10px 0 6px; text-transform: ${ar ? 'none' : 'uppercase'}; letter-spacing: ${ar ? '0' : '.05em'}; break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.k { border: 1px solid #e2e7f0; border-radius: 6px; padding: 6px 8px; background: #f7f9fc; break-inside: avoid; }
.k span { display: block; font-size: 8.3pt; color: #5a6584; }
.k b { font-size: 14pt; color: #0f1830; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 6px; }
thead { display: table-header-group; }
th { background: #062d8f; color: #fff; text-align: start; padding: 5px 6px; font-weight: 600; }
td { padding: 4px 6px; border-bottom: 1px solid #e2e7f0; vertical-align: top; }
td.n { text-align: end; font-variant-numeric: tabular-nums; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f7f9fc; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.empty { color: #8590ab; font-style: italic; margin: 4px 0 8px; }
.page { break-before: page; }
footer { margin-top: 18px; font-size: 8pt; color: #8590ab; border-top: 1px solid #e2e7f0; padding-top: 6px; }
</style></head><body>
<header><div><img src="${origin}/brand/accord-logo-light.png" alt="ACCORD"></div>
<div><h1>${esc(head[1])}</h1><div class="meta">${head.slice(2).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></header>
<h2>${esc(t('Executive summary'))}</h2>
${group('Leads', ['Total leads', 'New leads', 'Active leads', 'Hot', 'Warm', 'Cold', 'Won (in period)', 'Lost (in period)'])}
${group('Calls', ['Total call attempts', 'Unique leads called', 'Responded', "Didn't respond", 'Response rate'])}
${group('Meetings', ['Meetings scheduled', 'Meetings held', 'Meetings missed', 'Meetings rescheduled'])}
${group('Follow-ups', ['Follow-ups due', 'Overdue follow-ups (now)'])}
${group('Proposals', ['Proposals created', 'Proposals sent', 'Proposals under review (now)', 'Accepted proposals', 'Rejected proposals'])}
<h2>${esc(t('Pipeline summary'))} · ${esc(t('Temperature summary'))}</h2>
<div class="two"><div>${table(H('pipeline'), S.pipeline)}</div><div>${table(H('temperature'), S.temperature)}</div></div>
<h2 class="page">${esc(t('BD performance'))}</h2>
${table(H('bd'), S.bd)}
<h2>${esc(t('Commercial activity'))}</h2>
<div class="two"><div>${table(H('metric'), S.commercial)}</div><div>${table(H('metric'), S.meetings)}</div></div>
<h2 class="page">${esc(t('Next actions & risks'))}</h2>
<h3>${esc(t('Critical follow-ups (overdue)'))}</h3>${table(H('critical'), S.critical.slice(0, 15))}
<h3>${esc(t('Proposals awaiting client response'))}</h3>${table(H('awaiting'), S.awaiting)}
<h3>${esc(t('Meetings requiring confirmation'))}</h3>${table(H('confirm'), S.confirm)}
<h3>${esc(t('Leads with no activity in 30 days'))} (${D.staleCount})</h3>${table(H('stale'), S.stale)}
<footer>${esc(t('Figures are computed from recorded activity only — nothing is estimated.'))} · ACCORD CRM · ${esc(fmtDateTime(D.generatedAt))} (Africa/Cairo)</footer>
</body></html>`;
}

/** Print the report document to PDF (browser "Save as PDF"; the file name is pre-set from the document title). */
export function printHtml(html: string, fileTitle: string): HTMLIFrameElement {
  document.getElementById('accord-print-frame')?.remove();
  const f = document.createElement('iframe');
  f.id = 'accord-print-frame'; f.setAttribute('data-testid', 'board-report-print'); f.title = fileTitle;
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  f.srcdoc = html;
  f.onload = () => {
    const w = f.contentWindow; if (!w) return;
    const prev = document.title; document.title = fileTitle; // Chrome/Safari use the title as the default PDF name
    const imgs = [...w.document.images];
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })))).then(() => {
      w.focus(); w.print(); setTimeout(() => { document.title = prev; }, 1000);
    });
  };
  document.body.appendChild(f);
  return f;
}
