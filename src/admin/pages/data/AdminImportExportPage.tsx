import { useQuery } from '@tanstack/react-query';
import { Download, FileUp, ListChecks } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  downloadText,
  flattenRow,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  toCsv,
  type ParsedCsv,
} from '@/domain/admin/csv';
import {
  applyMapping,
  autoMap,
  IMPORT_FIELDS,
  IMPORT_TEMPLATE_COLUMNS,
  missingRequired,
  REQUIRED_IMPORT_FIELDS,
  type ImportMapping,
} from '@/domain/admin/importMapping';
import {
  EXPORT_KINDS,
  type ExportKind,
  type ImportPreview,
  type ImportRowResult,
} from '@/domain/admin/schemas';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable } from '../../ui/DataTable';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';

type Tab = 'import' | 'export' | 'history';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Product/price/stock import (CSV → column mapping → server-validated preview → confirmation)
 * and data exports. Files are treated as untrusted text: nothing is evaluated, formulas stay
 * plain strings, and exported cells that look like formulas are neutralised.
 */
export function AdminImportExportPage() {
  const { at } = useAdminI18n();
  const { can } = useAccess();
  const [tab, setTab] = useState<Tab>(can('data.import') ? 'import' : 'export');
  const tabs: { id: Tab; label: string }[] = [
    ...(can('data.import') ? [{ id: 'import' as const, label: at('dataAdmin.tab.import') }] : []),
    ...(can('reports.export')
      ? [{ id: 'export' as const, label: at('dataAdmin.tab.export') }]
      : []),
    ...(can('data.import') ? [{ id: 'history' as const, label: at('dataAdmin.tab.history') }] : []),
  ];
  return (
    <>
      <PageHeader title={at('modules.import-export.title')} subtitle={at('dataAdmin.subtitle')} />
      <div className={styles.stack}>
        <Tabs
          idBase="data"
          label={at('modules.import-export.title')}
          tabs={tabs}
          active={tab}
          onChange={setTab}
        />
        <TabPanel idBase="data" active={tab}>
          {tab === 'import' && <ImportPanel onDone={() => setTab('history')} />}
          {tab === 'export' && <ExportPanel />}
          {tab === 'history' && <HistoryPanel />}
        </TabPanel>
      </div>
    </>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Extract<ImportPreview, { ok: true }> | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const confirm = useConfirm<boolean>();
  const commit = useAdminAction((jobId: string, validOnly: boolean) =>
    repo.importCommit(jobId, validOnly),
  );

  const reset = () => {
    setParsed(null);
    setPreview(null);
    setFileName(null);
    setMapping({});
    commit.reset();
  };

  const onFile = async (file: File) => {
    reset();
    setFileError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(
        at('dataAdmin.tooLarge', { size: format.number(MAX_IMPORT_BYTES / 1024 / 1024) }),
      );
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setFileError(at('dataAdmin.csvOnly'));
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    if (result.headers.length === 0 || result.rows.length === 0) {
      setFileError(at('dataAdmin.empty'));
      return;
    }
    setFileName(file.name);
    setParsed(result);
    setMapping(autoMap(result.headers));
  };

  const missing = missingRequired(mapping);
  const runPreview = async () => {
    if (!parsed || !fileName) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const { rows } = applyMapping(parsed, mapping);
      const result = await repo.importPreview(fileName, rows);
      if (result.ok) setPreview(result);
      else setPreviewError(at(`problems.${result.code}` as AdminMessageKey));
    } catch (e) {
      setPreviewError(errorText(e, true));
    } finally {
      setPreviewing(false);
    }
  };

  const rows = preview ? preview.rows.filter((r) => !errorsOnly || r.errors.length > 0) : [];
  const summary = preview?.summary;

  return (
    <div className={styles.stack}>
      <Alert tone="info">{at('dataAdmin.importIntro')}</Alert>
      <Panel
        title={at('dataAdmin.step1')}
        icon={<FileUp aria-hidden="true" />}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<Download aria-hidden="true" />}
            onClick={() =>
              downloadText('malek-import-template.csv', `${IMPORT_TEMPLATE_COLUMNS.join(',')}\r\n`)
            }
          >
            {at('dataAdmin.template')}
          </Button>
        }
      >
        <div className={styles.stack}>
          <label htmlFor={inputId} className={styles.fieldLabel}>
            {at('dataAdmin.chooseFile')}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className={styles.control}
            aria-describedby={`${inputId}-hint`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <span id={`${inputId}-hint`} className={styles.hint}>
            {at('dataAdmin.fileHint', {
              rows: format.number(MAX_IMPORT_ROWS),
              size: format.number(MAX_IMPORT_BYTES / 1024 / 1024),
            })}
          </span>
          {fileError && (
            <Alert tone="danger" live>
              {fileError}
            </Alert>
          )}
        </div>
      </Panel>

      {parsed && (
        <Panel title={at('dataAdmin.step2')} icon={<ListChecks aria-hidden="true" />}>
          <div className={styles.stack}>
            <p className={styles.small}>
              {at('dataAdmin.fileSummary', {
                name: fileName ?? '',
                rows: format.number(Math.min(parsed.rows.length, MAX_IMPORT_ROWS)),
                columns: format.number(parsed.headers.length),
              })}
            </p>
            {parsed.rows.length > MAX_IMPORT_ROWS && (
              <Alert tone="warning">
                {at('dataAdmin.truncated', { max: format.number(MAX_IMPORT_ROWS) })}
              </Alert>
            )}
            <div className={`${styles.formGrid} ${styles.formGrid3}`}>
              {IMPORT_FIELDS.map((field) => (
                <SelectField
                  key={field}
                  label={`${at(`dataAdmin.field.${field}` as AdminMessageKey)}${
                    REQUIRED_IMPORT_FIELDS.includes(field) ? ` · ${at('ui.required')}` : ''
                  }`}
                  value={mapping[field] === undefined ? '' : String(mapping[field])}
                  error={missing.includes(field) ? at('dataAdmin.mapRequired') : null}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMapping(
                      Object.fromEntries([
                        ...Object.entries(mapping).filter(([k]) => k !== field),
                        ...(v === '' ? [] : [[field, Number(v)]]),
                      ]) as ImportMapping,
                    );
                    setPreview(null);
                  }}
                  options={[
                    { value: '', label: at('dataAdmin.notMapped') },
                    ...parsed.headers.map((h, i) => ({
                      value: String(i),
                      label: h || at('dataAdmin.column', { n: i + 1 }),
                    })),
                  ]}
                />
              ))}
            </div>
            <div className={styles.actions}>
              <Button
                loading={previewing}
                disabled={missing.length > 0}
                onClick={() => void runPreview()}
              >
                {at('dataAdmin.preview')}
              </Button>
              <Button variant="ghost" onClick={reset}>
                {at('ui.reset')}
              </Button>
            </div>
            {previewError && (
              <Alert tone="danger" live>
                {previewError}
              </Alert>
            )}
          </div>
        </Panel>
      )}

      {preview && summary && (
        <Panel title={at('dataAdmin.step3')}>
          <div className={styles.stack}>
            <div className={styles.chips} aria-live="polite">
              <Badge>{at('dataAdmin.sum.total', { count: summary.total })}</Badge>
              <Badge tone="success">
                {at('dataAdmin.sum.createProduct', { count: summary.createProduct })}
              </Badge>
              <Badge tone="success">
                {at('dataAdmin.sum.createVariant', { count: summary.createVariant })}
              </Badge>
              <Badge tone="info">{at('dataAdmin.sum.update', { count: summary.update })}</Badge>
              <Badge tone={summary.errors > 0 ? 'danger' : 'neutral'}>
                {at('dataAdmin.sum.errors', { count: summary.errors })}
              </Badge>
            </div>
            <CheckboxField
              label={at('dataAdmin.errorsOnly')}
              checked={errorsOnly}
              onChange={setErrorsOnly}
            />
            <DataTable
              caption={at('dataAdmin.step3')}
              rows={rows.slice(0, 500)}
              rowKey={(r) => String(r.rowNo)}
              maxHeight="50vh"
              columns={[
                {
                  id: 'row',
                  header: at('dataAdmin.col.row'),
                  rowHeader: true,
                  className: styles.num,
                  cell: (r: ImportRowResult) => format.number(r.rowNo),
                },
                {
                  id: 'action',
                  header: at('dataAdmin.col.action'),
                  cell: (r) => (
                    <Badge
                      tone={
                        r.action === 'error' ? 'danger' : r.action === 'update' ? 'info' : 'success'
                      }
                    >
                      {at(`dataAdmin.action.${r.action}` as AdminMessageKey)}
                    </Badge>
                  ),
                },
                {
                  id: 'sku',
                  header: 'SKU',
                  cell: (r) => <span className={styles.mono}>{String(r.data.sku ?? '—')}</span>,
                },
                {
                  id: 'details',
                  header: at('dataAdmin.col.details'),
                  cell: (r) =>
                    r.errors.length > 0 ? (
                      <ul className={styles.errorList}>
                        {r.errors.map((code) => (
                          <li key={code}>{at(`dataAdmin.rowError.${code}` as AdminMessageKey)}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className={styles.small}>
                        {[
                          r.data.price !== undefined &&
                            `${at('dataAdmin.field.price')}: ${String(r.data.price)}`,
                          r.data.stock !== undefined &&
                            `${at('dataAdmin.field.stock')}: ${String(r.data.stock)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ),
                },
              ]}
            />
            {rows.length > 500 && <p className={styles.hint}>{at('dataAdmin.showingFirst')}</p>}
            {commit.error && (
              <Alert tone="danger" live>
                {commit.error}
              </Alert>
            )}
            <div className={styles.actions}>
              <Button
                disabled={summary.errors > 0 || summary.total === 0}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('dataAdmin.commitAllTitle'),
                      body: at('dataAdmin.commitBody', {
                        count: summary.total - summary.errors,
                      }),
                      confirmLabel: at('dataAdmin.commit'),
                      reason: 'optional',
                    },
                    false,
                  )
                }
              >
                {at('dataAdmin.commitAll')}
              </Button>
              {summary.errors > 0 && summary.total > summary.errors && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    confirm.ask(
                      {
                        title: at('dataAdmin.commitValidTitle'),
                        body: at('dataAdmin.commitValidBody', {
                          count: summary.total - summary.errors,
                          skipped: summary.errors,
                        }),
                        confirmLabel: at('dataAdmin.commit'),
                        tone: 'danger',
                      },
                      true,
                    )
                  }
                >
                  {at('dataAdmin.commitValid')}
                </Button>
              )}
            </div>
            {summary.errors > 0 && <p className={styles.hint}>{at('dataAdmin.allOrNothing')}</p>}
          </div>
        </Panel>
      )}
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={commit.pending}
        error={commit.error}
        onCancel={confirm.close}
        onConfirm={async () => {
          if (!preview) return;
          const r = await commit.run(preview.jobId, confirm.payload === true);
          if (r?.ok) {
            confirm.close();
            reset();
            if (inputRef.current) inputRef.current.value = '';
            onDone();
          }
        }}
      />
    </div>
  );
}

function ExportPanel() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: ExportKind, as: 'csv' | 'json') => {
    setBusy(`${kind}-${as}`);
    setError(null);
    try {
      const result = await repo.exportData(kind);
      if (as === 'csv')
        downloadText(`${kind}-${today()}.csv`, toCsv(result.rows.map((r) => flattenRow(r))));
      else
        downloadText(
          `${kind}-${today()}.json`,
          JSON.stringify(result, null, 2),
          'application/json',
        );
    } catch (e) {
      setError(errorText(e, true));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.stack}>
      <Alert tone="info">{at('dataAdmin.exportIntro')}</Alert>
      {error && (
        <Alert tone="danger" live>
          {error}
        </Alert>
      )}
      <ul className={styles.pickList}>
        {EXPORT_KINDS.map((kind) => (
          <li key={kind}>
            <span className={styles.cellTitle}>
              <strong>{at(`dataAdmin.kind.${kind}` as AdminMessageKey)}</strong>
            </span>
            <span className={styles.rowActions}>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                loading={busy === `${kind}-csv`}
                onClick={() => void run(kind, 'csv')}
              >
                <span>
                  CSV
                  <span className="visually-hidden">
                    : {at(`dataAdmin.kind.${kind}` as AdminMessageKey)}
                  </span>
                </span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download aria-hidden="true" />}
                loading={busy === `${kind}-json`}
                onClick={() => void run(kind, 'json')}
              >
                <span>
                  JSON
                  <span className="visually-hidden">
                    : {at(`dataAdmin.kind.${kind}` as AdminMessageKey)}
                  </span>
                </span>
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryPanel() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const jobs = useQuery({
    queryKey: ['admin', 'import-jobs'],
    queryFn: () => repo.listImportJobs(),
  });
  return (
    <QueryState query={jobs} isEmpty={(d) => d.length === 0} empty={at('dataAdmin.noJobs')}>
      {(list) => (
        <DataTable
          caption={at('dataAdmin.tab.history')}
          rows={list}
          rowKey={(j) => j.id}
          columns={[
            {
              id: 'file',
              header: at('dataAdmin.col.file'),
              rowHeader: true,
              cell: (j) => <span className={styles.mono}>{j.fileName ?? '—'}</span>,
            },
            {
              id: 'status',
              header: at('dataAdmin.col.status'),
              cell: (j) => (
                <Badge
                  tone={
                    j.status === 'committed'
                      ? 'success'
                      : j.status === 'failed'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {at(`dataAdmin.jobStatus.${j.status}` as AdminMessageKey)}
                </Badge>
              ),
            },
            {
              id: 'rows',
              header: at('dataAdmin.col.rows'),
              className: styles.num,
              cell: (j) => format.number(j.rowCount),
            },
            {
              id: 'applied',
              header: at('dataAdmin.col.applied'),
              className: styles.num,
              cell: (j) =>
                j.summary.applied === undefined ? '—' : format.number(j.summary.applied),
            },
            {
              id: 'date',
              header: at('dataAdmin.col.date'),
              className: styles.nowrap,
              cell: (j) => format.dateTime(j.committedAt ?? j.createdAt),
            },
            { id: 'by', header: at('dataAdmin.col.by'), cell: (j) => j.createdBy ?? '—' },
          ]}
        />
      )}
    </QueryState>
  );
}
