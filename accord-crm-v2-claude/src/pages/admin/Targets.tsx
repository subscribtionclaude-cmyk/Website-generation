import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote, Modal, Field } from '../../components/ui';
import { cairoToday, fmtDate } from '../../lib/cairo';
import { t } from '../../lib/i18n';

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
      <PageHead title={t('User call targets')} sub={t('Daily Call Target per BD executive. History is effective-dated; reports use the target that applied on each day.')} />
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : (
        <div className="col">
          <div className="card table-wrap"><table className="t" aria-label={t('Current targets')}><thead><tr><th>{t('BD executive')}</th><th className="r">{t('Current daily target')}</th><th>{t('Since')}</th><th /></tr></thead><tbody>
            {q.data!.users.map((u) => { const c = current(u.id); return (
              <tr key={u.id}><td><b>{u.full_name || u.email}</b></td><td className="r num">{c ? c.daily_call_target : <span className="muted">{t('not set')}</span>}</td><td>{c ? fmtDate(c.effective_from) : '—'}</td><td className="r"><button className="btn sm" onClick={() => setEdit(u)}>{t('Set target')}</button></td></tr>); })}
          </tbody></table></div>
          <div className="card"><div className="card-head"><h2>{t('Target history')}</h2></div><div className="table-wrap"><table className="t"><thead><tr><th>{t('User')}</th><th className="r">{t('Target')}</th><th>{t('From')}</th><th>{t('To')}</th><th>{t('State')}</th></tr></thead><tbody>
            {q.data!.targets.map((x) => <tr key={x.id}><td>{q.data!.users.find((u) => u.id === x.user_id)?.full_name ?? x.user_id.slice(0, 8)}</td><td className="r num">{x.daily_call_target}</td><td>{fmtDate(x.effective_from)}</td><td>{x.effective_to ? fmtDate(x.effective_to) : t('open')}</td><td>{!x.active ? <span className="badge">{t('superseded')}</span> : x.effective_to && x.effective_to < today ? <span className="badge">{t('ended')}</span> : x.effective_from > today ? <span className="badge info">{t('scheduled')}</span> : <span className="badge ok">{t('current')}</span>}</td></tr>)}
          </tbody></table></div></div>
        </div>)}
      {edit && <SetTarget u={edit} current={current(edit.id)?.daily_call_target} onClose={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['adminTargets'] }); qc.invalidateQueries({ queryKey: ['currentTargets'] }); }} toast={toast} />}
    </>
  );
}

function SetTarget({ u, current, onClose, toast }: { u: P; current?: number; onClose: () => void; toast: (t: string, k?: 'ok' | 'bad' | 'info') => void }) {
  const [v, setV] = useState(current?.toString() ?? '100'); const [from, setFrom] = useState(cairoToday()); const [err, setErr] = useState<unknown>(null);
  async function save() {
    try { unwrap(await supabase.rpc('set_user_target', { p_user: u.id, p_target: Number(v), p_from: from })); toast(t('Target saved'), 'ok'); onClose(); } catch (e) { setErr(e); }
  }
  return (
    <Modal narrow title={t('Daily call target · {name}', { name: u.full_name || u.email })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Save')}</button></>}>
      <ErrorNote error={err} />
      <Field label={t('Calls per day')}><input type="number" min="0" max="2000" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Field label={t('Effective from (Cairo date)')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <span className="muted small">{t('Earlier days keep their previous target. Setting a date in the past re-states history from that date.')}</span>
    </Modal>
  );
}
