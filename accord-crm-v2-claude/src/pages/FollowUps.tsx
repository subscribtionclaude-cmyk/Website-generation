import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Phone, Check, CalendarClock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Loading, Empty, ErrorNote, UserSelect } from '../components/ui';
import { Num } from '../components/viz';
import { useCall } from '../components/CallProvider';
import { CompleteFollowUpDialog, FollowUpFormDialog } from '../components/followups';
import { addDays, cairoToday, daysBetween, fmtDate, fmtMonth, weekRange } from '../lib/cairo';
import type { FollowUp } from '../lib/types';
import { t } from '../lib/i18n';

type Tab = 'overdue' | 'today' | 'tomorrow' | 'week' | 'upcoming' | 'completed';
const RANGES = (d: string): Record<Tab, (b: any) => any> => ({
  overdue: (b) => b.eq('status', 'open').lt('due_date', d).order('due_date'),
  today: (b) => b.eq('status', 'open').eq('due_date', d).order('due_time', { nullsFirst: false }),
  tomorrow: (b) => b.eq('status', 'open').eq('due_date', addDays(d, 1)),
  week: (b) => b.eq('status', 'open').gte('due_date', d).lte('due_date', weekRange(d).to).order('due_date'),
  upcoming: (b) => b.eq('status', 'open').gt('due_date', addDays(d, 1)).order('due_date'),
  completed: (b) => b.eq('status', 'completed').order('completed_at', { ascending: false }),
});

export default function FollowUps() {
  const { profile, isStaff, isAdmin } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'today';
  const [who, setWho] = useState(profile!.id);
  const [complete, setComplete] = useState<FollowUp | null>(null); const [resched, setResched] = useState<FollowUp | null>(null);
  const { startCall } = useCall();
  const td = cairoToday();
  const base = (head = false) => { let b = supabase.from('follow_ups').select(head ? 'id' : '*, leads(name)', { count: 'exact', head }); if (who) b = b.eq('owner_id', who); return b; };

  const counts = useQuery({
    queryKey: ['followups', 'counts', who, td],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all((Object.keys(RANGES(td)) as Tab[]).filter((k) => k !== 'completed').map(async (k) => { const { count } = await RANGES(td)[k](base(true)); out[k] = count ?? 0; }));
      return out;
    },
  });
  const list = useQuery({
    queryKey: ['followups', 'list', tab, who, td],
    queryFn: async () => {
      const { data, error } = await RANGES(td)[tab](base()).limit(200);
      if (error) throw new Error(error.message); return data as unknown as FollowUp[];
    },
  });

  return (
    <>
      <PageHead title={t('Follow-ups')} sub={t('Business dates in Africa/Cairo')} actions={<UserSelect value={who} onChange={setWho} includeAll allLabel={t('Everyone')} />} />
      {/* urgency first: overdue → due today → soon → later; the selected view is highlighted */}
      <div className="summary-tabs" role="tablist" aria-label={t('Follow-ups')} style={{ ['--n' as string]: 6 }}>
        {([['overdue', 'Overdue', 'risk'], ['today', 'Due today', 'gold'], ['tomorrow', 'Tomorrow', ''], ['week', 'This week', ''], ['upcoming', 'Upcoming', ''], ['completed', 'Completed', '']] as [Tab, string, string][]).map(([k, l, tone], i) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className={`reveal ${tone && (counts.data?.[k] ?? 0) > 0 ? tone : ''}`} style={{ ['--i' as string]: i, ['--d' as string]: '40ms' }} onClick={() => setSp({ tab: k }, { replace: true })}>
            <span>{t(l)}</span><b>{k === 'completed' ? '✓' : counts.data ? <Num v={counts.data[k] ?? 0} /> : '…'}</b>
          </button>))}
      </div>
      <ErrorNote error={list.error} />
      <div className="card">
        {list.isLoading ? <Loading /> : !list.data?.length ? <Empty>{t('Nothing here.')}</Empty> : list.data.map((f) => (
          <div key={f.id} className={`row spread card-pad list-row urg ${f.status === 'completed' ? 'done' : f.due_date < td ? 'overdue' : f.due_date === td ? 'today' : ''}`} data-testid="followup-row" style={{ paddingBlock: 10 }}>
            <div className="row nowrap grow" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="datechip" aria-hidden="true"><b>{f.due_date.slice(8, 10)}</b><span>{fmtMonth(f.due_date)}</span></span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <Link to={`/leads/view/?id=${f.lead_id}`}><b>{f.leads?.name}</b></Link>
              <span className="small"><b style={{ color: f.status === 'open' && f.due_date < td ? 'var(--bad)' : undefined }}>{fmtDate(f.due_date)}{f.due_time ? ` ${f.due_time.slice(0, 5)}` : ''}</b>
                {f.status === 'open' && f.due_date < td && <span style={{ color: 'var(--bad)' }}> · {t('{n}d overdue', { n: daysBetween(f.due_date, td) })}</span>}
                {f.notes ? <span className="muted"> · {f.notes}</span> : null} <span className="badge">{t(f.origin.replace(/_/g, ' '))}</span></span>
            </div></div>
            {isStaff && f.status === 'open' && (isAdmin || f.owner_id === profile!.id) && (
              <div className="row">
                <button className="btn sm" onClick={() => startCall({ id: f.lead_id, name: f.leads?.name ?? '' })}><Phone /> {t('Call')}</button>
                <button className="btn sm primary" onClick={() => setComplete(f)} data-testid="complete-followup"><Check /> {t('Complete')}</button>
                <button className="btn sm ghost" onClick={() => setResched(f)} aria-label={t('Reschedule')}><CalendarClock /></button>
              </div>)}
          </div>))}
      </div>
      {complete && <CompleteFollowUpDialog fu={complete} leadName={complete.leads?.name ?? ''} onClose={() => setComplete(null)} />}
      {resched && <FollowUpFormDialog leadId={resched.lead_id} leadName={resched.leads?.name ?? ''} editing={resched} onClose={() => setResched(null)} />}
    </>
  );
}
