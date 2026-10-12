import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase, unwrap } from '../../lib/supabase';
import { Kpi, Loading } from '../../components/ui';
import { fmtDate, fmtDay } from '../../lib/cairo';
import { Num, Trend, StageFlow, MeetingMix, Meter, Panel, stagger } from '../../components/viz';
import { TeamTable } from '../../components/team';
import { downloadCsv } from '../../lib/csv';
import { t, personName } from '../../lib/i18n';
import { term } from '../../lib/terminology';

export interface ByUser { user_id: string; name: string; active: boolean; total: number; responded: number; did_not_respond: number; unique_leads: number; response_rate: number | null; target: number; achievement_pct: number | null; remaining: number; meetings_generated: number; proposals_generated: number }
export interface Report {
  range: { from: string; to: string; timezone: string; generated_at: string };
  calls: { total: number; responded: number; did_not_respond: number; unique_leads: number; response_rate: number | null; target: number; achievement_pct: number | null; remaining: number; by_user: ByUser[]; by_day: { date: string; total: number; responded: number; did_not_respond: number; unique_leads: number; target: number }[] };
  meetings: Record<string, number>;
  commercial: Record<string, number>;
  follow_ups: Record<string, number>;
  pipeline: { stage: string; label: string; current: number; entered: number }[];
  wins_losses: { lead_id: string; lead: string; result: string; at: string; by: string | null }[];
  critical_follow_ups: { id: string; lead_id: string; lead: string; due_date: string; days_overdue: number; owner: string | null; notes: string | null }[];
}

export function useAdminReport(from: string, to: string) {
  return useQuery({
    queryKey: ['adminReport', from, to], staleTime: 20_000, placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await supabase.rpc('admin_report', { p_from: from, p_to: to })) as unknown as Report,
  });
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Calls & target: KPI band, per-day trend, team table with comparison bars (+ optional per-day table). */
export function CallsSection({ r, showDays = true, band = true }: { r: Report; showDays?: boolean; band?: boolean }) {
  const c = r.calls;
  return (
    <section className="col" style={{ gap: 12 }} aria-label={t('Calls')}>
      <div className="section-label"><h2>{t('Calls & target performance')}</h2></div>
      {band && <div className="kpi-band" style={{ ['--cols' as string]: 4 }}>
        <Kpi lead hero label={t('Total call attempts')} value={<Num v={c.total} count />} sub={t('Unique leads {n}', { n: c.unique_leads })} meter={c.achievement_pct ?? 0} style={stagger(0, 60)} />
        <Kpi label={t('Responded')} value={<Num v={c.responded} count />} sub={t('Response rate {r}', { r: pct(c.response_rate) })} style={stagger(1, 60)} />
        <Kpi label={t('Didn\'t respond')} value={<Num v={c.did_not_respond} count />} style={stagger(2, 60)} />
        <Kpi label={t('Target vs actual')} value={<Num v={c.achievement_pct} suffix="%" count />} sub={t('Target {target} · remaining {rem}', { target: c.target, rem: c.remaining })} style={stagger(3, 60)} />
      </div>}
      {showDays && c.by_day.length > 1 && (
        <Panel className="reveal" style={stagger(0, 240)} title={t('Calls per day')} sub={t('Attempts, responded and the combined working-day target')}>
          <Trend points={c.by_day} fmtX={fmtDay} label={t('Calls per day')} />
        </Panel>)}
      <Panel className="reveal" style={stagger(1, 300)} title={<span data-testid="team-performance">{t('{team} performance', { team: term('sales_team') })}</span>} flush>
        <TeamTable label={t('Calls by user')} targets rows={c.by_user.map((u) => ({ key: u.user_id, ...u }))} />
      </Panel>
      {showDays && c.by_day.length > 1 && (
        <details className="panel reveal" style={stagger(2, 340)}>
          <summary className="panel-head" style={{ paddingBottom: 11, cursor: 'pointer' }}><h2>{t('Daily breakdown')}</h2></summary>
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Date')}</th><th className="r">{t('Calls')}</th><th className="r">{t('Responded')}</th><th className="r">{t('Didn\'t')}</th><th className="r">{t('Unique leads')}</th><th className="r">{t('Team target')}</th></tr></thead><tbody>
            {c.by_day.map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="r num">{d.total}</td><td className="r num">{d.responded}</td><td className="r num">{d.did_not_respond}</td><td className="r num">{d.unique_leads}</td><td className="r num">{d.target || '—'}</td></tr>)}
          </tbody></table></div>
        </details>)}
    </section>
  );
}

export function MeetingsSection({ r, className = '' }: { r: Report; className?: string }) {
  const m = r.meetings;
  return (
    <Panel className={`reveal ${className}`} style={stagger(0, 380)} label={t('Meetings')} title={t('Meetings')} sub={t('Generated from calls {n}', { n: m.generated_from_calls })}>
      <div className="tiles" style={{ ['--n' as string]: 3 }}>
        <div><span>{t('Scheduled')}</span><b><Num v={m.scheduled} /></b></div><div><span>{t('Attended')}</span><b><Num v={m.attended} /></b></div><div className="gold"><span>{t('Awaiting outcome')}</span><b><Num v={m.awaiting_outcome} /></b></div>
      </div>
      <MeetingMix m={m} />
      <span className="muted small">{t('Awaiting outcome {a} · requests {r}', { a: m.awaiting_outcome, r: m.requested })}</span>
    </Panel>
  );
}

export function CommercialSection({ r, className = '' }: { r: Report; className?: string }) {
  const c = r.commercial;
  return (
    <Panel className={`reveal ${className}`} style={stagger(1, 380)} label={t('Commercial')} title={t('Commercial progress')}>
      <div className="tiles" style={{ ['--n' as string]: 3 }}>
        <div className="gold"><span>{t('Won')}</span><b><Num v={c.won} /></b></div><div><span>{t('Lost')}</span><b><Num v={c.lost} /></b></div><div><span>{t('Proposal value sent')}</span><b><Num v={Number(c.proposal_value_sent)} /></b></div>
      </div>
      <div className="mlist">
        <div><span>{t('Forms sent')}</span><b>{c.forms_sent}</b></div><div><span>{t('Forms completed')}</span><b>{c.forms_completed}</b></div>
        <div><span>{t('Forms awaiting client')}</span><b>{c.forms_awaiting_client}</b></div><div><span>{t('Proposals prepared')}</span><b>{c.proposals_prepared}</b></div>
        <div><span>{t('Proposals sent')}</span><b>{c.proposals_sent}</b></div><div><span>{t('Awaiting responses')}</span><b>{c.awaiting_responses}</b></div>
        <div><span>{t('Responses received')}</span><b>{c.proposal_responses}</b></div><div><span>{t('Negotiations')}</span><b>{c.negotiations}</b></div>
        <div><span>{t('Accepted')}</span><b>{c.accepted}</b></div><div><span>{t('Rejected')}</span><b>{c.rejected}</b></div>
      </div>
    </Panel>
  );
}

export function FollowUpsSection({ r, className = '' }: { r: Report; className?: string }) {
  const f = r.follow_ups;
  return (
    <Panel className={`reveal ${className}`} style={stagger(2, 380)} label={t('Follow-ups')} title={t('Follow-ups')}>
      <div className="tiles" style={{ ['--n' as string]: 2 }}>
        <div><span>{t('Due')}</span><b><Num v={f.due} /></b></div><div><span>{t('Completed')}</span><b><Num v={f.completed} /></b></div>
        <div className={f.overdue ? 'risk' : ''}><span>{t('Overdue (in range)')}</span><b><Num v={f.overdue} /></b></div><div className={f.open_overdue_total ? 'risk' : ''}><span>{t('Overdue now (all)')}</span><b><Num v={f.open_overdue_total} /></b></div>
      </div>
      <Meter pct={f.due ? (100 * f.completed) / f.due : 0} label={t('Completed')} />
    </Panel>
  );
}

export function PipelineSection({ r, className = '' }: { r: Report; className?: string }) {
  return (
    <Panel className={`reveal ${className}`} style={stagger(3, 420)} label={t('Pipeline')} title={t('Pipeline')} sub={t('Current leads per stage · share · entered during the period')}>
      <StageFlow stages={r.pipeline.map((p) => ({ key: p.stage, label: t(p.label), current: p.current, entered: p.entered }))} delay={460} />
    </Panel>
  );
}

export function WinsLossesSection({ r, className = '' }: { r: Report; className?: string }) {
  return (
    <Panel className={`reveal ${className}`} style={stagger(4, 460)} label={t('Wins and losses')} title={t('Wins & losses')} flush>
      <div className="table-wrap"><table className="t"><thead><tr><th>{t('Lead')}</th><th>{t('Result')}</th><th>{t('When')}</th><th>{t('Recorded by')}</th></tr></thead><tbody>
        {r.wins_losses.length === 0 && <tr><td colSpan={4} className="muted">{t('None in this period.')}</td></tr>}
        {r.wins_losses.map((w, i) => <tr key={i}><td><Link to={`/leads/view/?id=${w.lead_id}`}>{w.lead}</Link></td><td><span className={`badge ${w.result === 'won' ? 'ok' : ''}`}>{t(w.result === 'won' ? 'Won' : 'Lost')}</span></td><td>{fmtDate(w.at)}</td><td>{w.by ?? '—'}</td></tr>)}
      </tbody></table></div>
    </Panel>
  );
}

export function CriticalSection({ r, className = '' }: { r: Report; className?: string }) {
  return (
    <Panel className={`reveal ${className}`} style={stagger(5, 500)} label={t('Critical follow-ups')} title={t('Critical follow-ups (overdue)')} sub={t('Oldest first')} flush>
      <div className="table-wrap"><table className="t"><thead><tr><th>{t('Lead')}</th><th>{t('Due')}</th><th className="r">{t('Days overdue')}</th><th>{t('Owner')}</th><th>{t('Note')}</th></tr></thead><tbody>
        {r.critical_follow_ups.length === 0 && <tr><td colSpan={5} className="muted">{t('No overdue follow-ups.')}</td></tr>}
        {r.critical_follow_ups.map((f) => <tr key={f.id}><td><Link to={`/leads/view/?id=${f.lead_id}`}>{f.lead}</Link></td><td>{fmtDate(f.due_date)}</td><td className="r num" style={{ color: 'var(--bad)' }}>{f.days_overdue}</td><td>{personName(f.owner) || '—'}</td><td>{f.notes}</td></tr>)}
      </tbody></table></div>
    </Panel>
  );
}

export function reportCsv(r: Report): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  rows.push(['ACCORD CRM report', `${r.range.from} to ${r.range.to}`, r.range.timezone, `generated ${r.range.generated_at}`], []);
  rows.push(['CALLS BY USER'], ['User', 'Calls', 'Responded', "Didn't respond", 'Response rate %', 'Unique leads', 'Target', 'Achievement %', 'Remaining', 'Meetings generated', 'Proposals generated']);
  for (const u of r.calls.by_user) rows.push([personName(u.name), u.total, u.responded, u.did_not_respond, u.response_rate, u.unique_leads, u.target, u.achievement_pct, u.remaining, u.meetings_generated, u.proposals_generated]);
  rows.push(['TOTAL', r.calls.total, r.calls.responded, r.calls.did_not_respond, r.calls.response_rate, r.calls.unique_leads, r.calls.target, r.calls.achievement_pct, r.calls.remaining], []);
  rows.push(['CALLS BY DAY'], ['Date', 'Calls', 'Responded', "Didn't respond", 'Unique leads', 'Team target']);
  for (const d of r.calls.by_day) rows.push([d.date, d.total, d.responded, d.did_not_respond, d.unique_leads, d.target]);
  rows.push([], ['MEETINGS']); for (const [k, v] of Object.entries(r.meetings)) rows.push([k, v]);
  rows.push([], ['COMMERCIAL']); for (const [k, v] of Object.entries(r.commercial)) rows.push([k, v]);
  rows.push([], ['FOLLOW-UPS']); for (const [k, v] of Object.entries(r.follow_ups)) rows.push([k, v]);
  rows.push([], ['PIPELINE'], ['Stage', 'Current', 'Entered in period']); for (const p of r.pipeline) rows.push([p.label, p.current, p.entered]);
  rows.push([], ['WINS / LOSSES'], ['Lead', 'Result', 'At', 'By']); for (const w of r.wins_losses) rows.push([w.lead, w.result, w.at, w.by]);
  rows.push([], ['CRITICAL FOLLOW-UPS'], ['Lead', 'Due', 'Days overdue', 'Owner', 'Note']); for (const f of r.critical_follow_ups) rows.push([f.lead, f.due_date, f.days_overdue, personName(f.owner), f.notes]);
  return rows;
}
export const exportReport = (r: Report, name: string) => downloadCsv(`accord-${name}-${r.range.from}_${r.range.to}.csv`, reportCsv(r));
export { Loading };
