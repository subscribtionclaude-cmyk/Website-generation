import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Phone, CalendarClock, Handshake, Briefcase, AlertTriangle, CheckCircle2, CalendarDays, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useMyCallMetrics, useCairoToday } from '../lib/hooks';
import { Kpi, PageHead, Loading, ErrorNote, Empty } from '../components/ui';
import { useCall } from '../components/CallProvider';
import { addDays, cairoDayStart, fmtDate, fmtTime, daysBetween } from '../lib/cairo';
import { label, MEETING_TYPES, CONFIRMATION } from '../lib/labels';
import { t } from '../lib/i18n';

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: c, error } = await q;
  if (error) throw new Error(error.message);
  return c ?? 0;
}

function StatRow({ to, label, value, tone }: { to: string; label: string; value: number; tone?: 'bad' | 'warn' }) {
  return (
    <Link to={to} className="stat-row">
      <span className="grow">{label}</span>
      <b className="num" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
      <ChevronRight className="flip-rtl" aria-hidden="true" />
    </Link>
  );
}

export default function Dashboard() {
  const { profile, isStaff } = useAuth();
  const today = useCairoToday();
  const { startCall } = useCall();
  const m = useMyCallMetrics();
  const me = profile!.id;

  const dash = useQuery({
    queryKey: ['dashboard', me, today], refetchInterval: 60_000,
    queryFn: async () => {
      const t0 = cairoDayStart(today).toISOString(); const t1 = cairoDayStart(addDays(today, 1)).toISOString();
      const fu = () => supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('owner_id', me).eq('status', 'open');
      const mt = () => supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('owner_id', me).eq('status', 'scheduled');
      const [fuToday, fuOver, mtToday, mtUp, mtConf, mtUnconf, formsWait, propAction, propFu, queue, todayMeetings] = await Promise.all([
        count(fu().eq('due_date', today)), count(fu().lt('due_date', today)),
        count(mt().gte('scheduled_at', t0).lt('scheduled_at', t1)), count(mt().gte('scheduled_at', t1)),
        count(mt().gte('scheduled_at', t0).eq('confirmation_status', 'confirmed')), count(mt().gte('scheduled_at', t0).neq('confirmation_status', 'confirmed')),
        count(supabase.from('commercial_forms').select('id', { count: 'exact', head: true }).eq('owner_id', me).in('status', ['sent', 'partially_completed'])),
        count(supabase.from('proposals').select('id', { count: 'exact', head: true }).eq('owner_id', me).in('status', ['not_started', 'preparing', 'ready', 'revision_requested'])),
        count(supabase.from('proposals').select('id', { count: 'exact', head: true }).eq('owner_id', me).in('status', ['sent', 'under_review']).lte('next_follow_up_date', today)),
        supabase.from('follow_ups').select('id,lead_id,due_date,notes,title,leads(name)').eq('owner_id', me).eq('status', 'open').lte('due_date', today).order('due_date').limit(8),
        supabase.from('meetings').select('id,lead_id,scheduled_at,meeting_type,confirmation_status,meeting_with,leads(name)').eq('owner_id', me).eq('status', 'scheduled').gte('scheduled_at', t0).lt('scheduled_at', t1).order('scheduled_at'),
      ]);
      if (queue.error) throw new Error(queue.error.message);
      if (todayMeetings.error) throw new Error(todayMeetings.error.message);
      return { fuToday, fuOver, mtToday, mtUp, mtConf, mtUnconf, formsWait, propAction, propFu, queue: queue.data as unknown as { id: string; lead_id: string; due_date: string; notes: string | null; leads: { name: string } | null }[], todayMeetings: todayMeetings.data as unknown as { id: string; lead_id: string; scheduled_at: string; meeting_type: string; confirmation_status: string; meeting_with: string | null; leads: { name: string } | null }[] };
    },
  });

  const mm = m.data;
  const pct = mm?.achievement_pct ?? null;
  return (
    <>
      <PageHead title={t('Hello, {name}', { name: (profile!.full_name || profile!.email).split(' ')[0] })} sub={t('Today · {date} (Cairo)', { date: fmtDate(today) })} />
      <ErrorNote error={m.error ?? dash.error} />

      <section aria-label={t('My call performance')} className="col" style={{ marginBottom: 22, gap: 10 }}>
        <h2 className="section-title">{t('My call performance')}</h2>
        {!mm ? <Loading /> : (
          <>
            <div className="grid cols-4 keep2">
              <Kpi hero label={t('Calls today')} value={<span data-testid="kpi-calls">{mm.total}</span>} sub={mm.has_target ? t('of {n} daily target', { n: mm.target }) : t('No target set — ask an admin')} />
              <Kpi label={t('Target achievement')} value={<span data-testid="kpi-pct">{pct === null ? '—' : `${pct}%`}</span>} sub={mm.has_target ? <>{t('Remaining')} <b data-testid="kpi-remaining">{mm.remaining}</b></> : ''} tone={pct !== null && pct >= 100 ? 'ok' : undefined} />
              <Kpi label={t('Responded')} value={<span data-testid="kpi-responded">{mm.responded}</span>} sub={t('Response rate {r}', { r: mm.response_rate === null ? '—' : `${mm.response_rate}%` })} />
              <Kpi label={t('Didn\'t respond')} value={<span data-testid="kpi-dnr">{mm.did_not_respond}</span>} sub={<>{t('Unique leads called')} <b data-testid="kpi-unique">{mm.unique_leads}</b></>} />
            </div>
            {mm.has_target && <div className={`progress ${pct !== null && pct >= 100 ? 'over' : ''}`} aria-label={t('Daily target progress')}><i style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>}
          </>
        )}
      </section>

      {dash.isLoading ? <Loading /> : dash.data && (
        <>
          <div className="grid cols-3" style={{ marginBottom: 22 }}>
            <section className="card" aria-label={t('My follow-ups')}>
              <div className="card-head"><h2 className="row"><CalendarClock size={16} /> {t('My follow-ups')}</h2></div>
              <div className="stat-list">
                <StatRow to="/follow-ups/?tab=today" label={t('Due today')} value={dash.data.fuToday} />
                <StatRow to="/follow-ups/?tab=overdue" label={t('Overdue')} value={dash.data.fuOver} tone={dash.data.fuOver ? 'bad' : undefined} />
              </div>
            </section>
            <section className="card" aria-label={t('My meetings')}>
              <div className="card-head"><h2 className="row"><Handshake size={16} /> {t('My meetings')}</h2>
                <span className="row nowrap small" title={t('Confirmed / Unconfirmed')}><span className="badge ok num">{dash.data.mtConf}</span><span className="badge warn num">{dash.data.mtUnconf}</span></span></div>
              <div className="stat-list">
                <StatRow to="/meetings/?tab=today" label={t('Today')} value={dash.data.mtToday} />
                <StatRow to="/meetings/?tab=upcoming" label={t('Upcoming')} value={dash.data.mtUp} />
              </div>
            </section>
            <section className="card" aria-label={t('My commercial actions')}>
              <div className="card-head"><h2 className="row"><Briefcase size={16} /> {t('Commercial actions')}</h2></div>
              <div className="stat-list">
                <StatRow to="/proposals/?tab=forms" label={t('Forms awaiting client')} value={dash.data.formsWait} />
                <StatRow to="/proposals/?tab=action" label={t('Proposals needing action')} value={dash.data.propAction} />
                <StatRow to="/proposals/?tab=followup" label={t('Proposal follow-ups due')} value={dash.data.propFu} tone={dash.data.propFu ? 'warn' : undefined} />
              </div>
            </section>
          </div>

          <div className="grid cols-2">
            <section className="card" aria-label={t('Priority next actions')}>
              <div className="card-head"><h2 className="row"><AlertTriangle size={16} /> {t('Next actions')}</h2><Link to="/follow-ups/">{t('All follow-ups')}</Link></div>
              {dash.data.queue.length === 0 ? <Empty icon={<CheckCircle2 />}>{t('Nothing due. Nice work.')}</Empty> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {dash.data.queue.map((f) => (
                    <li key={f.id} className="row spread nowrap card-pad list-row">
                      <div className="grow"><Link to={`/leads/view/?id=${f.lead_id}`}><b>{f.leads?.name}</b></Link>
                        <div className="muted small">{f.due_date < today ? <span style={{ color: 'var(--bad)' }}>{t('{n}d overdue', { n: daysBetween(f.due_date, today) })}</span> : t('Due today')}{f.notes ? ` · ${f.notes}` : ''}</div></div>
                      {isStaff && <button className="btn sm" onClick={() => startCall({ id: f.lead_id, name: f.leads?.name ?? '' })}><Phone /> {t('Call')}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card" aria-label={t('Today\'s meetings')}>
              <div className="card-head"><h2 className="row"><Handshake size={16} /> {t('Meetings today')}</h2><Link to="/meetings/">{t('Meetings hub')}</Link></div>
              {dash.data.todayMeetings.length === 0 ? <Empty icon={<CalendarDays />}>{t('No meetings today.')}</Empty> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {dash.data.todayMeetings.map((x) => (
                    <li key={x.id} className="row spread nowrap card-pad list-row">
                      <div className="grow"><Link to={`/leads/view/?id=${x.lead_id}`}><b>{x.leads?.name}</b></Link>
                        <div className="muted small"><span className="num">{fmtTime(x.scheduled_at)}</span> · {label(MEETING_TYPES, x.meeting_type)}{x.meeting_with ? ` · ${x.meeting_with}` : ''}</div></div>
                      <span className={`badge ${x.confirmation_status === 'confirmed' ? 'ok' : 'warn'}`}>{label(CONFIRMATION, x.confirmation_status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
