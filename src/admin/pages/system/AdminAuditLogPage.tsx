import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { jsonDiff, redactSecrets } from '@/domain/admin/diff';
import {
  AUDIT_MODULES,
  type AuditFilter,
  type AuditModule,
  type AuditRow,
} from '@/domain/admin/schemas';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog } from '../../ui/Dialog';
import { DiffTable } from '../../ui/DiffTable';
import { InputField, SelectField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { Pagination } from '../../ui/Pagination';
import { QueryState } from '../../ui/QueryState';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';

const PAGE = 50;
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const dayEnd = (d: string) =>
  d ? new Date(new Date(`${d}T00:00:00`).getTime() + 86_400_000).toISOString() : null;

/**
 * Append-only audit trail: who changed what, when, with a field-level before/after diff.
 * Secret-looking values are masked both in the database and again here before display.
 */
export function AdminAuditLogPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const [params, setParams] = useSearchParams();
  const [actor, setActor] = useState(params.get('actor') ?? '');
  const [action, setAction] = useState(params.get('action') ?? '');
  const [entity, setEntity] = useState(params.get('entity') ?? '');
  const filter: AuditFilter = {
    actor: params.get('actor') || null,
    action: params.get('action') || null,
    module: (params.get('module') as AuditModule | null) || null,
    entityId: params.get('entity') || null,
    from: dayStart(params.get('from') ?? ''),
    to: dayEnd(params.get('to') ?? ''),
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0) || 0,
  };
  const openId = Number(params.get('id')) || null;
  const list = useQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: () => repo.listAuditLogs(filter),
    placeholderData: (prev) => prev,
  });
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('offset' in patch)) next.delete('offset');
    setParams(next, { replace: true });
  };

  const columns: Column<AuditRow>[] = [
    {
      id: 'when',
      header: at('auditAdmin.col.when'),
      rowHeader: true,
      className: styles.nowrap,
      cell: (r) => (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => set({ id: String(r.id) })}
        >
          {format.dateTime(r.occurredAt)}
        </button>
      ),
    },
    {
      id: 'actor',
      header: at('auditAdmin.col.actor'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span>
            {r.actorName ?? (r.actorId ? r.actorId.slice(0, 8) : at('auditAdmin.system'))}
          </span>
          {r.actorEmail && (
            <bdi dir="ltr" className={styles.small}>
              {r.actorEmail}
            </bdi>
          )}
          {r.actorRole && <span className={`${styles.small} ${styles.muted}`}>{r.actorRole}</span>}
        </span>
      ),
    },
    {
      id: 'action',
      header: at('auditAdmin.col.action'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span className={styles.mono}>{r.action}</span>
          <Badge>{at(`auditAdmin.module.${r.module}` as AdminMessageKey)}</Badge>
        </span>
      ),
    },
    {
      id: 'entity',
      header: at('auditAdmin.col.entity'),
      cell: (r) => (
        <span className={styles.cellTitle}>
          <span className={styles.mono}>{r.entityType}</span>
          {r.entityId && <span className={`${styles.mono} ${styles.muted}`}>{r.entityId}</span>}
        </span>
      ),
    },
    {
      id: 'fields',
      header: at('auditAdmin.col.fields'),
      cell: (r) =>
        r.changedFields && r.changedFields.length > 0 ? (
          <span className={styles.small}>
            {r.changedFields.slice(0, 6).join(', ')}
            {r.changedFields.length > 6 && ` +${r.changedFields.length - 6}`}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader title={at('modules.audit-log.title')} subtitle={at('auditAdmin.subtitle')} />
      <div className={styles.stack}>
        <Alert tone="info">{at('auditAdmin.immutable')}</Alert>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('auditAdmin.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            set({ actor: actor.trim(), action: action.trim(), entity: entity.trim() });
          }}
        >
          <InputField
            label={at('auditAdmin.col.actor')}
            value={actor}
            placeholder={at('auditAdmin.actorHint')}
            onChange={(e) => setActor(e.target.value)}
          />
          <InputField
            label={at('auditAdmin.col.action')}
            value={action}
            ltr
            placeholder="catalog.price_change"
            onChange={(e) => setAction(e.target.value)}
          />
          <InputField
            label={at('auditAdmin.entityId')}
            value={entity}
            ltr
            onChange={(e) => setEntity(e.target.value)}
          />
          <SelectField
            label={at('auditAdmin.moduleLabel')}
            value={filter.module ?? ''}
            onChange={(e) => set({ module: e.target.value })}
            options={[
              { value: '', label: at('ui.all') },
              ...AUDIT_MODULES.map((m) => ({
                value: m,
                label: at(`auditAdmin.module.${m}` as AdminMessageKey),
              })),
            ]}
          />
          <InputField
            type="date"
            label={at('ui.from')}
            value={params.get('from') ?? ''}
            onChange={(e) => set({ from: e.target.value })}
          />
          <InputField
            type="date"
            label={at('ui.to')}
            value={params.get('to') ?? ''}
            onChange={(e) => set({ to: e.target.value })}
          />
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
              {at('ui.apply')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setActor('');
                setAction('');
                setEntity('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              {at('ui.reset')}
            </Button>
          </div>
        </form>
        <QueryState
          query={list}
          isEmpty={(d) => d.items.length === 0}
          empty={at('auditAdmin.empty')}
        >
          {(data) => (
            <>
              <DataTable
                caption={at('ui.rowsCount', { count: data.total })}
                rows={data.items}
                rowKey={(r) => String(r.id)}
                columns={columns}
              />
              <Pagination
                total={data.total}
                limit={PAGE}
                offset={filter.offset ?? 0}
                onChange={(offset) => set({ offset: String(offset) })}
              />
            </>
          )}
        </QueryState>
      </div>
      {openId !== null && <AuditDetailDialog id={openId} onClose={() => set({ id: '' })} />}
    </>
  );
}

function AuditDetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const detail = useQuery({
    queryKey: ['admin', 'audit-entry', id],
    queryFn: () => repo.getAuditLog(id),
  });
  return (
    <Dialog open wide icon={null} onClose={onClose} title={at('auditAdmin.detailTitle', { id })}>
      <div className={styles.stack}>
        <QueryState query={detail}>
          {(d) =>
            d === null ? (
              <Alert tone="warning">{at('auditAdmin.notFound')}</Alert>
            ) : (
              <>
                <dl className={styles.detailList}>
                  <div>
                    <dt>{at('auditAdmin.col.when')}</dt>
                    <dd>{format.dateTime(d.occurredAt)}</dd>
                  </div>
                  <div>
                    <dt>{at('auditAdmin.col.actor')}</dt>
                    <dd>
                      {d.actorName ?? at('auditAdmin.system')}
                      {d.actorEmail && (
                        <>
                          {' '}
                          <bdi dir="ltr">({d.actorEmail})</bdi>
                        </>
                      )}
                      {d.actorRole && ` · ${d.actorRole}`}
                    </dd>
                  </div>
                  <div>
                    <dt>{at('auditAdmin.col.action')}</dt>
                    <dd className={styles.mono}>{d.action}</dd>
                  </div>
                  <div>
                    <dt>{at('auditAdmin.col.entity')}</dt>
                    <dd className={styles.mono}>
                      {d.entityType}
                      {d.entityId && ` · ${d.entityId}`}
                    </dd>
                  </div>
                </dl>
                <DiffTable
                  caption={at('auditAdmin.changes')}
                  entries={jsonDiff(redactSecrets(d.before), redactSecrets(d.after))}
                />
                {d.metadata !== null && d.metadata !== undefined && (
                  <details>
                    <summary>{at('auditAdmin.metadata')}</summary>
                    <pre className={styles.codeBlock}>
                      {JSON.stringify(redactSecrets(d.metadata), null, 2)}
                    </pre>
                  </details>
                )}
              </>
            )
          }
        </QueryState>
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
