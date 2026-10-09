import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, Play } from 'lucide-react';
import { supabase, callFunction } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { PageHead, Loading, ErrorNote } from '../../components/ui';
import { fmtDateTime } from '../../lib/cairo';
import { t } from '../../lib/i18n';

interface Run { id: string; started_at: string; finished_at: string | null; sheet_name: string; mode: string; status: string; rows_scanned: number; inserted: number; updated: number; skipped: number; conflicts: number; rejected: number; errors: number; initiated_by: string | null }
interface Result { run_id: string; sheet: string; kind: string; status: string; scanned: number; inserted: number; updated: number; skipped: number; conflicts: number; rejected: number; errors: number }

export default function AdminSync() {
  const qc = useQueryClient(); const toast = useToast();
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null); const [res, setRes] = useState<{ mode: string; results: Result[] } | null>(null);
  const [scan, setScan] = useState<{ spreadsheet: string; tabs: { title: string; rows: number; cols: number; header_preview: unknown[][] }[] } | null>(null);
  const [sel, setSel] = useState<string>('');
  const runs = useQuery({ queryKey: ['syncRuns'], queryFn: async () => { const { data, error } = await supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(30); if (error) throw new Error(error.message); return data as Run[]; } });
  const errors = useQuery({ queryKey: ['syncErrors', sel], enabled: Boolean(sel), queryFn: async () => { const { data, error } = await supabase.from('sync_errors').select('*').eq('run_id', sel).order('id').limit(200); if (error) throw new Error(error.message); return data as { id: number; row_number: number | null; kind: string; message: string }[]; } });

  async function run(action: 'scan' | 'preview' | 'sync') {
    setErr(null); setBusy(action);
    try {
      const out = await callFunction<Record<string, unknown>>('google-sheet-sync', { action });
      if (action === 'scan') setScan(out as never); else { setRes(out as never); toast(action === 'preview' ? 'Preview complete (nothing written)' : 'Sync complete', 'ok'); qc.invalidateQueries({ queryKey: ['syncRuns'] }); }
    } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  const credErr = err instanceof Error && (err as Error & { status?: number }).status === 412;

  return (
    <>
      <PageHead title={t('Google Sheet sync')} sub={t('Accord New Data → Supabase. The Sheet is read-only: nothing is ever written back.')} />
      <div className="card card-pad col" style={{ marginBottom: 14 }}>
        <div className="row">
          <button className="btn" disabled={Boolean(busy)} onClick={() => run('scan')}><Search /> {busy === 'scan' ? 'Scanning…' : 'Scan sheet'}</button>
          <button className="btn" disabled={Boolean(busy)} onClick={() => run('preview')}><Play /> {busy === 'preview' ? 'Previewing…' : 'Preview (dry run)'}</button>
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => { if (confirm('Import Sheet1 (leads) and Sheet2 (projects) into the CRM now?')) run('sync'); }}><RefreshCw /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
        </div>
        <span className="muted small">Sheet1 → leads, contacts, follow-ups (matched by Lead ID, then Company + Email/Phone — never fuzzy). Sheet2 → developer/project reference list. Repeating an unchanged import changes nothing.</span>
        {credErr ? (
          <div className="notice warn"><b>{t('Google access is not configured yet.')}</b> {(err as Error).message}<br />Add the Google service-account credentials as Edge Function secrets (server-side only) and share the spreadsheet (Viewer) with that service-account email. See docs/SETUP.md, section “Google Sheet access”.</div>
        ) : <ErrorNote error={err} />}
      </div>

      {scan && <div className="card card-pad col" style={{ marginBottom: 14 }}><h2>{scan.spreadsheet}</h2>{scan.tabs.map((t) => (
        <div key={t.title}><b>{t.title}</b> <span className="muted small">({t.rows} rows × {t.cols} cols)</span><div className="table-wrap json"><table className="t"><tbody>{t.header_preview.slice(0, 3).map((r, i) => <tr key={i}>{(r as unknown[]).slice(0, 14).map((c, j) => <td key={j} className="small">{String(c ?? '').slice(0, 40)}</td>)}</tr>)}</tbody></table></div></div>))}</div>}

      {res && <div className="card card-pad col" style={{ marginBottom: 14 }}><h2>{res.mode === 'preview' ? 'Preview result (nothing written)' : 'Sync result'}</h2>
        <div className="table-wrap"><table className="t"><thead><tr><th>{t('Sheet')}</th><th>{t('Status')}</th><th className="r">{t('Scanned')}</th><th className="r">{t('Inserted')}</th><th className="r">{t('Updated')}</th><th className="r">{t('Skipped')}</th><th className="r">{t('Conflicts')}</th><th className="r">{t('Rejected')}</th><th className="r">{t('Errors')}</th></tr></thead><tbody>
          {res.results.map((r) => <tr key={r.run_id}><td>{r.sheet} <span className="muted small">({r.kind})</span></td><td><span className={`badge ${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'}`}>{r.status}</span></td><td className="r num">{r.scanned}</td><td className="r num">{r.inserted}</td><td className="r num">{r.updated}</td><td className="r num">{r.skipped}</td><td className="r num">{r.conflicts}</td><td className="r num">{r.rejected}</td><td className="r num">{r.errors}</td></tr>)}
        </tbody></table></div></div>}

      <div className="card"><div className="card-head"><h2>{t('Sync history')}</h2></div>
        {runs.isLoading ? <Loading /> : <div className="table-wrap"><table className="t" aria-label={t('Sync history')}><thead><tr><th>{t('When (Cairo)')}</th><th>{t('Sheet')}</th><th>{t('Mode')}</th><th>{t('Status')}</th><th className="r">{t('Rows')}</th><th className="r">{t('Ins')}</th><th className="r">{t('Upd')}</th><th className="r">{t('Skip')}</th><th className="r">{t('Conf')}</th><th className="r">{t('Rej')}</th><th className="r">{t('Err')}</th><th /></tr></thead><tbody>
          {runs.data?.length === 0 && <tr><td colSpan={12} className="muted">{t('No runs yet.')}</td></tr>}
          {runs.data?.map((r) => <tr key={r.id}><td className="nowrap">{fmtDateTime(r.started_at)}</td><td>{r.sheet_name}</td><td>{r.mode}</td><td><span className={`badge ${r.status === 'success' ? 'ok' : r.status === 'running' ? 'info' : r.status === 'partial' ? 'warn' : 'bad'}`}>{r.status}</span></td>
            <td className="r num">{r.rows_scanned}</td><td className="r num">{r.inserted}</td><td className="r num">{r.updated}</td><td className="r num">{r.skipped}</td><td className="r num">{r.conflicts}</td><td className="r num">{r.rejected}</td><td className="r num">{r.errors}</td>
            <td className="r">{(r.conflicts + r.rejected + r.errors > 0) && <button className="btn sm ghost" onClick={() => setSel(sel === r.id ? '' : r.id)}>{sel === r.id ? 'Hide' : 'Details'}</button>}</td></tr>)}
        </tbody></table></div>}
        {sel && <div className="card-pad col"><h3>{t('Issues for this run')}</h3>{errors.isLoading ? <Loading /> : errors.data?.map((e) => <div key={e.id} className="small"><span className={`badge ${e.kind === 'conflict' ? 'warn' : 'bad'}`}>{e.kind}</span> row {e.row_number ?? '—'}: {e.message}</div>)}</div>}
      </div>
    </>
  );
}
