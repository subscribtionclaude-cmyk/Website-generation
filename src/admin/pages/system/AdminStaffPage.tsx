import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AccountLookup, AdminRole, StaffMember } from '@/domain/admin/schemas';
import { resolveLocalized } from '@/domain/localized';
import { useAccess, useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { InputField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';

type Pending =
  | {
      kind: 'role';
      member: StaffMember | { id: string; name: string | null; email: string | null };
      from: string | null;
      to: string;
    }
  | { kind: 'suspend' | 'reactivate'; member: StaffMember };

/**
 * Staff accounts: roles, suspension and access review. There are no passwords here — people sign
 * in with their own account (created by themselves), and an owner/admin grants a role to it.
 */
export function AdminStaffPage() {
  const { at } = useAdminI18n();
  const { locale, format } = useI18n();
  const { can, access } = useAccess();
  const session = useSession();
  const repo = useAdminRepo();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<{ q: string | null; status: 'active' | 'suspended' | null }>(
    {
      q: null,
      status: null,
    },
  );
  const [roleFor, setRoleFor] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm<Pending>();
  const staff = useQuery({
    queryKey: ['admin', 'staff', filter],
    queryFn: () => repo.listStaff(filter),
    placeholderData: (prev) => prev,
  });
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => repo.listRoles() });
  const changeRole = useAdminAction((userId: string, from: string | null, to: string) =>
    repo.changeStaffRole(userId, from, to),
  );
  const suspend = useAdminAction((userId: string, on: boolean, reason: string | null) =>
    repo.setStaffSuspended(userId, on, reason),
  );
  const myRank = Math.max(0, ...(access?.roles ?? []).map((r) => r.rank));
  const isOwner = access?.grantsAll === true;
  const canManageRoles = can('roles.manage');
  const canManageUsers = can('users.manage');
  const grantable = (roles.data ?? []).filter((r) =>
    r.grantsAll ? isOwner : isOwner || r.rank < myRank,
  );
  const outranks = (m: StaffMember) => isOwner || m.rank < myRank;
  const roleName = (r: { name: Parameters<typeof resolveLocalized>[0] }) =>
    resolveLocalized(r.name, locale);

  const columns: Column<StaffMember>[] = [
    {
      id: 'name',
      header: at('staffAdmin.col.member'),
      rowHeader: true,
      cell: (m) => (
        <span className={styles.cellTitle}>
          <span>
            {m.name ?? '—'}
            {m.id === session?.userId && ` (${at('staffAdmin.you')})`}
          </span>
          {m.email && (
            <bdi dir="ltr" className={styles.small}>
              {m.email}
            </bdi>
          )}
        </span>
      ),
    },
    {
      id: 'roles',
      header: at('staffAdmin.col.roles'),
      cell: (m) => (
        <span className={styles.chips}>
          {m.roles.map((r) => (
            <Badge key={r.key} tone="brand">
              {roleName(r)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: 'status',
      header: at('staffAdmin.col.status'),
      cell: (m) =>
        m.status === 'active' ? (
          <Badge tone="success">{at('staffAdmin.active')}</Badge>
        ) : (
          <span className={styles.cellTitle}>
            <Badge tone="danger">{at('staffAdmin.suspended')}</Badge>
            {m.suspensionReason && <span className={styles.small}>{m.suspensionReason}</span>}
          </span>
        ),
    },
    {
      id: 'active',
      header: at('staffAdmin.col.lastActive'),
      className: styles.nowrap,
      cell: (m) => (m.lastActiveAt ? format.dateTime(m.lastActiveAt) : '—'),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: (m) =>
        m.id !== session?.userId &&
        outranks(m) && (
          <span className={styles.rowActions}>
            {canManageRoles && (
              <Button size="sm" variant="secondary" onClick={() => setRoleFor(m)}>
                <span>
                  {at('staffAdmin.changeRole')}
                  <span className="visually-hidden">: {m.name ?? m.email}</span>
                </span>
              </Button>
            )}
            {canManageUsers && (
              <Button
                size="sm"
                variant={m.status === 'active' ? 'danger' : 'secondary'}
                onClick={() =>
                  confirm.ask(
                    m.status === 'active'
                      ? {
                          title: at('staffAdmin.suspendTitle'),
                          body: at('staffAdmin.suspendBody'),
                          affected: [m.name ?? m.email ?? m.id],
                          confirmLabel: at('staffAdmin.suspend'),
                          tone: 'danger',
                          reason: 'required',
                        }
                      : {
                          title: at('staffAdmin.reactivateTitle'),
                          affected: [m.name ?? m.email ?? m.id],
                          confirmLabel: at('staffAdmin.reactivate'),
                        },
                    { kind: m.status === 'active' ? 'suspend' : 'reactivate', member: m },
                  )
                }
              >
                <span>
                  {m.status === 'active' ? at('staffAdmin.suspend') : at('staffAdmin.reactivate')}
                  <span className="visually-hidden">: {m.name ?? m.email}</span>
                </span>
              </Button>
            )}
          </span>
        ),
    },
  ];

  const error = changeRole.error ?? suspend.error;
  return (
    <>
      <PageHeader
        title={at('modules.staff.title')}
        subtitle={at('staffAdmin.subtitle')}
        actions={
          canManageRoles && (
            <Button icon={<UserPlus aria-hidden="true" />} onClick={() => setAdding(true)}>
              {at('staffAdmin.add')}
            </Button>
          )
        }
      />
      <div className={styles.stack}>
        <Alert tone="info">{at('staffAdmin.noPasswords')}</Alert>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('staffAdmin.filters')}
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ ...filter, q: q.trim() || null });
          }}
        >
          <InputField
            label={at('ui.search')}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SelectField
            label={at('staffAdmin.col.status')}
            value={filter.status ?? ''}
            onChange={(e) =>
              setFilter({ ...filter, status: (e.target.value || null) as typeof filter.status })
            }
            options={[
              { value: '', label: at('ui.all') },
              { value: 'active', label: at('staffAdmin.active') },
              { value: 'suspended', label: at('staffAdmin.suspended') },
            ]}
          />
          <div className={styles.filterActions}>
            <Button type="submit" icon={<Search aria-hidden="true" />}>
              {at('ui.apply')}
            </Button>
          </div>
        </form>
        {error && (
          <Alert tone="danger" live>
            {error}
          </Alert>
        )}
        <QueryState query={staff} isEmpty={(d) => d.length === 0}>
          {(list) => (
            <DataTable
              caption={at('modules.staff.title')}
              rows={list}
              rowKey={(m) => m.id}
              columns={columns}
            />
          )}
        </QueryState>
      </div>

      {roleFor && (
        <RoleDialog
          title={at('staffAdmin.changeRoleFor', { name: roleFor.name ?? roleFor.email ?? '' })}
          current={roleFor.roles.map((r) => r.key)}
          roles={grantable}
          onClose={() => setRoleFor(null)}
          onPick={(from, to) => {
            confirm.ask(
              {
                title: at('staffAdmin.confirmRoleTitle'),
                body: at('staffAdmin.confirmRoleBody'),
                affected: [roleFor.name ?? roleFor.email ?? roleFor.id],
                confirmLabel: at('ui.confirm'),
                tone: 'danger',
              },
              { kind: 'role', member: roleFor, from, to },
            );
            setRoleFor(null);
          }}
        />
      )}
      {adding && (
        <AddStaffDialog
          roles={grantable}
          onClose={() => setAdding(false)}
          onPick={(account, to) => {
            confirm.ask(
              {
                title: at('staffAdmin.confirmRoleTitle'),
                body: at('staffAdmin.confirmAddBody'),
                affected: [account.name ?? account.email ?? account.id],
                confirmLabel: at('ui.confirm'),
                tone: 'danger',
              },
              {
                kind: 'role',
                member: { id: account.id, name: account.name, email: account.email },
                from: account.roles[0] ?? null,
                to,
              },
            );
            setAdding(false);
          }}
        />
      )}
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={changeRole.pending || suspend.pending}
        error={error}
        onCancel={confirm.close}
        onConfirm={async (reason) => {
          const p = confirm.payload;
          if (!p) return;
          const r =
            p.kind === 'role'
              ? await changeRole.run(p.member.id, p.from, p.to)
              : await suspend.run(p.member.id, p.kind === 'suspend', reason || null);
          if (r?.ok) confirm.close();
        }}
      />
    </>
  );
}

function RoleDialog({
  title,
  current,
  roles,
  onClose,
  onPick,
}: {
  title: string;
  current: string[];
  roles: AdminRole[];
  onClose: () => void;
  onPick: (from: string | null, to: string) => void;
}) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const [from, setFrom] = useState<string>(current[0] ?? '');
  const [to, setTo] = useState<string>('');
  return (
    <Dialog open onClose={onClose} title={title} icon={null}>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (to) onPick(from || null, to);
        }}
      >
        {current.length > 1 && (
          <SelectField
            label={at('staffAdmin.replaceRole')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            options={current.map((k) => ({ value: k, label: k }))}
          />
        )}
        <SelectField
          label={at('staffAdmin.newRole')}
          value={to}
          required
          hint={at('staffAdmin.grantableHint')}
          onChange={(e) => setTo(e.target.value)}
          options={[
            { value: '', label: at('staffAdmin.pickRole') },
            ...roles
              .filter((r) => r.key !== from)
              .map((r) => ({ value: r.key, label: resolveLocalized(r.name, locale) })),
          ]}
        />
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" disabled={!to}>
            {at('ui.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddStaffDialog({
  roles,
  onClose,
  onPick,
}: {
  roles: AdminRole[];
  onClose: () => void;
  onPick: (account: Extract<AccountLookup, { found: true }>, role: string) => void;
}) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const repo = useAdminRepo();
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<AccountLookup | null>(null);
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={at('staffAdmin.add')} icon={null}>
      <div className={styles.stack}>
        <p className={styles.small}>{at('staffAdmin.addHint')}</p>
        <form
          className={styles.filters}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setResult(await repo.lookupAccount(email.trim()));
            } catch (err) {
              setError(errorText(err, true));
            } finally {
              setBusy(false);
            }
          }}
        >
          <InputField
            label={at('staffAdmin.email')}
            type="email"
            required
            ltr
            value={email}
            autoComplete="off"
            onChange={(e) => {
              setEmail(e.target.value);
              setResult(null);
            }}
          />
          <div className={styles.filterActions}>
            <Button type="submit" variant="secondary" loading={busy}>
              {at('staffAdmin.lookup')}
            </Button>
          </div>
        </form>
        {error && (
          <Alert tone="danger" live>
            {error}
          </Alert>
        )}
        {result && !result.found && (
          <Alert tone="warning" live>
            {at('staffAdmin.notFound')}
          </Alert>
        )}
        {result?.found && (
          <Panel title={result.name ?? result.email ?? result.id}>
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault();
                if (role) onPick(result, role);
              }}
            >
              <p className={styles.small}>
                {result.roles.length > 0
                  ? at('staffAdmin.hasRoles', { roles: result.roles.join(', ') })
                  : at('staffAdmin.noRoles')}
              </p>
              <SelectField
                label={at('staffAdmin.newRole')}
                value={role}
                required
                hint={at('staffAdmin.grantableHint')}
                onChange={(e) => setRole(e.target.value)}
                options={[
                  { value: '', label: at('staffAdmin.pickRole') },
                  ...roles.map((r) => ({ value: r.key, label: resolveLocalized(r.name, locale) })),
                ]}
              />
              <div className={styles.dialogActions}>
                <Button variant="secondary" onClick={onClose}>
                  {at('ui.cancel')}
                </Button>
                <Button type="submit" disabled={!role}>
                  {at('staffAdmin.grant')}
                </Button>
              </div>
            </form>
          </Panel>
        )}
      </div>
    </Dialog>
  );
}
