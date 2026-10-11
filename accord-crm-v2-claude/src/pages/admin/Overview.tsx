import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote, Kpi } from '../../components/ui';
import { cairoToday, fmtDate, fmtDateTime } from '../../lib/cairo';
import { useAdminReport, CallsSection, PipelineSection, CriticalSection } from './shared';
import { t } from '../../lib/i18n';

export default function AdminOverview() {
  const today = cairoToday();
  const rep = useAdminReport(today, today);
  const audit = useQuery({ queryKey: ['auditRecent'], queryFn: async () => { const { data, error } = await supabase.from('audit_logs').select('id,at,actor_email,entity,action').order('at', { ascending: false }).limit(6); if (error) throw new Error(error.message); return data as { id: number; at: string; actor_email: string | null; entity: string; action: string }[]; } });
  const sync = useQuery({ queryKey: ['lastSync'], queryFn: async () => { const { data } = await supabase.from('sync_runs').select('*').eq('mode', 'sync').order('started_at', { ascending: false }).limit(1); return (data?.[0] ?? null) as null | { started_at: string; status: string; sheet_name: string; inserted: number; updated: number; conflicts: number; errors: number }; } });
  const r = rep.data;
  return (
    <>
      <PageHead title={t('Management overview')} sub={t('Today · {date} (Cairo) — live', { date: fmtDate(today) })} />
      <ErrorNote error={rep.error} />
      {!r ? <Loading /> : (
        <div className="col" style={{ gap: 22 }}>
          <div className="grid cols-4 keep2">
            <Kpi hero label={t('Team calls today')} value={r.calls.total} sub={t('Target {target} · {pct}%', { target: r.calls.target, pct: r.calls.achievement_pct ?? '—' })} />
            <Kpi label={t('Meetings today')} value={r.meetings.scheduled} sub={t('{n} confirmed', { n: r.meetings.confirmed })} />
            <Kpi label={t('Overdue follow-ups')} value={r.follow_ups.open_overdue_total} tone={r.follow_ups.open_overdue_total ? 'bad' : undefined} />
            <Kpi label={t('Proposals awaiting response')} value={r.commercial.awaiting_responses} sub={t('Forms awaiting client {n}', { n: r.commercial.forms_awaiting_client })} />
          </div>
          <CallsSection r={r} showDays={false} />
          <PipelineSection r={r} />
          <div className="grid cols-2">
            <div className="card card-pad col"><div className="row spread"><h2>{t('Google Sheet sync')}</h2><Link to="/admin/sync/">{t('Open')}</Link></div>
              {sync.data ? <span>Last sync {fmtDateTime(sync.data.started_at)} — <b>{sync.data.status}</b> · {sync.data.inserted} new, {sync.data.updated} updated, {sync.data.conflicts} conflicts, {sync.data.errors} errors</span> : <span className="muted">{t('No sync has run yet.')}</span>}</div>
            <div className="card card-pad col"><div className="row spread"><h2>{t('Recent audit activity')}</h2><Link to="/admin/audit/">{t('Open')}</Link></div>
              {audit.data?.map((a) => <div key={a.id} className="small"><span className="muted">{fmtDateTime(a.at)}</span> · {a.actor_email ?? t('system')} · <code>{a.action}</code> <code>{a.entity}</code></div>)}
              {audit.data?.length === 0 && <span className="muted">{t('No entries yet.')}</span>}</div>
          </div>
          <CriticalSection r={r} />
        </div>
      )}
    </>
  );
}
