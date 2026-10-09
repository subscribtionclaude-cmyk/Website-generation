import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap, callFunction, configured } from '../../lib/supabase';
import { PageHead, Loading, ErrorNote, Kpi } from '../../components/ui';
import { fmtDateTime } from '../../lib/cairo';

export default function AdminStatus() {
  const s = useQuery({ queryKey: ['sysStatus'], queryFn: async () => unwrap(await supabase.rpc('system_status')) as unknown as { server_time: string; cairo_today: string; counts: Record<string, number>; last_sync: null | { started_at: string; status: string; sheet_name: string } } });
  const fn = useQuery({ queryKey: ['fnPing'], retry: 0, queryFn: async () => { const t = Date.now(); await callFunction('admin-users', { action: 'ping' }); return Date.now() - t; } });
  const sheet = useQuery({ queryKey: ['sheetCfg'], retry: 0, queryFn: async () => { try { await callFunction('google-sheet-sync', { action: 'scan' }); return 'ok'; } catch (e) { return (e as Error & { status?: number }).status === 412 ? 'not-configured' : 'error'; } } });
  return (
    <>
      <PageHead title="System status" />
      <ErrorNote error={s.error} />
      {s.isLoading ? <Loading /> : s.data && (
        <div className="col" style={{ gap: 16 }}>
          <div className="grid cols-4 keep2">
            <Kpi label="Database" value="Online" sub={`Server time ${fmtDateTime(s.data.server_time)}`} tone="ok" />
            <Kpi label="Cairo business date" value={s.data.cairo_today} />
            <Kpi label="Edge Functions" value={fn.isLoading ? '…' : fn.data !== undefined ? 'Reachable' : 'Unreachable'} sub={fn.data !== undefined ? `${fn.data} ms` : (fn.error as Error | null)?.message} tone={fn.data !== undefined ? 'ok' : 'bad'} />
            <Kpi label="Google credentials" value={sheet.isLoading ? '…' : sheet.data === 'ok' ? 'Working' : sheet.data === 'not-configured' ? 'Not configured' : 'Error'} tone={sheet.data === 'ok' ? 'ok' : 'warn'} />
          </div>
          <div className="card card-pad"><h2>Data volumes</h2><div className="grid cols-auto" style={{ marginTop: 8 }}>{Object.entries(s.data.counts).map(([k, v]) => <div key={k}><div className="muted small">{k.replace(/_/g, ' ')}</div><b className="num" style={{ fontSize: 20 }}>{Number(v).toLocaleString()}</b></div>)}</div></div>
          <div className="card card-pad col"><h2>Environment</h2>
            <dl className="kv"><dt>Frontend config</dt><dd>{configured ? 'Supabase URL + public key present' : 'Missing'}</dd><dt>Last sync</dt><dd>{s.data.last_sync ? `${fmtDateTime(s.data.last_sync.started_at)} — ${s.data.last_sync.status} (${s.data.last_sync.sheet_name})` : 'Never'}</dd><dt>Build</dt><dd>ACCORD CRM V2 · Claude independent version</dd></dl></div>
        </div>)}
    </>
  );
}
