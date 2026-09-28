import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AdminBrand, BrandInput } from '@/domain/admin/schemas';
import { ltOrNull, slugify } from '@/domain/admin/validation';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { CheckboxField, InputField, LocalizedField } from '../../ui/fields';
import { toDraft, useConfirm, type LocalizedDraft } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized, useLookups } from './catalogHooks';
import { ImageUpload } from './catalogParts';

interface BrandForm {
  id?: string;
  expectedUpdatedAt?: string;
  slug: string;
  name: LocalizedDraft;
  description: LocalizedDraft;
  logoUrl: string;
  sortOrder: number;
  isVisible: boolean;
  isFeatured: boolean;
  showOnApple: boolean;
  seoTitle: LocalizedDraft;
  seoDescription: LocalizedDraft;
  categoryIds: string[];
}

const emptyForm = (): BrandForm => ({
  slug: '',
  name: { ar: '', en: '' },
  description: { ar: '', en: '' },
  logoUrl: '',
  sortOrder: 0,
  isVisible: true,
  isFeatured: false,
  showOnApple: false,
  seoTitle: { ar: '', en: '' },
  seoDescription: { ar: '', en: '' },
  categoryIds: [],
});

const formFrom = (b: AdminBrand): BrandForm => ({
  id: b.id,
  expectedUpdatedAt: b.updatedAt,
  slug: b.slug,
  name: toDraft(b.name),
  description: toDraft(b.description),
  logoUrl: b.logoUrl ?? '',
  sortOrder: b.sortOrder,
  isVisible: b.isVisible,
  isFeatured: b.isFeatured,
  showOnApple: b.showOnApple,
  seoTitle: toDraft(b.seoTitle),
  seoDescription: toDraft(b.seoDescription),
  categoryIds: b.categoryIds,
});

/** Brands: logo, description, visibility, featured, Apple landing participation, categories, SEO. */
export function AdminBrandsPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const lookups = useLookups();
  const list = useQuery({ queryKey: ['admin', 'brands'], queryFn: () => repo.listBrands() });
  const [form, setForm] = useState<BrandForm | null>(null);
  const confirm = useConfirm<AdminBrand>();
  const canManage = can('catalog.manage');

  const save = useAdminAction(
    (f: BrandForm) => {
      const input: BrandInput = {
        id: f.id,
        expectedUpdatedAt: f.expectedUpdatedAt,
        slug: f.slug.trim().toLowerCase(),
        name: ltOrNull(f.name.ar, f.name.en) ?? { ar: '' },
        description: ltOrNull(f.description.ar, f.description.en),
        logoUrl: f.logoUrl.trim() || null,
        sortOrder: f.sortOrder,
        isVisible: f.isVisible,
        isFeatured: f.isFeatured,
        showOnApple: f.showOnApple,
        seoTitle: ltOrNull(f.seoTitle.ar, f.seoTitle.en),
        seoDescription: ltOrNull(f.seoDescription.ar, f.seoDescription.en),
        categoryIds: f.categoryIds,
      };
      return repo.saveBrand(input);
    },
    { onSuccess: () => setForm(null) },
  );
  const remove = useAdminAction((id: string) => repo.deleteBrand(id));

  const columns: Column<AdminBrand>[] = [
    {
      id: 'logo',
      header: <span className="visually-hidden">{at('catalog.brand.logo')}</span>,
      cell: (b) =>
        b.logoUrl ? <img className={styles.thumb} src={b.logoUrl} alt="" loading="lazy" /> : null,
    },
    {
      id: 'name',
      header: at('catalog.col.brand'),
      rowHeader: true,
      cell: (b) => (
        <span className={styles.cellTitle}>
          <span>{loc(b.name)}</span>
          <span className={`${styles.mono} ${styles.muted}`}>{b.slug}</span>
        </span>
      ),
    },
    {
      id: 'products',
      header: at('catalog.col.products'),
      className: styles.num,
      cell: (b) => format.number(b.productCount),
    },
    {
      id: 'flags',
      header: at('catalog.col.placement'),
      cell: (b) => (
        <span className={styles.chips}>
          {!b.isVisible && <Badge>{at('catalog.hidden')}</Badge>}
          {b.isFeatured && <Badge tone="brand">{at('catalog.brand.featured')}</Badge>}
          {b.showOnApple && <Badge tone="info">{at('catalog.brand.apple')}</Badge>}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: (b) =>
        canManage && (
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.edit')}: ${loc(b.name)}`}
              onClick={() => {
                save.reset();
                setForm(formFrom(b));
              }}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.delete')}: ${loc(b.name)}`}
              onClick={() =>
                confirm.ask(
                  {
                    title: at('catalog.brand.deleteTitle'),
                    body: at('catalog.brand.deleteBody'),
                    affected: [loc(b.name)],
                    confirmLabel: at('ui.delete'),
                    tone: 'danger',
                  },
                  b,
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        ),
    },
  ];

  const patch = (p: Partial<BrandForm>) => form && setForm({ ...form, ...p });
  return (
    <>
      <PageHeader
        title={at('modules.brands.title')}
        subtitle={at('catalog.brand.subtitle')}
        actions={
          canManage && (
            <Button
              icon={<Plus aria-hidden="true" />}
              onClick={() => {
                save.reset();
                setForm(emptyForm());
              }}
            >
              {at('catalog.brand.new')}
            </Button>
          )
        }
      />
      <div className={styles.stack}>
        {remove.error && (
          <Alert tone="danger" live>
            {remove.error}
          </Alert>
        )}
        <QueryState query={list} isEmpty={(d) => d.length === 0}>
          {(data) => (
            <DataTable
              caption={at('modules.brands.title')}
              rows={data}
              rowKey={(b) => b.id}
              columns={columns}
            />
          )}
        </QueryState>
      </div>
      {form && (
        <Dialog
          open
          onClose={() => setForm(null)}
          title={form.id ? at('catalog.brand.edit') : at('catalog.brand.new')}
          wide
          icon={null}
        >
          <form
            className={styles.stack}
            onSubmit={(e) => {
              e.preventDefault();
              void save.run(form);
            }}
          >
            <LocalizedField
              legend={at('catalog.editor.name')}
              required
              value={form.name}
              onChange={(name) =>
                patch({ name, slug: form.id || form.slug ? form.slug : slugify(name.en) })
              }
            />
            <div className={styles.formGrid}>
              <InputField
                label={at('catalog.editor.slug')}
                value={form.slug}
                ltr
                required
                maxLength={60}
                onChange={(e) => patch({ slug: e.target.value.toLowerCase() })}
              />
              <InputField
                label={at('catalog.brand.logoUrl')}
                value={form.logoUrl}
                ltr
                onChange={(e) => patch({ logoUrl: e.target.value })}
              />
            </div>
            <ImageUpload
              label={at('catalog.brand.uploadLogo')}
              onUploaded={(url) => patch({ logoUrl: url })}
            />
            <LocalizedField
              legend={at('catalog.editor.description')}
              value={form.description}
              multiline
              rows={3}
              onChange={(description) => patch({ description })}
            />
            <fieldset className={styles.chips} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={styles.fieldLabel}>{at('catalog.col.placement')}</legend>
              <CheckboxField
                label={at('catalog.visible')}
                checked={form.isVisible}
                onChange={(isVisible) => patch({ isVisible })}
              />
              <CheckboxField
                label={at('catalog.brand.featured')}
                checked={form.isFeatured}
                onChange={(isFeatured) => patch({ isFeatured })}
              />
              <CheckboxField
                label={at('catalog.brand.apple')}
                hint={at('catalog.brand.appleHint')}
                checked={form.showOnApple}
                onChange={(showOnApple) => patch({ showOnApple })}
              />
            </fieldset>
            <fieldset className={styles.chips} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={styles.fieldLabel}>{at('catalog.brand.categories')}</legend>
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
            {save.error && (
              <Alert tone="danger" live>
                {save.error}
              </Alert>
            )}
            <div className={styles.dialogActions}>
              <Button variant="secondary" onClick={() => setForm(null)}>
                {at('ui.cancel')}
              </Button>
              <Button type="submit" loading={save.pending}>
                {at('ui.save')}
              </Button>
            </div>
          </form>
        </Dialog>
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
    </>
  );
}
