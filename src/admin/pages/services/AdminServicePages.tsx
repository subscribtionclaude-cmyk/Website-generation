import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextAreaField, TextField } from '@/components/ui/TextField';
import type { PermissionKey } from '@/domain/access/permissions';
import { resolveLocalized } from '@/domain/localized';
import { limitsFromSettings, tradeInDifference } from '@/domain/services/media';
import { isTerminal, staffStatusOptions } from '@/domain/services/status';
import {
  SERVICE_STATUSES,
  TAX_STATUSES,
  type ServiceActionResult,
  type ServiceKind,
  type ServiceOffer,
  type StaffServiceRequest,
  type TaxStatus,
} from '@/domain/services/types';
import { useAccess, useSession } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { MediaUploader } from '@/storefront/services/MediaUploader';
import { uploadsToMedia, type UploadItem } from '@/storefront/services/serviceHelpers';
import { MediaGallery, RequestSummary } from '@/storefront/services/ServiceDetailParts';
import { KIND_LABEL, statusLabelKey } from '@/storefront/services/serviceLabels';
import { StatusPill } from '@/storefront/services/ServiceParts';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { useAdminPageMeta } from '../../useAdminPageMeta';
import adminStyles from '../../admin.module.css';
import styles from '../orders/orders.module.css';

/** Admin module path for each service kind (matches ADMIN_MODULES). */
const SERVICE_MODULE_PATH: Record<ServiceKind, string> = {
  repair: 'repairs',
  trade_in: 'trade-in',
  used: 'used-requests',
  after_sales: 'after-sales',
};

const MANAGE_PERMISSION: Record<ServiceKind, PermissionKey> = {
  repair: 'repairs.manage',
  trade_in: 'tradein.manage',
  used: 'used_requests.manage',
  after_sales: 'after_sales.manage',
};

const RESULT_MESSAGE: Record<string, AdminMessageKey> = {
  closed: 'servicesAdmin.errors.closed',
  same_status: 'servicesAdmin.errors.same_status',
  invalid_status: 'servicesAdmin.errors.invalid_status',
  use_offer: 'servicesAdmin.errors.use_offer',
  approval_required: 'servicesAdmin.errors.approval_required',
  invalid_amount: 'servicesAdmin.errors.invalid_amount',
  invalid_device: 'servicesAdmin.errors.invalid_device',
  invalid_battery: 'servicesAdmin.errors.invalid_battery',
  message_required: 'servicesAdmin.errors.message_required',
  reason_required: 'servicesAdmin.errors.reason_required',
  already_decided: 'servicesAdmin.errors.already_decided',
  catalog_price_only: 'servicesAdmin.errors.catalog_price_only',
  target_price_unavailable: 'servicesAdmin.errors.target_price_unavailable',
  not_staff: 'servicesAdmin.errors.not_staff',
  not_found: 'servicesAdmin.errors.not_found',
  forbidden: 'servicesAdmin.errors.forbidden',
};

type Feedback = { tone: 'success' | 'danger'; key: AdminMessageKey } | null;

// ── List ────────────────────────────────────────────────────────────────────
export function AdminServiceListPage({ kind }: { kind: ServiceKind }) {
  const { at } = useAdminI18n();
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const title = at(`modules.${SERVICE_MODULE_PATH[kind]}.title` as AdminMessageKey);
  useAdminPageMeta(title);
  const [status, setStatus] = useState('open');
  const [assigned, setAssigned] = useState<'' | 'me' | 'unassigned'>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['admin-services', session?.userId ?? null, kind, status, assigned, search],
    queryFn: () =>
      repositories.serviceOps.list(kind, {
        status: status || null,
        assigned: assigned || null,
        q: search || null,
        limit: 50,
      }),
  });
  const base = `/admin/${SERVICE_MODULE_PATH[kind]}`;

  return (
    <>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>{title}</h1>
        <p className={adminStyles.pageSubtitle}>{at('servicesAdmin.subtitle')}</p>
      </div>
      <div className={adminStyles.stack}>
        <form
          className={styles.filters}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(q.trim());
          }}
        >
          <div className={styles.field}>
            <label className={adminStyles.label} htmlFor="svc-q">
              {at('servicesAdmin.search')}
            </label>
            <input
              id="svc-q"
              className={adminStyles.select}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="RP-2026-000001 / 010…"
              dir="ltr"
            />
          </div>
          <div className={styles.field}>
            <label className={adminStyles.label} htmlFor="svc-status">
              {at('servicesAdmin.status')}
            </label>
            <select
              id="svc-status"
              className={adminStyles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="open">{at('servicesAdmin.openOnly')}</option>
              <option value="">{at('servicesAdmin.allStatuses')}</option>
              {SERVICE_STATUSES[kind].map((s) => (
                <option key={s} value={s}>
                  {t(statusLabelKey(s))}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={adminStyles.label} htmlFor="svc-assigned">
              {at('servicesAdmin.assigned')}
            </label>
            <select
              id="svc-assigned"
              className={adminStyles.select}
              value={assigned}
              onChange={(e) => setAssigned(e.target.value as '' | 'me' | 'unassigned')}
            >
              <option value="">{at('servicesAdmin.assignedAny')}</option>
              <option value="me">{at('servicesAdmin.assignedMe')}</option>
              <option value="unassigned">{at('servicesAdmin.unassigned')}</option>
            </select>
          </div>
          <Button type="submit" variant="primary" icon={<Search aria-hidden="true" />}>
            {at('orders.apply')}
          </Button>
        </form>

        {list.isPending && <Skeleton height="20rem" radius="var(--radius-lg)" />}
        {list.isError && (
          <Alert
            tone="danger"
            live
            action={
              <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {at('errors.loadFailed')}
          </Alert>
        )}
        {list.data && list.data.items.length === 0 && (
          <Alert tone="info">{at('servicesAdmin.empty')}</Alert>
        )}
        {list.data && list.data.items.length > 0 && (
          <div
            className={adminStyles.tableWrap}
            role="region"
            aria-label={title}
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className={`${adminStyles.table} ${styles.table}`}>
              <caption className="visually-hidden">
                {at('servicesAdmin.count', { count: list.data.total })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{at('servicesAdmin.number')}</th>
                  <th scope="col">{at('orders.date')}</th>
                  <th scope="col">{at('orders.customer')}</th>
                  <th scope="col">{t('services.device')}</th>
                  <th scope="col">{at('servicesAdmin.status')}</th>
                  <th scope="col">{at('servicesAdmin.assigned')}</th>
                  <th scope="col">{at('orders.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link to={`${base}/${r.id}`} className={styles.orderLink}>
                        <bdi dir="ltr">{r.number}</bdi>
                      </Link>
                    </th>
                    <td>{format.dateTime(r.createdAt)}</td>
                    <td>
                      {r.contactName}
                      <br />
                      <bdi dir="ltr" className={adminStyles.muted}>
                        {r.contactPhone}
                      </bdi>
                    </td>
                    <td>{resolveLocalized(r.title, locale)}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td>{r.assignedTo?.name ?? at('servicesAdmin.unassigned')}</td>
                    <td>
                      <span className={styles.flags}>
                        {r.awaitingCustomer && (
                          <Badge tone="info">{at('servicesAdmin.flagAwaiting')}</Badge>
                        )}
                        {r.openOffer && (
                          <Badge tone="warning">{at('servicesAdmin.flagOffer')}</Badge>
                        )}
                        {r.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
export function AdminServiceDetailPage({ kind }: { kind: ServiceKind }) {
  const { requestId = '' } = useParams();
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const request = useQuery({
    queryKey: ['admin-service', session?.userId ?? null, requestId],
    queryFn: () => repositories.serviceOps.get(requestId),
  });
  useAdminPageMeta(
    request.data
      ? at('servicesAdmin.detailTitle', { number: request.data.number })
      : at(`modules.${SERVICE_MODULE_PATH[kind]}.title` as AdminMessageKey),
  );
  return (
    <>
      <Link to={`/admin/${SERVICE_MODULE_PATH[kind]}`} className={styles.back}>
        <ArrowLeft className="flip-rtl" aria-hidden="true" />
        {at('servicesAdmin.backToList')}
      </Link>
      {request.isPending && <Skeleton height="30rem" radius="var(--radius-lg)" />}
      {request.isError && (
        <Alert
          tone="danger"
          live
          action={
            <Button size="sm" variant="secondary" onClick={() => void request.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {at('errors.loadFailed')}
        </Alert>
      )}
      {(request.data === null || (request.data && request.data.kind !== kind)) && (
        <Alert tone="warning">{at('servicesAdmin.notFound')}</Alert>
      )}
      {request.data && request.data.kind === kind && <ServiceDetail request={request.data} />}
    </>
  );
}

function useServiceAction<TInput>(
  requestId: string,
  run: (input: TInput) => Promise<ServiceActionResult<StaffServiceRequest>>,
  onDone?: () => void,
) {
  const queryClient = useQueryClient();
  const session = useSession();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const mutation = useMutation({
    mutationFn: run,
    onMutate: () => setFeedback(null),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(
          ['admin-service', session?.userId ?? null, requestId],
          result.request,
        );
        void queryClient.invalidateQueries({ queryKey: ['admin-services'] });
        setFeedback({ tone: 'success', key: 'servicesAdmin.saved' });
        onDone?.();
      } else {
        setFeedback({
          tone: 'danger',
          key: RESULT_MESSAGE[result.code] ?? 'servicesAdmin.actionFailed',
        });
      }
    },
    onError: (error) => {
      const code = (error as { code?: string }).code;
      setFeedback({
        tone: 'danger',
        key: code === 'forbidden' ? 'servicesAdmin.errors.forbidden' : 'servicesAdmin.actionFailed',
      });
    },
  });
  return { mutation, feedback };
}

function ActionCard({
  title,
  children,
  feedback,
}: {
  title: string;
  children: ReactNode;
  feedback: Feedback;
}) {
  const { at } = useAdminI18n();
  return (
    <Card>
      <h2 className={adminStyles.sectionTitle}>{title}</h2>
      <div className={styles.actionBody}>
        {children}
        {feedback && (
          <Alert tone={feedback.tone} live>
            {at(feedback.key)}
          </Alert>
        )}
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={adminStyles.dlRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function submit(handler: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    handler();
  };
}

/** Parses a staff-entered EGP amount; null when empty or not a positive number. */
function parseAmount(value: string, allowZero = false): number | null {
  const n = Number(value.trim().replace(/,/g, ''));
  if (!value.trim() || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return Math.round(n * 100) / 100;
}

const OFFER_LABEL: Record<ServiceOffer['kind'], CoreMessageKey> = {
  repair_estimate: 'requestDetail.offerEstimate',
  repair_final: 'requestDetail.offerFinal',
  trade_in: 'requestDetail.offerTradeIn',
  used_proposal: 'requestDetail.offerUsed',
};

function ServiceDetail({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { t, format } = useI18n();
  const { can } = useAccess();
  const manage = can(MANAGE_PERMISSION[request.kind]);
  const closed = isTerminal(request.status);

  return (
    <div className={adminStyles.stack}>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>
          <bdi dir="ltr">{request.number}</bdi>
        </h1>
        <div className={styles.flags}>
          <Badge>{t(KIND_LABEL[request.kind])}</Badge>
          <StatusPill status={request.status} />
          {request.awaitingCustomer && (
            <Badge tone="info">{at('servicesAdmin.flagAwaiting')}</Badge>
          )}
          {request.kind === 'repair' && request.consultationRequired && (
            <Badge tone="warning">{t('repairs.consultation')}</Badge>
          )}
          {request.isDemo && <Badge>{at('orders.flagDemo')}</Badge>}
        </div>
      </div>

      <div className={styles.detailGrid}>
        <div className={adminStyles.stack}>
          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('servicesAdmin.customer')}</h2>
            <dl className={adminStyles.dl}>
              <Row label={at('orders.customer')}>
                {request.contact.name} · <bdi dir="ltr">{request.contact.phone}</bdi>
                {request.customerEmail && (
                  <>
                    {' · '}
                    <bdi dir="ltr">{request.customerEmail}</bdi>
                  </>
                )}
              </Row>
              <Row label={t('services.preferredContact')}>
                {request.preferredContact === 'whatsapp'
                  ? t('services.contactWhatsApp')
                  : t('services.contactPhone')}
              </Row>
              <Row label={at('orders.date')}>{format.dateTime(request.createdAt)}</Row>
              <Row label={at('servicesAdmin.assigned')}>
                {request.assignedTo?.name ?? at('servicesAdmin.unassigned')}
              </Row>
            </dl>
          </Card>

          <Card>
            <h2 className={adminStyles.sectionTitle}>{t('requestDetail.summary')}</h2>
            <RequestSummary request={request} />
            <MediaGallery items={request.media} />
          </Card>

          {request.offers.length > 0 && (
            <Card>
              <h2 className={adminStyles.sectionTitle}>{at('servicesAdmin.offers')}</h2>
              <ul className={styles.timeline}>
                {request.offers.map((o) => (
                  <li key={o.id}>
                    <strong>
                      {t(OFFER_LABEL[o.kind])} ·{' '}
                      {t(`requestDetail.offer_${o.status}` as CoreMessageKey)}
                      {o.expired && o.status === 'sent' && ` · ${t('requestDetail.offerExpired')}`}
                    </strong>
                    {o.kind === 'trade_in' ? (
                      <span>
                        {t('requestDetail.currentDeviceValue')}: {format.money(o.deviceValue ?? 0)}{' '}
                        · {t('requestDetail.targetPrice')}: {format.money(o.targetPrice ?? 0)} ·{' '}
                        {at('servicesAdmin.difference')}: {format.money(o.difference ?? 0)}
                      </span>
                    ) : (
                      <span>{format.money(o.amount ?? 0)}</span>
                    )}
                    {o.note && <span className={adminStyles.muted}>{o.note}</span>}
                    <span className={adminStyles.muted}>{format.dateTime(o.createdAt)}</span>
                    <MediaGallery items={o.media} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className={adminStyles.sectionTitle}>{at('servicesAdmin.timeline')}</h2>
            <ol className={styles.timeline}>
              {[...request.events].reverse().map((e) => (
                <li key={e.id}>
                  <strong>
                    {at(`servicesAdmin.event.${e.type}` as AdminMessageKey)}
                    {e.status && ` → ${t(statusLabelKey(e.status))}`}
                  </strong>
                  {e.message && <span dir="auto">{e.message}</span>}
                  <span className={adminStyles.muted}>
                    {format.dateTime(e.createdAt)} ·{' '}
                    {at(`servicesAdmin.actor.${e.actorKind}` as AdminMessageKey)} ·{' '}
                    {e.visibleToCustomer
                      ? at('servicesAdmin.visibleToCustomer')
                      : at('servicesAdmin.internalOnly')}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className={adminStyles.stack}>
          {!manage && <Alert tone="info">{at('servicesAdmin.readOnly')}</Alert>}
          {manage && closed && <Alert tone="info">{at('servicesAdmin.closedNote')}</Alert>}
          {manage && <AssignAction request={request} />}
          {manage && !closed && <StatusAction request={request} />}
          {manage && !closed && request.kind === 'repair' && (
            <RepairQuoteAction request={request} />
          )}
          {manage && !closed && request.kind === 'trade_in' && (
            <TradeInOfferAction request={request} />
          )}
          {manage && !closed && request.kind === 'used' && <UsedProposalAction request={request} />}
          {manage && !closed && request.kind === 'after_sales' && (
            <AfterSalesDecisionAction request={request} />
          )}
          {manage && !closed && <RequestInfoAction request={request} />}
          {manage && <NoteAction request={request} />}
        </div>
      </div>
    </div>
  );
}

function AssignAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [staffId, setStaffId] = useState(request.assignedTo?.id ?? '');
  const assignees = useQuery({
    queryKey: ['admin-service-assignees', request.kind],
    queryFn: () => repositories.serviceOps.assignees(request.kind),
    staleTime: 5 * 60_000,
  });
  const { mutation, feedback } = useServiceAction(request.id, (id: string | null) =>
    repositories.serviceOps.assign(request.id, id),
  );
  return (
    <ActionCard title={at('servicesAdmin.assignTitle')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(() => mutation.mutate(staffId || null))}>
        <div className={styles.field}>
          <label className={adminStyles.label} htmlFor="svc-assignee">
            {at('servicesAdmin.assigned')}
          </label>
          <select
            id="svc-assignee"
            className={adminStyles.select}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">{at('servicesAdmin.unassigned')}</option>
            {(assignees.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.buttons}>
          <Button type="submit" variant="secondary" loading={mutation.isPending}>
            {at('servicesAdmin.assign')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function StatusAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const options = staffStatusOptions(request.kind, request.status, request.afterSalesType);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const { mutation, feedback } = useServiceAction(
    request.id,
    (v: { status: string; note: string }) =>
      repositories.serviceOps.setStatus(request.id, v.status, v.note.trim() || null),
    () => {
      setStatus('');
      setNote('');
    },
  );
  if (options.length === 0) return null;
  return (
    <ActionCard title={at('servicesAdmin.statusTitle')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(() => status && mutation.mutate({ status, note }))}
      >
        <div className={styles.field}>
          <label className={adminStyles.label} htmlFor="svc-next">
            {at('servicesAdmin.nextStatus')}
          </label>
          <select
            id="svc-next"
            className={adminStyles.select}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{at('servicesAdmin.chooseStatus')}</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {t(statusLabelKey(s))}
              </option>
            ))}
          </select>
        </div>
        <TextAreaField
          label={at('servicesAdmin.customerMessage')}
          hint={at('servicesAdmin.customerMessageHint')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" disabled={!status} loading={mutation.isPending}>
            {at('servicesAdmin.updateStatus')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function NoteAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const { mutation, feedback } = useServiceAction(
    request.id,
    (v: { message: string; visible: boolean }) =>
      repositories.serviceOps.addNote(request.id, v.message, v.visible),
    () => setMessage(''),
  );
  return (
    <ActionCard title={at('servicesAdmin.noteTitle')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(
          () => message.trim() && mutation.mutate({ message: message.trim(), visible }),
        )}
      >
        <TextAreaField
          label={at('servicesAdmin.noteLabel')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={2000}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          {at('servicesAdmin.noteVisible')}
        </label>
        <div className={styles.buttons}>
          <Button
            type="submit"
            variant="secondary"
            disabled={!message.trim()}
            loading={mutation.isPending}
          >
            {visible ? at('servicesAdmin.postUpdate') : at('servicesAdmin.addNote')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function RequestInfoAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [message, setMessage] = useState('');
  const { mutation, feedback } = useServiceAction(
    request.id,
    (m: string) => repositories.serviceOps.requestInfo(request.id, m),
    () => setMessage(''),
  );
  return (
    <ActionCard title={at('servicesAdmin.infoTitle')} feedback={feedback}>
      <form
        className={styles.actionBody}
        onSubmit={submit(() => message.trim() && mutation.mutate(message.trim()))}
      >
        <TextAreaField
          label={at('servicesAdmin.infoLabel')}
          hint={at('servicesAdmin.infoHint')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <div className={styles.buttons}>
          <Button
            type="submit"
            variant="secondary"
            disabled={!message.trim()}
            loading={mutation.isPending}
          >
            {at('servicesAdmin.sendInfoRequest')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function RepairQuoteAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [quoteKind, setQuoteKind] = useState<'estimate' | 'final'>('estimate');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { mutation, feedback } = useServiceAction(
    request.id,
    (v: { amount: number }) =>
      repositories.serviceOps.sendRepairQuote(request.id, quoteKind, v.amount, note.trim() || null),
    () => {
      setAmount('');
      setNote('');
    },
  );
  const send = () => {
    const value = parseAmount(amount);
    if (value === null) {
      setError(at('servicesAdmin.errors.invalid_amount'));
      return;
    }
    setError(null);
    mutation.mutate({ amount: value });
  };
  return (
    <ActionCard title={at('servicesAdmin.quoteTitle')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(send)} noValidate>
        <fieldset className={styles.radios}>
          <legend className={adminStyles.label}>{at('servicesAdmin.quoteKind')}</legend>
          {(['estimate', 'final'] as const).map((k) => (
            <label key={k} className={styles.check}>
              <input
                type="radio"
                name="quote-kind"
                checked={quoteKind === k}
                onChange={() => setQuoteKind(k)}
              />
              {at(k === 'estimate' ? 'servicesAdmin.quoteEstimate' : 'servicesAdmin.quoteFinal')}
            </label>
          ))}
        </fieldset>
        <TextField
          label={at('servicesAdmin.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error}
          dir="ltr"
        />
        <TextAreaField
          label={at('servicesAdmin.offerNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <p className={adminStyles.muted}>{at('servicesAdmin.quoteHint')}</p>
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {at('servicesAdmin.sendQuote')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function TradeInOfferAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const settings = useSettings();
  const { repositories } = useRuntime();
  const catalogPrice = request.targetIsCatalog ? (request.target?.price ?? null) : null;
  const [deviceValue, setDeviceValue] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [note, setNote] = useState('');
  const [inspection, setInspection] = useState('');
  const [validDays, setValidDays] = useState(String(settings.services.tradeIn.offerValidityDays));
  const [error, setError] = useState<string | null>(null);
  const value = parseAmount(deviceValue, true);
  const target = request.targetIsCatalog ? catalogPrice : parseAmount(targetPrice);
  const difference = value !== null && target !== null ? tradeInDifference(target, value) : null;
  const { mutation, feedback } = useServiceAction(
    request.id,
    (v: { deviceValue: number; targetPrice: number | null; validDays: number | null }) =>
      repositories.serviceOps.sendTradeInOffer(request.id, {
        deviceValue: v.deviceValue,
        targetPrice: v.targetPrice,
        note: note.trim() || null,
        inspectionNote: inspection.trim() || null,
        validDays: v.validDays,
      }),
  );
  const send = () => {
    const days = validDays.trim() ? Number(validDays) : null;
    if (value === null || (!request.targetIsCatalog && target === null)) {
      setError(at('servicesAdmin.errors.invalid_amount'));
      return;
    }
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 60)) {
      setError(at('servicesAdmin.errors.invalid_days'));
      return;
    }
    setError(null);
    mutation.mutate({
      deviceValue: value,
      targetPrice: request.targetIsCatalog ? null : target,
      validDays: days,
    });
  };
  return (
    <ActionCard title={at('servicesAdmin.valuationTitle')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(send)} noValidate>
        <TextField
          label={at('servicesAdmin.deviceValue')}
          inputMode="decimal"
          value={deviceValue}
          onChange={(e) => setDeviceValue(e.target.value)}
          dir="ltr"
        />
        {request.targetIsCatalog ? (
          <p>
            {at('servicesAdmin.catalogPrice')}:{' '}
            <strong>
              {catalogPrice !== null ? format.money(catalogPrice) : at('servicesAdmin.noPrice')}
            </strong>
            <br />
            <span className={adminStyles.muted}>{at('servicesAdmin.catalogPriceHint')}</span>
          </p>
        ) : (
          <TextField
            label={at('servicesAdmin.targetPrice')}
            hint={at('servicesAdmin.manualTargetHint')}
            inputMode="decimal"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            dir="ltr"
          />
        )}
        <p role="status">
          {at('servicesAdmin.difference')}:{' '}
          <strong>{difference !== null ? format.money(difference) : '—'}</strong>
        </p>
        <TextAreaField
          label={at('servicesAdmin.inspectionNote')}
          value={inspection}
          onChange={(e) => setInspection(e.target.value)}
          rows={2}
          maxLength={1000}
        />
        <TextAreaField
          label={at('servicesAdmin.offerNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <TextField
          label={at('servicesAdmin.validDays')}
          inputMode="numeric"
          value={validDays}
          onChange={(e) => setValidDays(e.target.value)}
          error={error}
          dir="ltr"
        />
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {at('servicesAdmin.sendOffer')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function UsedProposalAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const settings = useSettings();
  const { repositories } = useRuntime();
  const [device, setDevice] = useState({
    brand: request.brand ?? '',
    model: request.model ?? '',
    storage: '',
    color: '',
    battery: '',
    condition: '',
    taxStatus: 'unknown' as TaxStatus,
  });
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const media = settings.services.media;
  const { mutation, feedback } = useServiceAction(
    request.id,
    (v: { price: number; battery: number | null }) =>
      repositories.serviceOps.sendUsedProposal(
        request.id,
        {
          brand: device.brand.trim(),
          model: device.model.trim(),
          storage: device.storage.trim() || null,
          color: device.color.trim() || null,
          batteryHealth: v.battery,
          condition: device.condition.trim() || null,
          taxStatus: device.taxStatus,
        },
        v.price,
        note.trim() || null,
        uploadsToMedia(uploads),
      ),
    () => setUploads([]),
  );
  const send = () => {
    const amount = parseAmount(price);
    const battery = device.battery.trim() ? Number(device.battery) : null;
    if (!device.brand.trim() || !device.model.trim()) {
      setError(at('servicesAdmin.errors.invalid_device'));
      return;
    }
    if (battery !== null && (!Number.isInteger(battery) || battery < 1 || battery > 100)) {
      setError(at('servicesAdmin.errors.invalid_battery'));
      return;
    }
    if (amount === null) {
      setError(at('servicesAdmin.errors.invalid_amount'));
      return;
    }
    if (uploads.some((u) => u.status !== 'done')) {
      setError(t('media.waitUploads'));
      return;
    }
    setError(null);
    mutation.mutate({ price: amount, battery });
  };
  const set = (patch: Partial<typeof device>) => setDevice((d) => ({ ...d, ...patch }));
  return (
    <ActionCard title={at('servicesAdmin.proposalTitle')} feedback={feedback}>
      <form className={styles.actionBody} onSubmit={submit(send)} noValidate>
        <TextField
          label={t('services.brand')}
          value={device.brand}
          onChange={(e) => set({ brand: e.target.value })}
        />
        <TextField
          label={t('services.model')}
          value={device.model}
          onChange={(e) => set({ model: e.target.value })}
        />
        <TextField
          label={t('services.storage')}
          value={device.storage}
          onChange={(e) => set({ storage: e.target.value })}
        />
        <TextField
          label={t('services.color')}
          value={device.color}
          onChange={(e) => set({ color: e.target.value })}
        />
        <TextField
          label={t('tradeIn.batteryHealth')}
          inputMode="numeric"
          value={device.battery}
          onChange={(e) => set({ battery: e.target.value })}
          dir="ltr"
        />
        <TextField
          label={t('requestDetail.condition')}
          value={device.condition}
          onChange={(e) => set({ condition: e.target.value })}
        />
        <div className={styles.field}>
          <label className={adminStyles.label} htmlFor="svc-tax">
            {t('requestDetail.taxStatus')}
          </label>
          <select
            id="svc-tax"
            className={adminStyles.select}
            value={device.taxStatus}
            onChange={(e) => set({ taxStatus: e.target.value as TaxStatus })}
          >
            {TAX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`requestDetail.tax_${s}` as CoreMessageKey)}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label={at('servicesAdmin.price')}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          dir="ltr"
        />
        <TextAreaField
          label={at('servicesAdmin.offerNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
        <MediaUploader
          value={uploads}
          onChange={(fn) => setUploads(fn)}
          limits={limitsFromSettings({ ...media, allowVideo: false })}
          imageMaxDimension={media.imageMaxDimension}
          imageQuality={media.imageQuality}
          allowVideo={false}
          upload={(file, mime) => repositories.serviceOps.uploadProposalPhoto(file, mime)}
          discard={(u) => repositories.services.discardUpload(u)}
        />
        {error && (
          <Alert tone="danger" live>
            {error}
          </Alert>
        )}
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {at('servicesAdmin.sendProposal')}
          </Button>
        </div>
      </form>
    </ActionCard>
  );
}

function AfterSalesDecisionAction({ request }: { request: StaffServiceRequest }) {
  const { at } = useAdminI18n();
  const { repositories } = useRuntime();
  const [note, setNote] = useState('');
  const { mutation, feedback } = useServiceAction(request.id, (decision: 'approved' | 'rejected') =>
    repositories.serviceOps.decideAfterSales(request.id, decision, note.trim() || null),
  );
  if (request.status !== 'new' && request.status !== 'under_review') return null;
  return (
    <ActionCard title={at('servicesAdmin.decisionTitle')} feedback={feedback}>
      <TextAreaField
        label={at('servicesAdmin.decisionNote')}
        hint={at('servicesAdmin.decisionHint')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
      />
      <div className={styles.buttons}>
        <Button
          variant="primary"
          loading={mutation.isPending && mutation.variables === 'approved'}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('approved')}
        >
          {at('servicesAdmin.approve')}
        </Button>
        <Button
          variant="secondary"
          loading={mutation.isPending && mutation.variables === 'rejected'}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('rejected')}
        >
          {at('servicesAdmin.reject')}
        </Button>
      </div>
    </ActionCard>
  );
}
