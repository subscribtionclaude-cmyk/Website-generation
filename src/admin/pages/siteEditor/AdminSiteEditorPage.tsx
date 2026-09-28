import { History, Plus, Redo2, Rocket, Save, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { LocalizedText } from '@/domain/localized';
import type { TrustItem } from '@/domain/settings/schemas';
import { newSection } from '@/domain/siteEditor/defaults';
import { insertSection, uniqueKey } from '@/domain/siteEditor/layout';
import {
  EDITABLE_PAGES,
  isEditablePage,
  type EditablePage,
  type LayoutSection,
} from '@/domain/siteEditor/schemas';
import { useSettings } from '@/features/settings/context';
import type { Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/context';
import type { PreviewState } from '@/preview/protocol';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { useConfirm, useDirtyGuard } from '../../ui/hooks';
import { PageHeader } from '../../ui/PageHeader';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { UnsavedChangesDialog } from '../../ui/useDirtyGuard';
import { useErrorText } from '../../ui/useAdminText';
import ui from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';
import { AddSectionDialog, PublishDialog, VersionsDialog, type AddPosition } from './EditorDialogs';
import {
  STOREFRONT_PATH,
  TAB_SETTINGS,
  WORKSPACE_TABS,
  type Device,
  type PreviewSettingKey,
  type WorkspaceTab,
} from './editorState';
import { PreviewPane } from './PreviewPane';
import { SectionInspector } from './SectionInspector';
import { SectionTree } from './SectionTree';
import { DesignPanel, NavigationPanel, SeoPanel } from './SettingsPanels';
import {
  useEditorData,
  useSiteEditor,
  type EditorData,
  type Outcome,
  type PublishItem,
} from './useSiteEditor';
import { useReferences } from './useReferences';
import styles from './siteEditor.module.css';

type LayoutMode = 'one' | 'two' | 'three';

/**
 * Layout from the editor's own width (the admin sidebar takes part of the screen): very wide →
 * structure | preview | inspector; wide → one switchable panel + preview; narrow → one pane.
 */
const modeFor = (width: number): LayoutMode =>
  width >= 1480 ? 'three' : width >= 880 ? 'two' : 'one';

function useLayoutMode() {
  const [mode, setMode] = useState<LayoutMode>('one');
  // Callback ref: measures during commit (before paint, so the layout never flashes) and keeps
  // following the editor's width.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setMode(modeFor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMode(modeFor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [mode, measure] as const;
}

/**
 * Visual Site Editor (Phase 07): edits the real storefront's page layouts (Home, Apple, Offers)
 * and design settings, previews them in the real storefront renderer, then saves drafts,
 * publishes, versions and rolls back through permission-checked, audited RPCs.
 */
export function AdminSiteEditorPage() {
  const { at } = useAdminI18n();
  const errorText = useErrorText();
  const { pages, settings } = useEditorData();
  if (pages.isPending || settings.isPending)
    return (
      <>
        <PageHeader title={at('modules.site-editor.title')} subtitle={at('siteEditor.subtitle')} />
        <Skeleton height="28rem" radius="var(--radius-lg)" />
      </>
    );
  if (pages.isError || settings.isError)
    return (
      <>
        <PageHeader title={at('modules.site-editor.title')} subtitle={at('siteEditor.subtitle')} />
        <Alert tone="danger" live>
          {errorText(pages.error ?? settings.error)}
        </Alert>
      </>
    );
  return <SiteEditor initial={{ pages: pages.data, settings: settings.data }} />;
}

type Pane = 'structure' | 'preview' | 'inspector';

function SiteEditor({ initial }: { initial: EditorData }) {
  const { at } = useAdminI18n();
  const loc = useLocalized();
  const { mode } = useRuntime();
  const { features } = useSettings();
  const [layoutMode, measureLayout] = useLayoutMode();
  const wide = layoutMode === 'three';
  const session = useSiteEditor(initial);
  const { doc } = session;
  const [tab, setTab] = useState<WorkspaceTab>('home');
  const [previewPage, setPreviewPage] = useState<EditablePage>('home');
  const [selected, setSelected] = useState<Partial<Record<EditablePage, string>>>({});
  const [pane, setPane] = useState<Pane>('structure');
  // Small screens start with the phone preview (a scaled desktop would be unreadable).
  const [device, setDevice] = useState<Device>(() =>
    window.innerWidth < 700 ? 'mobile' : 'desktop',
  );
  const [locale, setLocale] = useState<Locale>('ar');
  const [sample, setSample] = useState(false);
  const [applyToSample, setApplyToSample] = useState(false);
  const [dialog, setDialog] = useState<'add' | 'publish' | 'versions' | null>(null);
  const [saveResult, setSaveResult] = useState<Outcome[] | null>(null);
  const confirmRemove = useConfirm<{ page: EditablePage; key: string }>();
  const confirmDiscard = useConfirm<EditablePage>();
  const guard = useDirtyGuard(session.dirty);

  const page: EditablePage | null = isEditablePage(tab) ? tab : null;
  const shownPage = page ?? previewPage;
  const layout = page ? doc.layouts[page] : [];
  const pageMeta = page ? session.pageMeta(page) : undefined;
  const readOnly = !pageMeta?.canEdit;
  const selectedKey = page ? (selected[page] ?? null) : null;
  const selectedSection = layout.find((s) => s.key === selectedKey) ?? null;
  const issues = useMemo(
    () => (page ? (session.layoutIssues[page] ?? []) : []),
    [page, session.layoutIssues],
  );
  const invalidKeys = useMemo(
    () => new Set(issues.map((i) => i.key).filter((k): k is string => k !== null)),
    [issues],
  );
  const trustItems = (doc.settings.trust as { items?: TrustItem[] } | undefined)?.items ?? [];
  const { choices, refs, entryTitle } = useReferences(trustItems);
  const sampleAllowed = mode === 'demo' || features.showDemoCatalog;

  const canEditSetting = (key: PreviewSettingKey) => session.settingMeta(key)?.canEdit === true;
  const layoutsEditable = EDITABLE_PAGES.some((p) => session.pageMeta(p)?.canEdit);
  const anyEditable = layoutsEditable || Object.values(TAB_SETTINGS).flat().some(canEditSetting);
  const pendingItems = session.pending();
  const canPublishItem = (item: PublishItem) =>
    item.kind === 'page'
      ? session.pageMeta(item.key as EditablePage)?.canPublish === true
      : session.settingMeta(item.key as PreviewSettingKey)?.canPublish === true;
  const anyPublishable = pendingItems.some(canPublishItem);

  const pageLabel = (p: EditablePage) => at(`sectionsAdmin.page.${p}` as AdminMessageKey);
  const settingLabel = (k: string) => {
    const text = at(`settingsAdmin.key.${k}` as AdminMessageKey);
    return text.startsWith('settingsAdmin.') ? k : text;
  };
  const itemLabel = (item: PublishItem) =>
    item.kind === 'page'
      ? at('siteEditor.publish.pageItem', { page: pageLabel(item.key as EditablePage) })
      : at('siteEditor.publish.settingItem', { name: settingLabel(item.key) });
  const typeOf = (s: { type: string }) => at(`sectionsAdmin.type.${s.type}` as AdminMessageKey);
  const titleOf = (s: { key: string; type: string; props?: Record<string, unknown> }) => {
    const props = s.props ?? {};
    const title = props.title as LocalizedText | null | undefined;
    if (title && loc(title)) return loc(title);
    if (s.type === 'trust_feature') {
      const item = trustItems.find((t) => t.id === props.itemId);
      if (item) return loc(item.title);
    }
    if (s.type === 'hero_campaign' && typeof props.campaignSlug === 'string')
      return `${typeOf(s)}: ${entryTitle(props.campaignSlug) ?? props.campaignSlug}`;
    return typeOf(s);
  };

  const setLayout = (p: EditablePage, next: LayoutSection[], tag: string | null = null) =>
    session.change({ ...doc, layouts: { ...doc.layouts, [p]: next } }, tag);
  const setSetting = (key: PreviewSettingKey, value: Record<string, unknown>, tag: string) =>
    session.change({ ...doc, settings: { ...doc.settings, [key]: value } }, `setting:${tag}`);
  const allSections = EDITABLE_PAGES.flatMap((p) => doc.layouts[p]);
  const select = (key: string) => {
    if (!page) return;
    setSelected((s) => ({ ...s, [page]: key }));
    if (!wide) setPane('inspector');
  };

  const addSection = (type: Parameters<typeof newSection>[0], position: AddPosition) => {
    if (!page) return;
    const key = uniqueKey(allSections, `${page}-${type.replace(/_/g, '-')}`);
    const section = newSection(type, key, refs);
    if (!section) return;
    const index =
      position === 'top'
        ? 0
        : position === 'after' && selectedKey
          ? layout.findIndex((s) => s.key === selectedKey) + 1
          : layout.length;
    setLayout(page, insertSection(layout, section, index), null);
    setSelected((s) => ({ ...s, [page]: key }));
    setDialog(null);
    if (!wide) setPane('inspector');
  };

  const duplicate = (key: string) => {
    if (!page) return;
    const index = layout.findIndex((s) => s.key === key);
    const source = layout[index];
    if (!source) return;
    const copy = { ...structuredClone(source), key: uniqueKey(allSections, `${key}-copy`) };
    if (copy.type === 'offer_group') copy.props = { ...copy.props, anchor: copy.key };
    setLayout(page, insertSection(layout, copy, index + 1));
    setSelected((s) => ({ ...s, [page]: copy.key }));
  };

  const previewState: PreviewState = useMemo(
    () => ({ layouts: doc.layouts, settings: doc.settings }),
    [doc],
  );

  // Undo / redo shortcuts (text fields keep their own native undo).
  const onShortcut = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey && session.canUndo) {
      e.preventDefault();
      session.undo();
    } else if (((key === 'z' && e.shiftKey) || key === 'y') && session.canRedo) {
      e.preventDefault();
      session.redo();
    }
  });
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => onShortcut(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const dirtyCount = session.pagesDirty.length + session.settingsDirty.length;
  const status = session.busy
    ? at(`siteEditor.status.${session.busy}`)
    : dirtyCount > 0
      ? at('siteEditor.status.unsaved', { count: dirtyCount })
      : pendingItems.length > 0
        ? at('siteEditor.status.drafts', { count: pendingItems.length })
        : at('siteEditor.status.live');

  const structurePane = page ? (
    <section className={styles.pane} aria-labelledby="se-structure">
      <div className={styles.paneHead}>
        <h2 id="se-structure" className={styles.paneTitle}>
          {at('siteEditor.structure', { page: pageLabel(page) })}
        </h2>
        {!readOnly && (
          <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setDialog('add')}>
            {at('siteEditor.add.button')}
          </Button>
        )}
      </div>
      <PageStatus
        meta={pageMeta}
        dirty={session.pagesDirty.includes(page)}
        onDiscard={
          pageMeta?.draft && pageMeta.canEdit
            ? () =>
                confirmDiscard.ask(
                  {
                    title: at('siteEditor.discard.title', { page: pageLabel(page) }),
                    body: at('siteEditor.discard.body'),
                    confirmLabel: at('siteEditor.discard.confirm'),
                    tone: 'danger',
                  },
                  page,
                )
            : undefined
        }
      />
      {page === 'apple' && <Alert tone="info">{at('siteEditor.appleNote')}</Alert>}
      <SectionTree
        label={at('siteEditor.structure', { page: pageLabel(page) })}
        sections={layout}
        selectedKey={selectedKey}
        invalidKeys={invalidKeys}
        readOnly={readOnly}
        titleOf={titleOf}
        typeOf={typeOf}
        onSelect={select}
        onChange={(next, tag) => setLayout(page, next, tag ?? null)}
        onDuplicate={duplicate}
        onRemove={(key) => {
          const s = layout.find((x) => x.key === key);
          confirmRemove.ask(
            {
              title: at('siteEditor.remove.title'),
              body: at('siteEditor.remove.body', { name: s ? titleOf(s) : key }),
              confirmLabel: at('siteEditor.remove.confirm'),
              tone: 'danger',
            },
            { page, key },
          );
        }}
      />
    </section>
  ) : (
    <section className={`${styles.pane} ${styles.paneWide}`} aria-labelledby="se-settings">
      <h2 id="se-settings" className="visually-hidden">
        {at(`siteEditor.tab.${tab}` as AdminMessageKey)}
      </h2>
      {tab === 'design' && (
        <DesignPanel values={doc.settings} canEdit={canEditSetting} onChange={setSetting} />
      )}
      {tab === 'navigation' && (
        <NavigationPanel values={doc.settings} canEdit={canEditSetting} onChange={setSetting} />
      )}
      {tab === 'seo' && (
        <SeoPanel values={doc.settings} canEdit={canEditSetting} onChange={setSetting} />
      )}
    </section>
  );

  const inspectorPane = page ? (
    <section className={styles.pane} aria-labelledby="se-inspector">
      <h2 id="se-inspector" className={styles.paneTitle}>
        {at('siteEditor.inspector.title')}
      </h2>
      {selectedSection ? (
        <SectionInspector
          key={selectedSection.key}
          section={selectedSection}
          title={titleOf(selectedSection)}
          issues={issues}
          readOnly={readOnly}
          choices={choices}
          onChange={(patch, tag) =>
            setLayout(
              page,
              layout.map((s) => (s.key === selectedSection.key ? { ...s, ...patch } : s)),
              tag,
            )
          }
          trust={{
            items: trustItems,
            canEdit: canEditSetting('trust'),
            onChange: (items, tag) =>
              setSetting('trust', { ...(doc.settings.trust ?? {}), items }, tag),
          }}
        />
      ) : (
        <p className={ui.muted}>{at('siteEditor.inspector.empty')}</p>
      )}
    </section>
  ) : null;

  const previewPane = (
    <section className={`${styles.pane} ${styles.panePreview}`} aria-labelledby="se-preview">
      <div className={styles.paneHead}>
        <h2 id="se-preview" className={styles.paneTitle}>
          {at('siteEditor.preview.title')}
        </h2>
        {!page && (
          <label className={styles.inlineSelect}>
            <span>{at('siteEditor.preview.page')}</span>
            <select
              className={ui.control}
              value={previewPage}
              onChange={(e) => setPreviewPage(e.target.value as EditablePage)}
            >
              {EDITABLE_PAGES.map((p) => (
                <option key={p} value={p}>
                  {pageLabel(p)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <PreviewPane
        path={STOREFRONT_PATH[shownPage]}
        state={previewState}
        focusKey={page ? selectedKey : null}
        device={device}
        locale={locale}
        sample={sample}
        sampleAllowed={sampleAllowed}
        applyToSample={applyToSample}
        onDevice={setDevice}
        onLocale={setLocale}
        onSample={setSample}
        onApplyToSample={setApplyToSample}
      />
    </section>
  );

  const panes: { id: Pane; label: string }[] = [
    {
      id: 'structure',
      label: page ? at('siteEditor.pane.structure') : at('siteEditor.pane.settings'),
    },
    { id: 'preview', label: at('siteEditor.pane.preview') },
    ...(page ? [{ id: 'inspector' as Pane, label: at('siteEditor.pane.inspector') }] : []),
  ];
  const activePane = panes.some((p) => p.id === pane) ? pane : 'structure';
  const paneSwitch = (list: typeof panes) => (
    <div className={styles.paneSwitch} role="group" aria-label={at('siteEditor.pane.label')}>
      {list.map((p) => (
        <Button
          key={p.id}
          size="sm"
          variant={activePane === p.id ? 'primary' : 'secondary'}
          aria-pressed={activePane === p.id}
          onClick={() => setPane(p.id)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );

  return (
    <div ref={measureLayout} className={styles.editor}>
      <PageHeader title={at('modules.site-editor.title')} subtitle={at('siteEditor.subtitle')} />
      <div className={styles.toolbar} role="toolbar" aria-label={at('siteEditor.toolbar')}>
        <span className={styles.status} role="status" aria-live="polite">
          {status}
        </span>
        <Button
          size="sm"
          variant="secondary"
          icon={<Undo2 aria-hidden="true" />}
          disabled={!session.canUndo}
          onClick={session.undo}
          aria-keyshortcuts="Control+Z"
        >
          {at('siteEditor.undo')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Redo2 aria-hidden="true" />}
          disabled={!session.canRedo}
          onClick={session.redo}
          aria-keyshortcuts="Control+Shift+Z Control+Y"
        >
          {at('siteEditor.redo')}
        </Button>
        {page && (
          <Button
            size="sm"
            variant="secondary"
            icon={<History aria-hidden="true" />}
            onClick={() => setDialog('versions')}
          >
            {at('siteEditor.versions.button')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={<Save aria-hidden="true" />}
          loading={session.busy === 'save'}
          disabled={!session.dirty || !anyEditable || session.busy !== null}
          onClick={() => void session.save().then(setSaveResult)}
        >
          {at('siteEditor.saveDraft')}
        </Button>
        <Button
          size="sm"
          icon={<Rocket aria-hidden="true" />}
          disabled={!anyPublishable || session.busy !== null}
          onClick={() => setDialog('publish')}
        >
          {at('siteEditor.publish.button')}
        </Button>
      </div>
      {!layoutsEditable && <Alert tone="info">{at('siteEditor.viewOnly')}</Alert>}
      {saveResult && saveResult.length > 0 && (
        <div role="status" aria-live="polite" className={ui.stack}>
          {saveResult.every((o) => o.ok) ? (
            <Alert tone="success">{at('siteEditor.saved')}</Alert>
          ) : (
            saveResult
              .filter((o) => !o.ok)
              .map((o, i) => (
                <Alert key={i} tone="danger">
                  {o.item ? `${itemLabel(o.item)}: ` : ''}
                  {o.message}
                </Alert>
              ))
          )}
        </div>
      )}

      <Tabs
        idBase="site-editor"
        label={at('siteEditor.workspace')}
        tabs={WORKSPACE_TABS.map((t) => ({
          id: t,
          label: (
            <span className={styles.tabLabel}>
              {isEditablePage(t) ? pageLabel(t) : at(`siteEditor.tab.${t}` as AdminMessageKey)}
              {((isEditablePage(t) && session.pagesDirty.includes(t)) ||
                (!isEditablePage(t) &&
                  TAB_SETTINGS[t].some((k) => session.settingsDirty.includes(k)))) && (
                <Badge tone="warning">{at('siteEditor.tabDirty')}</Badge>
              )}
            </span>
          ),
        }))}
        active={tab}
        onChange={(t) => {
          setTab(t);
          if (isEditablePage(t)) setPreviewPage(t);
          else if (pane === 'inspector') setPane('structure');
        }}
      />
      <TabPanel idBase="site-editor" active={tab}>
        {layoutMode === 'three' ? (
          <div className={page ? styles.workspace : styles.workspaceSettings}>
            {structurePane}
            {previewPane}
            {inspectorPane}
          </div>
        ) : layoutMode === 'two' ? (
          <div className={styles.workspaceSettings}>
            <div className={styles.narrow}>
              {page && paneSwitch(panes.filter((p) => p.id !== 'preview'))}
              {/* Panes stay mounted (hidden when inactive): no lost scroll, no preview reloads. */}
              <div hidden={activePane === 'inspector' && page !== null}>{structurePane}</div>
              {page && <div hidden={activePane !== 'inspector'}>{inspectorPane}</div>}
            </div>
            {previewPane}
          </div>
        ) : (
          <div className={styles.narrow}>
            {paneSwitch(panes)}
            <div hidden={activePane !== 'structure'}>{structurePane}</div>
            <div hidden={activePane !== 'preview'}>{previewPane}</div>
            {page && <div hidden={activePane !== 'inspector'}>{inspectorPane}</div>}
          </div>
        )}
      </TabPanel>

      {dialog === 'add' && page && (
        <AddSectionDialog
          page={page}
          refs={refs}
          hasSelection={selectedKey !== null}
          onClose={() => setDialog(null)}
          onAdd={addSection}
        />
      )}
      {dialog === 'publish' && (
        <PublishDialog
          items={pendingItems}
          itemLabel={itemLabel}
          canPublish={canPublishItem}
          invalid={(item) =>
            item.kind === 'page'
              ? (session.layoutIssues[item.key as EditablePage] ?? []).length > 0
              : session.settingIssues[item.key as PreviewSettingKey] === true
          }
          busy={session.busy === 'publish'}
          onClose={() => setDialog(null)}
          onPublish={session.publish}
        />
      )}
      {dialog === 'versions' && page && (
        <VersionsDialog
          page={page}
          pageLabel={pageLabel(page)}
          live={pageMeta?.published ?? []}
          canPublish={pageMeta?.canPublish === true}
          busy={session.busy === 'rollback'}
          titleOf={titleOf}
          onClose={() => setDialog(null)}
          onRollback={(version) => session.rollback(page, version)}
        />
      )}
      <ConfirmDialog
        open={confirmRemove.open}
        options={confirmRemove.options}
        onCancel={confirmRemove.close}
        onConfirm={() => {
          const payload = confirmRemove.payload;
          if (payload)
            setLayout(
              payload.page,
              doc.layouts[payload.page].filter((s) => s.key !== payload.key),
            );
          confirmRemove.close();
        }}
      />
      <ConfirmDialog
        open={confirmDiscard.open}
        options={confirmDiscard.options}
        onCancel={confirmDiscard.close}
        onConfirm={() => {
          const p = confirmDiscard.payload;
          confirmDiscard.close();
          if (p) void session.discard(p);
        }}
      />
      <UnsavedChangesDialog blocker={guard.blocker} />
    </div>
  );
}

function PageStatus({
  meta,
  dirty,
  onDiscard,
}: {
  meta: ReturnType<ReturnType<typeof useSiteEditor>['pageMeta']>;
  dirty: boolean;
  onDiscard?: () => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  if (!meta) return null;
  return (
    <div className={styles.pageStatus}>
      <span className={ui.small}>
        {meta.version !== null
          ? at('siteEditor.pageStatus.version', {
              n: meta.version,
              date: meta.publishedAt ? format.dateTime(meta.publishedAt) : '—',
            })
          : at('siteEditor.pageStatus.original')}
      </span>
      {meta.draft && (
        <span className={ui.small}>
          <Badge tone="info">{at('siteEditor.pageStatus.draft')}</Badge>{' '}
          {meta.draftUpdatedAt ? format.dateTime(meta.draftUpdatedAt) : ''}
          {meta.draftBy ? ` · ${at('ui.by', { name: meta.draftBy })}` : ''}
        </span>
      )}
      {dirty && <Badge tone="warning">{at('siteEditor.pageStatus.unsaved')}</Badge>}
      {onDiscard && (
        <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden="true" />} onClick={onDiscard}>
          {at('siteEditor.discard.button')}
        </Button>
      )}
    </div>
  );
}
