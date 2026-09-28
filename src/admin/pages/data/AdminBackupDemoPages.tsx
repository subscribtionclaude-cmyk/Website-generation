import { useQuery } from '@tanstack/react-query';
import { DatabaseBackup, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { downloadText } from '@/domain/admin/csv';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable } from '../../ui/DataTable';
import { ConfirmDialog } from '../../ui/Dialog';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';

/**
 * Configuration / catalog / content JSON export. It is a convenience copy — it does not replace
 * the database provider's own backups, and it never contains passwords, sessions or payments.
 */
export function AdminBackupsPage() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const backup = await repo.exportBackup();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `malek-store-backup-${stamp}.json`;
      downloadText(name, JSON.stringify(backup, null, 2), 'application/json');
      setDone(name);
    } catch (e) {
      setError(errorText(e, true));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={at('modules.backups.title')} subtitle={at('backupAdmin.subtitle')} />
      <div className={styles.stack}>
        <Alert tone="warning">{at('backupAdmin.notProvider')}</Alert>
        <Panel title={at('backupAdmin.contents')} icon={<DatabaseBackup aria-hidden="true" />}>
          <div className={styles.stack}>
            <ul className={styles.small}>
              <li>{at('backupAdmin.includes')}</li>
              <li>{at('backupAdmin.excludes')}</li>
              <li>{at('backupAdmin.restore')}</li>
            </ul>
            <div>
              <Button
                icon={<Download aria-hidden="true" />}
                loading={busy}
                onClick={() => void download()}
              >
                {at('backupAdmin.download')}
              </Button>
            </div>
            {done && (
              <Alert tone="success" live>
                {at('backupAdmin.done', { name: done })}
              </Alert>
            )}
            {error && (
              <Alert tone="danger" live>
                {error}
              </Alert>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

const CONFIRM_WORD = 'DEMO';

/**
 * Demo data: what is flagged as demo, delete it all (rows flagged is_demo only — live rows are
 * never touched), and in the browser preview reset everything back to the seed.
 */
export function AdminDemoDataPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { mode } = useRuntime();
  const repo = useAdminRepo();
  const confirm = useConfirm<'delete' | 'reset'>();
  const [deleted, setDeleted] = useState<Record<string, number> | null>(null);
  const summary = useQuery({
    queryKey: ['admin', 'demo-summary'],
    queryFn: () => repo.demoSummary(),
  });
  const remove = useAdminAction(
    async () => {
      const counts = await repo.deleteDemoData();
      return { ok: true as const, counts };
    },
    { onSuccess: (r) => setDeleted(r.counts) },
  );
  const reset = useAdminAction(async () => {
    await repo.resetDemoData?.();
    return { ok: true as const };
  });
  const tableLabel = (t: string) => {
    const k = `demoAdmin.table.${t.replace(/^public\./, '')}`;
    const text = at(k as AdminMessageKey);
    return text === k ? t : text;
  };
  const total = (counts: Record<string, number>) =>
    Object.values(counts).reduce((n, v) => n + v, 0);
  return (
    <>
      <PageHeader title={at('modules.demo-data.title')} subtitle={at('demoAdmin.subtitle')} />
      <div className={styles.stack}>
        <Alert tone={mode === 'demo' ? 'warning' : 'info'}>
          {mode === 'demo' ? at('demoAdmin.modeDemo') : at('demoAdmin.modeLive')}
        </Alert>
        <Alert tone="info">{at('demoAdmin.liveSafe')}</Alert>
        {mode !== 'demo' && <Alert tone="info">{at('demoAdmin.replaceLive')}</Alert>}
        {deleted && (
          <Alert tone="success" live>
            {at('demoAdmin.deleted', { count: format.number(total(deleted)) })}
          </Alert>
        )}
        {(remove.error || reset.error) && (
          <Alert tone="danger" live>
            {remove.error ?? reset.error}
          </Alert>
        )}
        <Panel
          title={at('demoAdmin.summary')}
          actions={
            <>
              {mode === 'demo' && repo.resetDemoData && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw aria-hidden="true" />}
                  onClick={() =>
                    confirm.ask(
                      {
                        title: at('demoAdmin.resetTitle'),
                        body: at('demoAdmin.resetBody'),
                        confirmLabel: at('demoAdmin.reset'),
                        tone: 'danger',
                      },
                      'reset',
                    )
                  }
                >
                  {at('demoAdmin.reset')}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 aria-hidden="true" />}
                disabled={!summary.data || total(summary.data) === 0}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('demoAdmin.deleteTitle'),
                      body: at('demoAdmin.deleteBody'),
                      affected: Object.entries(summary.data ?? {})
                        .filter(([, n]) => n > 0)
                        .map(([t, n]) => `${tableLabel(t)}: ${format.number(n)}`),
                      confirmLabel: at('demoAdmin.delete'),
                      tone: 'danger',
                      irreversible: true,
                      typeToConfirm: CONFIRM_WORD,
                    },
                    'delete',
                  )
                }
              >
                {at('demoAdmin.delete')}
              </Button>
            </>
          }
        >
          <QueryState query={summary}>
            {(counts) =>
              total(counts) === 0 ? (
                <p className={styles.muted}>{at('demoAdmin.none')}</p>
              ) : (
                <DataTable
                  caption={at('demoAdmin.summary')}
                  rows={Object.entries(counts)}
                  rowKey={([t]) => t}
                  columns={[
                    {
                      id: 'table',
                      header: at('demoAdmin.area'),
                      rowHeader: true,
                      cell: ([t]) => tableLabel(t),
                    },
                    {
                      id: 'rows',
                      header: at('demoAdmin.rows'),
                      className: styles.num,
                      cell: ([, n]) => format.number(n),
                    },
                  ]}
                />
              )
            }
          </QueryState>
        </Panel>
      </div>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={remove.pending || reset.pending}
        onCancel={confirm.close}
        onConfirm={async () => {
          if (confirm.payload === 'delete') {
            const r = await remove.run();
            // The browser preview keeps its data in memory: reload to start from the empty store.
            if (r?.ok && mode === 'demo') window.location.reload();
          } else if (confirm.payload === 'reset') {
            const r = await reset.run();
            if (r?.ok) window.location.reload();
          }
          confirm.close();
        }}
      />
    </>
  );
}
