// Admin-only. Reads the approved legacy sheet (READ-ONLY) and applies it to Supabase.
// actions: scan | preview | sync          (the browser can never choose a different spreadsheet)
import { handle, json, requireAdmin, HttpError } from '../_shared/auth.ts';
import { DEFAULT_SPREADSHEET_ID, GoogleConfigError, getAccessToken, listTabs, readTab } from '../_shared/google.ts';
import { chunk, parseLeadSheet, parseProjectSheet } from '../_shared/sheet-core.ts';

const SPREADSHEET_ID = () => Deno.env.get('GOOGLE_SPREADSHEET_ID') ?? DEFAULT_SPREADSHEET_ID;
const DEFAULT_SHEETS = [{ name: 'Sheet1', kind: 'leads' }, { name: 'Sheet2', kind: 'projects' }];
type Kind = 'leads' | 'projects';

Deno.serve((req) => handle(req, async (req) => {
  const { user, admin } = await requireAdmin(req);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  if (!['scan', 'preview', 'sync'].includes(action)) throw new HttpError(400, 'Unknown action');

  let token: string;
  try { token = await getAccessToken(); } catch (e) {
    if (e instanceof GoogleConfigError) throw new HttpError(412, e.message);
    throw e;
  }

  let meta;
  try { meta = await listTabs(token, SPREADSHEET_ID()); } catch (e) {
    if (e instanceof GoogleConfigError) throw new HttpError(412, e.message);
    throw e;
  }

  if (action === 'scan') {
    const tabs = [];
    for (const t of meta.tabs) {
      const sample = (await readTab(token, SPREADSHEET_ID(), t.title)).slice(0, 4);
      tabs.push({ ...t, header_preview: sample });
    }
    return json(req, { spreadsheet: meta.title, spreadsheet_id: SPREADSHEET_ID(), tabs });
  }

  const dryRun = action === 'preview';
  const requested: { name: string; kind: Kind }[] = Array.isArray(body.sheets) && body.sheets.length ? body.sheets : DEFAULT_SHEETS;
  const known = new Set(meta.tabs.map((t) => t.title));
  const results = [];

  for (const s of requested) {
    if (!known.has(s.name)) throw new HttpError(400, `Sheet "${s.name}" does not exist in the spreadsheet`);
    if (s.kind !== 'leads' && s.kind !== 'projects') throw new HttpError(400, 'Invalid sheet kind');
    const { data: run, error: runErr } = await admin.from('sync_runs').insert({
      initiated_by: user.id, spreadsheet_id: SPREADSHEET_ID(), sheet_name: s.name, mode: dryRun ? 'preview' : 'sync',
    }).select('id').single();
    if (runErr || !run) throw new HttpError(500, 'Could not start the sync run');

    const totals = { scanned: 0, inserted: 0, updated: 0, skipped: 0, conflicts: 0, rejected: 0, errors: 0 };
    let status: 'success' | 'partial' | 'failed' = 'success';
    try {
      const values = await readTab(token, SPREADSHEET_ID(), s.name);
      const parsed = s.kind === 'leads' ? parseLeadSheet(values) : parseProjectSheet(values);
      totals.scanned = parsed.rows.length;
      for (const w of parsed.warnings) {
        totals.errors++;
        await admin.from('sync_errors').insert({ run_id: run.id, row_number: w.row, kind: 'error', message: w.message });
      }
      const rpc = s.kind === 'leads' ? 'sync_apply_leads' : 'sync_apply_projects';
      for (const part of chunk(parsed.rows as unknown[], 100)) {
        const { data, error } = await admin.rpc(rpc, { p_run: run.id, p_actor: user.id, p_sheet: s.name, p_rows: part, p_dry_run: dryRun });
        if (error) {
          totals.errors++; status = 'partial';
          await admin.from('sync_errors').insert({ run_id: run.id, kind: 'error', message: `Batch failed: ${error.message}`.slice(0, 500) });
          continue;
        }
        totals.inserted += data.inserted; totals.updated += data.updated; totals.skipped += data.skipped;
        totals.conflicts += data.conflicts; totals.rejected += data.rejected;
      }
      if (totals.errors > 0 && status === 'success') status = 'partial';
      await admin.from('sync_runs').update({
        finished_at: new Date().toISOString(), status, rows_scanned: totals.scanned, inserted: totals.inserted,
        updated: totals.updated, skipped: totals.skipped, conflicts: totals.conflicts, rejected: totals.rejected, errors: totals.errors,
        summary: { header_row: parsed.headerRow, columns: parsed.columns, dry_run: dryRun },
      }).eq('id', run.id);
    } catch (e) {
      status = 'failed';
      await admin.from('sync_errors').insert({ run_id: run.id, kind: 'error', message: (e instanceof Error ? e.message : 'unknown').slice(0, 500) });
      await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), status, errors: totals.errors + 1 }).eq('id', run.id);
    }
    if (!dryRun) {
      await admin.rpc('svc_audit', { p_actor: user.id, p_action: 'google_import', p_entity: 'sync_runs', p_entity_id: run.id, p_meta: { sheet: s.name, ...totals, status } });
    }
    results.push({ run_id: run.id, sheet: s.name, kind: s.kind, status, ...totals });
  }
  return json(req, { mode: dryRun ? 'preview' : 'sync', spreadsheet: meta.title, results });
}));
