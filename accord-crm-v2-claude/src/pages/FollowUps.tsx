import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Phone, Check, CalendarClock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Tabs, Loading, Empty, ErrorNote, UserSelect } from '../components/ui';
import { useCall } from '../components/CallProvider';
import { CompleteFollowUpDialog, FollowUpFormDialog } from '../components/followups';
import { addDays, cairoToday, daysBetween, fmtDate, weekRange } from '../lib/cairo';
import type { FollowUp } from '../lib/types';

type Tab = 'overdue' | 'today' | 'tomorrow' | 'week' | 'upcoming' | 'completed';
const RANGES = (t: string): Record<Tab, (b: any) => any> => ({
  overdue: (b) => b.eq('status', 'open').lt('due_date', t).order('due_date'),
  today: (b) => b.eq('status', 'open').eq('due_date', t).order('due_time', { nullsFirst: false }),
  tomorrow: (b) => b.eq('status', 'open').eq('due_date', addDays(t, 1)),
  week: (b) => b.eq('status', 'open').gte('due_date', t).lte('due_date', weekRange(t).to).order('due_date'),
  upcoming: (b) => b.eq('status', 'open').gt('due_date', addDays(t, 1)).order('due_date'),
  completed: (b) => b.eq('status', 'completed').order('completed_at', { ascending: false }),
});

export default function FollowUps() {
  const { profile, isStaff, isAdmin } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'today';
  const [who, setWho] = useState(profile!.id);
  const [complete, setComplete] = useState<FollowUp | null>(null); const [resched, setResched] = useState<FollowUp | null>(null);
  const { startCall } = useCall();
  const t = cairoToday();
  const base = (head = false) => { let b = supabase.from('follow_ups').select(head ? 'id' : '*, leads(name)', { count: 'exact', head }); if (who) b = b.eq('owner_id', who); return b; };

  const counts = useQuery({
    queryKey: ['followups', 'counts', who, t],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all((Object.keys(RANGES(t)) as Tab[]).filter((k) => k !== 'completed').map(async (k) => { const { count } = await RANGES(t)[k](base(true)); out[k] = count ?? 0; }));
      return out;
    },
  });
  const list = useQuery({
    queryKey: ['followups', 'list', tab, who, t],
    queryFn: async () => {
      const { data, error } = await RANGES(t)[tab](base()).limit(200);
      if (error) throw new Error(error.message); return data as unknown as FollowUp[];
    },
  });

  return (
    <>
      <PageHead title="Follow-ups" sub="Business dates in Africa/Cairo" actions={<UserSelect value={who} onChange={setWho} includeAll allLabel="Everyone" />} />
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={[
          { key: 'overdue', label: 'Overdue', count: counts.data?.overdue }, { key: 'today', label: 'Today', count: counts.data?.today }, { key: 'tomorrow', label: 'Tomorrow', count: counts.data?.tomorrow },
          { key: 'week', label: 'This week', count: counts.data?.week }, { key: 'upcoming', label: 'Upcoming', count: counts.data?.upcoming }, { key: 'completed', label: 'Completed' }]} />
      </div>
      <ErrorNote error={list.error} />
      <div className="card">
        {list.isLoading ? <Loading /> : !list.data?.length ? <Empty>Nothing here.</Empty> : list.data.map((f) => (
          <div key={f.id} className="row spread card-pad" style={{ borderBottom: '1px solid var(--line)' }} data-testid="followup-row">
            <div className="col" style={{ gap: 2 }}>
              <Link to={`/leads/view/?id=${f.lead_id}`}><b>{f.leads?.name}</b></Link>
              <span className="small"><b style={{ color: f.status === 'open' && f.due_date < t ? 'var(--bad)' : undefined }}>{fmtDate(f.due_date)}{f.due_time ? ` ${f.due_time.slice(0, 5)}` : ''}</b>
                {f.status === 'open' && f.due_date < t && <span style={{ color: 'var(--bad)' }}> · {daysBetween(f.due_date, t)}d overdue</span>}
                {f.notes ? <span className="muted"> · {f.notes}</span> : null} <span className="badge">{f.origin.replace('_', ' ')}</span></span>
            </div>
            {isStaff && f.status === 'open' && (isAdmin || f.owner_id === profile!.id) && (
              <div className="row">
                <button className="btn sm" onClick={() => startCall({ id: f.lead_id, name: f.leads?.name ?? '' })}><Phone /> Call</button>
                <button className="btn sm primary" onClick={() => setComplete(f)} data-testid="complete-followup"><Check /> Complete</button>
                <button className="btn sm ghost" onClick={() => setResched(f)} aria-label="Reschedule"><CalendarClock /></button>
              </div>)}
          </div>))}
      </div>
      {complete && <CompleteFollowUpDialog fu={complete} leadName={complete.leads?.name ?? ''} onClose={() => setComplete(null)} />}
      {resched && <FollowUpFormDialog leadId={resched.lead_id} leadName={resched.leads?.name ?? ''} editing={resched} onClose={() => setResched(null)} />}
    </>
  );
}
