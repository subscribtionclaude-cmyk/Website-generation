import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AdminCategory, CategoryInput } from '@/domain/admin/schemas';
import { ltOrNull, slugify } from '@/domain/admin/validation';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { CheckboxField, InputField, LocalizedField, SelectField } from '../../ui/fields';
import { toDraft, useConfirm, type LocalizedDraft } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from './catalogHooks';
import { ImageUpload } from './catalogParts';

interface CategoryForm {
  id?: string;
  expectedUpdatedAt?: string;
  slug: string;
  parentId: string;
  name: LocalizedDraft;
  description: LocalizedDraft;
  icon: string;
  imageUrl: string;
  sortOrder: number;
  isVisible: boolean;
  showInNav: boolean;
  showOnHome: boolean;
  showInShop: boolean;
  showInCategoryGrid: boolean;
  seoTitle: LocalizedDraft;
  seoDescription: LocalizedDraft;
}

const emptyForm = (): CategoryForm => ({
  slug: '',
  parentId: '',
  name: { ar: '', en: '' },
  description: { ar: '', en: '' },
  icon: '',
  imageUrl: '',
  sortOrder: 0,
  isVisible: true,
  showInNav: false,
  showOnHome: false,
  showInShop: true,
  showInCategoryGrid: false,
  seoTitle: { ar: '', en: '' },
  seoDescription: { ar: '', en: '' },
});

const formFrom = (c: AdminCategory): CategoryForm => ({
  id: c.id,
  expectedUpdatedAt: c.updatedAt,
  slug: c.slug,
  parentId: c.parentId ?? '',
  name: toDraft(c.name),
  description: toDraft(c.description),
  icon: c.icon ?? '',
  imageUrl: c.imageUrl ?? '',
  sortOrder: c.sortOrder,
  isVisible: c.isVisible,
  showInNav: c.showInNav,
  showOnHome: c.showOnHome,
  showInShop: c.showInShop,
  showInCategoryGrid: c.showInCategoryGrid,
  seoTitle: toDraft(c.seoTitle),
  seoDescription: toDraft(c.seoDescription),
});

/** Depth-first order so sub-categories sit under their parent. */
function treeOrder(
  list: AdminCategory[],
): { category: AdminCategory; depth: number; siblings: AdminCategory[] }[] {
  const out: { category: AdminCategory; depth: number; siblings: AdminCategory[] }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const siblings = list
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
    for (const c of siblings) {
      out.push({ category: c, depth, siblings });
      if (depth < 10) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent deleted elsewhere) stay visible at the end.
  for (const c of list)
    if (!out.some((x) => x.category.id === c.id))
      out.push({ category: c, depth: 0, siblings: [c] });
  return out;
}

/** Category tree: create / edit / reorder / delete, navigation flags, SEO; cycles refused. */
export function AdminCategoriesPage() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const list = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => repo.listCategories(),
  });
  const [form, setForm] = useState<CategoryForm | null>(null);
  const confirm = useConfirm<AdminCategory>();
  const canManage = can('catalog.manage');

  const save = useAdminAction(
    (f: CategoryForm) => {
      const input: CategoryInput = {
        id: f.id,
        expectedUpdatedAt: f.expectedUpdatedAt,
        slug: f.slug.trim().toLowerCase(),
        parentId: f.parentId || null,
        name: ltOrNull(f.name.ar, f.name.en) ?? { ar: '' },
        description: ltOrNull(f.description.ar, f.description.en),
        icon: f.icon.trim() || null,
        imageUrl: f.imageUrl.trim() || null,
        sortOrder: f.sortOrder,
        isVisible: f.isVisible,
        showInNav: f.showInNav,
        showOnHome: f.showOnHome,
        showInShop: f.showInShop,
        showInCategoryGrid: f.showInCategoryGrid,
        seoTitle: ltOrNull(f.seoTitle.ar, f.seoTitle.en),
        seoDescription: ltOrNull(f.seoDescription.ar, f.seoDescription.en),
      };
      return repo.saveCategory(input);
    },
    { onSuccess: () => setForm(null) },
  );
  const reorder = useAdminAction((parentId: string | null, ids: string[]) =>
    repo.reorderCategories(parentId, ids),
  );
  const remove = useAdminAction((id: string) => repo.deleteCategory(id));

  const columns: Column<ReturnType<typeof treeOrder>[number]>[] = [
    {
      id: 'name',
      header: at('catalog.col.category'),
      rowHeader: true,
      cell: ({ category: c, depth }) => (
        <span className={styles.cellTitle} style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
          <span>
            {depth > 0 && <span aria-hidden="true">↳ </span>}
            {loc(c.name)}
          </span>
          <span className={`${styles.mono} ${styles.muted}`}>{c.slug}</span>
        </span>
      ),
    },
    {
      id: 'products',
      header: at('catalog.col.products'),
      className: styles.num,
      cell: ({ category: c }) => format.number(c.productCount),
    },
    {
      id: 'flags',
      header: at('catalog.col.placement'),
      cell: ({ category: c }) => (
        <span className={styles.chips}>
          {!c.isVisible && <Badge tone="neutral">{at('catalog.hidden')}</Badge>}
          {c.showInNav && <Badge>{at('catalog.category.nav')}</Badge>}
          {c.showOnHome && <Badge>{at('catalog.category.home')}</Badge>}
          {c.showInShop && <Badge>{at('catalog.category.shop')}</Badge>}
          {c.showInCategoryGrid && <Badge>{at('catalog.category.grid')}</Badge>}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: ({ category: c, siblings }) => {
        const index = siblings.findIndex((s) => s.id === c.id);
        const moveTo = (delta: number) => {
          const ids = siblings.map((s) => s.id);
          const [id] = ids.splice(index, 1);
          if (id) ids.splice(index + delta, 0, id);
          void reorder.run(c.parentId, ids);
        };
        return canManage ? (
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.iconButton}
              disabled={index <= 0 || reorder.pending}
              aria-label={`${at('ui.moveUp')}: ${loc(c.name)}`}
              onClick={() => moveTo(-1)}
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              disabled={index >= siblings.length - 1 || reorder.pending}
              aria-label={`${at('ui.moveDown')}: ${loc(c.name)}`}
              onClick={() => moveTo(1)}
            >
              <ArrowDown aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.edit')}: ${loc(c.name)}`}
              onClick={() => {
                save.reset();
                setForm(formFrom(c));
              }}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.delete')}: ${loc(c.name)}`}
              onClick={() =>
                confirm.ask(
                  {
                    title: at('catalog.category.deleteTitle'),
                    body: at('catalog.category.deleteBody'),
                    affected: [loc(c.name)],
                    confirmLabel: at('ui.delete'),
                    tone: 'danger',
                  },
                  c,
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        ) : null;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={at('modules.categories.title')}
        subtitle={at('catalog.category.subtitle')}
        actions={
          canManage && (
            <Button
              icon={<Plus aria-hidden="true" />}
              onClick={() => {
                save.reset();
                setForm(emptyForm());
              }}
            >
              {at('catalog.category.new')}
            </Button>
          )
        }
      />
      <div className={styles.stack}>
        {(reorder.error ?? remove.error) && (
          <Alert tone="danger" live>
            {reorder.error ?? remove.error}
          </Alert>
        )}
        <QueryState query={list} isEmpty={(d) => d.length === 0}>
          {(data) => {
            const rows = treeOrder(data);
            return (
              <DataTable
                caption={at('modules.categories.title')}
                rows={rows}
                rowKey={(r) => r.category.id}
                columns={columns}
              />
            );
          }}
        </QueryState>
      </div>
      {form && (
        <CategoryDialog
          form={form}
          setForm={setForm}
          all={list.data ?? []}
          pending={save.pending}
          error={save.error}
          onSubmit={() => void save.run(form)}
        />
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

function CategoryDialog({
  form,
  setForm,
  all,
  pending,
  error,
  onSubmit,
}: {
  form: CategoryForm;
  setForm: (f: CategoryForm | null) => void;
  all: AdminCategory[];
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const { at } = useAdminI18n();
  const loc = useLocalized();
  // Hide the category itself and its descendants from the parent list (the server refuses cycles too).
  const descendants = new Set<string>();
  if (form.id) {
    const walk = (id: string) => {
      descendants.add(id);
      for (const c of all) if (c.parentId === id && !descendants.has(c.id)) walk(c.id);
    };
    walk(form.id);
  }
  const patch = (p: Partial<CategoryForm>) => setForm({ ...form, ...p });
  return (
    <Dialog
      open
      onClose={() => setForm(null)}
      title={form.id ? at('catalog.category.edit') : at('catalog.category.new')}
      wide
      icon={null}
    >
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
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
          <SelectField
            label={at('catalog.category.parent')}
            value={form.parentId}
            onChange={(e) => patch({ parentId: e.target.value })}
            options={[
              { value: '', label: at('catalog.category.root') },
              ...all
                .filter((c) => !descendants.has(c.id))
                .map((c) => ({ value: c.id, label: loc(c.name) })),
            ]}
          />
          <InputField
            label={at('catalog.category.icon')}
            hint={at('catalog.category.iconHint')}
            value={form.icon}
            ltr
            maxLength={30}
            onChange={(e) => patch({ icon: e.target.value })}
          />
          <InputField
            label={at('catalog.category.imageUrl')}
            value={form.imageUrl}
            ltr
            onChange={(e) => patch({ imageUrl: e.target.value })}
          />
        </div>
        <ImageUpload onUploaded={(url) => patch({ imageUrl: url })} />
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
            label={at('catalog.category.nav')}
            checked={form.showInNav}
            onChange={(showInNav) => patch({ showInNav })}
          />
          <CheckboxField
            label={at('catalog.category.home')}
            checked={form.showOnHome}
            onChange={(showOnHome) => patch({ showOnHome })}
          />
          <CheckboxField
            label={at('catalog.category.shop')}
            checked={form.showInShop}
            onChange={(showInShop) => patch({ showInShop })}
          />
          <CheckboxField
            label={at('catalog.category.grid')}
            checked={form.showInCategoryGrid}
            onChange={(showInCategoryGrid) => patch({ showInCategoryGrid })}
          />
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
        {error && (
          <Alert tone="danger" live>
            {error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => setForm(null)}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {at('ui.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
