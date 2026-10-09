import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote } from '../../components/ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
interface Stage { key: string; label: string; position: number; active: boolean }
interface Outcome { key: string; label: string; kind: string; active: boolean }

export default function AdminConfig() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['config'], queryFn: async () => {
    const [s, st, o] = await Promise.all([supabase.from('settings').select('*'), supabase.from('pipeline_stages').select('*').order('position'), supabase.from('call_outcomes').select('*').order('position')]);
    for (const r of [s, st, o]) if (r.error) throw new Error(r.error.message);
    return { settings: Object.fromEntries((s.data ?? []).map((x) => [x.key, x.value])) as Record<string, unknown>, stages: st.data as Stage[], outcomes: o.data as Outcome[] };
  } });
  const [labels, setLabels] = useState<Record<string, string>>({});
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok = 'Saved') { const r = await fn(); if (r.error) toast(r.error.message, 'bad'); else { toast(ok, 'ok'); qc.invalidateQueries({ queryKey: ['config'] }); qc.invalidateQueries({ queryKey: ['stages'] }); } }
  if (q.isLoading) return <Loading />;
  const wd = (q.data?.settings.working_days as number[]) ?? [0, 1, 2, 3, 4];
  return (
    <>
      <PageHead title="CRM configuration" sub="Every change here is audited." />
      <ErrorNote error={q.error} />
      <div className="grid cols-2">
        <div className="card card-pad col"><h2>Working days</h2><span className="muted small">Period call targets count only these days (Cairo calendar). Default Sunday–Thursday.</span>
          <div className="chips">{DOW.map((d, i) => <button key={d} className={`chip ${wd.includes(i) ? 'on' : ''}`} onClick={() => run(() => supabase.from('settings').update({ value: wd.includes(i) ? wd.filter((x) => x !== i) : [...wd, i].sort() }).eq('key', 'working_days'))}>{d}</button>)}</div></div>
        <div className="card card-pad col"><h2>Call outcomes</h2><span className="muted small">Responded and Didn't Respond are always on. Others can be switched on for future use; "kind" decides whether they count as responded.</span>
          {q.data?.outcomes.map((o) => <label key={o.key} className="row spread"><span><b>{o.label}</b> <span className="badge">{o.kind === 'responded' ? 'counts as responded' : "counts as didn't respond"}</span></span>
            <input type="checkbox" checked={o.active} disabled={o.key === 'responded' || o.key === 'did_not_respond'} onChange={(e) => run(() => supabase.from('call_outcomes').update({ active: e.target.checked }).eq('key', o.key))} /></label>)}</div>
        <div className="card card-pad col" style={{ gridColumn: '1 / -1' }}><h2>Pipeline stage labels</h2>
          {q.data?.stages.map((s) => <div key={s.key} className="row"><code style={{ width: 100 }}>{s.key}</code><input style={{ maxWidth: 240 }} value={labels[s.key] ?? s.label} onChange={(e) => setLabels({ ...labels, [s.key]: e.target.value })} aria-label={`Label for ${s.key}`} />
            <button className="btn sm" disabled={(labels[s.key] ?? s.label) === s.label || !(labels[s.key] ?? '').trim()} onClick={() => run(() => supabase.from('pipeline_stages').update({ label: labels[s.key].trim() }).eq('key', s.key))}>Save</button></div>)}
          <span className="muted small">Stage keys are fixed; only display labels are configurable.</span></div>
      </div>
    </>
  );
}
export { unwrap };
