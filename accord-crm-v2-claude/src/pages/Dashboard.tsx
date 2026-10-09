import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Phone, CalendarClock, Handshake, Briefcase, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useMyCallMetrics, useCairoToday } from '../lib/hooks';
import { Kpi, PageHead, Loading, ErrorNote, Empty } from '../components/ui';
import { useCall } from '../components/CallProvider';
import { addDays, cairoDayStart, fmtDate, fmtTime, daysBetween } from '../lib/cairo';
import { label, MEETING_TYPES } from '../lib/labels';

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: c, error } = await q;
  if (error) throw new Error(error.message);
  return c ?? 0;
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
      <PageHead title={`Hello, ${(profile!.full_name || profile!.email).split(' ')[0]}`} sub={`Today · ${fmtDate(today)} (Cairo)`} />
      <ErrorNote error={m.error ?? dash.error} />

      <section aria-label="My call performance" className="col" style={{ marginBottom: 18 }}>
        <h2 className="row"><Phone size={16} /> My call performance</h2>
        {!mm ? <Loading /> : (
          <>
            <div className="grid cols-4 keep2">
              <Kpi hero label="Calls today" value={<span data-testid="kpi-calls">{mm.total}</span>} sub={mm.has_target ? `of ${mm.target} daily target` : 'No target set — ask an admin'} />
              <Kpi label="Target achievement" value={<span data-testid="kpi-pct">{pct === null ? '—' : `${pct}%`}</span>} sub={mm.has_target ? <>Remaining <b data-testid="kpi-remaining">{mm.remaining}</b></> : ''} tone={pct !== null && pct >= 100 ? 'ok' : undefined} />
              <Kpi label="Responded" value={<span data-testid="kpi-responded">{mm.responded}</span>} sub={`Response rate ${mm.response_rate ?? '—'}${mm.response_rate !== null ? '%' : ''}`} />
              <Kpi label="Didn't respond" value={<span data-testid="kpi-dnr">{mm.did_not_respond}</span>} sub={<>Unique leads called <b data-testid="kpi-unique">{mm.unique_leads}</b></>} />
            </div>
            {mm.has_target && <div className={`progress ${pct !== null && pct >= 100 ? 'over' : ''}`} aria-label="Daily target progress"><i style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>}
          </>
        )}
      </section>

      {dash.isLoading ? <Loading /> : dash.data && (
        <>
          <div className="grid cols-3" style={{ marginBottom: 18 }}>
            <section className="card card-pad col" aria-label="My follow-ups">
              <h2 className="row"><CalendarClock size={16} /> My follow-ups</h2>
              <div className="row spread"><Link to="/follow-ups/?tab=today">Due today</Link><b className="num">{dash.data.fuToday}</b></div>
              <div className="row spread"><Link to="/follow-ups/?tab=overdue" style={{ color: dash.data.fuOver ? 'var(--bad)' : undefined }}>Overdue</Link><b className="num" style={{ color: dash.data.fuOver ? 'var(--bad)' : undefined }}>{dash.data.fuOver}</b></div>
            </section>
            <section className="card card-pad col" aria-label="My meetings">
              <h2 className="row"><Handshake size={16} /> My meetings</h2>
              <div className="row spread"><Link to="/meetings/?tab=today">Today</Link><b className="num">{dash.data.mtToday}</b></div>
              <div className="row spread"><Link to="/meetings/?tab=upcoming">Upcoming</Link><b className="num">{dash.data.mtUp}</b></div>
              <div className="row spread"><span className="muted">Confirmed / Unconfirmed</span><span className="num"><span className="badge ok">{dash.data.mtConf}</span> <span className="badge warn">{dash.data.mtUnconf}</span></span></div>
            </section>
            <section className="card card-pad col" aria-label="My commercial actions">
              <h2 className="row"><Briefcase size={16} /> Commercial actions</h2>
              <div className="row spread"><Link to="/proposals/?tab=forms">Forms awaiting client</Link><b className="num">{dash.data.formsWait}</b></div>
              <div className="row spread"><Link to="/proposals/?tab=action">Proposals needing action</Link><b className="num">{dash.data.propAction}</b></div>
              <div className="row spread"><Link to="/proposals/?tab=followup">Proposal follow-ups due</Link><b className="num">{dash.data.propFu}</b></div>
            </section>
          </div>

          <div className="grid cols-2">
            <section className="card" aria-label="Priority next actions">
              <div className="card-head"><h2 className="row"><AlertTriangle size={16} /> Next actions</h2><Link to="/follow-ups/">All follow-ups</Link></div>
              {dash.data.queue.length === 0 ? <Empty>Nothing due. Nice work.</Empty> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {dash.data.queue.map((f) => (
                    <li key={f.id} className="row spread card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div><Link to={`/leads/view/?id=${f.lead_id}`}><b>{f.leads?.name}</b></Link>
                        <div className="muted small">{f.due_date < today ? <span style={{ color: 'var(--bad)' }}>{daysBetween(f.due_date, today)}d overdue</span> : 'Due today'}{f.notes ? ` · ${f.notes}` : ''}</div></div>
                      {isStaff && <button className="btn sm" onClick={() => startCall({ id: f.lead_id, name: f.leads?.name ?? '' })}><Phone /> Call</button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card" aria-label="Today's meetings">
              <div className="card-head"><h2 className="row"><Handshake size={16} /> Meetings today</h2><Link to="/meetings/">Meetings hub</Link></div>
              {dash.data.todayMeetings.length === 0 ? <Empty>No meetings today.</Empty> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {dash.data.todayMeetings.map((x) => (
                    <li key={x.id} className="row spread card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div><Link to={`/leads/view/?id=${x.lead_id}`}><b>{x.leads?.name}</b></Link>
                        <div className="muted small">{fmtTime(x.scheduled_at)} · {label(MEETING_TYPES, x.meeting_type)}{x.meeting_with ? ` · ${x.meeting_with}` : ''}</div></div>
                      <span className={`badge ${x.confirmation_status === 'confirmed' ? 'ok' : 'warn'}`}>{label([['confirmed', 'Confirmed'], ['unconfirmed', 'Unconfirmed'], ['tentative', 'Tentative']], x.confirmation_status)}</span>
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
