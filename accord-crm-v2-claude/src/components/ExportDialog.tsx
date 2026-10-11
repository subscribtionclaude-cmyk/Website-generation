import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, FileSpreadsheet, FileText, Presentation, Download, CheckCircle2, ShieldCheck, Table2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t, currentLang } from '../lib/i18n';
import { cairoToday, fmtDate } from '../lib/cairo';
import { STAGES, STAGE_LABEL, TEMPERATURES, TEMP_LABEL, PROPOSAL_STATUS } from '../lib/labels';
import { Modal, Field, Select, Segmented, UserSelect, ErrorNote, BusyButton } from './ui';
import { DATASETS, MEETING_STATUS_OPTIONS, resolvePeriod, type DatasetKey, type Filters, type Period, type PeriodKind } from '../lib/exportData';
import type { BoardKind } from '../lib/boardReport';

export type ExportKind = 'full' | 'board' | DatasetKey;
type Mode = 'admin' | 'staff' | 'board';

/** Export flow: type → period → optional filters → format → generate. Reads run with the user's own session (RLS). */
export function ExportDialog({ mode, initial, initialBoard = 'daily', onClose }: { mode: Mode; initial?: ExportKind; initialBoard?: BoardKind; onClose: () => void }) {
  const qc = useQueryClient();
  const today = cairoToday();
  const [kind, setKind] = useState<ExportKind>(initial ?? (mode === 'board' ? 'board' : mode === 'admin' ? 'full' : 'leads'));
  const [period, setPeriod] = useState<PeriodKind>('all');
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const [bKind, setBKind] = useState<BoardKind>(initialBoard);
  const [anchor, setAnchor] = useState(today);
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('pdf');
  const [f, setF] = useState<Filters>({ leadStatus: '' });
  const [busy, setBusy] = useState(false); const [step, setStep] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<null | { file: string; rows?: number; audited: boolean }>(null);

  const isBoard = kind === 'board';
  const types: { key: ExportKind; label: string; icon: JSX.Element; hint: string }[] = [
    ...(mode === 'admin' ? [{ key: 'full' as ExportKind, label: 'Full CRM Export', icon: <Database />, hint: 'All datasets in one workbook' }] : []),
    ...(mode !== 'board' ? DATASETS.filter((d) => d.key !== 'minutes').map((d) => ({ key: d.key as ExportKind, label: d.label, icon: <Table2 />, hint: '' })) : []),
    ...(mode !== 'staff' ? [{ key: 'board' as ExportKind, label: 'Board Report', icon: <Presentation />, hint: 'Daily · weekly · monthly' }] : []),
  ];
  const p: Period = { kind: period, from, to };
  const range = isBoard ? null : resolvePeriod(p);
  const set = (k: keyof Filters) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const leadFilters = !isBoard && kind !== 'projects';
  const active: string[] = [];
  if (!isBoard) active.push(range ? `${t('Period')}: ${range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`}` : `${t('Period')}: ${t('All time')}`);
  if (f.owner) active.push(`${t('User')} ✓`);
  if (leadFilters && f.temperature) active.push(`${t('Temperature')}: ${TEMP_LABEL[f.temperature]}`);
  if (leadFilters && f.stage) active.push(`${t('Stage')}: ${STAGE_LABEL[f.stage]}`);
  if (leadFilters && f.leadStatus) active.push(`${t('Lead status')}: ${t(f.leadStatus === 'active' ? 'Active' : 'Archived')}`);
  if ((kind === 'full' || kind === 'proposals') && f.proposalStatus) active.push(`${t('Proposal status')}: ${PROPOSAL_STATUS.find((x) => x[0] === f.proposalStatus)?.[1]}`);
  if ((kind === 'full' || kind === 'meetings') && f.meetingStatus) active.push(`${t('Meeting status')}: ${t(MEETING_STATUS_OPTIONS.find((x) => x[0] === f.meetingStatus)?.[1] ?? '')}`);

  async function run() {
    setErr(null); setDone(null); setBusy(true);
    try {
      const fmt = isBoard ? format : 'xlsx';
      const { boardPeriod, boardFileName } = await import('../lib/boardReport');
      const br = isBoard ? boardPeriod(bKind, bKind === 'custom' ? from : anchor, bKind === 'custom' ? to : undefined) : null;
      const per = br ?? range;
      const filters = isBoard ? {} : Object.fromEntries(Object.entries({ ...f, period }).filter(([, v]) => v));
      // 1. server-side permission check + audit record (refused for viewers; full/board exports are admin only)
      setStep(t('Checking permission…'));
      let audited = true;
      const a = await supabase.rpc('log_export', { p_kind: kind, p_format: fmt, p_from: per?.from ?? null, p_to: per?.to ?? null, p_filters: { ...filters, language: currentLang() } });
      if (a.error) {
        // only tolerate a project where migration 10 has not been applied yet; any other error (e.g. permission) stops here
        if (a.error.code === 'PGRST202' || /Could not find the function/i.test(a.error.message)) audited = false;
        else throw new Error(a.error.message);
      }
      const { buildXlsx, downloadBytes } = await import('../lib/xlsx');
      if (isBoard) {
        const { gatherBoard, boardSheets, boardHtml, printHtml } = await import('../lib/boardReport');
        setStep(t('Reading report data…'));
        const D = await gatherBoard(bKind, br!);
        const file = boardFileName(bKind, br!, fmt as 'pdf' | 'xlsx');
        if (fmt === 'xlsx') downloadBytes(file, buildXlsx(boardSheets(D), { rtl: currentLang() === 'ar', title: file }));
        else printHtml(boardHtml(D), file.replace(/\.pdf$/, ''));
        setDone({ file, audited });
      } else {
        const { fetchExportData, buildSheets, exportFileName } = await import('../lib/exportData');
        const sets: DatasetKey[] = kind === 'full' ? DATASETS.map((d) => d.key) : kind === 'meetings' ? ['meetings', 'minutes'] : [kind as DatasetKey];
        const D = await fetchExportData(sets, p, f, setStep);
        setStep(t('Building workbook…'));
        const sheets = buildSheets(sets, D);
        const file = exportFileName(kind === 'full' ? 'full' : (kind as DatasetKey), p);
        downloadBytes(file, buildXlsx(sheets, { rtl: currentLang() === 'ar', title: file }));
        setDone({ file, rows: sheets.reduce((n, s) => n + s.rows.length, 0), audited });
      }
      qc.invalidateQueries({ queryKey: ['exportAudit'] });
    } catch (e) { setErr(e); } finally { setBusy(false); setStep(''); }
  }

  return (
    <Modal wide title={t('Export')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{done ? t('Close') : t('Cancel')}</button>
        <BusyButton className="btn primary" busy={busy} onClick={run} data-testid="export-run"><Download /> {isBoard && format === 'pdf' ? t('Generate PDF') : t('Generate Excel')}</BusyButton></>}>
      <section className="col" aria-label={t('Export type')}>
        <span className="section-title">1 · {t('Export type')}</span>
        <div className="export-types" role="radiogroup" aria-label={t('Export type')}>
          {types.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={kind === x.key} className="export-type" onClick={() => { setKind(x.key); setDone(null); }} data-testid={`export-type-${x.key}`}>
              {x.icon}<span><b>{t(x.label)}</b>{x.hint && <small>{t(x.hint)}</small>}</span>
            </button>
          ))}
        </div>
        {(kind === 'full' || kind === 'board') && <span className="hint row"><ShieldCheck size={14} /> {t('Administrators only. Every export is recorded in the audit log.')}</span>}
      </section>

      <section className="col">
        <span className="section-title">2 · {t('Period')}</span>
        {isBoard ? (
          <>
            <Segmented<BoardKind> label={t('Report type')} value={bKind} onChange={setBKind} options={[
              { key: 'daily', label: t('Daily') }, { key: 'weekly', label: t('Weekly') }, { key: 'monthly', label: t('Monthly') }, { key: 'custom', label: t('Custom') }]} />
            {bKind === 'custom'
              ? <div className="form-grid"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
              : <Field label={bKind === 'daily' ? 'Report date' : 'Any date in period'}><input type="date" value={anchor} max={today} onChange={(e) => e.target.value && setAnchor(e.target.value)} data-testid="export-anchor" /></Field>}
            <span className="hint">{t('Cairo calendar (Africa/Cairo). Weeks run Sunday–Saturday, the CRM working week.')}</span>
          </>
        ) : (
          <>
            <Segmented<PeriodKind> label={t('Period')} value={period} onChange={setPeriod} options={[
              { key: 'all', label: t('All time') }, { key: 'today', label: t('Today') }, { key: 'this_week', label: t('This week') }, { key: 'this_month', label: t('This month') }, { key: 'custom', label: t('Custom') }]} />
            {period === 'custom' && <div className="form-grid"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="export-from" /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="export-to" /></Field></div>}
            <span className="hint">{t('Each sheet is filtered by its own date: lead created, call time, follow-up due date, meeting date, form / proposal created.')}</span>
          </>
        )}
      </section>

      {!isBoard && (
        <section className="col">
          <span className="section-title">3 · {t('Filters (optional)')}</span>
          <div className="form-grid">
            <Field label="User"><UserSelect value={f.owner ?? ''} onChange={set('owner')} includeAll allLabel="Everyone" /></Field>
            {leadFilters && <Field label="Temperature"><Select value={f.temperature ?? ''} onChange={set('temperature')} placeholder="All temperatures" options={TEMPERATURES.map((x) => [x, TEMP_LABEL[x]])} /></Field>}
            {leadFilters && <Field label="Pipeline stage"><Select value={f.stage ?? ''} onChange={set('stage')} placeholder="All stages" options={STAGES.map((x) => [x, STAGE_LABEL[x]])} /></Field>}
            {leadFilters && <Field label="Lead status"><Select value={f.leadStatus ?? ''} onChange={set('leadStatus')} placeholder="All" options={[['active', 'Active'], ['archived', 'Archived']]} /></Field>}
            {(kind === 'full' || kind === 'proposals') && <Field label="Proposal status"><Select value={f.proposalStatus ?? ''} onChange={set('proposalStatus')} placeholder="All" options={PROPOSAL_STATUS} /></Field>}
            {(kind === 'full' || kind === 'meetings') && <Field label="Meeting status"><Select value={f.meetingStatus ?? ''} onChange={set('meetingStatus')} placeholder="All" options={MEETING_STATUS_OPTIONS} /></Field>}
          </div>
        </section>
      )}

      <section className="col">
        <span className="section-title">{isBoard ? 3 : 4} · {t('Format')}</span>
        {isBoard
          ? <Segmented<'pdf' | 'xlsx'> label={t('Format')} value={format} onChange={setFormat} options={[{ key: 'pdf', label: 'PDF', icon: <FileText /> }, { key: 'xlsx', label: 'Excel (.xlsx)', icon: <FileSpreadsheet /> }]} />
          : <span className="badge"><FileSpreadsheet size={13} /> Excel (.xlsx) · {kind === 'full' ? t('11 sheets') : t('one sheet per dataset')}</span>}
        {isBoard && format === 'pdf' && <span className="hint">{t('Opens the print dialog with the report ready — choose “Save as PDF”. The file name is filled in for you.')}</span>}
      </section>

      {!isBoard && <div className="row small" data-testid="export-active-filters"><b>{t('Active filters')}:</b> {active.map((a) => <span key={a} className="badge">{a}</span>)}</div>}
      {busy && <div className="notice row" role="status"><span className="spinner" /> {step || t('Working…')}</div>}
      <ErrorNote error={err} />
      {done && <div className="notice ok row" role="status" data-testid="export-done"><CheckCircle2 size={16} /> <span>{t('Ready')}: <bdi className="ltr">{done.file}</bdi>{done.rows !== undefined ? ` · ${t('{n} rows', { n: done.rows })}` : ''}{done.audited ? '' : ` · ${t('audit log unavailable (apply migration 10)')}`}</span></div>}
    </Modal>
  );
}
