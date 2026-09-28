import { useQuery } from '@tanstack/react-query';
import { GitCompare, History, RotateCcw, Save, Send, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { jsonDiff } from '@/domain/admin/diff';
import type { SettingOverview, SettingVersion } from '@/domain/admin/schemas';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import { SETTING_SCHEMAS, type SettingKey } from '@/domain/settings/registry';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { DiffTable } from '../../ui/DiffTable';
import { useConfirm, useDirtyGuard } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { SchemaForm } from '../../ui/SchemaForm';
import { blankFor, issuesByPath, type FieldIssue } from '../../ui/schemaIntrospect';
import { DirtyBar, UnsavedChangesDialog } from '../../ui/useDirtyGuard';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useFieldText } from '../../ui/useFieldText';
import styles from '../../ui/adminUi.module.css';
import { useSettingTitle } from './settingsHooks';

export interface SettingFormArgs {
  value: unknown;
  onChange: (value: unknown) => void;
  issues: Record<string, FieldIssue>;
  disabled: boolean;
}

/**
 * Draft → publish workspace for one setting key: edits are validated with the same schema the
 * storefront uses, saved as a draft (optimistic concurrency), published with an optional note,
 * and every published version can be compared or restored. The database re-checks everything.
 */
export function SettingWorkspace({
  settingKey,
  title,
  subtitle,
  crumbs,
  renderForm,
  aside,
}: {
  settingKey: SettingKey;
  title?: string;
  subtitle?: ReactNode;
  crumbs?: { label: string; to: string }[];
  renderForm?: (args: SettingFormArgs) => ReactNode;
  aside?: (value: unknown) => ReactNode;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const titleOf = useSettingTitle();
  const [generation, setGeneration] = useState(0);
  const overview = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => repo.settingsOverview(),
  });
  const heading = title ?? titleOf(settingKey);
  return (
    <QueryState query={overview}>
      {(rows) => {
        const row = rows.find((r) => r.key === settingKey);
        if (!row)
          return (
            <>
              <PageHeader title={heading} crumbs={crumbs} />
              <Alert tone="warning">{at('settingsAdmin.notAvailable')}</Alert>
            </>
          );
        return (
          <SettingEditor
            key={generation}
            row={row}
            settingKey={settingKey}
            title={heading}
            subtitle={subtitle}
            crumbs={crumbs}
            renderForm={renderForm}
            aside={aside}
            onServerChange={() => setGeneration((g) => g + 1)}
          />
        );
      }}
    </QueryState>
  );
}

function initialValue(key: SettingKey, row: SettingOverview): unknown {
  const schema = SETTING_SCHEMAS[key];
  const fallback = (BASE_SETTINGS as Record<string, unknown>)[key];
  const raw = row.draft ?? row.published ?? fallback ?? blankFor(schema);
  const parsed = schema.safeParse(raw);
  return structuredClone(parsed.success ? parsed.data : raw);
}

function SettingEditor({
  row,
  settingKey,
  title,
  subtitle,
  crumbs,
  renderForm,
  aside,
  onServerChange,
}: {
  row: SettingOverview;
  settingKey: SettingKey;
  title: string;
  subtitle?: ReactNode;
  crumbs?: { label: string; to: string }[];
  renderForm?: (args: SettingFormArgs) => ReactNode;
  aside?: (value: unknown) => ReactNode;
  onServerChange: () => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const fieldText = useFieldText();
  const schema = SETTING_SCHEMAS[settingKey];
  const [initial] = useState(() => initialValue(settingKey, row));
  const [value, setValue] = useState<unknown>(initial);
  const [issues, setIssues] = useState<Record<string, FieldIssue>>({});
  const [conflict, setConflict] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const confirm = useConfirm<'publish' | 'force' | 'discard'>();
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const canEdit = row.canEdit;
  const guard = useDirtyGuard(dirty && canEdit);
  const staleDraft = row.draft !== null && row.draftBaseVersion !== row.version;

  const validate = (): Record<string, unknown> | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      setIssues(issuesByPath(parsed.error));
      return null;
    }
    setIssues({});
    return parsed.data as Record<string, unknown>;
  };

  const saveDraft = useAdminAction((data: Record<string, unknown>) =>
    repo.saveSettingDraft(settingKey, data, row.draftUpdatedAt),
  );
  const publish = useAdminAction((note: string | null, force: boolean) =>
    repo.publishSetting(settingKey, note, force),
  );
  const discard = useAdminAction(async () => {
    await repo.discardSettingDraft(settingKey);
    return { ok: true as const };
  });

  const doSave = async (): Promise<boolean> => {
    const data = validate();
    if (!data) return false;
    const r = await saveDraft.run(data);
    return r?.ok === true;
  };

  const runPublish = async (note: string, force: boolean) => {
    if (dirty && !(await doSave())) {
      confirm.close();
      return;
    }
    const r = await publish.run(note || null, force);
    if (r?.ok) {
      guard.allowNavigation();
      confirm.close();
      onServerChange();
    } else if (r && r.code === 'draft_conflict') {
      setConflict(true);
      confirm.close();
    }
  };

  const status = (
    <span className={styles.chips}>
      <Badge tone={row.isPublic ? 'info' : 'neutral'}>
        {row.isPublic ? at('settingsAdmin.public') : at('settingsAdmin.private')}
      </Badge>
      {row.version !== null ? (
        <Badge tone="success">{at('settingsAdmin.version', { version: row.version })}</Badge>
      ) : (
        <Badge tone="warning">{at('settingsAdmin.unpublished')}</Badge>
      )}
      {row.draft !== null && <Badge tone="warning">{at('settingsAdmin.draftPending')}</Badge>}
    </span>
  );

  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbs ?? [{ label: at('modules.store-settings.title'), to: '/admin/settings' }]}
        subtitle={subtitle}
        actions={
          canEdit && (
            <>
              {(dirty || row.draft !== null) && (
                <Button
                  variant="secondary"
                  icon={<GitCompare aria-hidden="true" />}
                  onClick={() => setReviewing(true)}
                >
                  {at('settingsAdmin.review')}
                </Button>
              )}
              {row.draft !== null && (
                <Button
                  variant="secondary"
                  icon={<Undo2 aria-hidden="true" />}
                  onClick={() =>
                    confirm.ask(
                      {
                        title: at('settingsAdmin.discardTitle'),
                        body: at('settingsAdmin.discardBody'),
                        confirmLabel: at('settingsAdmin.discard'),
                        tone: 'danger',
                      },
                      'discard',
                    )
                  }
                >
                  {at('settingsAdmin.discard')}
                </Button>
              )}
              <Button
                variant="secondary"
                icon={<Save aria-hidden="true" />}
                loading={saveDraft.pending}
                disabled={!dirty}
                onClick={async () => {
                  if (await doSave()) {
                    guard.allowNavigation();
                    onServerChange();
                  }
                }}
              >
                {at('settingsAdmin.saveDraft')}
              </Button>
              {row.canPublish && (
                <Button
                  icon={<Send aria-hidden="true" />}
                  disabled={!dirty && row.draft === null}
                  loading={publish.pending}
                  onClick={() => {
                    if (!validate()) return;
                    confirm.ask(
                      {
                        title: at('settingsAdmin.publishTitle', { name: title }),
                        body: row.isPublic
                          ? at('settingsAdmin.publishPublicBody')
                          : at('settingsAdmin.publishPrivateBody'),
                        confirmLabel: at('settingsAdmin.publish'),
                        reason: 'optional',
                      },
                      'publish',
                    );
                  }}
                >
                  {at('settingsAdmin.publish')}
                </Button>
              )}
            </>
          )
        }
      />
      <div className={styles.stack}>
        <div className={styles.panel}>
          <div className={styles.stack}>
            {status}
            <p className={styles.small}>
              {row.version !== null
                ? at('settingsAdmin.publishedInfo', {
                    version: row.version,
                    date: row.publishedAt ? format.dateTime(row.publishedAt) : '—',
                    name: row.publishedBy ?? '—',
                  })
                : at('settingsAdmin.defaultsInfo')}
              {row.draft !== null &&
                ` · ${at('settingsAdmin.draftInfo', {
                  date: row.draftUpdatedAt ? format.dateTime(row.draftUpdatedAt) : '—',
                  name: row.draftBy ?? '—',
                })}`}
            </p>
          </div>
        </div>
        {!canEdit && <Alert tone="info">{at('settingsAdmin.readOnly')}</Alert>}
        {canEdit && !row.canPublish && <Alert tone="info">{at('settingsAdmin.noPublish')}</Alert>}
        {staleDraft && <Alert tone="warning">{at('settingsAdmin.staleDraft')}</Alert>}
        {conflict && (
          <Alert
            tone="warning"
            live
            action={
              row.canPublish && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    confirm.ask(
                      {
                        title: at('settingsAdmin.forceTitle'),
                        body: at('settingsAdmin.forceBody'),
                        confirmLabel: at('settingsAdmin.forcePublish'),
                        tone: 'danger',
                        reason: 'required',
                      },
                      'force',
                    )
                  }
                >
                  {at('settingsAdmin.forcePublish')}
                </Button>
              )
            }
          >
            {at('settingsAdmin.conflict')}
          </Alert>
        )}
        {saveDraft.code === 'draft_conflict' && (
          <Alert tone="warning" live>
            <strong>{at('ui.staleTitle')}</strong> {at('settingsAdmin.draftChanged')}
          </Alert>
        )}
        {(saveDraft.error || publish.error || discard.error) &&
          saveDraft.code !== 'draft_conflict' &&
          !conflict && (
            <Alert tone="danger" live>
              {saveDraft.error ?? publish.error ?? discard.error}
            </Alert>
          )}
        {Object.keys(issues).length > 0 && (
          <Alert tone="danger" live>
            {at('schemaForm.fixErrors', { count: Object.keys(issues).length })}
          </Alert>
        )}
        <div className={aside ? styles.split : styles.stack}>
          <form
            className={styles.stack}
            onSubmit={(e) => {
              e.preventDefault();
              void doSave().then((ok) => {
                if (ok) {
                  guard.allowNavigation();
                  onServerChange();
                }
              });
            }}
          >
            {renderForm ? (
              renderForm({ value, onChange: setValue, issues, disabled: !canEdit })
            ) : (
              <div className={styles.panel}>
                <fieldset
                  className={styles.formGrid}
                  disabled={!canEdit}
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <legend className="visually-hidden">{title}</legend>
                  <SchemaForm
                    schema={schema}
                    value={value}
                    onChange={setValue}
                    rootKey={settingKey}
                    ctx={{ ...fieldText, issues, disabled: !canEdit }}
                  />
                </fieldset>
              </div>
            )}
          </form>
          {aside && <div className={styles.stack}>{aside(value)}</div>}
        </div>
        <VersionsPanel
          row={row}
          settingKey={settingKey}
          title={title}
          onRestored={() => {
            guard.allowNavigation();
            onServerChange();
          }}
        />
      </div>
      {canEdit && (
        <DirtyBar
          dirty={dirty}
          saving={saveDraft.pending}
          saveLabel={at('settingsAdmin.saveDraft')}
          onSave={() =>
            void doSave().then((ok) => {
              if (ok) {
                guard.allowNavigation();
                onServerChange();
              }
            })
          }
          onDiscard={() => {
            setValue(initial);
            setIssues({});
          }}
        />
      )}
      {reviewing && (
        <Dialog
          open
          wide
          icon={null}
          onClose={() => setReviewing(false)}
          title={at('settingsAdmin.reviewTitle', { name: title })}
        >
          <p className={styles.small}>{at('settingsAdmin.reviewHint')}</p>
          <DiffTable
            caption={at('settingsAdmin.reviewTitle', { name: title })}
            entries={jsonDiff(row.published ?? {}, value)}
          />
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => setReviewing(false)}>
              {at('ui.close')}
            </Button>
          </div>
        </Dialog>
      )}
      <UnsavedChangesDialog blocker={guard.blocker} />
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={publish.pending || discard.pending || saveDraft.pending}
        onCancel={confirm.close}
        onConfirm={async (reason) => {
          if (confirm.payload === 'discard') {
            const r = await discard.run();
            confirm.close();
            if (r?.ok) {
              guard.allowNavigation();
              onServerChange();
            }
          } else void runPublish(reason, confirm.payload === 'force');
        }}
      />
    </>
  );
}

function VersionsPanel({
  row,
  settingKey,
  title,
  onRestored,
}: {
  row: SettingOverview;
  settingKey: SettingKey;
  title: string;
  onRestored: () => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const repo = useAdminRepo();
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState<SettingVersion | null>(null);
  const confirm = useConfirm<SettingVersion>();
  const versions = useQuery({
    queryKey: ['admin', 'setting-versions', settingKey],
    queryFn: () => repo.settingVersions(settingKey, 25),
    enabled: open,
  });
  const restore = useAdminAction((version: number, note: string | null) =>
    repo.rollbackSetting(settingKey, version, note),
  );
  return (
    <Panel
      title={at('settingsAdmin.versions')}
      icon={<History aria-hidden="true" />}
      actions={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? at('ui.close') : at('settingsAdmin.showVersions')}
        </Button>
      }
    >
      {open && (
        <QueryState
          query={versions}
          isEmpty={(d) => d.length === 0}
          empty={at('settingsAdmin.noVersions')}
        >
          {(list) => (
            <ol className={styles.pickList}>
              {list.map((v) => (
                <li key={v.version}>
                  <span className={styles.cellTitle}>
                    <strong>
                      {at('settingsAdmin.version', { version: v.version })}
                      {v.version === row.version && ` · ${at('settingsAdmin.current')}`}
                    </strong>
                    <span className={styles.small}>
                      {format.dateTime(v.publishedAt)} · {v.publishedBy ?? '—'}
                    </span>
                    {v.note && <span className={styles.small}>{v.note}</span>}
                  </span>
                  <span className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<GitCompare aria-hidden="true" />}
                      onClick={() => setCompare(v)}
                    >
                      {at('settingsAdmin.compare')}
                    </Button>
                    {row.canPublish && v.version !== row.version && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw aria-hidden="true" />}
                        onClick={() =>
                          confirm.ask(
                            {
                              title: at('settingsAdmin.restoreTitle', { version: v.version }),
                              body: at('settingsAdmin.restoreBody'),
                              confirmLabel: at('settingsAdmin.restore'),
                              reason: 'optional',
                            },
                            v,
                          )
                        }
                      >
                        {at('settingsAdmin.restore')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      )}
      {compare && (
        <Dialog
          open
          wide
          icon={null}
          onClose={() => setCompare(null)}
          title={at('settingsAdmin.compareTitle', { version: compare.version })}
        >
          <p className={styles.small}>{at('settingsAdmin.compareHint')}</p>
          <DiffTable
            caption={`${title} · ${at('settingsAdmin.compareTitle', { version: compare.version })}`}
            entries={jsonDiff(compare.value, row.published ?? {})}
          />
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => setCompare(null)}>
              {at('ui.close')}
            </Button>
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={restore.pending}
        error={restore.error}
        onCancel={confirm.close}
        onConfirm={async (reason) => {
          if (!confirm.payload) return;
          const r = await restore.run(confirm.payload.version, reason || null);
          if (r?.ok) {
            confirm.close();
            onRestored();
          }
        }}
      />
    </Panel>
  );
}
