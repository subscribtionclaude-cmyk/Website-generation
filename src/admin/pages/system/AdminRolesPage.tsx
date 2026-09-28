import { useQuery } from '@tanstack/react-query';
import { Check, Minus, Pencil } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_MODULES,
  type PermissionKey,
} from '@/domain/access/permissions';
import type { AdminRole } from '@/domain/admin/schemas';
import { resolveLocalized } from '@/domain/localized';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { CheckboxField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../admin.module.css';
import ui from '../../ui/adminUi.module.css';

/**
 * Role × permission matrix with per-role editing. The database refuses edits to roles at or above
 * the editor's own level and grants of permissions the editor does not hold; the UI mirrors
 * those rules so nobody is offered a change that would be refused.
 */
export function AdminRolesPage() {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const repo = useAdminRepo();
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => repo.listRoles() });
  return (
    <>
      <PageHeader title={at('roles.title')} subtitle={at('roles.subtitle')} />
      <div className={ui.stack}>
        <Alert tone="info">{at('roles.readOnlyNote')}</Alert>
        <QueryState query={roles}>
          {(list) => (
            <>
              <ul className={ui.pickList} aria-label={at('rolesAdmin.list')}>
                {list.map((role) => (
                  <li key={role.key}>
                    <span className={ui.cellTitle}>
                      <strong>{resolveLocalized(role.name, locale)}</strong>
                      <span className={ui.small}>
                        {at('roles.rank', { rank: role.rank })} ·{' '}
                        {role.grantsAll
                          ? at('roles.allPermissions')
                          : at('rolesAdmin.count', { count: role.permissions.length })}{' '}
                        · {at('rolesAdmin.users', { count: role.users.length })}
                      </span>
                    </span>
                    {role.editable ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Pencil aria-hidden="true" />}
                        onClick={() => setEditing(role)}
                      >
                        <span>
                          {at('rolesAdmin.edit')}
                          <span className="visually-hidden">
                            : {resolveLocalized(role.name, locale)}
                          </span>
                        </span>
                      </Button>
                    ) : (
                      <Badge>
                        {role.grantsAll ? at('rolesAdmin.ownerLocked') : at('rolesAdmin.locked')}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
              <Matrix roles={list} />
            </>
          )}
        </QueryState>
      </div>
      {editing && <RoleEditor key={editing.key} role={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Matrix({ roles }: { roles: AdminRole[] }) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  return (
    <div
      className={styles.tableWrap}
      role="region"
      aria-label={at('roles.title')}
      // A scrollable region must be keyboard-focusable so the matrix can be scrolled without a mouse.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption className="visually-hidden">{at('roles.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{at('roles.permission')}</th>
            {roles.map((role) => (
              <th key={role.key} scope="col">
                <span className={styles.roleHead}>
                  {resolveLocalized(role.name, locale)}
                  <span className={styles.roleRank}>{at('roles.rank', { rank: role.rank })}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MODULES.map((module) => (
            <Fragment key={module}>
              <tr className={styles.moduleRow}>
                <th scope="colgroup" colSpan={roles.length + 1}>
                  {at(`permissionModules.${module}` as AdminMessageKey)}
                </th>
              </tr>
              {PERMISSION_DEFINITIONS.filter((p) => p.module === module).map((permission) => (
                <tr key={permission.key}>
                  <th scope="row">
                    {at(`permissions.${permission.key}` as AdminMessageKey)}{' '}
                    {permission.sensitive && <Badge tone="warning">{at('roles.sensitive')}</Badge>}
                    <span className={styles.permKey}>{permission.key}</span>
                  </th>
                  {roles.map((role) => {
                    const granted = role.grantsAll || role.permissions.includes(permission.key);
                    return (
                      <td key={role.key} className={granted ? styles.yes : styles.no}>
                        {granted ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
                        <span className="visually-hidden">
                          {granted ? at('roles.granted') : at('roles.notGranted')}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleEditor({ role, onClose }: { role: AdminRole; onClose: () => void }) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissions));
  const confirm = useConfirm();
  const save = useAdminAction((perms: string[]) => repo.setRolePermissions(role.key, perms), {
    onSuccess: onClose,
  });
  const added = [...selected].filter((p) => !role.permissions.includes(p));
  const removed = role.permissions.filter((p) => !selected.has(p));
  const label = (key: string) => at(`permissions.${key}` as AdminMessageKey);
  const name = resolveLocalized(role.name, locale);
  return (
    <Dialog open onClose={onClose} title={at('rolesAdmin.editTitle', { name })} wide icon={null}>
      <div className={ui.stack}>
        <p className={ui.small}>{at('rolesAdmin.editHint')}</p>
        {PERMISSION_MODULES.map((module) => (
          <fieldset key={module} className={ui.group}>
            <legend>{at(`permissionModules.${module}` as AdminMessageKey)}</legend>
            <div className={ui.chips}>
              {PERMISSION_DEFINITIONS.filter((p) => p.module === module).map((p) => {
                const holds = can(p.key as PermissionKey);
                return (
                  <CheckboxField
                    key={p.key}
                    label={
                      <>
                        {label(p.key)}
                        {p.sensitive && ` · ${at('roles.sensitive')}`}
                      </>
                    }
                    hint={holds ? undefined : at('rolesAdmin.notHeld')}
                    disabled={!holds}
                    checked={selected.has(p.key)}
                    onChange={(on) => {
                      const next = new Set(selected);
                      if (on) next.add(p.key);
                      else next.delete(p.key);
                      setSelected(next);
                    }}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}
        {save.error && (
          <Alert tone="danger" live>
            {save.error}
          </Alert>
        )}
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button
            disabled={added.length + removed.length === 0}
            onClick={() =>
              confirm.ask(
                {
                  title: at('rolesAdmin.confirmTitle', { name }),
                  body: at('rolesAdmin.confirmBody', {
                    count: role.users.length,
                  }),
                  affected: [
                    ...added.map((p) => `+ ${label(p)}`),
                    ...removed.map((p) => `− ${label(p)}`),
                  ],
                  confirmLabel: at('ui.save'),
                  tone: added.some(
                    (p) => PERMISSION_DEFINITIONS.find((d) => d.key === p)?.sensitive,
                  )
                    ? 'danger'
                    : 'default',
                },
                undefined,
              )
            }
          >
            {at('ui.save')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={save.pending}
        error={save.error}
        onCancel={confirm.close}
        onConfirm={async () => {
          const r = await save.run([...selected].sort());
          if (r?.ok) confirm.close();
        }}
      />
    </Dialog>
  );
}
