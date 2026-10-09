import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase, unwrap } from '../../lib/supabase';
import { Kpi, Loading } from '../../components/ui';
import { fmtDate } from '../../lib/cairo';
import { downloadCsv } from '../../lib/csv';
import { t } from '../../lib/i18n';

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
    queryKey: ['adminReport', from, to], staleTime: 20_000,
    queryFn: async () => unwrap(await supabase.rpc('admin_report', { p_from: from, p_to: to })) as unknown as Report,
  });
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

export function CallsSection({ r, showDays = true }: { r: Report; showDays?: boolean }) {
  const c = r.calls; const max = Math.max(1, ...c.by_day.map((d) => d.total));
  return (
    <section className="col" aria-label={t('Calls')}>
      <h2>{t('Calls & target performance')}</h2>
      <div className="grid cols-4 keep2">
        <Kpi hero label={t('Total call attempts')} value={c.total} sub={t('Unique leads {n}', { n: c.unique_leads })} />
        <Kpi label={t('Responded')} value={c.responded} sub={t('Response rate {r}', { r: pct(c.response_rate) })} />
        <Kpi label={t('Didn\'t respond')} value={c.did_not_respond} />
        <Kpi label={t('Target vs actual')} value={pct(c.achievement_pct)} sub={t('Target {target} · remaining {rem}', { target: c.target, rem: c.remaining })} tone={c.achievement_pct !== null && c.achievement_pct >= 100 ? 'ok' : undefined} />
      </div>
      <div className="card table-wrap"><table className="t" aria-label={t('Calls by user')}><thead><tr><th>{t('BD executive')}</th><th className="r">{t('Calls')}</th><th className="r">{t('Responded')}</th><th className="r">{t('Didn\'t')}</th><th className="r">{t('Rate')}</th><th className="r">{t('Unique leads')}</th><th className="r">{t('Target')}</th><th className="r">{t('Achieved')}</th><th className="r">{t('Remaining')}</th><th className="r">{t('Meetings gen.')}</th><th className="r">{t('Proposals gen.')}</th></tr></thead><tbody>
        {c.by_user.length === 0 && <tr><td colSpan={11} className="muted">{t('No users.')}</td></tr>}
        {c.by_user.map((u) => (
          <tr key={u.user_id}><td>{u.name}{!u.active && <span className="badge"> {t('inactive')}</span>}</td><td className="r num">{u.total}</td><td className="r num">{u.responded}</td><td className="r num">{u.did_not_respond}</td><td className="r num">{pct(u.response_rate)}</td><td className="r num">{u.unique_leads}</td><td className="r num">{u.target || '—'}</td><td className="r num"><b>{pct(u.achievement_pct)}</b></td><td className="r num">{u.target ? u.remaining : '—'}</td><td className="r num">{u.meetings_generated}</td><td className="r num">{u.proposals_generated}</td></tr>))}
      </tbody></table></div>
      {showDays && c.by_day.length > 1 && (
        <div className="card card-pad col"><h3>{t('Calls per day')}</h3>
          <div className="bars" role="img" aria-label={t('Calls per day')}>{c.by_day.map((d) => <div key={d.date} className="b" title={`${fmtDate(d.date)}: ${d.total}`} style={{ height: `${Math.max(3, (100 * d.total) / max)}%` }} />)}</div>
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Date')}</th><th className="r">{t('Calls')}</th><th className="r">{t('Responded')}</th><th className="r">{t('Didn\'t')}</th><th className="r">{t('Unique leads')}</th><th className="r">{t('Team target')}</th></tr></thead><tbody>
            {c.by_day.map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="r num">{d.total}</td><td className="r num">{d.responded}</td><td className="r num">{d.did_not_respond}</td><td className="r num">{d.unique_leads}</td><td className="r num">{d.target || '—'}</td></tr>)}
          </tbody></table></div>
        </div>
      )}
    </section>
  );
}

export function MeetingsSection({ r }: { r: Report }) {
  const m = r.meetings;
  return (
    <section className="col" aria-label={t('Meetings')}><h2>{t('Meetings')}</h2>
      <div className="grid cols-4 keep2">
        <Kpi hero label={t('Scheduled')} value={m.scheduled} sub={t('Generated from calls {n}', { n: m.generated_from_calls })} />
        <Kpi label={t('Confirmed')} value={m.confirmed} sub={t('Unconfirmed {n}', { n: m.unconfirmed })} />
        <Kpi label={t('Attended')} value={m.attended} sub={t('Not attended {n}', { n: m.not_attended })} />
        <Kpi label={t('Rescheduled / Cancelled')} value={`${m.rescheduled} / ${m.cancelled}`} sub={t('Awaiting outcome {a} · requests {r}', { a: m.awaiting_outcome, r: m.requested })} />
      </div>
    </section>
  );
}

export function CommercialSection({ r }: { r: Report }) {
  const c = r.commercial;
  return (
    <section className="col" aria-label={t('Commercial')}><h2>{t('Commercial progress')}</h2>
      <div className="grid cols-4 keep2">
        <Kpi label={t('Forms sent')} value={c.forms_sent} sub={t('Completed {c} · awaiting client {a}', { c: c.forms_completed, a: c.forms_awaiting_client })} />
        <Kpi label={t('Proposals prepared')} value={c.proposals_prepared} sub={t('Sent {n}', { n: c.proposals_sent })} />
        <Kpi label={t('Awaiting responses')} value={c.awaiting_responses} sub={t('Responses received {n}', { n: c.proposal_responses })} />
        <Kpi label={t('Negotiations')} value={c.negotiations} sub={t('Accepted {a} · rejected {r}', { a: c.accepted, r: c.rejected })} />
        <Kpi hero label={t('Won')} value={c.won} tone="ok" />
        <Kpi label={t('Lost')} value={c.lost} />
        <Kpi label={t('Proposal value sent')} value={Number(c.proposal_value_sent).toLocaleString()} sub={t('Sum of proposal values sent in range')} />
      </div>
    </section>
  );
}

export function FollowUpsSection({ r }: { r: Report }) {
  const f = r.follow_ups;
  return (
    <section className="col" aria-label={t('Follow-ups')}><h2>{t('Follow-ups')}</h2>
      <div className="grid cols-4 keep2"><Kpi label={t('Due')} value={f.due} /><Kpi label={t('Completed')} value={f.completed} /><Kpi label={t('Overdue (in range)')} value={f.overdue} tone={f.overdue ? 'bad' : undefined} /><Kpi label={t('Overdue now (all)')} value={f.open_overdue_total} /></div>
    </section>
  );
}

export function PipelineSection({ r }: { r: Report }) {
  const max = Math.max(1, ...r.pipeline.map((p) => p.current));
  return (
    <section className="col" aria-label={t('Pipeline')}><h2>{t('Pipeline')}</h2>
      <div className="card card-pad col">
        {r.pipeline.map((p) => (
          <div key={p.stage} className="hbar"><span>{p.label}</span><div className="track"><i style={{ width: `${(100 * p.current) / max}%` }} /></div><b className="num">{p.current}</b></div>))}
        <span className="muted small">Current leads per stage. Entered stage during the period: {r.pipeline.map((p) => `${p.label} ${p.entered}`).join(' · ')}</span>
      </div>
    </section>
  );
}

export function WinsLossesSection({ r }: { r: Report }) {
  return (
    <section className="col" aria-label={t('Wins and losses')}><h2>{t('Wins & losses')}</h2>
      <div className="card table-wrap"><table className="t"><thead><tr><th>{t('Lead')}</th><th>{t('Result')}</th><th>{t('When')}</th><th>{t('Recorded by')}</th></tr></thead><tbody>
        {r.wins_losses.length === 0 && <tr><td colSpan={4} className="muted">{t('None in this period.')}</td></tr>}
        {r.wins_losses.map((w, i) => <tr key={i}><td><Link to={`/leads/view/?id=${w.lead_id}`}>{w.lead}</Link></td><td><span className={`badge ${w.result === 'won' ? 'ok' : 'bad'}`}>{w.result}</span></td><td>{fmtDate(w.at)}</td><td>{w.by ?? '—'}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}

export function CriticalSection({ r }: { r: Report }) {
  return (
    <section className="col" aria-label={t('Critical follow-ups')}><h2>{t('Critical follow-ups (overdue)')}</h2>
      <div className="card table-wrap"><table className="t"><thead><tr><th>{t('Lead')}</th><th>{t('Due')}</th><th className="r">{t('Days overdue')}</th><th>{t('Owner')}</th><th>{t('Note')}</th></tr></thead><tbody>
        {r.critical_follow_ups.length === 0 && <tr><td colSpan={5} className="muted">{t('No overdue follow-ups.')}</td></tr>}
        {r.critical_follow_ups.map((f) => <tr key={f.id}><td><Link to={`/leads/view/?id=${f.lead_id}`}>{f.lead}</Link></td><td>{fmtDate(f.due_date)}</td><td className="r num" style={{ color: 'var(--bad)' }}>{f.days_overdue}</td><td>{f.owner ?? '—'}</td><td>{f.notes}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}

export function reportCsv(r: Report): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  rows.push(['ACCORD CRM report', `${r.range.from} to ${r.range.to}`, r.range.timezone, `generated ${r.range.generated_at}`], []);
  rows.push(['CALLS BY USER'], ['User', 'Calls', 'Responded', "Didn't respond", 'Response rate %', 'Unique leads', 'Target', 'Achievement %', 'Remaining', 'Meetings generated', 'Proposals generated']);
  for (const u of r.calls.by_user) rows.push([u.name, u.total, u.responded, u.did_not_respond, u.response_rate, u.unique_leads, u.target, u.achievement_pct, u.remaining, u.meetings_generated, u.proposals_generated]);
  rows.push(['TOTAL', r.calls.total, r.calls.responded, r.calls.did_not_respond, r.calls.response_rate, r.calls.unique_leads, r.calls.target, r.calls.achievement_pct, r.calls.remaining], []);
  rows.push(['CALLS BY DAY'], ['Date', 'Calls', 'Responded', "Didn't respond", 'Unique leads', 'Team target']);
  for (const d of r.calls.by_day) rows.push([d.date, d.total, d.responded, d.did_not_respond, d.unique_leads, d.target]);
  rows.push([], ['MEETINGS']); for (const [k, v] of Object.entries(r.meetings)) rows.push([k, v]);
  rows.push([], ['COMMERCIAL']); for (const [k, v] of Object.entries(r.commercial)) rows.push([k, v]);
  rows.push([], ['FOLLOW-UPS']); for (const [k, v] of Object.entries(r.follow_ups)) rows.push([k, v]);
  rows.push([], ['PIPELINE'], ['Stage', 'Current', 'Entered in period']); for (const p of r.pipeline) rows.push([p.label, p.current, p.entered]);
  rows.push([], ['WINS / LOSSES'], ['Lead', 'Result', 'At', 'By']); for (const w of r.wins_losses) rows.push([w.lead, w.result, w.at, w.by]);
  rows.push([], ['CRITICAL FOLLOW-UPS'], ['Lead', 'Due', 'Days overdue', 'Owner', 'Note']); for (const f of r.critical_follow_ups) rows.push([f.lead, f.due_date, f.days_overdue, f.owner, f.notes]);
  return rows;
}
export const exportReport = (r: Report, name: string) => downloadCsv(`accord-${name}-${r.range.from}_${r.range.to}.csv`, reportCsv(r));
export { Loading };
