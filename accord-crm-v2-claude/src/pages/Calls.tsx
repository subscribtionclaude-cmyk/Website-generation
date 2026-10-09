import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Play, Square, Trash2 } from 'lucide-react';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useMyCallMetrics, useRangeMetrics, useActiveSession, useCairoToday } from '../lib/hooks';
import { useCall } from '../components/CallProvider';
import { PageHead, Kpi, Loading, Empty, ErrorNote, LeadPicker, Tabs } from '../components/ui';
import { addDays, cairoDayStart, fmtDate, fmtTime, presetRange, PRESET_LABELS, type RangePreset, cairoDate } from '../lib/cairo';
import { OUTCOME_LABEL } from '../lib/labels';
import type { CallAttempt, LeadRow } from '../lib/types';
import type { CallMetrics } from '../lib/metrics';

function MetricsStrip({ m }: { m: CallMetrics }) {
  return (
    <div className="grid cols-4 keep2">
      <Kpi hero label="Calls" value={m.total} sub={m.has_target ? `Target ${m.target} · ${m.achievement_pct}% · remaining ${m.remaining}` : 'No target'} />
      <Kpi label="Responded" value={m.responded} sub={`Response rate ${m.response_rate ?? '—'}${m.response_rate !== null ? '%' : ''}`} />
      <Kpi label="Didn't respond" value={m.did_not_respond} />
      <Kpi label="Unique leads" value={m.unique_leads} />
    </div>
  );
}

export default function Calls() {
  const { profile, isStaff } = useAuth();
  const [tab, setTab] = useState<'today' | 'history' | 'range'>('today');
  const { startCall } = useCall();
  const today = useCairoToday();
  const m = useMyCallMetrics();
  const session = useActiveSession();
  const qc = useQueryClient(); const toast = useToast();
  const [day, setDay] = useState(today);
  const [preset, setPreset] = useState<RangePreset>('this_week');
  const range = presetRange(preset, today);

  const calls = (d: string) => ({
    queryKey: ['myCallsToday', profile?.id, d] as const,
    queryFn: async () => {
      const { data, error } = await supabase.from('call_attempts').select('*, leads(name)').eq('user_id', profile!.id)
        .gte('called_at', cairoDayStart(d).toISOString()).lt('called_at', cairoDayStart(addDays(d, 1)).toISOString()).order('called_at', { ascending: false }).limit(500);
      if (error) throw new Error(error.message); return data as unknown as CallAttempt[];
    },
  });
  const todayCalls = useQuery({ ...calls(today), enabled: tab === 'today' });
  const dayCalls = useQuery({ ...calls(day), enabled: tab === 'history' });
  const dayMetrics = useMyCallMetrics(day);
  const rangeM = useRangeMetrics(range.from, range.to);
  const daily = useQuery({
    queryKey: ['callDaily', profile?.id, range.from, range.to], enabled: tab === 'range',
    queryFn: async () => unwrap(await supabase.rpc('call_metrics_daily', { p_user: profile!.id, p_from: range.from, p_to: range.to })) as unknown as { date: string; total: number; responded: number; did_not_respond: number; unique_leads: number; target: number | null }[],
  });
  const sessionCalls = useQuery({
    queryKey: ['sessionCalls', session.data?.id], enabled: Boolean(session.data?.id), refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase.from('call_attempts').select('outcome').eq('call_session_id', session.data!.id);
      const total = data?.length ?? 0; const responded = (data ?? []).filter((x) => x.outcome === 'responded').length;
      return { total, responded, dnr: total - responded };
    },
  });
  const queue = useQuery({
    queryKey: ['callQueue'], enabled: isStaff && tab === 'today',
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_list_v').select('id,name,primary_contact,temperature').eq('archived', false).eq('total_calls', 0)
        .not('primary_contact', 'is', null).order('created_at').limit(8);
      if (error) throw new Error(error.message); return data as LeadRow[];
    },
  });

  async function startSession() {
    try { unwrap(await supabase.from('call_sessions').insert({ user_id: profile!.id }).select('id')); qc.invalidateQueries({ queryKey: ['callSession'] }); toast('Calling session started', 'ok'); } catch (e) { toast((e as Error).message, 'bad'); }
  }
  async function stopSession() {
    try { unwrap(await supabase.from('call_sessions').update({ ended_at: new Date().toISOString() }).eq('id', session.data!.id).select('id')); qc.invalidateQueries({ queryKey: ['callSession'] }); toast('Session ended', 'ok'); } catch (e) { toast((e as Error).message, 'bad'); }
  }
  async function del(c: CallAttempt) {
    if (!confirm(`Delete this call to ${c.leads?.name}?`)) return;
    const { error } = await supabase.from('call_attempts').delete().eq('id', c.id);
    if (error) toast(error.message, 'bad'); else { for (const k of [['myCallsToday'], ['callMetrics'], ['leads'], ['lead', c.lead_id]]) qc.invalidateQueries({ queryKey: k }); }
  }

  const list = (rows?: CallAttempt[], editable = false) => !rows ? <Loading /> : rows.length === 0 ? <Empty>No calls logged.</Empty> : (
    <div className="table-wrap"><table className="t" aria-label="Call attempts"><thead><tr><th>Time</th><th>Lead</th><th>Outcome</th><th>Note</th><th /></tr></thead><tbody>
      {rows.map((c) => (
        <tr key={c.id}><td className="nowrap num">{fmtTime(c.called_at)}</td><td><Link to={`/leads/view/?id=${c.lead_id}`}>{c.leads?.name}</Link></td>
          <td><span className={`badge ${c.outcome === 'responded' ? 'ok' : 'bad'}`}>{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>{c.sub_outcome && <span className="muted small"> · {c.sub_outcome.replace(/_/g, ' ')}</span>}</td>
          <td>{c.notes}</td>
          <td className="r nowrap">{isStaff && editable && <><button className="btn sm" onClick={() => startCall({ id: c.lead_id, name: c.leads?.name ?? '' })}><Phone /> Call again</button><button className="btn sm ghost" onClick={() => del(c)} aria-label="Delete"><Trash2 /></button></>}</td></tr>
      ))}
    </tbody></table></div>
  );

  return (
    <>
      <PageHead title="Calls" sub={`Every attempt is its own record · ${fmtDate(today)} (Cairo)`}
        actions={isStaff && (session.data
          ? <button className="btn" onClick={stopSession}><Square /> End session</button>
          : <button className="btn" onClick={startSession}><Play /> Start calling session</button>)} />
      <ErrorNote error={m.error} />
      {session.data && <div className="notice ok row spread" style={{ marginBottom: 12 }}><span>Session active since {fmtTime(session.data.started_at)} — {sessionCalls.data ? `${sessionCalls.data.total} calls · ${sessionCalls.data.responded} responded · ${sessionCalls.data.dnr} didn't respond` : '…'}</span></div>}
      <div style={{ marginBottom: 12 }}><Tabs value={tab} onChange={setTab} tabs={[{ key: 'today', label: 'My calls today' }, { key: 'history', label: 'Daily history' }, { key: 'range', label: 'Weekly / monthly' }]} /></div>

      {tab === 'today' && (
        <div className="col">
          {m.data ? <MetricsStrip m={m.data} /> : <Loading />}
          {isStaff && (
            <div className="grid cols-2">
              <div className="card card-pad col"><h3>Find a lead to call</h3><LeadPicker onPick={(l) => startCall({ id: l.id, name: l.name })} /></div>
              <div className="card card-pad col"><h3>Never called · up next</h3>
                {!queue.data ? <Loading /> : queue.data.length === 0 ? <span className="muted">Everyone with a contact has been called.</span> : queue.data.map((l) => (
                  <div key={l.id} className="row spread"><span>{l.name}<span className="muted small"> · {l.primary_contact}</span></span><button className="btn sm primary" onClick={() => startCall({ id: l.id, name: l.name })}><Phone /> Call</button></div>))}
              </div>
            </div>
          )}
          <div className="card"><div className="card-head"><h2>Today's attempts (newest first)</h2></div>{list(todayCalls.data, true)}</div>
        </div>
      )}
      {tab === 'history' && (
        <div className="col">
          <div className="row"><button className="btn sm" onClick={() => setDay(addDays(day, -1))}>← Prev</button><input type="date" max={today} value={day} onChange={(e) => e.target.value && setDay(cairoDate(cairoDayStart(e.target.value)))} style={{ width: 170 }} /><button className="btn sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>Next →</button></div>
          {dayMetrics.data ? <MetricsStrip m={dayMetrics.data} /> : <Loading />}
          <div className="card">{list(dayCalls.data, false)}</div>
        </div>
      )}
      {tab === 'range' && (
        <div className="col">
          <div className="row">{(['this_week', 'previous_week', 'this_month', 'previous_month'] as RangePreset[]).map((p) => <button key={p} className={`chip ${preset === p ? 'on' : ''}`} onClick={() => setPreset(p)}>{PRESET_LABELS[p]}</button>)}<span className="muted">{fmtDate(range.from)} – {fmtDate(range.to)}</span></div>
          {rangeM.data ? <MetricsStrip m={rangeM.data} /> : <Loading />}
          <div className="card table-wrap"><table className="t"><thead><tr><th>Date</th><th className="r">Calls</th><th className="r">Responded</th><th className="r">Didn't respond</th><th className="r">Unique leads</th><th className="r">Target</th><th className="r">%</th></tr></thead><tbody>
            {(daily.data ?? []).map((d) => (
              <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="r num">{d.total}</td><td className="r num">{d.responded}</td><td className="r num">{d.did_not_respond}</td><td className="r num">{d.unique_leads}</td>
                <td className="r num">{d.target ?? '—'}</td><td className="r num">{d.target ? `${Math.round((1000 * d.total) / d.target) / 10}%` : '—'}</td></tr>))}
          </tbody></table></div>
        </div>
      )}
    </>
  );
}
