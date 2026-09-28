import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import {
  OFFER_KINDS,
  PRODUCT_STATUSES,
  type AdminOffer,
  type OfferInput,
  type OfferKind,
  type ProductStatus,
} from '@/domain/admin/schemas';
import { ltOrNull, slugify, validateOfferInput } from '@/domain/admin/validation';
import type { LocalizedText } from '@/domain/localized';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, InputField, LocalizedField, SelectField } from '../../ui/fields';
import {
  numberOrNull,
  toDraft,
  useConfirm,
  useDirtyGuard,
  type LocalizedDraft,
} from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { DirtyBar, UnsavedChangesDialog } from '../../ui/useDirtyGuard';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useProblemText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import { ImageUpload } from '../catalog/catalogParts';
import { useLocalized, useLookups } from '../catalog/catalogHooks';
import { ProductPicker, PublicationStateBadge, RemoveButton } from './contentParts';
import { fromLocalInput, toLocalInput } from './contentTime';

type Role = 'target' | 'bundle_item' | 'gift';
interface OfferProductRow {
  productId: string;
  variantId: string | null;
  role: Role;
  quantity: number;
  name: LocalizedText;
  slug: string;
}
interface OfferForm {
  slug: string;
  kind: OfferKind;
  title: LocalizedDraft;
  subtitle: LocalizedDraft;
  description: LocalizedDraft;
  badge: LocalizedDraft;
  mediaKind: 'image' | 'video';
  mediaUrl: string;
  mediaAlt: LocalizedDraft;
  ctaLabel: LocalizedDraft;
  ctaHref: string;
  discountPercent: string;
  discountAmount: string;
  bundlePrice: string;
  minSubtotal: string;
  promoCode: string;
  maxRedemptions: string;
  maxRedemptionsPerCustomer: string;
  buyQuantity: string;
  getQuantity: string;
  startsAt: string;
  endsAt: string;
  showCountdown: boolean;
  featuredOnHome: boolean;
  status: ProductStatus;
  sortOrder: string;
  seoTitle: LocalizedDraft;
  seoDescription: LocalizedDraft;
  products: OfferProductRow[];
  categoryIds: string[];
}

const EMPTY_LT = { ar: '', en: '' };
const str = (n: number | null) => (n === null ? '' : String(n));
const intOrNull = (v: string) => {
  const n = numberOrNull(v);
  return n === null ? null : Math.trunc(n);
};

function emptyForm(): OfferForm {
  return {
    slug: '',
    kind: 'percentage',
    title: EMPTY_LT,
    subtitle: EMPTY_LT,
    description: EMPTY_LT,
    badge: EMPTY_LT,
    mediaKind: 'image',
    mediaUrl: '',
    mediaAlt: EMPTY_LT,
    ctaLabel: EMPTY_LT,
    ctaHref: '',
    discountPercent: '',
    discountAmount: '',
    bundlePrice: '',
    minSubtotal: '',
    promoCode: '',
    maxRedemptions: '',
    maxRedemptionsPerCustomer: '',
    buyQuantity: '',
    getQuantity: '',
    startsAt: '',
    endsAt: '',
    showCountdown: false,
    featuredOnHome: false,
    status: 'draft',
    sortOrder: '0',
    seoTitle: EMPTY_LT,
    seoDescription: EMPTY_LT,
    products: [],
    categoryIds: [],
  };
}

function formFrom(o: AdminOffer): OfferForm {
  return {
    slug: o.slug,
    kind: o.kind,
    title: toDraft(o.title),
    subtitle: toDraft(o.subtitle),
    description: toDraft(o.description),
    badge: toDraft(o.badge),
    mediaKind: o.mediaKind ?? 'image',
    mediaUrl: o.mediaUrl ?? '',
    mediaAlt: toDraft(o.mediaAlt),
    ctaLabel: toDraft(o.ctaLabel),
    ctaHref: o.ctaHref ?? '',
    discountPercent: str(o.discountPercent),
    discountAmount: str(o.discountAmount),
    bundlePrice: str(o.bundlePrice),
    minSubtotal: str(o.minSubtotal),
    promoCode: o.promoCode ?? '',
    maxRedemptions: str(o.maxRedemptions),
    maxRedemptionsPerCustomer: str(o.maxRedemptionsPerCustomer),
    buyQuantity: str(o.buyQuantity),
    getQuantity: str(o.getQuantity),
    startsAt: toLocalInput(o.startsAt),
    endsAt: toLocalInput(o.endsAt),
    showCountdown: o.showCountdown,
    featuredOnHome: o.featuredOnHome,
    status: o.status,
    sortOrder: String(o.sortOrder),
    seoTitle: toDraft(o.seoTitle),
    seoDescription: toDraft(o.seoDescription),
    products: o.products.map((p) => ({ ...p })),
    categoryIds: o.categoryIds,
  };
}

function toInput(f: OfferForm, offer: AdminOffer | null): OfferInput {
  const lt = (d: LocalizedDraft) => ltOrNull(d.ar, d.en);
  return {
    id: offer?.id,
    expectedUpdatedAt: offer?.updatedAt,
    slug: f.slug.trim().toLowerCase(),
    kind: f.kind,
    title: lt(f.title) ?? { ar: '' },
    subtitle: lt(f.subtitle),
    description: lt(f.description),
    badge: lt(f.badge) ?? { ar: '' },
    mediaKind: f.mediaUrl.trim() ? f.mediaKind : null,
    mediaUrl: f.mediaUrl.trim() || null,
    mediaAlt: lt(f.mediaAlt),
    ctaLabel: lt(f.ctaLabel),
    ctaHref: f.ctaHref.trim() || null,
    discountPercent: numberOrNull(f.discountPercent),
    discountAmount: numberOrNull(f.discountAmount),
    bundlePrice: numberOrNull(f.bundlePrice),
    promoCode: f.promoCode.trim().toUpperCase() || null,
    minSubtotal: numberOrNull(f.minSubtotal),
    maxRedemptions: intOrNull(f.maxRedemptions),
    maxRedemptionsPerCustomer: intOrNull(f.maxRedemptionsPerCustomer),
    buyQuantity: f.kind === 'buy_x_get_y' ? intOrNull(f.buyQuantity) : null,
    getQuantity: f.kind === 'buy_x_get_y' ? intOrNull(f.getQuantity) : null,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    showCountdown: f.showCountdown,
    featuredOnHome: f.featuredOnHome,
    status: f.status,
    sortOrder: intOrNull(f.sortOrder) ?? 0,
    seoTitle: lt(f.seoTitle),
    seoDescription: lt(f.seoDescription),
    products: f.products.map((p) => ({
      productId: p.productId,
      variantId: p.variantId,
      role: p.role,
      quantity: Math.max(1, Math.trunc(p.quantity) || 1),
    })),
    categoryIds: f.categoryIds,
  };
}

/** Loads an offer (or starts a new one) and hands a fresh form to the editor. */
export function AdminOfferEditorPage() {
  const { offerId } = useParams();
  const isNew = !offerId || offerId === 'new';
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const offer = useQuery({
    queryKey: ['admin', 'offer', offerId],
    queryFn: () => repo.getOffer(offerId ?? ''),
    enabled: !isNew,
  });
  if (isNew) return <OfferEditor key="new" offer={null} savedAt={null} onSaved={setSavedAt} />;
  return (
    <QueryState query={offer}>
      {(o) =>
        o === null ? (
          <>
            <PageHeader title={at('modules.offers.title')} />
            <Alert tone="warning">{at('ui.deletedElsewhere')}</Alert>
          </>
        ) : (
          <OfferEditor key={o.updatedAt} offer={o} savedAt={savedAt} onSaved={setSavedAt} />
        )
      }
    </QueryState>
  );
}

function OfferEditor({
  offer,
  savedAt,
  onSaved,
}: {
  offer: AdminOffer | null;
  savedAt: string | null;
  onSaved: (at: string) => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const lookups = useLookups();
  const navigate = useNavigate();
  const problemText = useProblemText();
  const [initial] = useState<OfferForm>(() => (offer ? formFrom(offer) : emptyForm()));
  const [form, setForm] = useState<OfferForm>(initial);
  const [problem, setProblem] = useState<{ field?: string; text: string } | null>(null);
  const confirm = useConfirm<'delete'>();
  const canManage = can('marketing.manage');
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const guard = useDirtyGuard(dirty && canManage);
  const patch = (p: Partial<OfferForm>) => setForm((f) => ({ ...f, ...p }));

  const save = useAdminAction(() => repo.saveOffer(toInput(form, offer)), {
    onSuccess: (r) => {
      if (!r.ok) return;
      onSaved(r.updatedAt);
      guard.allowNavigation();
      if (!offer) void navigate(`/admin/offers/${r.id}`, { replace: true });
    },
  });
  const remove = useAdminAction(() => repo.deleteOffer(offer?.id ?? ''), {
    onSuccess: () => {
      guard.allowNavigation();
      void navigate('/admin/offers', { replace: true });
    },
  });

  const submit = () => {
    const input = toInput(form, offer);
    const invalid = validateOfferInput(input);
    if (invalid) {
      setProblem({ field: invalid.field, text: problemText(invalid.code) });
      return;
    }
    setProblem(null);
    void save.run();
  };
  const fieldError = (field: string) =>
    problem?.field === field ? problem.text : save.code && field === 'server' ? save.error : null;

  const kind = form.kind;
  const needsPercentOrAmount = [
    'percentage',
    'flash',
    'limited_time',
    'promo_code',
    'price_drop',
  ].includes(kind);
  const roleOptions: Role[] =
    kind === 'bundle'
      ? ['bundle_item', 'target']
      : kind === 'free_gift'
        ? ['target', 'gift']
        : ['target'];
  const title = offer ? loc(offer.title) : at('offersAdmin.new');

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: at('modules.offers.title'), to: '/admin/offers' }]}
        subtitle={
          offer ? (
            <span className={styles.chips}>
              <PublicationStateBadge state={offer.state} />
              {offer.isDemo && <Badge tone="warning">{at('ui.demo')}</Badge>}
              <span className={styles.mono}>{offer.slug}</span>
              <span className={styles.muted}>
                {at('ui.lastUpdated', { date: format.dateTime(offer.updatedAt) })}
              </span>
            </span>
          ) : (
            at('offersAdmin.newHint')
          )
        }
        actions={
          <>
            {offer && offer.status === 'published' && (
              <Link
                to={`/offers/${offer.slug}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClassName({ variant: 'secondary' })}
              >
                <ExternalLink aria-hidden="true" />
                {at('offersAdmin.viewLive')}
              </Link>
            )}
            {offer && canManage && (
              <Button
                variant="secondary"
                icon={<Trash2 aria-hidden="true" />}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('offersAdmin.deleteTitle'),
                      body:
                        offer.redemptions > 0
                          ? at('offersAdmin.deleteArchives')
                          : at('offersAdmin.deleteBody'),
                      affected: [title],
                      confirmLabel: at('ui.delete'),
                      tone: 'danger',
                    },
                    'delete',
                  )
                }
              >
                {at('ui.delete')}
              </Button>
            )}
            {canManage && (
              <Button icon={<Save aria-hidden="true" />} loading={save.pending} onClick={submit}>
                {at('ui.save')}
              </Button>
            )}
          </>
        }
      />
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {savedAt && !dirty && (
          <Alert tone="success" live>
            {at('ui.saved')}
          </Alert>
        )}
        {!canManage && <Alert tone="info">{at('contentAdmin.readOnly')}</Alert>}
        {(problem || save.error) && (
          <Alert tone="danger" live>
            {problem?.text ?? save.error}
          </Alert>
        )}
        {save.code === 'stale' && (
          <Alert tone="warning">
            <strong>{at('ui.staleTitle')}</strong> {at('ui.staleBody')}
          </Alert>
        )}
        <fieldset
          disabled={!canManage}
          className={styles.split}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <div className={styles.stack}>
            <Panel title={at('offersAdmin.section.basics')}>
              <div className={styles.stack}>
                <div className={styles.formGrid}>
                  <SelectField
                    label={at('offersAdmin.col.kind')}
                    value={kind}
                    hint={at(`offersAdmin.kindHint.${kind}` as AdminMessageKey)}
                    onChange={(e) => patch({ kind: e.target.value as OfferKind })}
                    options={OFFER_KINDS.map((k) => ({
                      value: k,
                      label: at(`offersAdmin.kind.${k}` as AdminMessageKey),
                    }))}
                  />
                  <InputField
                    label={at('catalog.editor.slug')}
                    value={form.slug}
                    ltr
                    required
                    maxLength={60}
                    error={fieldError('slug')}
                    onChange={(e) => patch({ slug: e.target.value.toLowerCase() })}
                  />
                </div>
                <LocalizedField
                  legend={at('offersAdmin.field.title')}
                  required
                  value={form.title}
                  maxLength={120}
                  error={fieldError('title')}
                  onChange={(t) =>
                    patch({ title: t, slug: offer || form.slug ? form.slug : slugify(t.en) })
                  }
                />
                <LocalizedField
                  legend={at('offersAdmin.field.badge')}
                  required
                  value={form.badge}
                  maxLength={40}
                  hint={at('offersAdmin.field.badgeHint')}
                  error={fieldError('badge')}
                  onChange={(badge) => patch({ badge })}
                />
                <LocalizedField
                  legend={at('offersAdmin.field.subtitle')}
                  value={form.subtitle}
                  maxLength={160}
                  onChange={(subtitle) => patch({ subtitle })}
                />
                <LocalizedField
                  legend={at('catalog.editor.description')}
                  value={form.description}
                  multiline
                  rows={3}
                  maxLength={2000}
                  onChange={(description) => patch({ description })}
                />
              </div>
            </Panel>

            <Panel title={at('offersAdmin.section.value')}>
              <div className={styles.stack}>
                {fieldError('discount') && (
                  <span className={styles.error} role="alert">
                    {fieldError('discount')}
                  </span>
                )}
                <div className={`${styles.formGrid} ${styles.formGrid3}`}>
                  {(needsPercentOrAmount || kind === 'fixed') && (
                    <>
                      {kind !== 'fixed' && (
                        <InputField
                          type="number"
                          inputMode="decimal"
                          min={0.01}
                          max={100}
                          step="0.01"
                          label={at('offersAdmin.field.percent')}
                          value={form.discountPercent}
                          onChange={(e) => patch({ discountPercent: e.target.value })}
                        />
                      )}
                      <InputField
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        step="0.01"
                        label={at('offersAdmin.field.amount')}
                        value={form.discountAmount}
                        onChange={(e) => patch({ discountAmount: e.target.value })}
                      />
                    </>
                  )}
                  {kind === 'bundle' && (
                    <InputField
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      label={at('offersAdmin.field.bundlePrice')}
                      value={form.bundlePrice}
                      onChange={(e) => patch({ bundlePrice: e.target.value })}
                    />
                  )}
                  {kind === 'buy_x_get_y' && (
                    <>
                      <InputField
                        type="number"
                        min={1}
                        step={1}
                        label={at('offersAdmin.field.buyQuantity')}
                        value={form.buyQuantity}
                        error={fieldError('buyQuantity')}
                        onChange={(e) => patch({ buyQuantity: e.target.value })}
                      />
                      <InputField
                        type="number"
                        min={1}
                        step={1}
                        label={at('offersAdmin.field.getQuantity')}
                        value={form.getQuantity}
                        onChange={(e) => patch({ getQuantity: e.target.value })}
                      />
                    </>
                  )}
                  <InputField
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    label={at('offersAdmin.field.minSubtotal')}
                    value={form.minSubtotal}
                    onChange={(e) => patch({ minSubtotal: e.target.value })}
                  />
                </div>
                {kind === 'promo_code' ? (
                  <div className={`${styles.formGrid} ${styles.formGrid3}`}>
                    <InputField
                      label={at('offersAdmin.field.code')}
                      value={form.promoCode}
                      ltr
                      required
                      maxLength={30}
                      hint={at('offersAdmin.field.codeHint')}
                      error={fieldError('promoCode')}
                      onChange={(e) => patch({ promoCode: e.target.value.toUpperCase() })}
                    />
                    <InputField
                      type="number"
                      min={1}
                      step={1}
                      label={at('offersAdmin.field.maxRedemptions')}
                      hint={at('offersAdmin.field.unlimitedHint')}
                      value={form.maxRedemptions}
                      onChange={(e) => patch({ maxRedemptions: e.target.value })}
                    />
                    <InputField
                      type="number"
                      min={1}
                      step={1}
                      label={at('offersAdmin.field.maxPerCustomer')}
                      hint={at('offersAdmin.field.unlimitedHint')}
                      value={form.maxRedemptionsPerCustomer}
                      onChange={(e) => patch({ maxRedemptionsPerCustomer: e.target.value })}
                    />
                  </div>
                ) : (
                  form.promoCode && (
                    <Alert tone="warning">{problemText('code_only_for_promo')}</Alert>
                  )
                )}
                <p className={`${styles.hint} ${styles.full}`}>{at('offersAdmin.pricingNote')}</p>
              </div>
            </Panel>

            <Panel title={at('offersAdmin.section.products')}>
              <div className={styles.stack}>
                {fieldError('products') && (
                  <span className={styles.error} role="alert">
                    {fieldError('products')}
                  </span>
                )}
                {form.products.length > 0 ? (
                  <ul className={styles.pickList}>
                    {form.products.map((p, i) => (
                      <li key={`${p.productId}-${i}`}>
                        <span className={styles.cellTitle}>
                          <span>{loc(p.name)}</span>
                          <span className={`${styles.mono} ${styles.muted}`}>{p.slug}</span>
                        </span>
                        <SelectField
                          label={at('offersAdmin.field.role')}
                          value={p.role}
                          onChange={(e) =>
                            patch({
                              products: form.products.map((x, j) =>
                                j === i ? { ...x, role: e.target.value as Role } : x,
                              ),
                            })
                          }
                          options={[...new Set<Role>([...roleOptions, p.role])].map((r) => ({
                            value: r,
                            label: at(`offersAdmin.role.${r}` as AdminMessageKey),
                          }))}
                        />
                        <InputField
                          type="number"
                          min={1}
                          max={99}
                          step={1}
                          label={at('offersAdmin.field.quantity')}
                          value={String(p.quantity)}
                          onChange={(e) =>
                            patch({
                              products: form.products.map((x, j) =>
                                j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x,
                              ),
                            })
                          }
                        />
                        <RemoveButton
                          label={`${at('ui.remove')}: ${loc(p.name)}`}
                          onClick={() =>
                            patch({ products: form.products.filter((_, j) => j !== i) })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>{at('offersAdmin.noProducts')}</p>
                )}
                <ProductPicker
                  picked={form.products.map((p) => p.productId)}
                  disabled={!canManage || form.products.length >= 100}
                  onAdd={(p) =>
                    patch({
                      products: [
                        ...form.products,
                        {
                          ...p,
                          variantId: null,
                          quantity: 1,
                          role: kind === 'bundle' ? 'bundle_item' : 'target',
                        },
                      ],
                    })
                  }
                />
                <fieldset className={styles.chips} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className={styles.fieldLabel}>
                    {at('offersAdmin.field.categories')}
                  </legend>
                  {(lookups.data?.categories ?? []).map((c) => (
                    <CheckboxField
                      key={c.id}
                      label={loc(c.name)}
                      checked={form.categoryIds.includes(c.id)}
                      onChange={(on) =>
                        patch({
                          categoryIds: on
                            ? [...form.categoryIds, c.id]
                            : form.categoryIds.filter((x) => x !== c.id),
                        })
                      }
                    />
                  ))}
                </fieldset>
              </div>
            </Panel>

            <Panel title={at('offersAdmin.section.media')}>
              <div className={styles.stack}>
                <div className={styles.formGrid}>
                  <SelectField
                    label={at('offersAdmin.field.mediaKind')}
                    value={form.mediaKind}
                    onChange={(e) => patch({ mediaKind: e.target.value as 'image' | 'video' })}
                    options={[
                      { value: 'image', label: at('offersAdmin.media.image') },
                      { value: 'video', label: at('offersAdmin.media.video') },
                    ]}
                  />
                  <InputField
                    label={at('offersAdmin.field.mediaUrl')}
                    value={form.mediaUrl}
                    ltr
                    error={fieldError('mediaUrl')}
                    onChange={(e) => patch({ mediaUrl: e.target.value })}
                  />
                </div>
                {form.mediaKind === 'image' && (
                  <ImageUpload onUploaded={(url) => patch({ mediaUrl: url, mediaKind: 'image' })} />
                )}
                {form.mediaUrl && form.mediaKind === 'image' && (
                  <img src={form.mediaUrl} alt="" className={styles.mediaPreview} loading="lazy" />
                )}
                <LocalizedField
                  legend={at('offersAdmin.field.mediaAlt')}
                  value={form.mediaAlt}
                  maxLength={160}
                  onChange={(mediaAlt) => patch({ mediaAlt })}
                />
                <div className={styles.formGrid}>
                  <InputField
                    label={at('offersAdmin.field.ctaHref')}
                    value={form.ctaHref}
                    ltr
                    placeholder="/store?offer=…"
                    hint={at('contentAdmin.linkHint')}
                    error={fieldError('ctaHref')}
                    onChange={(e) => patch({ ctaHref: e.target.value })}
                  />
                </div>
                <LocalizedField
                  legend={at('offersAdmin.field.ctaLabel')}
                  value={form.ctaLabel}
                  maxLength={40}
                  onChange={(ctaLabel) => patch({ ctaLabel })}
                />
              </div>
            </Panel>
          </div>

          <div className={styles.stack}>
            <Panel title={at('offersAdmin.section.publishing')}>
              <div className={styles.stack}>
                <SelectField
                  label={at('offersAdmin.col.state')}
                  value={form.status}
                  onChange={(e) => patch({ status: e.target.value as ProductStatus })}
                  options={PRODUCT_STATUSES.map((s) => ({
                    value: s,
                    label: at(`catalog.status.${s}` as AdminMessageKey),
                  }))}
                />
                <InputField
                  type="datetime-local"
                  label={at('offersAdmin.field.startsAt')}
                  hint={at('offersAdmin.field.startsHint')}
                  value={form.startsAt}
                  onChange={(e) => patch({ startsAt: e.target.value })}
                />
                <InputField
                  type="datetime-local"
                  label={at('offersAdmin.field.endsAt')}
                  hint={at('offersAdmin.field.endsHint')}
                  value={form.endsAt}
                  error={fieldError('endsAt')}
                  onChange={(e) => patch({ endsAt: e.target.value })}
                />
                <CheckboxField
                  label={at('offersAdmin.field.countdown')}
                  hint={at('offersAdmin.field.countdownHint')}
                  checked={form.showCountdown}
                  onChange={(showCountdown) => patch({ showCountdown })}
                />
                <CheckboxField
                  label={at('offersAdmin.home')}
                  hint={at('offersAdmin.field.homeHint')}
                  checked={form.featuredOnHome}
                  onChange={(featuredOnHome) => patch({ featuredOnHome })}
                />
                <InputField
                  type="number"
                  step={1}
                  label={at('offersAdmin.field.sortOrder')}
                  value={form.sortOrder}
                  onChange={(e) => patch({ sortOrder: e.target.value })}
                />
              </div>
            </Panel>
            <Panel title={at('catalog.tabs.seo')}>
              <div className={styles.stack}>
                <LocalizedField
                  legend={at('catalog.editor.seoTitle')}
                  value={form.seoTitle}
                  maxLength={70}
                  onChange={(seoTitle) => patch({ seoTitle })}
                />
                <LocalizedField
                  legend={at('catalog.editor.seoDescription')}
                  value={form.seoDescription}
                  multiline
                  rows={2}
                  maxLength={170}
                  onChange={(seoDescription) => patch({ seoDescription })}
                />
              </div>
            </Panel>
          </div>
        </fieldset>
      </form>
      {canManage && (
        <DirtyBar
          dirty={dirty}
          saving={save.pending}
          onSave={submit}
          onDiscard={() => {
            setForm(initial);
            setProblem(null);
            save.reset();
          }}
        />
      )}
      <UnsavedChangesDialog blocker={guard.blocker} />
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={remove.pending}
        error={remove.error}
        onCancel={confirm.close}
        onConfirm={() => void remove.run()}
      />
    </>
  );
}
