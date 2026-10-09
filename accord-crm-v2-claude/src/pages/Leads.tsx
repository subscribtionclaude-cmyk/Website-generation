import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Phone, Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PageHead, Pager, TempBadge, StageBadge, Loading, Empty, ErrorNote, useDebounced, Select } from '../components/ui';
import { useCall } from '../components/CallProvider';
import { LeadFormDialog } from '../components/LeadForm';
import { TEMPERATURES, TEMP_LABEL, STAGES, STAGE_LABEL, OUTCOME_LABEL } from '../lib/labels';
import { fmtDate, fmtRelative, cairoToday, daysBetween } from '../lib/cairo';
import type { LeadRow } from '../lib/types';

const PAGE = 50;
const SORTS: Record<string, { col: string; asc: boolean; label: string }> = {
  name: { col: 'name', asc: true, label: 'Name A–Z' },
  recent_call: { col: 'last_call_at', asc: false, label: 'Last called' },
  follow_up: { col: 'next_follow_up_date', asc: true, label: 'Next follow-up' },
  calls: { col: 'total_calls', asc: false, label: 'Most calls' },
  newest: { col: 'created_at', asc: false, label: 'Newest' },
};

export default function Leads() {
  const { profile, isStaff } = useAuth();
  const { startCall } = useCall();
  const [sp, setSp] = useSearchParams();
  const [qText, setQText] = useState(sp.get('q') ?? '');
  const q = useDebounced(qText.trim().toLowerCase(), 300);
  const temp = sp.get('temp') ?? ''; const stage = sp.get('stage') ?? ''; const owner = sp.get('owner') ?? '';
  const sort = sp.get('sort') ?? 'name'; const never = sp.get('never') === '1'; const page = Number(sp.get('page') ?? 0);
  const [creating, setCreating] = useState(false);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const today = cairoToday();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['leads', { q, temp, stage, owner, sort, never, page, me: profile?.id }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let b = supabase.from('lead_list_v').select('*', { count: 'exact' }).eq('archived', false);
      if (q) b = b.ilike('search_text', `%${q.replace(/[%_,()]/g, ' ')}%`);
      if (temp) b = b.eq('temperature', temp);
      if (stage) b = b.eq('pipeline_stage', stage);
      if (owner === 'me') b = b.eq('owner_id', profile!.id); else if (owner === 'none') b = b.is('owner_id', null);
      if (never) b = b.eq('total_calls', 0);
      const s = SORTS[sort] ?? SORTS.name;
      b = b.order(s.col, { ascending: s.asc, nullsFirst: false }).order('name').range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, count, error } = await b;
      if (error) throw new Error(error.message);
      return { rows: data as LeadRow[], total: count ?? 0 };
    },
  });

  const callBtn = (l: LeadRow) => isStaff && <button className="btn sm primary" onClick={() => startCall({ id: l.id, name: l.name })} aria-label={`Call ${l.name}`} data-testid="lead-call"><Phone /> Call</button>;
  const fuCell = (l: LeadRow) => l.next_follow_up_date
    ? <span style={{ color: l.next_follow_up_date < today ? 'var(--bad)' : undefined }}>{fmtDate(l.next_follow_up_date)}{l.next_follow_up_date < today ? ` (${daysBetween(l.next_follow_up_date, today)}d late)` : ''}</span> : <span className="muted">—</span>;

  return (
    <>
      <PageHead title="Leads" sub={data ? `${data.total.toLocaleString()} leads` : ''} actions={isStaff && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> New lead</button>} />
      <div className="card card-pad col" style={{ marginBottom: 12 }}>
        <div className="row">
          <div className="grow" style={{ position: 'relative', minWidth: 220 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
            <input aria-label="Search leads" placeholder="Search company, contact, email or phone…" style={{ paddingLeft: 32 }} value={qText}
              onChange={(e) => { setQText(e.target.value); set('q', e.target.value); }} />
          </div>
          <Select value={temp} onChange={(v) => set('temp', v)} placeholder="All temperatures" options={TEMPERATURES.map((t) => [t, TEMP_LABEL[t]])} />
          <Select value={stage} onChange={(v) => set('stage', v)} placeholder="All stages" options={STAGES.map((t) => [t, STAGE_LABEL[t]])} />
          <Select value={owner} onChange={(v) => set('owner', v)} placeholder="All owners" options={[['me', 'My leads'], ['none', 'Unassigned']]} />
          <Select value={sort} onChange={(v) => set('sort', v)} options={Object.entries(SORTS).map(([k, s]) => [k, s.label])} />
          <label className="row small"><input type="checkbox" checked={never} onChange={(e) => set('never', e.target.checked ? '1' : '')} /> Never called</label>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="card" style={{ opacity: isFetching ? 0.85 : 1 }}>
        {isLoading ? <Loading /> : !data || data.rows.length === 0 ? <Empty>No leads match.</Empty> : (
          <>
            <div className="table-wrap hide-mobile">
              <table className="t" aria-label="Leads">
                <thead><tr><th>Company</th><th>Contact</th><th>Temperature</th><th>Stage</th><th className="r">Calls</th><th>Last call</th><th>Next follow-up</th><th>Owner</th><th /></tr></thead>
                <tbody>
                  {data.rows.map((l) => (
                    <tr key={l.id}>
                      <td><Link to={`/leads/view/?id=${l.id}`}><b>{l.name}</b></Link>{l.external_lead_id && <span className="muted small"> #{l.external_lead_id}</span>}</td>
                      <td>{l.primary_contact ?? <span className="muted">—</span>}</td>
                      <td><TempBadge v={l.temperature} /></td>
                      <td><StageBadge v={l.pipeline_stage} /></td>
                      <td className="r num">{l.total_calls ?? 0}<span className="muted small"> ({l.responded_calls ?? 0}✓)</span></td>
                      <td className="nowrap">{l.last_call_at ? <>{fmtRelative(l.last_call_at)} <span className="muted small">{OUTCOME_LABEL[l.last_call_outcome ?? ''] ?? ''}</span></> : <span className="muted">Never</span>}</td>
                      <td className="nowrap">{fuCell(l)}</td>
                      <td>{l.owner_name ?? <span className="muted">—</span>}</td>
                      <td className="r">{callBtn(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="show-mobile">
              {data.rows.map((l) => (
                <div key={l.id} className="card-pad col" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="row spread nowrap"><Link to={`/leads/view/?id=${l.id}`}><b>{l.name}</b></Link>{callBtn(l)}</div>
                  <div className="row"><TempBadge v={l.temperature} /><StageBadge v={l.pipeline_stage} /><span className="muted small">{l.total_calls ?? 0} calls · last {fmtRelative(l.last_call_at)}</span></div>
                  <div className="muted small">{l.primary_contact ?? 'No contact'} · follow-up {l.next_follow_up_date ? fmtDate(l.next_follow_up_date) : '—'}</div>
                </div>
              ))}
            </div>
            <Pager page={page} pageSize={PAGE} total={data.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </div>
      {creating && <LeadFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}
