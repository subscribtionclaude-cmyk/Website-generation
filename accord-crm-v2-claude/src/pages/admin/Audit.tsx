import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageHead, Pager, Loading, ErrorNote, Empty, useDebounced } from '../../components/ui';
import { fmtDateTime } from '../../lib/cairo';
import { t } from '../../lib/i18n';

interface A { id: number; at: string; actor_id: string | null; actor_email: string | null; entity: string; entity_id: string | null; action: string; old_value: unknown; new_value: unknown; meta: unknown }
const ENTITIES = ['leads', 'contacts', 'call_attempts', 'follow_ups', 'meetings', 'commercial_forms', 'proposals', 'user_targets', 'profiles', 'settings', 'sync_runs', 'attachments', 'projects', 'pipeline_stages', 'call_outcomes'];
const PAGE = 50;

export default function AdminAudit() {
  const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [actor, setActor] = useState(''); const [page, setPage] = useState(0); const [open, setOpen] = useState<number | null>(null);
  const dActor = useDebounced(actor.trim().toLowerCase()); const dAction = useDebounced(action.trim().toLowerCase());
  const q = useQuery({
    queryKey: ['audit', entity, dAction, dActor, page], placeholderData: keepPreviousData,
    queryFn: async () => {
      let b = supabase.from('audit_logs').select('*', { count: 'exact' }).order('id', { ascending: false });
      if (entity) b = b.eq('entity', entity); if (dAction) b = b.ilike('action', `%${dAction}%`); if (dActor) b = b.ilike('actor_email', `%${dActor}%`);
      const { data, count, error } = await b.range(page * PAGE, page * PAGE + PAGE - 1); if (error) throw new Error(error.message);
      return { rows: data as A[], total: count ?? 0 };
    },
  });
  return (
    <>
      <PageHead title={t('Audit log')} sub={t('Append-only. Entries cannot be edited or deleted — not even by administrators.')} />
      <div className="card card-pad row" style={{ marginBottom: 12 }}>
        <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }} aria-label={t('Entity')}><option value="">{t('All entities')}</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}</select>
        <input placeholder={t('Action contains…')} value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} style={{ maxWidth: 200 }} aria-label={t('Action')} />
        <input placeholder={t('Actor email contains…')} value={actor} onChange={(e) => { setActor(e.target.value); setPage(0); }} style={{ maxWidth: 240 }} aria-label={t('Actor')} />
      </div>
      <ErrorNote error={q.error} />
      <div className="card">
        {q.isLoading ? <Loading /> : !q.data?.rows.length ? <Empty>{t('No audit entries.')}</Empty> : (
          <><div className="table-wrap"><table className="t" aria-label={t('Audit log')}><thead><tr><th>{t('When (Cairo)')}</th><th>{t('Actor')}</th><th>{t('Action')}</th><th>{t('Entity')}</th><th>ID</th><th /></tr></thead><tbody>
            {q.data.rows.map((a) => (
              <>
                <tr key={a.id}><td className="nowrap">{fmtDateTime(a.at)}</td><td>{a.actor_email ?? <span className="muted">{t('system')}</span>}</td><td><b>{a.action}</b></td><td>{a.entity}</td><td className="mono">{a.entity_id?.slice(0, 8)}</td><td className="r"><button className="btn sm ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Diff'}</button></td></tr>
                {open === a.id && <tr key={a.id + 'd'}><td colSpan={6}><div className="grid cols-2"><div><div className="label">{t('Old')}</div><pre className="json mono">{JSON.stringify(a.old_value, null, 2) ?? '—'}</pre></div><div><div className="label">{t('New')}</div><pre className="json mono">{JSON.stringify(a.new_value ?? a.meta, null, 2) ?? '—'}</pre></div></div></td></tr>}
              </>))}
          </tbody></table></div><Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} /></>)}
      </div>
    </>
  );
}
