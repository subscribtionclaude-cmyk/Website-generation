import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote, Kpi } from '../../components/ui';
import { Num, Panel, stagger } from '../../components/viz';
import { TeamTable } from '../../components/team';
import { cairoToday, fmtDate, fmtDateTime } from '../../lib/cairo';
import { useAdminReport, PipelineSection, CriticalSection } from './shared';
import { fetchManagement } from '../../lib/managementReport';
import { t } from '../../lib/i18n';
import { term } from '../../lib/terminology';

export default function AdminOverview() {
  const today = cairoToday();
  const rep = useAdminReport(today, today);
  // the admin's team view uses the same aggregate payload as the Management Dashboard (adds follow-ups and won/lost)
  const team = useQuery({ queryKey: ['management', today, today, null], staleTime: 20_000, queryFn: () => fetchManagement(today, today, null) });
  const audit = useQuery({ queryKey: ['auditRecent'], queryFn: async () => { const { data, error } = await supabase.from('audit_logs').select('id,at,actor_email,entity,action').order('at', { ascending: false }).limit(6); if (error) throw new Error(error.message); return data as { id: number; at: string; actor_email: string | null; entity: string; action: string }[]; } });
  const sync = useQuery({ queryKey: ['lastSync'], queryFn: async () => { const { data } = await supabase.from('sync_runs').select('*').eq('mode', 'sync').order('started_at', { ascending: false }).limit(1); return (data?.[0] ?? null) as null | { started_at: string; status: string; sheet_name: string; inserted: number; updated: number; conflicts: number; errors: number }; } });
  const r = rep.data;
  const byUser = team.data?.calls.by_user;
  return (
    <>
      <PageHead title={t('Management overview')} sub={t('Today · {date} (Cairo) — live', { date: fmtDate(today) })} />
      <ErrorNote error={rep.error} />
      {!r ? <Loading /> : (
        <div className="col" style={{ gap: 14 }}>
          <div className="kpi-band" style={{ ['--cols' as string]: 5 }}>
            <Kpi lead hero label={t('Team calls today')} value={<Num v={r.calls.total} />} sub={t('Target {target} · {pct}%', { target: r.calls.target, pct: r.calls.achievement_pct ?? '—' })} meter={r.calls.achievement_pct ?? 0} style={stagger(0, 60)} />
            <Kpi label={t('Response rate')} value={<Num v={r.calls.response_rate} suffix="%" />} sub={`${t('Responded')} ${r.calls.responded}`} style={stagger(1, 60)} />
            <Kpi label={t('Meetings today')} value={<Num v={r.meetings.scheduled} />} sub={t('{n} confirmed', { n: r.meetings.confirmed })} style={stagger(2, 60)} />
            <Kpi label={t('Overdue follow-ups')} value={<Num v={r.follow_ups.open_overdue_total} />} tone={r.follow_ups.open_overdue_total ? 'bad' : undefined} style={stagger(3, 60)} />
            <Kpi label={t('Proposals awaiting response')} value={<Num v={r.commercial.awaiting_responses} />} sub={t('Forms awaiting client {n}', { n: r.commercial.forms_awaiting_client })} style={stagger(4, 60)} />
          </div>
          <Panel className="reveal" style={stagger(0, 240)} title={t('{team} performance', { team: term('sales_team') })} sub={t('Today — calls, target achievement, response rate, meetings, proposals, follow-ups and won/lost per person.')} flush
            actions={<Link to="/management/" className="small">{t('Open management dashboard')}</Link>}>
            {byUser ? <TeamTable label={t('{team} performance', { team: term('sales_team') })} targets followUps wl rows={byUser.map((u, i) => ({ key: String(u.name ?? i), ...u }))} />
              : <div className="panel-body"><Loading /></div>}
          </Panel>
          <div className="cc-grid">
            <PipelineSection r={r} className="s7" />
            <div className="s5 col" style={{ gap: 12 }}>
              <Panel className="reveal" style={stagger(1, 420)} title={t('Google Sheet sync')} actions={<Link to="/admin/sync/" className="small">{t('Open')}</Link>}>
                {sync.data ? <span className="small">Last sync {fmtDateTime(sync.data.started_at)} — <b>{sync.data.status}</b> · {sync.data.inserted} new, {sync.data.updated} updated, {sync.data.conflicts} conflicts, {sync.data.errors} errors</span> : <span className="muted small">{t('No sync has run yet.')}</span>}
              </Panel>
              <Panel className="reveal" style={stagger(2, 460)} title={t('Recent audit activity')} actions={<Link to="/admin/audit/" className="small">{t('Open')}</Link>}>
                {audit.data?.map((a) => <div key={a.id} className="small"><span className="muted">{fmtDateTime(a.at)}</span> · {a.actor_email ?? t('system')} · <code>{a.action}</code> <code>{a.entity}</code></div>)}
                {audit.data?.length === 0 && <span className="muted small">{t('No entries yet.')}</span>}
              </Panel>
            </div>
            <CriticalSection r={r} className="s12" />
          </div>
        </div>
      )}
    </>
  );
}
