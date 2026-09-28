import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useReducer, useState } from 'react';
import type { SettingOverview } from '@/domain/admin/schemas';
import { SETTING_SCHEMAS } from '@/domain/settings/registry';
import { validateLayout, type LayoutIssue } from '@/domain/siteEditor/layout';
import { commit, createHistory, redo, undo, type History } from '@/domain/siteEditor/history';
import { EDITABLE_PAGES, type EditablePage, type EditorPage } from '@/domain/siteEditor/schemas';
import { SETTINGS_QUERY_KEY } from '@/features/settings/context';
import { useRuntime } from '@/runtime/context';
import { PREVIEW_SETTING_KEYS } from '@/preview/protocol';
import { useErrorText, useProblemText } from '../../ui/useAdminText';
import {
  dirtyPages,
  dirtySettings,
  docFrom,
  type EditorDoc,
  type PreviewSettingKey,
} from './editorState';

export const EDITOR_PAGES_KEY = ['admin', 'site-editor', 'pages'] as const;
export const SETTINGS_OVERVIEW_KEY = ['admin', 'settings'] as const;

export interface EditorData {
  pages: EditorPage[];
  settings: SettingOverview[];
}

/** Server-side data the editor starts from (layouts + design settings, drafts included). */
export function useEditorData() {
  const { repositories } = useRuntime();
  const pages = useQuery({
    queryKey: EDITOR_PAGES_KEY,
    queryFn: async () =>
      (await Promise.all(EDITABLE_PAGES.map((p) => repositories.siteEditor.getPage(p)))).filter(
        (p): p is EditorPage => p !== null,
      ),
  });
  const settings = useQuery({
    queryKey: SETTINGS_OVERVIEW_KEY,
    queryFn: () => repositories.admin.settingsOverview(),
  });
  return { pages, settings };
}

type Action =
  | { type: 'change'; doc: EditorDoc; tag: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; doc: EditorDoc };

function reducer(state: History<EditorDoc>, action: Action): History<EditorDoc> {
  switch (action.type) {
    case 'change':
      return commit(state, action.doc, action.tag);
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
    case 'reset':
      return createHistory(action.doc);
  }
}

export interface PublishItem {
  kind: 'page' | 'setting';
  key: EditablePage | PreviewSettingKey;
}

export interface Outcome {
  item: PublishItem | null;
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * The editing session: undo/redo history over the whole document, dirty tracking against the last
 * saved state, and the save / publish flows. The database decides every write (permissions,
 * validation, stale drafts); this only reports what it answered.
 */
export function useSiteEditor(initial: EditorData) {
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const errorText = useErrorText();
  const [meta, setMeta] = useState(initial);
  const [base, setBase] = useState(() => docFrom(initial.pages, initial.settings));
  const [history, dispatch] = useReducer(reducer, base, createHistory<EditorDoc>);
  const [busy, setBusy] = useState<'save' | 'publish' | 'rollback' | null>(null);
  const doc = history.present;

  const change = useCallback(
    (next: EditorDoc, tag: string | null = null) => dispatch({ type: 'change', doc: next, tag }),
    [],
  );

  const pagesDirty = useMemo(() => dirtyPages(doc, base), [doc, base]);
  const settingsDirty = useMemo(() => dirtySettings(doc, base), [doc, base]);
  const layoutIssues = useMemo(() => {
    const out: Partial<Record<EditablePage, LayoutIssue[]>> = {};
    for (const p of EDITABLE_PAGES) out[p] = validateLayout(doc.layouts[p]);
    return out;
  }, [doc]);
  const settingIssues = useMemo(() => {
    const out: Partial<Record<PreviewSettingKey, boolean>> = {};
    for (const [key, value] of Object.entries(doc.settings))
      out[key as PreviewSettingKey] =
        !SETTING_SCHEMAS[key as PreviewSettingKey].safeParse(value).success;
    return out;
  }, [doc]);

  const pageMeta = (page: EditablePage) => meta.pages.find((p) => p.pageKey === page);
  const settingMeta = (key: PreviewSettingKey) => meta.settings.find((s) => s.key === key);

  /** Re-read server state after a write; the working document is kept as it is. */
  const refreshMeta = async () => {
    const [pages, settings] = await Promise.all([
      Promise.all(EDITABLE_PAGES.map((p) => repositories.siteEditor.getPage(p))),
      repositories.admin.settingsOverview(),
    ]);
    const next = { pages: pages.filter((p): p is EditorPage => p !== null), settings };
    setMeta(next);
    queryClient.setQueryData(EDITOR_PAGES_KEY, next.pages);
    queryClient.setQueryData(SETTINGS_OVERVIEW_KEY, next.settings);
    return next;
  };

  const fail = (item: PublishItem | null, error: unknown): Outcome => ({
    item,
    ok: false,
    message: errorText(error, true),
  });

  /** Save every changed page layout and design setting as a server draft. */
  const saveDrafts = async (): Promise<Outcome[]> => {
    const outcomes: Outcome[] = [];
    const saved = structuredClone(base);
    for (const page of pagesDirty) {
      const item: PublishItem = { kind: 'page', key: page };
      if ((layoutIssues[page] ?? []).length > 0) {
        outcomes.push({
          item,
          ok: false,
          code: 'invalid_props',
          message: problemText('invalid_props'),
        });
        continue;
      }
      try {
        const r = await repositories.siteEditor.saveDraft(
          page,
          doc.layouts[page],
          pageMeta(page)?.draftUpdatedAt ?? null,
        );
        if (r.ok) saved.layouts[page] = structuredClone(doc.layouts[page]);
        outcomes.push(
          r.ok
            ? { item, ok: true }
            : { item, ok: false, code: r.code, message: problemText(r.code) },
        );
      } catch (e) {
        outcomes.push(fail(item, e));
      }
    }
    for (const key of settingsDirty) {
      const item: PublishItem = { kind: 'setting', key };
      const value = doc.settings[key];
      const row = settingMeta(key);
      if (!value || !row?.canEdit) continue;
      if (settingIssues[key]) {
        outcomes.push({
          item,
          ok: false,
          code: 'invalid_value',
          message: problemText('invalid_value'),
        });
        continue;
      }
      try {
        const r = await repositories.admin.saveSettingDraft(key, value, row.draftUpdatedAt);
        if (r.ok) saved.settings[key] = structuredClone(value);
        outcomes.push(
          r.ok
            ? { item, ok: true }
            : { item, ok: false, code: r.code, message: problemText(r.code) },
        );
      } catch (e) {
        outcomes.push(fail(item, e));
      }
    }
    setBase(saved);
    await refreshMeta();
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    return outcomes;
  };

  const save = async () => {
    setBusy('save');
    try {
      return await saveDrafts();
    } finally {
      setBusy(null);
    }
  };

  /** Items that would go live on publish: saved drafts plus unsaved changes. */
  const pending = (): PublishItem[] => {
    const items: PublishItem[] = [];
    for (const page of EDITABLE_PAGES)
      if (pagesDirty.includes(page) || pageMeta(page)?.draft)
        items.push({ kind: 'page', key: page });
    for (const key of PREVIEW_SETTING_KEYS)
      if (settingsDirty.includes(key) || settingMeta(key)?.draft)
        items.push({ kind: 'setting', key });
    return items;
  };

  const publish = async (items: PublishItem[], note: string | null, force: boolean) => {
    setBusy('publish');
    const outcomes: Outcome[] = [];
    try {
      const saveOutcomes = await saveDrafts();
      const failedSave = saveOutcomes.filter((o) => !o.ok);
      if (failedSave.length > 0) return failedSave;
      for (const item of items) {
        try {
          const r =
            item.kind === 'page'
              ? await repositories.siteEditor.publish(item.key as EditablePage, note, force)
              : await repositories.admin.publishSetting(item.key, note, force);
          outcomes.push(
            r.ok
              ? { item, ok: true }
              : { item, ok: false, code: r.code, message: problemText(r.code) },
          );
        } catch (e) {
          outcomes.push(fail(item, e));
        }
      }
      const next = await refreshMeta();
      // What is live now becomes the new baseline (unpublished items keep their drafts).
      const fresh = docFrom(next.pages, next.settings);
      setBase(fresh);
      dispatch({ type: 'reset', doc: mergeUnsaved(fresh, doc, outcomes) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['public'] }),
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
      ]);
      return outcomes;
    } finally {
      setBusy(null);
    }
  };

  /** Restore a published version (a new version is recorded; an open draft is discarded first). */
  const rollback = async (page: EditablePage, version: number): Promise<Outcome> => {
    const item: PublishItem = { kind: 'page', key: page };
    setBusy('rollback');
    try {
      if (pageMeta(page)?.draft) await repositories.siteEditor.discardDraft(page).catch(() => null);
      const r = await repositories.siteEditor.rollback(page, version, null);
      if (!r.ok) return { item, ok: false, code: r.code, message: problemText(r.code) };
      const next = await refreshMeta();
      const layout = docFrom(next.pages, next.settings).layouts[page];
      setBase((b) => ({ ...b, layouts: { ...b.layouts, [page]: structuredClone(layout) } }));
      change({ ...doc, layouts: { ...doc.layouts, [page]: structuredClone(layout) } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['public'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
      ]);
      return { item, ok: true };
    } catch (e) {
      return fail(item, e);
    } finally {
      setBusy(null);
    }
  };

  const discard = async (page: EditablePage) => {
    const r = await repositories.siteEditor.discardDraft(page);
    const next = await refreshMeta();
    const fresh = docFrom(next.pages, next.settings);
    setBase((b) => ({ ...b, layouts: { ...b.layouts, [page]: fresh.layouts[page] } }));
    change({ ...doc, layouts: { ...doc.layouts, [page]: fresh.layouts[page] } });
    return r;
  };

  return {
    doc,
    base,
    meta,
    change,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    pagesDirty,
    settingsDirty,
    dirty: pagesDirty.length > 0 || settingsDirty.length > 0,
    layoutIssues,
    settingIssues,
    pageMeta,
    settingMeta,
    busy,
    save,
    pending,
    publish,
    rollback,
    discard,
  };
}

/** After publishing, keep unsaved edits of items that failed so nothing typed is lost. */
function mergeUnsaved(fresh: EditorDoc, working: EditorDoc, outcomes: Outcome[]): EditorDoc {
  const next = structuredClone(fresh);
  for (const o of outcomes) {
    if (o.ok || !o.item) continue;
    if (o.item.kind === 'page') {
      const page = o.item.key as EditablePage;
      next.layouts[page] = structuredClone(working.layouts[page]);
    } else {
      const key = o.item.key as PreviewSettingKey;
      if (working.settings[key]) next.settings[key] = structuredClone(working.settings[key]);
    }
  }
  return next;
}

export type SiteEditorSession = ReturnType<typeof useSiteEditor>;
