import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap, callFunction, configured } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote, Kpi } from '../../components/ui';
import { fmtDateTime } from '../../lib/cairo';
import { t } from '../../lib/i18n';

export default function AdminStatus() {
  const s = useQuery({ queryKey: ['sysStatus'], queryFn: async () => unwrap(await supabase.rpc('system_status')) as unknown as { server_time: string; cairo_today: string; counts: Record<string, number>; last_sync: null | { started_at: string; status: string; sheet_name: string } } });
  const fn = useQuery({ queryKey: ['fnPing'], retry: 0, queryFn: async () => { const t = Date.now(); await callFunction('admin-users', { action: 'ping' }); return Date.now() - t; } });
  const sheet = useQuery({ queryKey: ['sheetCfg'], retry: 0, queryFn: async () => { try { await callFunction('google-sheet-sync', { action: 'scan' }); return 'ok'; } catch (e) { return (e as Error & { status?: number }).status === 412 ? 'not-configured' : 'error'; } } });
  return (
    <>
      <PageHead title={t('System status')} />
      <ErrorNote error={s.error} />
      {s.isLoading ? <Loading /> : s.data && (
        <div className="col" style={{ gap: 16 }}>
          <div className="grid cols-4 keep2">
            <Kpi label={t('Database')} value={t('Online')} sub={t('Server time {time}', { time: fmtDateTime(s.data.server_time) })} tone="ok" />
            <Kpi label={t('Cairo business date')} value={s.data.cairo_today} />
            <Kpi label={t('Edge Functions')} value={fn.isLoading ? '…' : fn.data !== undefined ? t('Reachable') : t('Unreachable')} sub={fn.data !== undefined ? `${fn.data} ms` : (fn.error as Error | null)?.message} tone={fn.data !== undefined ? 'ok' : 'bad'} />
            <Kpi label={t('Google credentials')} value={sheet.isLoading ? '…' : sheet.data === 'ok' ? t('Working') : sheet.data === 'not-configured' ? t('Not configured') : t('Error')} tone={sheet.data === 'ok' ? 'ok' : 'warn'} />
          </div>
          <div className="card card-pad"><h2>{t('Data volumes')}</h2><div className="grid cols-auto" style={{ marginTop: 8 }}>{Object.entries(s.data.counts).map(([k, v]) => <div key={k}><div className="muted small">{t(k.replace(/_/g, ' '))}</div><b className="num" style={{ fontSize: 20 }}>{Number(v).toLocaleString()}</b></div>)}</div></div>
          <div className="card card-pad col"><h2>{t('Environment')}</h2>
            <dl className="kv"><dt>{t('Frontend config')}</dt><dd>{configured ? t('Supabase URL + public key present') : t('Missing')}</dd><dt>{t('Last sync')}</dt><dd>{s.data.last_sync ? `${fmtDateTime(s.data.last_sync.started_at)} — ${s.data.last_sync.status} (${s.data.last_sync.sheet_name})` : t('Never')}</dd><dt>{t('Build')}</dt><dd>{t('ACCORD CRM V2 · Claude independent version')}</dd></dl></div>
        </div>)}
    </>
  );
}
