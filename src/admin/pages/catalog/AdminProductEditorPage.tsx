import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, ExternalLink, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import type { AdminProduct, CatalogLookups } from '@/domain/admin/schemas';
import { validateProductInput } from '@/domain/admin/validation';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { useConfirm, useDirtyGuard } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { DirtyBar, UnsavedChangesDialog } from '../../ui/useDirtyGuard';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useProblemText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import { useLocalized, useLookups } from './catalogHooks';
import { StatusBadge } from './catalogParts';
import {
  DetailsSection,
  MediaSection,
  RelationsSection,
  SeoSection,
  SpecsSection,
  VariantsSection,
  WarrantySection,
} from './ProductEditorSections';
import { draftFromProduct, draftToInput, emptyDraft, type ProductDraft } from './productDraft';

type TabId = 'details' | 'variants' | 'media' | 'specs' | 'warranty' | 'relations' | 'seo';
const FIELD_TAB: Record<string, TabId> = {
  slug: 'details',
  name: 'details',
  brandId: 'details',
  categoryIds: 'details',
  variants: 'variants',
  options: 'variants',
  media: 'media',
  specGroups: 'specs',
  relations: 'relations',
};

/** Loads the product (or starts a new one) and hands a fresh draft to the editor. */
export function AdminProductEditorPage() {
  const { productId } = useParams();
  const isNew = !productId || productId === 'new';
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const lookups = useLookups();
  // Survives the editor remount that follows a save (fresh draft from the refetched product).
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const product = useQuery({
    queryKey: ['admin', 'product', productId],
    queryFn: () => repo.getProduct(productId ?? ''),
    enabled: !isNew,
  });
  if (isNew)
    return (
      <QueryState query={lookups}>
        {(l) => (
          <ProductEditor key="new" product={null} lookups={l} onSaved={setSavedAt} savedAt={null} />
        )}
      </QueryState>
    );
  return (
    <QueryState query={product}>
      {(p) =>
        p === null ? (
          <>
            <PageHeader title={at('modules.products.title')} />
            <Alert tone="warning">{at('ui.deletedElsewhere')}</Alert>
          </>
        ) : (
          <QueryState query={lookups}>
            {(l) => (
              <ProductEditor
                key={p.updatedAt}
                product={p}
                lookups={l}
                onSaved={setSavedAt}
                savedAt={savedAt}
              />
            )}
          </QueryState>
        )
      }
    </QueryState>
  );
}

function ProductEditor({
  product,
  lookups,
  onSaved,
  savedAt,
}: {
  product: AdminProduct | null;
  lookups: CatalogLookups;
  onSaved: (updatedAt: string) => void;
  savedAt: string | null;
}) {
  const { at } = useAdminI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [initial] = useState<ProductDraft>(() =>
    product ? draftFromProduct(product) : emptyDraft(),
  );
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [tab, setTab] = useState<TabId>('details');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { format } = useI18n();
  const confirm = useConfirm<'delete' | 'archive' | 'duplicate'>();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const canManage = can('catalog.manage');
  const guard = useDirtyGuard(dirty && canManage);

  const save = useAdminAction(() => repo.saveProduct(draftToInput(draft, product)), {
    onSuccess: (r) => {
      if (!r.ok) return;
      onSaved(r.updatedAt);
      guard.allowNavigation();
      if (!product) void navigate(`/admin/products/${r.id}`, { replace: true });
    },
  });
  const remove = useAdminAction(() => repo.deleteProduct(product?.id ?? ''), {
    onSuccess: () => {
      guard.allowNavigation();
      void navigate('/admin/products', { replace: true });
    },
  });
  const archive = useAdminAction(() => repo.setProductsState([product?.id ?? ''], 'archive'));
  const duplicate = useAdminAction(() => repo.duplicateProduct(product?.id ?? ''), {
    onSuccess: (r) => {
      if (!r.ok) return;
      guard.allowNavigation();
      void navigate(`/admin/products/${r.id}`);
    },
  });
  const stale = save.code === 'stale' || save.code === 'stale_variant';

  const onSave = async () => {
    const input = draftToInput(draft, product);
    const problem = validateProductInput(input);
    if (problem) {
      setErrors(problem.field ? { [problem.field]: problemText(problem.code) } : {});
      const target = problem.field ? FIELD_TAB[problem.field] : undefined;
      if (target) setTab(target);
      save.reset();
      return;
    }
    setErrors({});
    const result = await save.run();
    if (result && !result.ok && 'field' in result && result.field) {
      setErrors({ [result.field]: problemText(result.code) });
      const target = FIELD_TAB[result.field];
      if (target) setTab(target);
    }
  };

  const set = (update: (d: ProductDraft) => ProductDraft) => setDraft(update);

  const title = product ? loc(product.name) : at('catalog.newProduct');
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'details', label: at('catalog.tabs.details') },
    { id: 'variants', label: at('catalog.tabs.variants'), count: draft.variants.length },
    { id: 'media', label: at('catalog.tabs.media'), count: draft.media.length },
    { id: 'specs', label: at('catalog.tabs.specs') },
    { id: 'warranty', label: at('catalog.tabs.warranty') },
    { id: 'relations', label: at('catalog.tabs.relations'), count: draft.relations.length },
    { id: 'seo', label: at('catalog.tabs.seo') },
  ];

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: at('modules.products.title'), to: '/admin/products' }]}
        subtitle={
          product ? (
            <span className={styles.chips}>
              <StatusBadge status={product.status} />
              {!product.isVisible && <Badge>{at('catalog.hidden')}</Badge>}
              {product.isDemo && <Badge tone="warning">{at('ui.demo')}</Badge>}
              <span className={styles.muted}>
                {at('ui.lastUpdated', { date: format.dateTime(product.updatedAt) })}
              </span>
            </span>
          ) : (
            at('catalog.editor.newHint')
          )
        }
        actions={
          <>
            {product && product.status === 'published' && product.isVisible && (
              <Link
                to={`/product/${product.slug}`}
                target="_blank"
                rel="noopener"
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              >
                <ExternalLink aria-hidden="true" />
                {at('catalog.viewInStore')}
              </Link>
            )}
            {product && canManage && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy aria-hidden="true" />}
                  onClick={() =>
                    confirm.ask(
                      {
                        title: at('catalog.duplicateTitle'),
                        body: at('catalog.duplicateBody'),
                        confirmLabel: at('ui.duplicate'),
                      },
                      'duplicate',
                    )
                  }
                >
                  {at('ui.duplicate')}
                </Button>
                {product.hasHistory ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Archive aria-hidden="true" />}
                    onClick={() =>
                      confirm.ask(
                        {
                          title: at('catalog.bulk.archiveTitle', { count: 1 }),
                          body: at('catalog.archiveHistoryBody'),
                          affected: [title],
                          confirmLabel: at('catalog.bulk.archive'),
                          tone: 'danger',
                        },
                        'archive',
                      )
                    }
                  >
                    {at('catalog.bulk.archive')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 aria-hidden="true" />}
                    onClick={() =>
                      confirm.ask(
                        {
                          title: at('catalog.deleteTitle'),
                          body: at('catalog.deleteBody'),
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
              </>
            )}
            {canManage && (
              <Button
                icon={<Save aria-hidden="true" />}
                loading={save.pending}
                disabled={!dirty && !!product}
                onClick={() => void onSave()}
              >
                {at('ui.save')}
              </Button>
            )}
          </>
        }
      />
      <div className={styles.stack}>
        {!canManage && <Alert tone="info">{at('catalog.editor.readOnly')}</Alert>}
        {stale ? (
          <Alert
            tone="warning"
            live
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ['admin', 'product'] })
                }
              >
                {at('ui.reload')}
              </Button>
            }
          >
            <strong>{at('ui.staleTitle')}</strong> {at('ui.staleBody')}
          </Alert>
        ) : (
          save.error && (
            <Alert tone="danger" live>
              {save.error}
            </Alert>
          )
        )}
        {Object.values(errors)[0] && !save.error && (
          <Alert tone="danger" live>
            {Object.values(errors)[0]}
          </Alert>
        )}
        {product && savedAt === product.updatedAt && !dirty && (
          <Alert tone="success" live>
            {at('ui.saved')}
          </Alert>
        )}
        {(archive.error ?? remove.error ?? duplicate.error) && (
          <Alert tone="danger" live>
            {archive.error ?? remove.error ?? duplicate.error}
          </Alert>
        )}
        <div>
          <Tabs
            idBase="product-editor"
            label={at('catalog.editor.sections')}
            tabs={tabs}
            active={tab}
            onChange={setTab}
          />
          <TabPanel idBase="product-editor" active={tab}>
            <fieldset
              disabled={!canManage}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <legend className="visually-hidden">{title}</legend>
              {tab === 'details' && (
                <DetailsSection
                  draft={draft}
                  set={set}
                  lookups={lookups}
                  isNew={!product}
                  errors={errors}
                />
              )}
              {tab === 'variants' && (
                <VariantsSection
                  draft={draft}
                  set={set}
                  product={product}
                  canPrice={can('pricing.manage')}
                  canStock={can('inventory.manage')}
                  error={errors.variants ?? errors.options}
                />
              )}
              {tab === 'media' && <MediaSection draft={draft} set={set} />}
              {tab === 'specs' && (
                <SpecsSection draft={draft} set={set} productId={product?.id ?? null} />
              )}
              {tab === 'warranty' && <WarrantySection draft={draft} set={set} />}
              {tab === 'relations' && (
                <RelationsSection draft={draft} set={set} productId={product?.id ?? null} />
              )}
              {tab === 'seo' && <SeoSection draft={draft} set={set} />}
            </fieldset>
          </TabPanel>
        </div>
        {canManage && (
          <DirtyBar
            dirty={dirty}
            saving={save.pending}
            onSave={() => void onSave()}
            onDiscard={() => {
              setDraft(initial);
              setErrors({});
              save.reset();
            }}
          />
        )}
      </div>
      <UnsavedChangesDialog blocker={guard.blocker} />
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={remove.pending || archive.pending || duplicate.pending}
        onCancel={confirm.close}
        onConfirm={async () => {
          const kind = confirm.payload;
          if (kind === 'delete') await remove.run();
          if (kind === 'archive') await archive.run();
          if (kind === 'duplicate') await duplicate.run();
          confirm.close();
        }}
      />
    </>
  );
}
