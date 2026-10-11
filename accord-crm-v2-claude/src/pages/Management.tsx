import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHead, Loading, ErrorNote, Kpi } from '../components/ui';
import { cairoToday, fmtDate, monthRange, presetRange, weekRange, PRESET_LABELS, type RangePreset } from '../lib/cairo';
import { t } from '../lib/i18n';
import { term } from '../lib/terminology';
import { usePerms } from '../lib/perms';
import { useAuth } from '../lib/auth';
import { usePreviewRole } from '../lib/preview';
import { useToast } from '../lib/toast';
import { STAGE_LABEL } from '../lib/labels';
import { buildXlsx, downloadBytes } from '../lib/xlsx';
import { printHtml } from '../lib/boardReport';
import { fetchManagement, mgmtBlocks, mgmtFileName, mgmtHtml, mgmtSheets, memberHeader, memberRows, type Mgmt, type MgmtKind } from '../lib/managementReport';

// "What is happening across the Sales / BD operation?" — department aggregates from management_report().
// CURRENT SNAPSHOT (state now) and ACTIVITY DURING THE PERIOD are kept visibly separate.
const PERIODS: RangePreset[] = ['today', 'this_week', 'this_month', 'custom'];

export default function Management() {
  const today = cairoToday();
  const { can } = usePerms(); const { realAdmin } = useAuth(); const preview = usePreviewRole(); const toast = useToast();
  const [preset, setPreset] = useState<RangePreset>('today');
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const range = preset === 'custom' ? { from, to } : presetRange(preset, today);
  const previewRole = realAdmin && preview ? preview : null;
  const q = useQuery({ queryKey: ['management', range.from, range.to, previewRole], staleTime: 20_000, queryFn: () => fetchManagement(range.from, range.to, previewRole) });
  const D = q.data;

  async function report(k: MgmtKind, fmt: 'xlsx' | 'pdf') {
    try {
      const r = k === 'daily' ? { from: range.to, to: range.to } : k === 'weekly' ? weekRange(range.to) : k === 'monthly' ? monthRange(range.to) : range;
      const data = k === 'board' || k === 'summary' ? D! : await fetchManagement(r.from, r.to, previewRole);
      const { error } = await supabase.rpc('log_export', { p_kind: 'management', p_format: fmt, p_from: r.from, p_to: r.to, p_filters: { report: k, scope: data.scope } });
      if (error && !/PGRST202|Could not find the function/.test(`${error.code} ${error.message}`)) throw new Error(error.message);
      if (fmt === 'xlsx') downloadBytes(mgmtFileName(k, r, 'xlsx'), buildXlsx(mgmtSheets(data, k), { rtl: document.documentElement.dir === 'rtl', title: mgmtFileName(k, r, 'xlsx') }));
      else printHtml(mgmtHtml(data, k), mgmtFileName(k, r, 'pdf').replace(/\.pdf$/, ''));
    } catch (e) { toast(t((e as Error).message), 'bad'); }
  }
  const reports = (['daily', 'weekly', 'monthly', 'board'] as const).filter((k) => can(`reports.${k}`));

  return (
    <>
      <PageHead title={term('management_dashboard')} sub={<>{fmtDate(range.from)}{range.from !== range.to ? ` – ${fmtDate(range.to)}` : ''} · <bdi className="ltr">Africa/Cairo</bdi></>}
        actions={can('export.management_summary') && D && <button className="btn" onClick={() => report('summary', 'xlsx')} data-testid="mgmt-export"><Download /> {t('Export management summary')}</button>} />
      <div className="row no-print" style={{ marginBottom: 14 }} role="group" aria-label={t('Period')}>
        {PERIODS.map((p) => <button key={p} className={`chip ${preset === p ? 'on' : ''}`} onClick={() => setPreset(p)} data-testid={`mgmt-period-${p}`}>{PRESET_LABELS[p]}</button>)}
        {preset === 'custom' && <><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: 160 }} aria-label={t('From')} /><span className="flip-rtl" style={{ display: 'inline-block' }}>→</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ width: 160 }} aria-label={t('To')} /></>}
      </div>
      <ErrorNote error={q.error} />
      {q.isLoading || !D ? (q.error ? null : <Loading />) : (
        <div className="col" style={{ gap: 22 }}>
          {reports.length > 0 && (
            <section className="card card-pad col no-print" aria-label={t('Reports')} data-testid="mgmt-reports">
              <h2>{t('Reports')}</h2>
              <div className="row" style={{ gap: 8 }}>
                {reports.map((k) => (
                  <span key={k} className="row nowrap" style={{ gap: 4 }}>
                    <b className="small" style={{ minWidth: 70 }}>{t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', board: 'Board / Executive' }[k])}</b>
                    <button className="btn sm" onClick={() => report(k, 'pdf')} data-testid={`mgmt-report-${k}-pdf`}><Printer /> PDF</button>
                    <button className="btn sm" onClick={() => report(k, 'xlsx')} data-testid={`mgmt-report-${k}-xlsx`}><FileSpreadsheet /> Excel</button>
                  </span>))}
              </div>
              <span className="muted small">{t('Daily / weekly / monthly reports cover the period that contains the end date above; the board summary covers the selected period.')}</span>
            </section>)}
          <Snapshot D={D} />
          <Activity D={D} />
        </div>
      )}
    </>
  );
}

function Snapshot({ D }: { D: Mgmt }) {
  const [leads, other] = mgmtBlocks(D);
  return (
    <section className="col" aria-label={t('Current snapshot')} data-testid="mgmt-snapshot">
      <div><h2>{t('Current snapshot')}</h2><span className="muted small">{t('State right now — independent of the selected period.')}</span></div>
      <div className="grid cols-4 keep2">{leads.rows.map(([l, v], i) => <Kpi key={l} hero={i === 0} label={l} value={v} />)}</div>
      <div className="grid cols-4 keep2">{other.rows.map(([l, v]) => <Kpi key={l} label={l} value={v} tone={l === 'Overdue follow-ups (now)' && Number(v) > 0 ? 'bad' : undefined} />)}</div>
    </section>
  );
}

function Activity({ D }: { D: Mgmt }) {
  const blocks = mgmtBlocks(D).slice(2);
  const c = D.calls; const max = Math.max(1, ...c.by_day.map((d) => d.total));
  const pipeMax = Math.max(1, ...D.pipeline.map((p) => p.current));
  return (
    <section className="col" style={{ gap: 18 }} aria-label={t('Activity during the period')} data-testid="mgmt-activity">
      <div><h2>{t('Activity during the selected period')}</h2><span className="muted small">{t('Counts of what happened between the selected dates (Cairo time).')}</span></div>
      {blocks.map((b, i) => (
        <div key={b.title} className="col" data-testid={i === 0 ? 'mgmt-department' : undefined}>
          <h3>{b.title}</h3>
          <div className="grid cols-4 keep2">{b.rows.map(([l, v], j) => <Kpi key={l} hero={i === 0 && j < 3} label={l} value={v} tone={l === 'Target achievement' && (c.achievement_pct ?? 0) >= 100 ? 'ok' : undefined} />)}</div>
        </div>))}
      {c.by_day.length > 1 && (
        <div className="card card-pad col"><h3>{t('Calls per day')}</h3>
          <div className="bars" role="img" aria-label={t('Calls per day')}>{c.by_day.map((d) => <div key={d.date} className="b" title={`${fmtDate(d.date)}: ${d.total}`} style={{ height: `${Math.max(3, (100 * d.total) / max)}%` }} />)}</div>
        </div>)}
      <div className="card card-pad col"><h3>{t('Pipeline')}</h3>
        {D.pipeline.map((p) => <div key={p.stage} className="hbar"><span>{STAGE_LABEL[p.stage] ?? t(p.label)}</span><div className="track"><i style={{ width: `${(100 * p.current) / pipeMax}%` }} /></div><b className="num">{p.current}</b></div>)}
        <span className="muted small">{t('Bars: current leads per stage (snapshot). Entered during the period: {list}', { list: D.pipeline.map((p) => `${STAGE_LABEL[p.stage] ?? t(p.label)} ${p.entered}`).join(' · ') })}</span>
      </div>
      {D.calls.by_user ? (
        <div className="col" data-testid="mgmt-individual">
          <h3>{t('{team} performance', { team: term('sales_team') })}</h3>
          <div className="card table-wrap"><table className="t" aria-label={t('{team} performance', { team: term('sales_team') })}><thead><tr>{memberHeader(D).map((h, i) => <th key={h} className={i ? 'r' : ''}>{h}</th>)}</tr></thead><tbody>
            {memberRows(D).length === 0 && <tr><td colSpan={memberHeader(D).length} className="muted">{t('No activity in this period.')}</td></tr>}
            {memberRows(D).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'r num' : ''}>{v}</td>)}</tr>)}
          </tbody></table></div>
          {!D.scope.names && <span className="muted small">{t('Employee names are hidden by your access settings.')}</span>}
        </div>
      ) : <span className="muted small" data-testid="mgmt-department-only">{t('Department-level view: individual employee performance is not included for your role.')}</span>}
    </section>
  );
}
