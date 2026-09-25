import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  CircleAlert,
  CircleCheck,
  Clock3,
  FlaskConical,
  Heart,
  Hourglass,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MapPin,
  Package,
  PackageCheck,
  Pencil,
  RefreshCw,
  ShoppingCart,
  Smartphone,
  Star,
  Tag,
  Trash2,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { Skeleton } from '@/components/feedback/Skeleton';
import { StateMessage } from '@/components/feedback/StateMessage';
import { LocaleLink, LocaleNavLink } from '@/components/navigation/LocaleLink';
import { BidiText } from '@/components/text/BidiText';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { TextField } from '@/components/ui/TextField';
import { GOVERNORATES, deliveryPlace } from '@/domain/commerce/governorates';
import { addressProblem } from '@/domain/customer/address';
import {
  ADDRESS_LABELS,
  type Address,
  type AddressInput,
  type AppNotification,
  type NotificationCategory,
  type RequestStatus,
} from '@/domain/customer/types';
import { resolveLocalized } from '@/domain/localized';
import { useAccess, useAuth, useSession } from '@/features/auth/context';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useCustomerLists } from '@/features/customer/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { isEgyptianMobile } from '@/lib/phone';
import { useRuntime } from '@/runtime/context';
import { MyOrders, type OrderFilter } from '../../commerce/MyOrders';
import { stockLabelKey } from '../../components/stockLabel';
import { RecentlyViewedRail } from '../../customer/ProductRails';
import styles from '../../customer/account.module.css';

// ═════════════════════════════ Layout ═════════════════════════════
const NAV: { to: string; label: CoreMessageKey; Icon: LucideIcon; end?: boolean }[] = [
  { to: '/account', label: 'account.navOverview', Icon: LayoutGrid, end: true },
  { to: '/account/orders', label: 'account.navOrders', Icon: Package },
  { to: '/wishlist', label: 'account.navWishlist', Icon: Heart },
  { to: '/account/requests', label: 'account.navRequests', Icon: BellRing },
  { to: '/account/notifications', label: 'account.navNotifications', Icon: Bell },
  { to: '/account/reviews', label: 'account.navReviews', Icon: Star },
  { to: '/account/addresses', label: 'account.navAddresses', Icon: MapPin },
  { to: '/account/profile', label: 'account.navProfile', Icon: UserRound },
];

export function AccountLayout() {
  return (
    <RequireAuth>
      <AccountShell />
    </RequireAuth>
  );
}

function AccountShell() {
  const { t } = useI18n();
  const { state, signOut } = useAuth();
  const { isStaff } = useAccess();
  const { repositories } = useRuntime();
  const session = useSession();
  const navLabelId = useId();
  const unread = useQuery({
    queryKey: ['notifications-unread', session?.userId ?? null],
    queryFn: () => repositories.notifications.unreadCount(),
    enabled: Boolean(session),
    staleTime: 30_000,
  });
  const email = state.status === 'signed_in' ? state.session.email : null;
  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.accountHead}>
        {email && <p className={styles.muted}>{t('auth.signedInAs', { email: isolate(email) })}</p>}
        <div className={styles.headActions}>
          {isStaff && (
            <Link to="/admin" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
              <LayoutDashboard aria-hidden="true" />
              {t('account.adminLink')}
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden="true" />}
            onClick={() => void signOut()}
          >
            {t('common.signOut')}
          </Button>
        </div>
      </div>
      <div className={styles.shell}>
        <nav className={styles.nav} aria-labelledby={navLabelId}>
          <span id={navLabelId} className="visually-hidden">
            {t('account.navLabel')}
          </span>
          <ul className={styles.navList}>
            {NAV.map(({ to, label, Icon, end }) => (
              <li key={to}>
                <LocaleNavLink to={to} end={end} className={styles.navLink}>
                  <Icon aria-hidden="true" />
                  {t(label)}
                  {to === '/account/notifications' && (unread.data ?? 0) > 0 && (
                    <span className={styles.navBadge}>
                      {unread.data}
                      <span className="visually-hidden"> {t('notifications.unreadSuffix')}</span>
                    </span>
                  )}
                </LocaleNavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  usePageMeta({ title, noIndex: true });
  return (
    <header className={styles.pageHead}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {children}
    </header>
  );
}

// ═════════════════════════════ Overview ═════════════════════════════
export function AccountOverview() {
  const { t, format, locale } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const lists = useCustomerLists();
  const uid = session?.userId ?? null;
  const profile = useQuery({
    queryKey: ['profile', uid],
    queryFn: () => repositories.profiles.getMyProfile(),
  });
  const cart = useQuery({
    queryKey: ['cart-status', uid],
    queryFn: () => repositories.account.getCartStatus(),
  });
  const requests = useQuery({
    queryKey: ['requests', uid],
    queryFn: () => repositories.requests.listMine(),
  });
  const inbox = useQuery({
    queryKey: ['notifications', uid, 'recent'],
    queryFn: () => repositories.notifications.list({ limit: 3 }),
  });
  const activeRequests = [
    ...(requests.data?.notify ?? []),
    ...(requests.data?.waitlist ?? []),
  ].filter((r) => ['active', 'available'].includes(r.status)).length;
  const firstName = profile.data?.fullName?.split(/\s+/)[0];

  return (
    <>
      <PageTitle title={t('account.title')}>
        <p className={styles.muted}>
          {firstName ? t('account.greeting', { name: firstName }) : t('account.greetingAnon')}
        </p>
      </PageTitle>

      {cart.data && cart.data.itemCount > 0 && (
        <section
          className={`${styles.card} ${cart.data.abandoned ? styles.highlight : ''}`}
          aria-labelledby="acc-cart"
        >
          <h2 id="acc-cart" className={styles.cardTitle}>
            <ShoppingCart aria-hidden="true" />
            {cart.data.abandoned ? t('account.cartWaitingTitle') : t('account.cartTitle')}
          </h2>
          <p className={styles.muted}>
            {t('account.cartBody', { count: format.number(cart.data.itemCount) })}
          </p>
          <LocaleLink
            to="/cart"
            className={buttonClassName({ variant: cart.data.abandoned ? 'accent' : 'secondary' })}
          >
            {t('account.continueCart')}
          </LocaleLink>
        </section>
      )}

      <section className={styles.card} aria-labelledby="acc-orders">
        <div className={styles.cardHead}>
          <h2 id="acc-orders" className={styles.cardTitle}>
            <Package aria-hidden="true" />
            {t('account.latestOrder')}
          </h2>
          <LocaleLink to="/account/orders" className={styles.cardLink}>
            {t('account.allOrders')}
          </LocaleLink>
        </div>
        <MyOrders pageSize={1} />
      </section>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="acc-wishlist">
          <h2 id="acc-wishlist" className={styles.cardTitle}>
            <Heart aria-hidden="true" />
            {t('account.savedItems')}
          </h2>
          <p className={styles.stat}>{format.number(lists.wishlist.count)}</p>
          <LocaleLink to="/wishlist" className={styles.cardLink}>
            {t('account.viewWishlist')}
          </LocaleLink>
        </section>
        <section className={styles.card} aria-labelledby="acc-requests">
          <h2 id="acc-requests" className={styles.cardTitle}>
            <BellRing aria-hidden="true" />
            {t('account.activeRequests')}
          </h2>
          <p className={styles.stat}>{requests.isPending ? '…' : format.number(activeRequests)}</p>
          <LocaleLink to="/account/requests" className={styles.cardLink}>
            {t('account.viewRequests')}
          </LocaleLink>
        </section>
      </div>

      <section className={styles.card} aria-labelledby="acc-notifications">
        <div className={styles.cardHead}>
          <h2 id="acc-notifications" className={styles.cardTitle}>
            <Bell aria-hidden="true" />
            {t('account.recentNotifications')}
          </h2>
          <LocaleLink to="/account/notifications" className={styles.cardLink}>
            {t('account.allNotifications')}
          </LocaleLink>
        </div>
        {inbox.isPending ? (
          <Skeleton height="60px" />
        ) : (inbox.data?.items.length ?? 0) === 0 ? (
          <p className={styles.muted}>{t('notifications.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {inbox.data?.items.map((n) => (
              <li key={n.id} className={styles.rowMeta}>
                <strong>{resolveLocalized(n.title, locale)}</strong>
                <time dateTime={n.createdAt}>{format.dateTime(n.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecentlyViewedRail title={t('account.continueShopping')} />
    </>
  );
}

// ═════════════════════════════ Profile ═════════════════════════════
export function AccountProfile() {
  const { t, format } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const profile = useQuery({
    queryKey: ['profile', uid],
    queryFn: () => repositories.profiles.getMyProfile(),
  });
  return (
    <>
      <PageTitle title={t('account.profileTitle')} />
      {profile.isPending ? (
        <Skeleton height="240px" />
      ) : profile.data ? (
        <ProfileForm
          key={profile.data.id}
          initial={{
            fullName: profile.data.fullName ?? '',
            phone: profile.data.phone ?? '',
            preferredLocale: profile.data.preferredLocale,
          }}
          email={profile.data.email}
          createdAt={profile.data.createdAt ? format.date(profile.data.createdAt) : null}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['profile', uid] })}
        />
      ) : null}
    </>
  );
}

function ProfileForm({
  initial,
  email,
  createdAt,
  onSaved,
}: {
  initial: { fullName: string; phone: string; preferredLocale: 'ar' | 'en' };
  email: string | null;
  createdAt: string | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<'fullName' | 'phone', string>>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => repositories.profiles.updateMyProfile(form),
    onSuccess: (result) => {
      if (!result.ok) {
        setErrors(
          result.field === 'phone'
            ? { phone: t('checkout.errorPhone') }
            : { fullName: t('checkout.errorName') },
        );
        return;
      }
      setSaved(true);
      onSaved();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (form.fullName.trim() && form.fullName.trim().length < 2)
      next.fullName = t('checkout.errorName');
    if (form.phone.trim() && !isEgyptianMobile(form.phone)) next.phone = t('checkout.errorPhone');
    setErrors(next);
    setSaved(false);
    if (Object.keys(next).length === 0) save.mutate();
  };
  return (
    <form className={`${styles.card} ${styles.form}`} onSubmit={submit} noValidate>
      <TextField
        label={t('checkout.name')}
        value={form.fullName}
        onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        autoComplete="name"
        error={errors.fullName}
        maxLength={120}
      />
      <TextField
        label={t('checkout.phone')}
        hint={t('checkout.phoneHint')}
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        inputMode="tel"
        dir="ltr"
        autoComplete="tel"
        error={errors.phone}
      />
      <TextField
        label={t('account.emailLabel')}
        value={email ?? ''}
        readOnly
        dir="ltr"
        hint={t('account.emailHint')}
      />
      <fieldset className={styles.fieldset}>
        <legend>{t('account.languageLabel')}</legend>
        {(['ar', 'en'] as const).map((locale) => (
          <label key={locale} className={styles.checkRow}>
            <input
              type="radio"
              name="preferredLocale"
              checked={form.preferredLocale === locale}
              onChange={() => setForm({ ...form, preferredLocale: locale })}
            />
            {locale === 'ar' ? 'العربية' : 'English'}
          </label>
        ))}
      </fieldset>
      {createdAt && <p className={styles.muted}>{t('account.memberSince', { date: createdAt })}</p>}
      <p className={styles.muted}>{t('checkout.noSmsNote')}</p>
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('account.saveProfile')}
        </Button>
      </div>
      <p role="status" className={styles.muted}>
        {saved ? t('account.profileSaved') : save.isError ? t('account.saveError') : ''}
      </p>
    </form>
  );
}

// ═════════════════════════════ Addresses ═════════════════════════════
const LABEL_KEY: Record<(typeof ADDRESS_LABELS)[number], CoreMessageKey> = {
  home: 'account.addressHome',
  work: 'account.addressWork',
  other: 'account.addressOther',
};

export function AccountAddresses() {
  const { t, locale } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const addresses = useQuery({
    queryKey: ['addresses', uid],
    queryFn: () => repositories.account.listAddresses(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['addresses', uid] });
  const remove = useMutation({
    mutationFn: (id: string) => repositories.account.deleteAddress(id),
    onSuccess: () => {
      setMessage(t('account.addressDeleted'));
      void refresh();
    },
  });
  const makeDefault = useMutation({
    mutationFn: (a: Address) => repositories.account.saveAddress({ ...a, isDefault: true }),
    onSuccess: () => {
      setMessage(t('account.addressDefaultSet'));
      void refresh();
    },
  });

  return (
    <>
      <PageTitle title={t('account.addressesTitle')}>
        {editing === null && (addresses.data?.length ?? 0) < 10 && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('account.addAddress')}
          </Button>
        )}
      </PageTitle>
      <p role="status" className="visually-hidden">
        {message}
      </p>
      {editing !== null && (
        <AddressForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage(t('account.addressSaved'));
            void refresh();
          }}
        />
      )}
      {addresses.isPending ? (
        <Skeleton height="120px" />
      ) : addresses.isError ? (
        <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <CircleAlert aria-hidden="true" />
          {t('account.loadError')}
        </p>
      ) : addresses.data.length === 0 && editing === null ? (
        <StateMessage
          headingLevel={2}
          icon={<MapPin />}
          title={t('account.addressesEmpty')}
          body={t('account.addressesEmptyBody')}
        />
      ) : (
        <ul className={styles.list}>
          {addresses.data.map((a) => (
            <li key={a.id} className={`${styles.row} ${styles.rowNoThumb}`}>
              <div className={styles.rowBody}>
                <p className={styles.rowTitle}>
                  {t(LABEL_KEY[a.label])}{' '}
                  {a.isDefault && (
                    <span className={`${styles.pill} ${styles.pillGood}`}>
                      <CircleCheck aria-hidden="true" />
                      {t('account.defaultAddress')}
                    </span>
                  )}
                </p>
                <p>
                  {deliveryPlace(
                    { governorate: a.governorate, area: a.area, address: a.address },
                    locale,
                  )}
                </p>
                {a.notes && <p className={styles.muted}>{a.notes}</p>}
                {a.phone && (
                  <p className={styles.muted}>
                    <bdi dir="ltr">{a.phone}</bdi>
                  </p>
                )}
                <div className={styles.rowActions}>
                  <button type="button" className={styles.linkButton} onClick={() => setEditing(a)}>
                    <Pencil aria-hidden="true" />
                    {t('account.edit')}
                    <span className="visually-hidden">: {t(LABEL_KEY[a.label])}</span>
                  </button>
                  {!a.isDefault && (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => makeDefault.mutate(a)}
                    >
                      <CircleCheck aria-hidden="true" />
                      {t('account.makeDefault')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => remove.mutate(a.id)}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('account.delete')}
                    <span className="visually-hidden">: {t(LABEL_KEY[a.label])}</span>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One typed address form (same rules as checkout — addressProblem / app.delivery_address_problem). */
export function AddressForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Address | null;
  onSaved: (address: Address) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const { repositories } = useRuntime();
  const [form, setForm] = useState<AddressInput>(
    initial ?? {
      label: 'home',
      governorate: '',
      area: '',
      address: '',
      notes: null,
      phone: null,
      isDefault: false,
    },
  );
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const save = useMutation({
    mutationFn: () => repositories.account.saveAddress(form),
    onSuccess: (result) => {
      if (!result.ok || !result.address) {
        setErrors({
          [result.field ?? 'form']:
            result.code === 'invalid_phone' ? t('checkout.errorPhone') : t('account.addressError'),
        });
        return;
      }
      onSaved(result.address);
    },
    onError: () => setErrors({ form: t('account.saveError') }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = addressProblem(form);
    const next: Record<string, string> = {};
    if (problem === 'governorate') next.governorate = t('checkout.errorAddress');
    if (problem === 'area') next.area = t('checkout.errorArea');
    if (problem === 'address') next.address = t('checkout.errorAddressLine');
    if (form.phone?.trim() && !isEgyptianMobile(form.phone)) next.phone = t('checkout.errorPhone');
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };
  const governorateId = useId();
  return (
    <form
      className={`${styles.card} ${styles.form}`}
      onSubmit={submit}
      noValidate
      aria-label={initial ? t('account.editAddress') : t('account.addAddress')}
    >
      <fieldset className={styles.fieldset}>
        <legend>{t('account.addressLabel')}</legend>
        <div className={styles.segmented}>
          {ADDRESS_LABELS.map((label) => (
            <label key={label} className={styles.checkRow}>
              <input
                type="radio"
                name="address-label"
                checked={form.label === label}
                onChange={() => setForm({ ...form, label })}
              />
              {t(LABEL_KEY[label])}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={styles.fieldLabel} htmlFor={governorateId}>
          {t('checkout.governorate')}
        </label>
        <select
          id={governorateId}
          className={styles.select}
          value={form.governorate}
          onChange={(e) => setForm({ ...form, governorate: e.target.value })}
          aria-invalid={errors.governorate ? true : undefined}
        >
          <option value="">—</option>
          {GOVERNORATES.map((g) => (
            <option key={g.key} value={g.key}>
              {resolveLocalized(g.name, locale)}
            </option>
          ))}
        </select>
        {errors.governorate && (
          <p className={styles.error} role="alert">
            {errors.governorate}
          </p>
        )}
      </div>
      <TextField
        label={t('checkout.area')}
        value={form.area}
        onChange={(e) => setForm({ ...form, area: e.target.value })}
        error={errors.area}
        maxLength={120}
      />
      <TextField
        label={t('checkout.address')}
        hint={t('checkout.addressHint')}
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
        error={errors.address}
        maxLength={400}
      />
      <TextField
        label={t('checkout.addressNotes')}
        value={form.notes ?? ''}
        onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
        maxLength={400}
      />
      <TextField
        label={t('account.addressPhone')}
        hint={t('account.addressPhoneHint')}
        value={form.phone ?? ''}
        onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
        inputMode="tel"
        dir="ltr"
        error={errors.phone}
      />
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
        />
        {t('account.setDefault')}
      </label>
      {errors.form && (
        <p className={styles.error} role="alert">
          {errors.form}
        </p>
      )}
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('account.saveAddress')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

// ═════════════════════════════ Orders ═════════════════════════════
const FILTERS: { key: OrderFilter; label: CoreMessageKey }[] = [
  { key: 'all', label: 'account.filterAll' },
  { key: 'current', label: 'account.filterCurrent' },
  { key: 'completed', label: 'account.filterCompleted' },
  { key: 'cancelled', label: 'account.filterCancelled' },
];

export function AccountOrders() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<OrderFilter>('all');
  return (
    <>
      <PageTitle title={t('account.ordersTitle')} />
      <div className={styles.segmented} role="group" aria-label={t('account.filterLabel')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {t(f.label)}
          </button>
        ))}
      </div>
      <MyOrders filter={filter} pageSize={10} />
    </>
  );
}

// ═════════════════════════════ Requests ═════════════════════════════
const REQUEST_STATUS: Record<
  RequestStatus,
  { label: CoreMessageKey; Icon: LucideIcon; tone: string }
> = {
  active: { label: 'requests.statusActive', Icon: Hourglass, tone: styles.pillWait ?? '' },
  available: { label: 'requests.statusAvailable', Icon: CircleCheck, tone: styles.pillGood ?? '' },
  notified: { label: 'requests.statusNotified', Icon: BellRing, tone: styles.pillGood ?? '' },
  converted: { label: 'requests.statusConverted', Icon: PackageCheck, tone: styles.pillGood ?? '' },
  cancelled: { label: 'requests.statusCancelled', Icon: CircleAlert, tone: '' },
  expired: { label: 'requests.statusExpired', Icon: Clock3, tone: '' },
};

function RequestStatusPill({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  const { label, Icon, tone } = REQUEST_STATUS[status];
  return (
    <span className={`${styles.pill} ${tone}`}>
      <Icon aria-hidden="true" />
      {t(label)}
    </span>
  );
}

export function AccountRequests() {
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const requests = useQuery({
    queryKey: ['requests', uid],
    queryFn: () => repositories.requests.listMine(),
  });
  const cancel = useMutation({
    mutationFn: (r: { kind: 'notify' | 'waitlist'; id: string }) =>
      repositories.requests.cancel(r.kind, r.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['requests', uid] }),
  });
  const upcoming: { key: CoreMessageKey; Icon: LucideIcon }[] = [
    { key: 'requests.futureRepairs', Icon: Wrench },
    { key: 'requests.futureTradeIn', Icon: RefreshCw },
    { key: 'requests.futureUsed', Icon: Smartphone },
  ];
  return (
    <>
      <PageTitle title={t('requests.accountTitle')}>
        <p className={styles.muted}>{t('requests.accountSubtitle')}</p>
      </PageTitle>
      {requests.isPending ? (
        <Skeleton height="160px" />
      ) : requests.isError ? (
        <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <CircleAlert aria-hidden="true" />
          {t('account.loadError')}
        </p>
      ) : (
        <>
          <section className={styles.rail} aria-labelledby="req-notify">
            <h2 id="req-notify" className={styles.sectionTitle}>
              {t('requests.notifySection')}
            </h2>
            {requests.data.notify.length === 0 ? (
              <p className={styles.muted}>{t('requests.notifyEmpty')}</p>
            ) : (
              <ul className={styles.list}>
                {requests.data.notify.map((r) => (
                  <li key={r.id} className={styles.row}>
                    {r.product.image ? (
                      <img className={styles.thumb} src={r.product.image.url} alt="" />
                    ) : (
                      <span className={styles.thumb} />
                    )}
                    <div className={styles.rowBody}>
                      <LocaleLink to={`/product/${r.product.slug}`} className={styles.rowTitle}>
                        <BidiText text={resolveLocalized(r.product.name, locale)} />
                      </LocaleLink>
                      {r.variant?.label && (
                        <span className={styles.muted}>
                          {resolveLocalized(r.variant.label, locale)}
                        </span>
                      )}
                      <div className={styles.rowMeta}>
                        <RequestStatusPill status={r.status} />
                        {r.stockState && (
                          <span>{t(stockLabelKey(r.stockState, r.product.availabilityState))}</span>
                        )}
                        <span>{t('requests.requestedOn', { date: format.date(r.createdAt) })}</span>
                        {r.product.isDemo && (
                          <span className={styles.pill}>
                            <FlaskConical aria-hidden="true" />
                            {t('catalog.demo')}
                          </span>
                        )}
                      </div>
                      {['active', 'available'].includes(r.status) && (
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => cancel.mutate({ kind: 'notify', id: r.id })}
                          >
                            {t('requests.cancel')}
                            <span className="visually-hidden">
                              : {resolveLocalized(r.product.name, locale)}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles.rail} aria-labelledby="req-waitlist">
            <h2 id="req-waitlist" className={styles.sectionTitle}>
              {t('requests.waitlistSection')}
            </h2>
            {requests.data.waitlist.length === 0 ? (
              <p className={styles.muted}>{t('requests.waitlistEmpty')}</p>
            ) : (
              <ul className={styles.list}>
                {requests.data.waitlist.map((r) => (
                  <li key={r.id} className={styles.row}>
                    {r.product.image ? (
                      <img className={styles.thumb} src={r.product.image.url} alt="" />
                    ) : (
                      <span className={styles.thumb} />
                    )}
                    <div className={styles.rowBody}>
                      <LocaleLink to={`/product/${r.product.slug}`} className={styles.rowTitle}>
                        <BidiText text={resolveLocalized(r.product.name, locale)} />
                      </LocaleLink>
                      {(r.desiredStorage || r.desiredColor) && (
                        <span className={styles.muted}>
                          {[r.desiredStorage, r.desiredColor].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <div className={styles.rowMeta}>
                        <RequestStatusPill status={r.status} />
                        <span>{t(stockLabelKey('in_stock', r.product.availabilityState))}</span>
                        <span>{t('requests.requestedOn', { date: format.date(r.createdAt) })}</span>
                      </div>
                      {['active', 'available'].includes(r.status) && (
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => cancel.mutate({ kind: 'waitlist', id: r.id })}
                          >
                            {t('requests.cancel')}
                            <span className="visually-hidden">
                              : {resolveLocalized(r.product.name, locale)}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <section className={styles.rail} aria-labelledby="req-future">
        <h2 id="req-future" className={styles.sectionTitle}>
          {t('requests.futureTitle')}
        </h2>
        <div className={styles.grid}>
          {upcoming.map(({ key, Icon }) => (
            <div key={key} className={styles.card}>
              <p className={styles.cardTitle}>
                <Icon aria-hidden="true" />
                {t(key)}
              </p>
              <p className={styles.muted}>{t('requests.futureBody')}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ═════════════════════════════ Notifications ═════════════════════════════
const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  order: Package,
  back_in_stock: PackageCheck,
  waitlist: BellRing,
  price_drop: Tag,
  review: Star,
  cart: ShoppingCart,
  account: UserRound,
};

const CATEGORY_LABEL: Record<NotificationCategory, CoreMessageKey> = {
  order: 'notifications.catOrder',
  back_in_stock: 'notifications.catBackInStock',
  waitlist: 'notifications.catWaitlist',
  price_drop: 'notifications.catPriceDrop',
  review: 'notifications.catReview',
  cart: 'notifications.catCart',
  account: 'notifications.catAccount',
};

export function AccountNotifications() {
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const uid = session?.userId ?? null;
  const [pages, setPages] = useState<AppNotification[][]>([]);
  const first = useQuery({
    queryKey: ['notifications', uid, 'inbox'],
    queryFn: () => repositories.notifications.list({ limit: 10 }),
  });
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const items = [...(first.data?.items ?? []), ...pages.flat()];
  const more = hasMore ?? first.data?.hasMore ?? false;
  const refreshCounts = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread', uid] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', uid] });
  };
  const loadMore = useMutation({
    mutationFn: () =>
      repositories.notifications.list({
        limit: 10,
        before: items[items.length - 1]?.createdAt ?? null,
      }),
    onSuccess: (page) => {
      setPages((p) => [...p, page.items]);
      setHasMore(page.hasMore);
    },
  });
  const markAll = useMutation({
    mutationFn: () => repositories.notifications.markAllRead(),
    onSuccess: () => {
      setPages([]);
      setHasMore(null);
      refreshCounts();
    },
  });
  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await repositories.notifications.markRead(n.id);
      refreshCounts();
    }
    if (n.actionPath)
      void navigate(
        n.actionPath.startsWith('/')
          ? locale === 'en'
            ? `/en${n.actionPath}`
            : n.actionPath
          : '/',
      );
  };
  const unread = first.data?.unreadCount ?? 0;

  return (
    <>
      <PageTitle title={t('notifications.title')}>
        {unread > 0 && (
          <Button variant="secondary" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            {t('notifications.markAll')}
          </Button>
        )}
      </PageTitle>
      <p className={styles.muted} role="status">
        {first.data ? t('notifications.unreadCount', { count: format.number(unread) }) : ''}
      </p>
      {first.isPending ? (
        <Skeleton height="200px" />
      ) : first.isError ? (
        <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <CircleAlert aria-hidden="true" />
          {t('account.loadError')}
        </p>
      ) : items.length === 0 ? (
        <StateMessage
          headingLevel={2}
          icon={<Bell />}
          title={t('notifications.empty')}
          body={t('notifications.emptyBody')}
        />
      ) : (
        <ul className={styles.list} aria-label={t('notifications.listLabel')}>
          {items.map((n) => {
            const Icon = CATEGORY_ICON[n.category];
            return (
              <li key={n.id} className={`${styles.row} ${n.readAt ? '' : styles.rowUnread}`}>
                <span className={styles.icon}>
                  <Icon aria-hidden="true" />
                </span>
                <div className={styles.rowBody}>
                  <p className={styles.rowTitle}>
                    {!n.readAt && (
                      <span className="visually-hidden">{t('notifications.unreadPrefix')} </span>
                    )}
                    {resolveLocalized(n.title, locale)}
                  </p>
                  <p>{resolveLocalized(n.body, locale)}</p>
                  <div className={styles.rowMeta}>
                    <span className={styles.pill}>{t(CATEGORY_LABEL[n.category])}</span>
                    <time dateTime={n.createdAt}>{format.dateTime(n.createdAt)}</time>
                    {n.isDemo && <span className={styles.pill}>{t('catalog.demo')}</span>}
                  </div>
                  <div className={styles.rowActions}>
                    {n.actionPath && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => void open(n)}
                      >
                        {t('notifications.open')}
                      </button>
                    )}
                    {!n.readAt && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => {
                          void repositories.notifications.markRead(n.id).then(() => {
                            setPages((p) =>
                              p.map((page) =>
                                page.map((x) =>
                                  x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
                                ),
                              ),
                            );
                            refreshCounts();
                          });
                        }}
                      >
                        {t('notifications.markRead')}
                        <span className="visually-hidden">
                          : {resolveLocalized(n.title, locale)}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <Button variant="secondary" onClick={() => loadMore.mutate()} loading={loadMore.isPending}>
          {t('notifications.more')}
        </Button>
      )}
      <NotificationPreferences />
    </>
  );
}

function NotificationPreferences() {
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const prefs = useQuery({
    queryKey: ['notification-prefs', uid],
    queryFn: () => repositories.notifications.preferences(),
  });
  const set = useMutation({
    mutationFn: (v: { category: string; enabled: boolean }) =>
      repositories.notifications.setPreference(v.category, 'in_app', v.enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-prefs', uid] }),
  });
  if (!prefs.data) return null;
  return (
    <section className={styles.card} aria-labelledby="notif-prefs">
      <h2 id="notif-prefs" className={styles.cardTitle}>
        {t('notifications.prefsTitle')}
      </h2>
      <p className={styles.muted}>{t('notifications.prefsNote')}</p>
      <div className={styles.prefScroller}>
        <table className={styles.prefTable}>
          <caption className="visually-hidden">{t('notifications.prefsTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('notifications.prefCategory')}</th>
              <th scope="col">{t('notifications.channelInApp')}</th>
              <th scope="col">{t('notifications.channelOther')}</th>
            </tr>
          </thead>
          <tbody>
            {prefs.data.map((p) => {
              const label = t(CATEGORY_LABEL[p.category]);
              return (
                <tr key={p.category}>
                  <th scope="row">{label}</th>
                  <td>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={p.channels.in_app.enabled}
                        disabled={p.mandatory || set.isPending}
                        onChange={(e) =>
                          set.mutate({ category: p.category, enabled: e.target.checked })
                        }
                      />
                      <span className="visually-hidden">
                        {t('notifications.inAppFor', { category: label })}
                      </span>
                      <span aria-hidden="true">
                        {p.mandatory
                          ? t('notifications.always')
                          : p.channels.in_app.enabled
                            ? t('notifications.on')
                            : t('notifications.off')}
                      </span>
                    </label>
                  </td>
                  <td className={styles.muted}>{t('notifications.notAvailable')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ═════════════════════════════ Reviews ═════════════════════════════
export function AccountReviews() {
  const { t, locale, format } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const reviews = useQuery({
    queryKey: ['my-reviews', uid],
    queryFn: () => repositories.reviews.listMine(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => repositories.reviews.deleteMine(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-reviews', uid] }),
  });
  const STATUS: Record<
    'pending' | 'approved' | 'rejected',
    { label: CoreMessageKey; tone: string; Icon: LucideIcon }
  > = {
    pending: { label: 'reviews.statusPending', tone: styles.pillWait ?? '', Icon: Hourglass },
    approved: { label: 'reviews.statusApproved', tone: styles.pillGood ?? '', Icon: CircleCheck },
    rejected: { label: 'reviews.statusRejected', tone: '', Icon: CircleAlert },
  };
  return (
    <>
      <PageTitle title={t('reviews.accountTitle')}>
        <p className={styles.muted}>{t('reviews.accountSubtitle')}</p>
      </PageTitle>
      {reviews.isPending ? (
        <Skeleton height="120px" />
      ) : reviews.isError ? (
        <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <CircleAlert aria-hidden="true" />
          {t('account.loadError')}
        </p>
      ) : reviews.data.length === 0 ? (
        <StateMessage
          headingLevel={2}
          icon={<Star />}
          title={t('reviews.accountEmpty')}
          body={t('reviews.accountEmptyBody')}
        />
      ) : (
        <ul className={styles.list}>
          {reviews.data.map((r) => {
            const s = STATUS[r.status];
            const productName = r.product ? resolveLocalized(r.product.name, locale) : '';
            return (
              <li key={r.id} className={`${styles.row} ${styles.rowNoThumb}`}>
                <div className={styles.rowBody}>
                  {r.product && (
                    <LocaleLink to={`/product/${r.product.slug}`} className={styles.rowTitle}>
                      <BidiText text={productName} />
                    </LocaleLink>
                  )}
                  <div className={styles.rowMeta}>
                    <span className={`${styles.pill} ${s.tone}`}>
                      <s.Icon aria-hidden="true" />
                      {t(s.label)}
                    </span>
                    <span>{t('reviews.ratedText', { rating: r.rating })}</span>
                    <time dateTime={r.updatedAt}>{format.date(r.updatedAt)}</time>
                  </div>
                  <p dir="auto">{r.body}</p>
                  <div className={styles.rowActions}>
                    {r.product && (
                      <LocaleLink
                        to={`/product/${r.product.slug}#product-reviews`}
                        className={styles.linkButton}
                      >
                        <Pencil aria-hidden="true" />
                        {t('reviews.edit')}
                        <span className="visually-hidden">: {productName}</span>
                      </LocaleLink>
                    )}
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => remove.mutate(r.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('account.delete')}
                      <span className="visually-hidden">: {productName}</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
