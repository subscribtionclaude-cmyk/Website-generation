import { useQuery } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  AVAILABILITY_STATES,
  ENTRY_TYPES,
  PRODUCT_STATUSES,
  type AdminEntry,
  type EntryInput,
  type EntryType,
  type ProductStatus,
} from '@/domain/admin/schemas';
import { ltOrNull, slugify, validateEntryInput } from '@/domain/admin/validation';
import type { LocalizedText } from '@/domain/localized';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, InputField, LocalizedField, SelectField } from '../../ui/fields';
import { toDraft, useConfirm, useDirtyGuard, type LocalizedDraft } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { DirtyBar, UnsavedChangesDialog } from '../../ui/useDirtyGuard';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useProblemText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import { ImageUpload, StatusBadge } from '../catalog/catalogParts';
import { useLocalized } from '../catalog/catalogHooks';
import { ProductPicker, RemoveButton } from './contentParts';
import { fromLocalInput, toLocalInput } from './contentTime';

type Availability = (typeof AVAILABILITY_STATES)[number];
interface EntryForm {
  slug: string;
  type: EntryType;
  eyebrow: LocalizedDraft;
  title: LocalizedDraft;
  subtitle: LocalizedDraft;
  excerpt: LocalizedDraft;
  body: LocalizedDraft;
  mediaKind: 'image' | 'video';
  mediaUrl: string;
  mediaPosterUrl: string;
  mediaAlt: LocalizedDraft;
  ctaLabel: LocalizedDraft;
  ctaHref: string;
  secondaryCtaLabel: LocalizedDraft;
  secondaryCtaHref: string;
  state: Availability | '';
  releaseDate: string;
  publishAt: string;
  expiresAt: string;
  isFeatured: boolean;
  status: ProductStatus;
  seoTitle: LocalizedDraft;
  seoDescription: LocalizedDraft;
  products: { productId: string; name: LocalizedText; slug: string }[];
}

const EMPTY_LT = { ar: '', en: '' };

function emptyForm(): EntryForm {
  return {
    slug: '',
    type: 'news',
    eyebrow: EMPTY_LT,
    title: EMPTY_LT,
    subtitle: EMPTY_LT,
    excerpt: EMPTY_LT,
    body: EMPTY_LT,
    mediaKind: 'image',
    mediaUrl: '',
    mediaPosterUrl: '',
    mediaAlt: EMPTY_LT,
    ctaLabel: EMPTY_LT,
    ctaHref: '',
    secondaryCtaLabel: EMPTY_LT,
    secondaryCtaHref: '',
    state: '',
    releaseDate: '',
    publishAt: toLocalInput(new Date().toISOString()),
    expiresAt: '',
    isFeatured: false,
    status: 'draft',
    seoTitle: EMPTY_LT,
    seoDescription: EMPTY_LT,
    products: [],
  };
}

function formFrom(e: AdminEntry): EntryForm {
  return {
    slug: e.slug,
    type: e.type,
    eyebrow: toDraft(e.eyebrow),
    title: toDraft(e.title),
    subtitle: toDraft(e.subtitle),
    excerpt: toDraft(e.excerpt),
    body: toDraft(e.body),
    mediaKind: e.mediaKind ?? 'image',
    mediaUrl: e.mediaUrl ?? '',
    mediaPosterUrl: e.mediaPosterUrl ?? '',
    mediaAlt: toDraft(e.mediaAlt),
    ctaLabel: toDraft(e.ctaLabel),
    ctaHref: e.ctaHref ?? '',
    secondaryCtaLabel: toDraft(e.secondaryCtaLabel),
    secondaryCtaHref: e.secondaryCtaHref ?? '',
    state: e.state ?? '',
    releaseDate: toLocalInput(e.releaseDate),
    publishAt: toLocalInput(e.publishAt),
    expiresAt: toLocalInput(e.expiresAt),
    isFeatured: e.isFeatured,
    status: e.status,
    seoTitle: toDraft(e.seoTitle),
    seoDescription: toDraft(e.seoDescription),
    products: e.products,
  };
}

function toInput(f: EntryForm, entry: AdminEntry | null): EntryInput {
  const lt = (d: LocalizedDraft) => ltOrNull(d.ar, d.en);
  return {
    id: entry?.id,
    expectedUpdatedAt: entry?.updatedAt,
    slug: f.slug.trim().toLowerCase(),
    type: f.type,
    eyebrow: lt(f.eyebrow),
    title: lt(f.title) ?? { ar: '' },
    subtitle: lt(f.subtitle),
    excerpt: lt(f.excerpt),
    body: lt(f.body),
    mediaKind: f.mediaUrl.trim() ? f.mediaKind : null,
    mediaUrl: f.mediaUrl.trim() || null,
    mediaPosterUrl: f.mediaPosterUrl.trim() || null,
    mediaAlt: lt(f.mediaAlt),
    ctaLabel: lt(f.ctaLabel),
    ctaHref: f.ctaHref.trim() || null,
    secondaryCtaLabel: lt(f.secondaryCtaLabel),
    secondaryCtaHref: f.secondaryCtaHref.trim() || null,
    state: f.state || null,
    releaseDate: fromLocalInput(f.releaseDate),
    publishAt: fromLocalInput(f.publishAt) ?? new Date().toISOString(),
    expiresAt: fromLocalInput(f.expiresAt),
    isFeatured: f.isFeatured,
    status: f.status,
    seoTitle: lt(f.seoTitle),
    seoDescription: lt(f.seoDescription),
    productIds: f.products.map((p) => p.productId),
  };
}

export function AdminNewsEditorPage() {
  const { entryId } = useParams();
  const isNew = !entryId || entryId === 'new';
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const entry = useQuery({
    queryKey: ['admin', 'entry', entryId],
    queryFn: () => repo.getEntry(entryId ?? ''),
    enabled: !isNew,
  });
  if (isNew) return <EntryEditor key="new" entry={null} savedAt={null} onSaved={setSavedAt} />;
  return (
    <QueryState query={entry}>
      {(e) =>
        e === null ? (
          <>
            <PageHeader title={at('modules.news.title')} />
            <Alert tone="warning">{at('ui.deletedElsewhere')}</Alert>
          </>
        ) : (
          <EntryEditor key={e.updatedAt} entry={e} savedAt={savedAt} onSaved={setSavedAt} />
        )
      }
    </QueryState>
  );
}

function EntryEditor({
  entry,
  savedAt,
  onSaved,
}: {
  entry: AdminEntry | null;
  savedAt: string | null;
  onSaved: (at: string) => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const navigate = useNavigate();
  const problemText = useProblemText();
  const [initial] = useState<EntryForm>(() => (entry ? formFrom(entry) : emptyForm()));
  const [form, setForm] = useState<EntryForm>(initial);
  const [problem, setProblem] = useState<{ field?: string; text: string } | null>(null);
  const confirm = useConfirm<'delete'>();
  const canManage = can('content.manage');
  const canPublish = can('content.publish');
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const guard = useDirtyGuard(dirty && canManage);
  const patch = (p: Partial<EntryForm>) => setForm((f) => ({ ...f, ...p }));
  // Without content.publish, the status stays what it was (the database refuses a change).
  const statusLocked = !canPublish;

  const save = useAdminAction(() => repo.saveEntry(toInput(form, entry)), {
    onSuccess: (r) => {
      if (!r.ok) return;
      onSaved(r.updatedAt);
      guard.allowNavigation();
      if (!entry) void navigate(`/admin/news/${r.id}`, { replace: true });
    },
  });
  const remove = useAdminAction(() => repo.deleteEntry(entry?.id ?? ''), {
    onSuccess: () => {
      guard.allowNavigation();
      void navigate('/admin/news', { replace: true });
    },
  });
  const submit = () => {
    const invalid = validateEntryInput(toInput(form, entry));
    if (invalid) {
      setProblem({ field: invalid.field, text: problemText(invalid.code) });
      return;
    }
    setProblem(null);
    void save.run();
  };
  const fieldError = (field: string) => (problem?.field === field ? problem.text : null);
  const title = entry ? loc(entry.title) : at('newsAdmin.new');

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: at('modules.news.title'), to: '/admin/news' }]}
        subtitle={
          entry ? (
            <span className={styles.chips}>
              <StatusBadge status={entry.status} />
              {entry.isDemo && <Badge tone="warning">{at('ui.demo')}</Badge>}
              <span className={styles.mono}>{entry.slug}</span>
              <span className={styles.muted}>
                {at('ui.lastUpdated', { date: format.dateTime(entry.updatedAt) })}
              </span>
            </span>
          ) : (
            at('newsAdmin.newHint')
          )
        }
        actions={
          <>
            {entry && canPublish && (
              <Button
                variant="secondary"
                icon={<Trash2 aria-hidden="true" />}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('newsAdmin.deleteTitle'),
                      affected: [title],
                      confirmLabel: at('ui.delete'),
                      tone: 'danger',
                      irreversible: true,
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
        {canManage && !canPublish && <Alert tone="info">{at('newsAdmin.noPublish')}</Alert>}
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
            <Panel title={at('newsAdmin.section.text')}>
              <div className={styles.stack}>
                <div className={styles.formGrid}>
                  <SelectField
                    label={at('newsAdmin.col.type')}
                    value={form.type}
                    onChange={(e) => patch({ type: e.target.value as EntryType })}
                    options={ENTRY_TYPES.map((t) => ({
                      value: t,
                      label: at(`newsAdmin.type.${t}` as AdminMessageKey),
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
                  legend={at('newsAdmin.field.eyebrow')}
                  value={form.eyebrow}
                  maxLength={60}
                  onChange={(eyebrow) => patch({ eyebrow })}
                />
                <LocalizedField
                  legend={at('newsAdmin.col.title')}
                  required
                  value={form.title}
                  maxLength={140}
                  error={fieldError('title')}
                  onChange={(t) =>
                    patch({ title: t, slug: entry || form.slug ? form.slug : slugify(t.en) })
                  }
                />
                <LocalizedField
                  legend={at('offersAdmin.field.subtitle')}
                  value={form.subtitle}
                  maxLength={200}
                  onChange={(subtitle) => patch({ subtitle })}
                />
                <LocalizedField
                  legend={at('newsAdmin.field.excerpt')}
                  value={form.excerpt}
                  multiline
                  rows={2}
                  maxLength={300}
                  onChange={(excerpt) => patch({ excerpt })}
                />
                <LocalizedField
                  legend={at('newsAdmin.field.body')}
                  value={form.body}
                  multiline
                  rows={8}
                  maxLength={20000}
                  hint={at('newsAdmin.field.bodyHint')}
                  onChange={(body) => patch({ body })}
                />
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
                  {form.mediaKind === 'video' && (
                    <InputField
                      label={at('newsAdmin.field.poster')}
                      value={form.mediaPosterUrl}
                      ltr
                      onChange={(e) => patch({ mediaPosterUrl: e.target.value })}
                    />
                  )}
                </div>
                <ImageUpload
                  label={
                    form.mediaKind === 'video' ? at('newsAdmin.field.uploadPoster') : undefined
                  }
                  onUploaded={(url) =>
                    form.mediaKind === 'video'
                      ? patch({ mediaPosterUrl: url })
                      : patch({ mediaUrl: url })
                  }
                />
                {(form.mediaKind === 'image' ? form.mediaUrl : form.mediaPosterUrl) && (
                  <img
                    src={form.mediaKind === 'image' ? form.mediaUrl : form.mediaPosterUrl}
                    alt=""
                    className={styles.mediaPreview}
                    loading="lazy"
                  />
                )}
                <LocalizedField
                  legend={at('offersAdmin.field.mediaAlt')}
                  value={form.mediaAlt}
                  maxLength={160}
                  onChange={(mediaAlt) => patch({ mediaAlt })}
                />
              </div>
            </Panel>
            <Panel title={at('newsAdmin.section.links')}>
              <div className={styles.stack}>
                <div className={styles.formGrid}>
                  <InputField
                    label={at('offersAdmin.field.ctaHref')}
                    value={form.ctaHref}
                    ltr
                    hint={at('contentAdmin.linkHint')}
                    error={fieldError('ctaHref')}
                    onChange={(e) => patch({ ctaHref: e.target.value })}
                  />
                  <InputField
                    label={at('newsAdmin.field.secondaryHref')}
                    value={form.secondaryCtaHref}
                    ltr
                    onChange={(e) => patch({ secondaryCtaHref: e.target.value })}
                  />
                </div>
                <LocalizedField
                  legend={at('offersAdmin.field.ctaLabel')}
                  value={form.ctaLabel}
                  maxLength={40}
                  onChange={(ctaLabel) => patch({ ctaLabel })}
                />
                <LocalizedField
                  legend={at('newsAdmin.field.secondaryLabel')}
                  value={form.secondaryCtaLabel}
                  maxLength={40}
                  onChange={(secondaryCtaLabel) => patch({ secondaryCtaLabel })}
                />
              </div>
            </Panel>
            <Panel title={at('newsAdmin.section.products')}>
              <div className={styles.stack}>
                {form.products.length > 0 ? (
                  <ul className={styles.pickList}>
                    {form.products.map((p) => (
                      <li key={p.productId}>
                        <span className={styles.cellTitle}>
                          <span>{loc(p.name)}</span>
                          <span className={`${styles.mono} ${styles.muted}`}>{p.slug}</span>
                        </span>
                        <RemoveButton
                          label={`${at('ui.remove')}: ${loc(p.name)}`}
                          onClick={() =>
                            patch({
                              products: form.products.filter((x) => x.productId !== p.productId),
                            })
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
                  disabled={!canManage || form.products.length >= 24}
                  onAdd={(p) => patch({ products: [...form.products, p] })}
                />
              </div>
            </Panel>
          </div>
          <div className={styles.stack}>
            <Panel title={at('offersAdmin.section.publishing')}>
              <div className={styles.stack}>
                <SelectField
                  label={at('newsAdmin.col.status')}
                  value={form.status}
                  disabled={statusLocked}
                  hint={statusLocked ? at('newsAdmin.noPublish') : undefined}
                  onChange={(e) => patch({ status: e.target.value as ProductStatus })}
                  options={PRODUCT_STATUSES.map((s) => ({
                    value: s,
                    label: at(`catalog.status.${s}` as AdminMessageKey),
                  }))}
                />
                <InputField
                  type="datetime-local"
                  label={at('newsAdmin.field.publishAt')}
                  hint={at('newsAdmin.field.publishAtHint')}
                  value={form.publishAt}
                  required
                  onChange={(e) => patch({ publishAt: e.target.value })}
                />
                <InputField
                  type="datetime-local"
                  label={at('newsAdmin.field.expiresAt')}
                  value={form.expiresAt}
                  error={fieldError('expiresAt')}
                  onChange={(e) => patch({ expiresAt: e.target.value })}
                />
                <CheckboxField
                  label={at('newsAdmin.featured')}
                  checked={form.isFeatured}
                  onChange={(isFeatured) => patch({ isFeatured })}
                />
              </div>
            </Panel>
            {(form.type === 'coming_soon' || form.type === 'new_release') && (
              <Panel title={at('newsAdmin.section.release')}>
                <div className={styles.stack}>
                  <SelectField
                    label={at('newsAdmin.field.state')}
                    value={form.state}
                    onChange={(e) => patch({ state: e.target.value as Availability | '' })}
                    options={[
                      { value: '', label: at('ui.none') },
                      ...AVAILABILITY_STATES.map((s) => ({
                        value: s,
                        label: at(`catalog.availability.${s}` as AdminMessageKey),
                      })),
                    ]}
                  />
                  <InputField
                    type="datetime-local"
                    label={at('newsAdmin.field.releaseDate')}
                    hint={at('newsAdmin.field.releaseHint')}
                    value={form.releaseDate}
                    onChange={(e) => patch({ releaseDate: e.target.value })}
                  />
                </div>
              </Panel>
            )}
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
