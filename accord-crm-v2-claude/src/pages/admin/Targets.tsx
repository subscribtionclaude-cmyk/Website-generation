import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Modal, Field } from '../../components/ui';
import { cairoToday, fmtDate } from '../../lib/cairo';

interface T { id: string; user_id: string; daily_call_target: number; effective_from: string; effective_to: string | null; active: boolean; created_at: string }
interface P { id: string; full_name: string; email: string }

export default function AdminTargets() {
  const qc = useQueryClient(); const toast = useToast();
  const [edit, setEdit] = useState<P | null>(null);
  const q = useQuery({ queryKey: ['adminTargets'], queryFn: async () => {
    const [p, t] = await Promise.all([supabase.from('profiles').select('id,full_name,email').eq('role', 'bd_executive').eq('active', true).order('full_name'), supabase.from('user_targets').select('*').order('effective_from', { ascending: false })]);
    if (p.error) throw new Error(p.error.message); if (t.error) throw new Error(t.error.message);
    return { users: p.data as P[], targets: t.data as T[] };
  } });
  const today = cairoToday();
  const current = (uid: string) => q.data?.targets.find((t) => t.user_id === uid && t.active && t.effective_from <= today && (!t.effective_to || t.effective_to >= today));
  return (
    <>
      <PageHead title="User call targets" sub="Daily Call Target per BD executive. History is effective-dated; reports use the target that applied on each day." />
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : (
        <div className="col">
          <div className="card table-wrap"><table className="t" aria-label="Current targets"><thead><tr><th>BD executive</th><th className="r">Current daily target</th><th>Since</th><th /></tr></thead><tbody>
            {q.data!.users.map((u) => { const c = current(u.id); return (
              <tr key={u.id}><td><b>{u.full_name || u.email}</b></td><td className="r num">{c ? c.daily_call_target : <span className="muted">not set</span>}</td><td>{c ? fmtDate(c.effective_from) : '—'}</td><td className="r"><button className="btn sm" onClick={() => setEdit(u)}>Set target</button></td></tr>); })}
          </tbody></table></div>
          <div className="card"><div className="card-head"><h2>Target history</h2></div><div className="table-wrap"><table className="t"><thead><tr><th>User</th><th className="r">Target</th><th>From</th><th>To</th><th>State</th></tr></thead><tbody>
            {q.data!.targets.map((t) => <tr key={t.id}><td>{q.data!.users.find((u) => u.id === t.user_id)?.full_name ?? t.user_id.slice(0, 8)}</td><td className="r num">{t.daily_call_target}</td><td>{fmtDate(t.effective_from)}</td><td>{t.effective_to ? fmtDate(t.effective_to) : 'open'}</td><td>{!t.active ? <span className="badge">superseded</span> : t.effective_to && t.effective_to < today ? <span className="badge">ended</span> : t.effective_from > today ? <span className="badge info">scheduled</span> : <span className="badge ok">current</span>}</td></tr>)}
          </tbody></table></div></div>
        </div>)}
      {edit && <SetTarget u={edit} current={current(edit.id)?.daily_call_target} onClose={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['adminTargets'] }); qc.invalidateQueries({ queryKey: ['currentTargets'] }); }} toast={toast} />}
    </>
  );
}

function SetTarget({ u, current, onClose, toast }: { u: P; current?: number; onClose: () => void; toast: (t: string, k?: 'ok' | 'bad' | 'info') => void }) {
  const [v, setV] = useState(current?.toString() ?? '100'); const [from, setFrom] = useState(cairoToday()); const [err, setErr] = useState<unknown>(null);
  async function save() {
    try { unwrap(await supabase.rpc('set_user_target', { p_user: u.id, p_target: Number(v), p_from: from })); toast('Target saved', 'ok'); onClose(); } catch (e) { setErr(e); }
  }
  return (
    <Modal narrow title={`Daily call target · ${u.full_name || u.email}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorNote error={err} />
      <Field label="Calls per day"><input type="number" min="0" max="2000" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Field label="Effective from (Cairo date)"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <span className="muted small">Earlier days keep their previous target. Setting a date in the past re-states history from that date.</span>
    </Modal>
  );
}
