import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  ClipboardList,
  Lock,
  MapPin,
  Pencil,
  Pin,
  Star,
  Trash2,
  User,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { CustomerDetail, CustomerNote } from '@/domain/admin/schemas';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { OrderStatusBadge } from '@/storefront/commerce/CommerceParts';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, TextareaField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel, StatTile } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';
import type { OrderStatus } from '@/domain/commerce/types';

const SERVICE_PATH: Record<string, string> = {
  repair: 'repairs',
  trade_in: 'trade-in',
  used: 'used-requests',
  after_sales: 'after-sales',
};

/** Customer profile, addresses, orders, requests, reviews, notifications and private CRM notes. */
export function AdminCustomerDetailPage() {
  const { customerId = '' } = useParams();
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const customer = useQuery({
    queryKey: ['admin', 'customer', customerId],
    queryFn: () => repo.getCustomer(customerId),
  });
  return (
    <QueryState query={customer}>
      {(c) =>
        c === null ? (
          <>
            <PageHeader
              title={at('modules.customers.title')}
              crumbs={[{ label: at('modules.customers.title'), to: '/admin/customers' }]}
            />
            <Alert tone="warning">{at('ui.deletedElsewhere')}</Alert>
          </>
        ) : (
          <CustomerView customer={c} />
        )
      }
    </QueryState>
  );
}

function CustomerView({ customer: c }: { customer: CustomerDetail }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const loc = useLocalized();
  const title = c.name ?? c.email ?? at('customers.unnamed');
  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: at('modules.customers.title'), to: '/admin/customers' }]}
        subtitle={at('customers.detailSubtitle')}
      />
      <div className={styles.stack}>
        <div className={styles.tiles}>
          <StatTile
            label={at('customers.col.orders')}
            value={format.number(c.stats.ordersCount)}
            icon={<ClipboardList aria-hidden="true" />}
            to={can('orders.view') ? `/admin/orders?customer=${c.id}` : undefined}
          />
          <StatTile
            label={at('customers.col.ltv')}
            value={format.money(c.stats.lifetimeValue, { fractionDigits: 0 })}
            hint={at('customers.ltvHint')}
          />
          <StatTile
            label={at('customers.col.lastOrder')}
            value={c.stats.lastOrderAt ? format.date(c.stats.lastOrderAt) : '—'}
          />
          <StatTile
            label={at('customers.col.openRequests')}
            value={format.number(c.stats.openRequests)}
          />
          <StatTile
            label={at('customers.col.wishlist')}
            value={format.number(c.stats.wishlistCount)}
          />
        </div>
        <div className={styles.split}>
          <div className={styles.stack}>
            <Panel title={at('customers.profile')} icon={<User aria-hidden="true" />}>
              <dl className={styles.formGrid} style={{ margin: 0 }}>
                <Item label={at('customers.col.customer')}>{c.name ?? '—'}</Item>
                <Item label={at('customers.email')}>
                  {c.email ? <bdi dir="ltr">{c.email}</bdi> : '—'}
                </Item>
                <Item label={at('customers.col.phone')}>
                  {c.phone ? <bdi dir="ltr">{c.phone}</bdi> : '—'}
                </Item>
                <Item label={at('customers.language')}>
                  {c.preferredLocale === 'en' ? 'English' : 'العربية'}
                </Item>
                <Item label={at('customers.col.joined')}>
                  {c.joinedAt ? format.date(c.joinedAt) : '—'}
                </Item>
                <Item label={at('customers.lastSignIn')}>
                  {c.lastSignInAt ? format.dateTime(c.lastSignInAt) : '—'}
                </Item>
              </dl>
              <p
                className={`${styles.small} ${styles.muted}`}
                style={{ marginBlockStart: 'var(--space-3)' }}
              >
                <Lock
                  aria-hidden="true"
                  style={{ width: '0.9rem', height: '0.9rem', verticalAlign: 'middle' }}
                />{' '}
                {at('customers.noSecrets')}
              </p>
            </Panel>
            {c.orders && (
              <Panel
                title={at('customers.orders', { count: c.orders.length })}
                icon={<ClipboardList aria-hidden="true" />}
              >
                {c.orders.length === 0 ? (
                  <p className={styles.muted}>{at('ui.none')}</p>
                ) : (
                  <ul
                    className={styles.stack}
                    style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}
                  >
                    {c.orders.map((o) => (
                      <li key={o.id} className={styles.chips} style={{ alignItems: 'center' }}>
                        <Link to={`/admin/orders/${o.id}`}>
                          <bdi dir="ltr">{o.orderNumber}</bdi>
                        </Link>
                        <OrderStatusBadge status={o.status as OrderStatus} />
                        <span className={styles.small}>
                          {format.money(o.total, { fractionDigits: 0 })} ·{' '}
                          {format.date(o.createdAt)}
                        </span>
                        {o.isDemo && <Badge>{at('ui.demo')}</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            <Panel title={at('customers.requests')} icon={<Wrench aria-hidden="true" />}>
              {c.serviceRequests.length === 0 ? (
                <p className={styles.muted}>{at('ui.none')}</p>
              ) : (
                <ul
                  className={styles.stack}
                  style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}
                >
                  {c.serviceRequests.map((r) => (
                    <li key={r.id} className={styles.chips}>
                      <Link to={`/admin/${SERVICE_PATH[r.kind] ?? 'repairs'}/${r.id}`}>
                        <bdi dir="ltr">{r.number}</bdi>
                      </Link>
                      <span>{loc(r.title)}</span>
                      <Badge>{r.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={at('customers.addresses')} icon={<MapPin aria-hidden="true" />}>
              {c.addresses.length === 0 ? (
                <p className={styles.muted}>{at('ui.none')}</p>
              ) : (
                <ul
                  className={styles.stack}
                  style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}
                >
                  {c.addresses.map((a) => (
                    <li key={a.id}>
                      <strong>{a.label ?? a.governorate}</strong>{' '}
                      {a.isDefault && <Badge tone="brand">{at('customers.defaultAddress')}</Badge>}
                      <br />
                      <span className={styles.small}>
                        {a.governorate} · {a.area} · {a.address}
                        {a.phone && (
                          <>
                            {' · '}
                            <bdi dir="ltr">{a.phone}</bdi>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={at('customers.reviews')} icon={<Star aria-hidden="true" />}>
              {c.reviews.length === 0 ? (
                <p className={styles.muted}>{at('ui.none')}</p>
              ) : (
                <ul
                  className={styles.stack}
                  style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}
                >
                  {c.reviews.map((r) => (
                    <li key={r.id} className={styles.chips}>
                      <span>{'★'.repeat(r.rating)}</span>
                      <span>{r.product ? loc(r.product.name) : '—'}</span>
                      <Badge>{at(`customers.reviewStatus.${r.status}` as AdminMessageKey)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={at('customers.notifications')} icon={<Bell aria-hidden="true" />}>
              {c.notifications.length === 0 ? (
                <p className={styles.muted}>{at('ui.none')}</p>
              ) : (
                <ul
                  className={styles.stack}
                  style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-1)' }}
                >
                  {c.notifications.map((n) => (
                    <li key={n.id} className={styles.small}>
                      {loc(n.title)}{' '}
                      <span className={styles.muted}>
                        · {format.dateTime(n.createdAt)} ·{' '}
                        {n.read ? at('customers.read') : at('customers.unread')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <div className={styles.stack}>
            <NotesPanel customer={c} />
            <Panel title={at('customers.activity')}>
              <dl className={styles.stack} style={{ margin: 0, gap: 'var(--space-2)' }}>
                <Item label={at('customers.cartItems')}>{format.number(c.activity.cartItems)}</Item>
                <Item label={at('customers.recentlyViewed')}>
                  {format.number(c.activity.recentlyViewed)}
                </Item>
                <Item label={at('customers.followUp')}>
                  {c.activity.followUp
                    ? at(`carts.state.${c.activity.followUp.state}` as AdminMessageKey)
                    : '—'}
                </Item>
              </dl>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}

/** Internal CRM notes: staff only, audited, never shown to the customer. */
function NotesPanel({ customer }: { customer: CustomerDetail }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<CustomerNote | null>(null);
  const confirm = useConfirm<CustomerNote>();
  const save = useAdminAction(
    () =>
      repo.saveCustomerNote(
        customer.id,
        editing?.id ?? null,
        body,
        pinned,
        editing?.updatedAt ?? null,
      ),
    {
      onSuccess: () => {
        setBody('');
        setPinned(false);
        setEditing(null);
      },
    },
  );
  const remove = useAdminAction((id: string) => repo.deleteCustomerNote(id));
  const canManage = can('customers.manage');
  return (
    <Panel title={at('customers.notes')} icon={<Lock aria-hidden="true" />}>
      <Alert tone="info">{at('customers.notesPrivate')}</Alert>
      {canManage && (
        <form
          className={styles.stack}
          style={{ marginBlock: 'var(--space-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            void save.run();
          }}
        >
          <TextareaField
            label={editing ? at('customers.editNote') : at('customers.newNote')}
            value={body}
            onChange={setBody}
            maxLength={4000}
            required
            rows={3}
          />
          <CheckboxField label={at('customers.pin')} checked={pinned} onChange={setPinned} />
          {save.error && (
            <Alert tone="danger" live>
              {save.error}
            </Alert>
          )}
          <div className={styles.actions}>
            {editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setBody('');
                  setPinned(false);
                }}
              >
                {at('ui.cancel')}
              </Button>
            )}
            <Button type="submit" loading={save.pending} disabled={!body.trim()}>
              {at('ui.save')}
            </Button>
          </div>
        </form>
      )}
      {remove.error && (
        <Alert tone="danger" live>
          {remove.error}
        </Alert>
      )}
      {customer.notes.length === 0 ? (
        <p className={styles.muted}>{at('customers.noNotes')}</p>
      ) : (
        <ul
          className={styles.stack}
          style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}
        >
          {customer.notes.map((n) => (
            <li key={n.id} className={styles.repeat}>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{n.body}</p>
              <span className={`${styles.small} ${styles.muted}`}>
                {n.isPinned && (
                  <Pin
                    aria-label={at('customers.pinned')}
                    style={{ width: '0.9rem', height: '0.9rem' }}
                  />
                )}{' '}
                {n.authorName ?? '—'} · {format.dateTime(n.updatedAt)}
              </span>
              {canManage && (
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={at('customers.editNote')}
                    onClick={() => {
                      setEditing(n);
                      setBody(n.body);
                      setPinned(n.isPinned);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={at('customers.deleteNote')}
                    onClick={() =>
                      confirm.ask(
                        {
                          title: at('customers.deleteNote'),
                          body: n.body.slice(0, 200),
                          confirmLabel: at('ui.delete'),
                          tone: 'danger',
                        },
                        n,
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={remove.pending}
        onCancel={confirm.close}
        onConfirm={async () => {
          if (confirm.payload) await remove.run(confirm.payload.id);
          confirm.close();
        }}
      />
    </Panel>
  );
}
