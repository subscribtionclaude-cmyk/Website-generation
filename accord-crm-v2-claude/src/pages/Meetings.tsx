import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Tabs, Loading, Empty, ErrorNote, UserSelect, Modal, LeadPicker } from '../components/ui';
import { MeetingCard } from '../components/MeetingCard';
import { MeetingFormDialog } from '../components/meetings';
import { addDays, cairoDayStart, cairoToday } from '../lib/cairo';
import type { Meeting } from '../lib/types';

type Tab = 'today' | 'upcoming' | 'confirmed' | 'unconfirmed' | 'pending' | 'completed' | 'attended' | 'not_attended' | 'cancelled' | 'rescheduled' | 'requested' | 'all';
const TABS: [Tab, string][] = [['today', 'Today'], ['upcoming', 'Upcoming'], ['confirmed', 'Confirmed'], ['unconfirmed', 'Unconfirmed'], ['pending', 'Awaiting outcome'], ['requested', 'Requested'], ['completed', 'Completed'], ['attended', 'Attended'], ['not_attended', 'Not attended'], ['cancelled', 'Cancelled'], ['rescheduled', 'Rescheduled'], ['all', 'All']];

export default function Meetings() {
  const { profile, isStaff } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'today';
  const [who, setWho] = useState(profile!.id);
  const [newFor, setNewFor] = useState<null | 'pick' | { id: string; name: string }>(null);
  const t = cairoToday();
  const t0 = cairoDayStart(t).toISOString(); const t1 = cairoDayStart(addDays(t, 1)).toISOString();

  // Today / Upcoming come from the schedule automatically — no manual categorisation.
  const filt = (b: any, k: Tab) => {
    switch (k) {
      case 'today': return b.eq('status', 'scheduled').gte('scheduled_at', t0).lt('scheduled_at', t1).order('scheduled_at');
      case 'upcoming': return b.eq('status', 'scheduled').gte('scheduled_at', t1).order('scheduled_at');
      case 'confirmed': return b.eq('status', 'scheduled').eq('confirmation_status', 'confirmed').gte('scheduled_at', t0).order('scheduled_at');
      case 'unconfirmed': return b.eq('status', 'scheduled').neq('confirmation_status', 'confirmed').gte('scheduled_at', t0).order('scheduled_at');
      case 'pending': return b.eq('status', 'scheduled').eq('attendance_status', 'pending').lt('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: false });
      case 'requested': return b.eq('status', 'requested').order('created_at', { ascending: false });
      case 'completed': return b.eq('status', 'completed').order('scheduled_at', { ascending: false });
      case 'attended': return b.eq('attendance_status', 'attended').order('scheduled_at', { ascending: false });
      case 'not_attended': return b.eq('attendance_status', 'not_attended').order('scheduled_at', { ascending: false });
      case 'cancelled': return b.eq('status', 'cancelled').order('scheduled_at', { ascending: false });
      case 'rescheduled': return b.eq('status', 'rescheduled').order('scheduled_at', { ascending: false });
      default: return b.order('scheduled_at', { ascending: false, nullsFirst: true });
    }
  };
  const base = (head = false) => { let b = supabase.from('meetings').select(head ? 'id' : '*, leads(name)', { count: 'exact', head }); if (who) b = b.eq('owner_id', who); return b; };
  const counts = useQuery({
    queryKey: ['meetings', 'counts', who, t],
    queryFn: async () => { const o: Record<string, number> = {}; await Promise.all((['today', 'upcoming', 'pending', 'requested'] as Tab[]).map(async (k) => { const { count } = await filt(base(true), k); o[k] = count ?? 0; })); return o; },
  });
  const list = useQuery({
    queryKey: ['meetings', 'list', tab, who, t],
    queryFn: async () => { const { data, error } = await filt(base(), tab).limit(150); if (error) throw new Error(error.message); return data as unknown as Meeting[]; },
  });

  return (
    <>
      <PageHead title="Meetings" sub="Operational hub — attendance is always recorded explicitly"
        actions={<><UserSelect value={who} onChange={setWho} includeAll allLabel="Everyone" />{isStaff && <button className="btn primary" onClick={() => setNewFor('pick')}><CalendarPlus /> New meeting</button>}</>} />
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: counts.data?.[k] }))} />
      </div>
      <ErrorNote error={list.error} />
      {list.isLoading ? <Loading /> : !list.data?.length ? <div className="card"><Empty>No meetings in this view.</Empty></div> : <div className="col">{list.data.map((m) => <MeetingCard key={m.id} m={m} />)}</div>}
      {newFor === 'pick' && <Modal narrow title="Which lead is the meeting with?" onClose={() => setNewFor(null)}><LeadPicker autoFocus onPick={(l) => setNewFor({ id: l.id, name: l.name })} /></Modal>}
      {newFor && newFor !== 'pick' && <MeetingFormDialog leadId={newFor.id} leadName={newFor.name} mode="scheduled" onClose={() => setNewFor(null)} />}
    </>
  );
}
