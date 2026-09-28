import type { SettingOverview } from '@/domain/admin/schemas';
import { sameLayout } from '@/domain/siteEditor/layout';
import {
  EDITABLE_PAGES,
  type EditablePage,
  type EditorPage,
  type LayoutSection,
} from '@/domain/siteEditor/schemas';
import { PREVIEW_SETTING_KEYS } from '@/preview/protocol';

export type PreviewSettingKey = (typeof PREVIEW_SETTING_KEYS)[number];
export type WorkspaceTab = EditablePage | 'design' | 'navigation' | 'seo';
export const WORKSPACE_TABS: WorkspaceTab[] = [...EDITABLE_PAGES, 'design', 'navigation', 'seo'];

/** Settings each non-page workspace tab edits. */
export const TAB_SETTINGS: Record<'design' | 'navigation' | 'seo', PreviewSettingKey[]> = {
  design: ['theme', 'brand'],
  navigation: ['navigation'],
  seo: ['seo', 'page_seo'],
};

/**
 * The editing session's document: every editable page layout plus the design settings. Undo/redo
 * snapshots this whole object, so a change on one tab can be undone from any tab.
 */
export interface EditorDoc {
  layouts: Record<EditablePage, LayoutSection[]>;
  settings: Partial<Record<PreviewSettingKey, Record<string, unknown>>>;
}

export function docFrom(pages: EditorPage[], settings: SettingOverview[]): EditorDoc {
  const layouts = {} as Record<EditablePage, LayoutSection[]>;
  for (const key of EDITABLE_PAGES) {
    const page = pages.find((p) => p.pageKey === key);
    layouts[key] = structuredClone(page?.draft ?? page?.published ?? []);
  }
  const values: EditorDoc['settings'] = {};
  for (const key of PREVIEW_SETTING_KEYS) {
    const row = settings.find((s) => s.key === key);
    const value = row?.draft ?? row?.published;
    if (value) values[key] = structuredClone(value);
  }
  return { layouts, settings: values };
}

const json = (v: unknown) => JSON.stringify(v ?? null);

export function dirtyPages(doc: EditorDoc, base: EditorDoc): EditablePage[] {
  return EDITABLE_PAGES.filter((p) => !sameLayout(doc.layouts[p], base.layouts[p]));
}

export function dirtySettings(doc: EditorDoc, base: EditorDoc): PreviewSettingKey[] {
  return PREVIEW_SETTING_KEYS.filter((k) => json(doc.settings[k]) !== json(base.settings[k]));
}

export const STOREFRONT_PATH: Record<EditablePage, string> = {
  home: '/',
  apple: '/apple',
  offers: '/offers',
};

/** Storefront routes a link may point to (anything else must be a validated internal path or https). */
export const SAFE_ROUTES = [
  '/',
  '/store',
  '/apple',
  '/offers',
  '/new',
  '/coming-soon',
  '/budget',
  '/news',
  '/services',
  '/repairs',
  '/trade-in',
  '/used',
  '/after-sales',
  '/contact',
  '/wishlist',
  '/compare',
] as const;

/** Preview device sizes (true CSS widths; the frame is scaled to fit the pane). */
export const DEVICES = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
} as const;
export type Device = keyof typeof DEVICES;
