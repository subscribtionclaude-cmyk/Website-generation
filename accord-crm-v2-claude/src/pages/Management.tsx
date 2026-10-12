import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Printer, FileSpreadsheet, Users, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHead, ErrorNote, Kpi } from '../components/ui';
import { Num, Trend, StageFlow, MixBar, Donut, Panel, Meter, MeetingMix, stagger, useGlide } from '../components/viz';
import { TeamTable } from '../components/team';
import { cairoToday, fmtDate, fmtDay, monthRange, presetRange, weekRange, PRESET_LABELS, type RangePreset } from '../lib/cairo';
import { t } from '../lib/i18n';
import { term } from '../lib/terminology';
import { usePerms } from '../lib/perms';
import { useAuth } from '../lib/auth';
import { usePreviewRole } from '../lib/preview';
import { useToast } from '../lib/toast';
import { STAGE_LABEL } from '../lib/labels';
import { buildXlsx, downloadBytes } from '../lib/xlsx';
import { printHtml } from '../lib/boardReport';
import { fetchManagement, mgmtFileName, mgmtHtml, mgmtSheets, type Mgmt, type MgmtKind } from '../lib/managementReport';

// "What is happening across the Sales / BD operation?" — department aggregates from management_report().
// CURRENT SNAPSHOT (state now) and ACTIVITY DURING THE PERIOD stay visibly separate. Changing the period keeps the
// previous figures on screen while the new ones load, then numbers / bars morph to the new values (no page flash).
const PERIODS: RangePreset[] = ['today', 'this_week', 'this_month', 'custom'];

export default function Management() {
  const today = cairoToday();
  const { can } = usePerms(); const { realAdmin } = useAuth(); const preview = usePreviewRole(); const toast = useToast();
  const [preset, setPreset] = useState<RangePreset>('today');
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const range = preset === 'custom' ? { from, to } : presetRange(preset, today);
  const previewRole = realAdmin && preview ? preview : null;
  const q = useQuery({ queryKey: ['management', range.from, range.to, previewRole], staleTime: 20_000, placeholderData: keepPreviousData, queryFn: () => fetchManagement(range.from, range.to, previewRole) });
  const D = q.data;
  const updating = q.isFetching && q.isPlaceholderData;
  const [periodsRef, periodGlide] = useGlide<HTMLDivElement>('.chip.on', preset);

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
      <div className="cmd-strip no-print">
        <div ref={periodsRef} className="periods glide-host" role="group" aria-label={t('Period')}>
          {periodGlide}
          {PERIODS.map((p) => <button key={p} className={`chip ${preset === p ? 'on' : ''}`} aria-pressed={preset === p} onClick={() => setPreset(p)} data-testid={`mgmt-period-${p}`}>{PRESET_LABELS[p]}</button>)}
        </div>
        {preset === 'custom' && <span className="row nowrap" style={{ gap: 6 }}><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: 150, minHeight: 32 }} aria-label={t('From')} /><span className="flip-rtl" style={{ display: 'inline-block' }}>→</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ width: 150, minHeight: 32 }} aria-label={t('To')} /></span>}
        <span className={`live ${updating ? 'busy' : ''}`} role="status"><i />{updating ? t('Updating…') : t('Live · Cairo time')}</span>
        {D && <span className="badge" title={t('What your access includes')}>{D.scope.individual ? <><Users size={12} /> {t('Individual breakdown')}</> : <><Building2 size={12} /> {t('Department only')}</>}</span>}
        <span className="grow" />
        {reports.length > 0 && (
          <div className="report-pills" aria-label={t('Reports')} data-testid="mgmt-reports" title={t('Daily / weekly / monthly reports cover the period that contains the end date above; the board summary covers the selected period.')}>
            <span className="muted small" style={{ fontWeight: 650 }}>{t('Reports')}</span>
            {reports.map((k) => (
              <span key={k} className="report-pill">
                {t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', board: 'Board / Executive' }[k])}
                <button className="btn sm" onClick={() => report(k, 'pdf')} data-testid={`mgmt-report-${k}-pdf`} aria-label={`${t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', board: 'Board / Executive' }[k])} PDF`}><Printer /> PDF</button>
                <button className="btn sm" onClick={() => report(k, 'xlsx')} data-testid={`mgmt-report-${k}-xlsx`} aria-label={`${t({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', board: 'Board / Executive' }[k])} Excel`}><FileSpreadsheet /> Excel</button>
              </span>))}
          </div>)}
      </div>
      <ErrorNote error={q.error} />
      {!D ? (q.error ? null : <Skeleton />) : (
        <div className={`col data-live ${updating ? 'is-updating' : ''}`} style={{ gap: 14 }} aria-busy={updating}>
          <Activity D={D} />
          <Snapshot D={D} />
          <Team D={D} />
        </div>
      )}
    </>
  );
}

function Activity({ D }: { D: Mgmt }) {
  const c = D.calls; const m = D.meetings; const co = D.commercial; const f = D.follow_ups;
  const single = c.by_day.length <= 1;
  return (
    <section className="col" style={{ gap: 12 }} aria-label={t('Activity during the period')} data-testid="mgmt-activity">
      <div className="section-label"><h2>{t('Activity during the selected period')}</h2><span>{t('Counts of what happened between the selected dates (Cairo time).')}</span></div>
      <div className="kpi-band" style={{ ['--cols' as string]: 6 }} data-testid="mgmt-department">
        <Kpi lead hero label="Total call attempts" value={<Num v={c.total} count />} sub={t('Department call target') + ` ${c.target}`} meter={c.achievement_pct ?? 0} style={stagger(0, 60)} />
        <Kpi label="Target achievement" value={<Num v={c.achievement_pct} suffix="%" count />} sub={t('Remaining') + ` ${c.remaining}`} style={stagger(1, 60)} />
        <Kpi label="Response rate" value={<Num v={c.response_rate} suffix="%" count />} sub={`${t('Responded')} ${c.responded} · ${t("Didn't respond")} ${c.did_not_respond}`} style={stagger(2, 60)} />
        <Kpi label="Meetings scheduled" value={<Num v={m.scheduled} count />} sub={`${t('Attended')} ${m.attended} · ${t('Confirmed')} ${m.confirmed}`} style={stagger(3, 60)} />
        <Kpi label="Proposals sent" value={<Num v={co.proposals_sent} count />} sub={`${t('Client responses')} ${co.proposal_responses}`} style={stagger(4, 60)} />
        <Kpi label="Won / Lost" value={<><Num v={D.period.won} count /><span className="muted" style={{ fontWeight: 500 }}> / </span><Num v={D.period.lost} count /></>} sub={`${t('New leads')} ${D.period.leads_new}`} style={stagger(5, 60)} />
      </div>
      <div className="cc-grid">
        <Panel className="s8 reveal" style={stagger(0, 260)} title={single ? t('Department target — today') : t('Calls per day')} sub={single ? t('Attempts against the combined daily target') : t('Attempts, responded and the combined working-day target')}>
          {single ? (
            <div className="col" style={{ gap: 14, paddingBlock: 6 }}>
              <div className="row spread nowrap" style={{ alignItems: 'baseline' }}><span style={{ fontSize: 34, fontWeight: 720, letterSpacing: '-0.03em' }}><Num v={c.total} /><span className="muted" style={{ fontSize: 16, fontWeight: 600 }}> / {c.target}</span></span><b className="num" style={{ fontSize: 18 }}><Num v={c.achievement_pct} suffix="%" /></b></div>
              <Meter pct={c.achievement_pct ?? 0} />
              <div className="tiles" style={{ ['--n' as string]: 4 }}>
                <div><span>{t('Responded')}</span><b><Num v={c.responded} /></b></div><div><span>{t("Didn't respond")}</span><b><Num v={c.did_not_respond} /></b></div>
                <div><span>{t('Unique leads called')}</span><b><Num v={c.unique_leads} /></b></div><div className="gold"><span>{t('Remaining')}</span><b><Num v={c.remaining} /></b></div>
              </div>
            </div>
          ) : <Trend points={c.by_day} fmtX={fmtDay} label={t('Calls per day')} />}
        </Panel>
        <Panel className="s4 reveal" style={stagger(1, 260)} title={t('Conversion from calls')} sub={t('Selected period')}>
          <div className="mlist" style={{ ['--n' as string]: 1 }}>
            <div><span>{t('Unique leads called')}</span><b><Num v={c.unique_leads} /></b></div>
            <div><span>{t('Meetings generated from calls')}</span><b><Num v={m.generated_from_calls} /></b></div>
            <div><span>{t('Forms sent')}</span><b><Num v={co.forms_sent} /></b></div>
            <div><span>{t('Forms completed')}</span><b><Num v={co.forms_completed} /></b></div>
            <div><span>{t('Negotiations')}</span><b><Num v={co.negotiations} /></b></div>
            <div><span>{t('Proposal value sent')}</span><b><Num v={Number(co.proposal_value_sent ?? 0)} /></b></div>
          </div>
        </Panel>
        <Panel className="s4 reveal" style={stagger(2, 340)} title={t('Meetings (period)')}>
          <div className="tiles" style={{ ['--n' as string]: 3 }}>
            <div><span>{t('Scheduled')}</span><b><Num v={m.scheduled} /></b></div><div><span>{t('Attended')}</span><b><Num v={m.attended} /></b></div><div className="gold"><span>{t('Awaiting outcome')}</span><b><Num v={m.awaiting_outcome} /></b></div>
          </div>
          <MeetingMix m={m} />
        </Panel>
        <Panel className="s4 reveal" style={stagger(3, 340)} title={t('Follow-ups (period)')} sub={t('Due in the selected period')}>
          <div className="tiles" style={{ ['--n' as string]: 3 }}>
            <div><span>{t('Due')}</span><b><Num v={f.due} /></b></div><div><span>{t('Completed')}</span><b><Num v={f.completed} /></b></div><div className={f.overdue ? 'risk' : ''}><span>{t('Overdue (in range)')}</span><b><Num v={f.overdue} /></b></div>
          </div>
          <Meter pct={f.due ? (100 * f.completed) / f.due : 0} delay={160} label={t('Completed')} />
          <span className="muted small">{f.due ? t('{p}% of follow-ups due in the period are completed', { p: Math.round((100 * f.completed) / f.due) }) : t('No follow-ups due in this period.')}</span>
        </Panel>
        <Panel className="s4 reveal" style={stagger(4, 340)} title={t('Commercial (period)')}>
          <div className="mlist" style={{ ['--n' as string]: 1 }}>
            <div><span>{t('New leads')}</span><b><Num v={D.period.leads_new} /></b></div>
            <div><span>{t('Proposals sent')}</span><b><Num v={co.proposals_sent} /></b></div>
            <div><span>{t('Client responses')}</span><b><Num v={co.proposal_responses} /></b></div>
            <div><span>{t('Won')}</span><b><Num v={D.period.won} /></b></div>
            <div><span>{t('Lost')}</span><b><Num v={D.period.lost} /></b></div>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function Snapshot({ D }: { D: Mgmt }) {
  const s = D.snapshot; const l = s.leads; const sp = s.proposals;
  return (
    <section className="col" style={{ gap: 12 }} aria-label={t('Current snapshot')} data-testid="mgmt-snapshot">
      <div className="section-label"><h2>{t('Current snapshot')}</h2><span>{t('State right now — independent of the selected period.')}</span></div>
      <div className="cc-grid">
        <Panel className="s7 reveal" style={stagger(0, 520)} title={t('Pipeline')} sub={t('Current leads per stage · share · entered during the period')}>
          <StageFlow stages={D.pipeline.map((p) => ({ key: p.stage, label: STAGE_LABEL[p.stage] ?? t(p.label), current: p.current, entered: p.entered }))} delay={560} />
        </Panel>
        <Panel className="s5 reveal" style={stagger(1, 520)} title={t('Lead health')} sub={t('{n} active of {total} leads', { n: l.active, total: l.total })}>
          <div className="tiles" style={{ ['--n' as string]: 3 }}>
            <div><span>{t('Total leads')}</span><b><Num v={l.total} /></b></div><div><span>{t('Active leads')}</span><b><Num v={l.active} /></b></div><div className="gold"><span>{t('Closed / won')}</span><b><Num v={l.closed} /></b></div>
          </div>
          <MixBar delay={600} items={[
            { key: 'hot', label: t('Hot'), value: l.hot, color: 'var(--viz-1)' }, { key: 'warm', label: t('Warm'), value: l.warm, color: 'var(--viz-3)' },
            { key: 'cold', label: t('Cold'), value: l.cold, color: 'var(--viz-2)' }, { key: 'closed', label: t('Closed / won'), value: l.closed, color: 'var(--ok)' }, { key: 'lost', label: t('Lost'), value: l.lost, color: 'var(--viz-4)' }]} />
          <div className="tiles" style={{ ['--n' as string]: 2 }}>
            <div><span>{t('Open follow-ups')}</span><b><Num v={s.follow_ups.open} /></b></div>
            <div className={s.follow_ups.overdue ? 'risk' : ''}><span>{t('Overdue follow-ups (now)')}</span><b><Num v={s.follow_ups.overdue} /></b></div>
          </div>
        </Panel>
        <Panel className="s6 reveal" style={stagger(2, 600)} title={t('Proposals')} sub={t('Status of every proposal right now')}>
          <Donut centerLabel={t('Proposals')} delay={640} items={[
            { key: 'prep', label: t('Proposals preparing'), value: sp.preparing, color: 'var(--viz-4)' },
            { key: 'sent', label: t('Proposals sent'), value: sp.sent, color: 'var(--viz-2)' },
            { key: 'rev', label: t('Proposals under review'), value: sp.under_review, color: 'var(--viz-1)' },
            { key: 'revq', label: t('Revision requested'), value: sp.revision_requested, color: 'var(--viz-3)' },
            { key: 'acc', label: t('Accepted'), value: sp.accepted, color: 'var(--ok)' },
            { key: 'rej', label: t('Rejected'), value: sp.rejected, color: 'var(--line-strong)' }]} />
          <span className="muted small">{t('Proposals awaiting response')}: <b className="num">{sp.awaiting_response}</b></span>
        </Panel>
        <Panel className="s6 reveal" style={stagger(3, 600)} title={t('Meetings')} sub={t('Right now')}>
          <div className="tiles" style={{ ['--n' as string]: 2 }}>
            <div><span>{t('Upcoming meetings')}</span><b><Num v={s.meetings.upcoming} /></b></div>
            <div className={s.meetings.awaiting_outcome ? 'gold' : ''}><span>{t('Meetings awaiting outcome')}</span><b><Num v={s.meetings.awaiting_outcome} /></b></div>
          </div>
          <span className="muted small">{t('Meetings that already took place but have no recorded attendance yet are shown as awaiting outcome.')}</span>
        </Panel>
      </div>
    </section>
  );
}

function Team({ D }: { D: Mgmt }) {
  if (!D.calls.by_user) return <span className="muted small" data-testid="mgmt-department-only">{t('Department-level view: individual employee performance is not included for your role.')}</span>;
  return (
    <Panel className="reveal" style={stagger(0, 700)} testId="mgmt-individual" title={t('{team} performance', { team: term('sales_team') })} sub={t('Aggregates per person for the selected period — exact values, bars for comparison.')} flush>
      <TeamTable label={t('{team} performance', { team: term('sales_team') })} targets={D.scope.targets} followUps wl
        rows={D.calls.by_user.map((u, i) => ({ key: String(u.member ?? u.name ?? i), ...u }))} />
      {!D.scope.names && <span className="muted small" style={{ padding: '8px 14px 12px' }}>{t('Employee names are hidden by your access settings.')}</span>}
    </Panel>
  );
}

/** The dashboard's frame while the first payload loads: the composition is already in place (KPI band reading 0,
 *  panel frames) so the figures count up inside it when the data lands — no "Loading…" swap. */
function Skeleton() {
  return (
    <div className="col" style={{ gap: 14 }} aria-busy="true" aria-label={t('Loading…')} data-testid="mgmt-skeleton">
      <div className="section-label"><h2>{t('Activity during the selected period')}</h2></div>
      <div className="kpi-band" style={{ ['--cols' as string]: 6 }}>
        {['Total call attempts', 'Target achievement', 'Response rate', 'Meetings scheduled', 'Proposals sent', 'Won / Lost'].map((l, i) => (
          <div key={l} className={`kpi ${i === 0 ? 'lead hero' : ''}`}><div className="k-label">{t(l)}</div><div className="k-value num muted">—</div><div className="k-sub"><span className="skeleton" style={{ width: '60%' }} /></div></div>))}
      </div>
      <div className="cc-grid">
        {['s8', 's4', 's4', 's4', 's4'].map((c, i) => (
          <section key={i} className={`panel ${c}`} style={{ minHeight: i === 0 ? 220 : 160 }}><div className="panel-body"><span className="skeleton" style={{ width: '40%' }} /><span className="skeleton" style={{ width: '90%' }} /><span className="skeleton" style={{ width: '75%' }} /></div></section>))}
      </div>
    </div>
  );
}
