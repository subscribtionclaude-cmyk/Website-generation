import { structuralProblem } from '@/domain/siteEditor/layout';
import {
  EDITABLE_PAGES,
  isEditablePage,
  type EditablePage,
  type EditorPage,
  type EditorPageSummary,
  type LayoutSection,
  type LayoutVersion,
} from '@/domain/siteEditor/schemas';
import type { AdminResult } from '../schemas';
import { requireAny, type AdminActor, type DemoAdminContext } from './context';

/** Copy of `record` without `key` (no dynamic `delete`). */
function without<T>(record: Partial<Record<string, T>>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as Partial<
    Record<string, T>
  >;
}

export interface DemoLayoutDraft {
  sections: LayoutSection[];
  baseVersion: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Layout state kept inside DemoAdminState (optional: older stored states predate Phase 07). */
export interface DemoLayoutState {
  /** Published layout per page once the editor (or a versioned edit) has touched it. */
  layouts?: Partial<Record<EditablePage, LayoutSection[]>>;
  layoutDrafts?: Partial<Record<EditablePage, DemoLayoutDraft>>;
  layoutVersions?: Partial<Record<EditablePage, LayoutVersion[]>>;
}

/**
 * DEMO MODE ONLY — the Phase 07 site_editor_* RPCs mirrored in this browser: design.view /
 * design.edit / design.publish, structural validation, stale drafts, versions (the first publish
 * records the previous layout as version 1), rollback and audit entries.
 */
export class DemoAdminLayouts {
  private readonly ctx: DemoAdminContext;
  /** Live layout of a page (base sections with Phase 06 edits, or the published layout). */
  private readonly live: (pageKey: EditablePage) => LayoutSection[];

  constructor(ctx: DemoAdminContext, live: (pageKey: EditablePage) => LayoutSection[]) {
    this.ctx = ctx;
    this.live = live;
  }

  private get state() {
    const s = this.ctx.state as typeof this.ctx.state & DemoLayoutState;
    s.layouts ??= {};
    s.layoutDrafts ??= {};
    s.layoutVersions ??= {};
    return s as Required<DemoLayoutState>;
  }

  published(pageKey: EditablePage): LayoutSection[] | null {
    return this.state.layouts[pageKey] ?? null;
  }

  currentVersion(pageKey: EditablePage): number | null {
    return this.state.layoutVersions[pageKey]?.at(-1)?.version ?? null;
  }

  private recordVersion(pageKey: EditablePage, note: string | null, actor: AdminActor | null) {
    const versions = (this.state.layoutVersions[pageKey] ??= []);
    const version = (this.currentVersion(pageKey) ?? 0) + 1;
    versions.push({
      version,
      note: note?.slice(0, 500) ?? null,
      publishedAt: this.ctx.stamp(),
      publishedBy: actor?.name ?? null,
      sections: structuredClone(this.live(pageKey)),
    });
    return version;
  }

  /** The layout before the first versioned change becomes version 1 (restorable). */
  ensureInitial(pageKey: EditablePage) {
    if (this.currentVersion(pageKey) === null) this.recordVersion(pageKey, 'Initial layout', null);
  }

  /** Phase 06 structured section edit on a live page: recorded as a version too. */
  recordContentEdit(pageKey: EditablePage, key: string, actor: AdminActor) {
    this.recordVersion(pageKey, `Content edit: ${key}`, actor);
  }

  private pageJson(actor: AdminActor, pageKey: EditablePage): EditorPage {
    const versions = this.state.layoutVersions[pageKey] ?? [];
    const latest = versions.at(-1);
    const draft = this.state.layoutDrafts[pageKey];
    return {
      pageKey,
      published: structuredClone(this.live(pageKey)),
      version: latest?.version ?? null,
      publishedAt: latest?.publishedAt ?? null,
      publishedBy: latest?.publishedBy ?? null,
      draft: draft ? structuredClone(draft.sections) : null,
      draftUpdatedAt: draft?.updatedAt ?? null,
      draftBaseVersion: draft?.baseVersion ?? null,
      draftBy: draft?.updatedBy ?? null,
      canEdit: actor.can('design.edit'),
      canPublish: actor.can('design.publish'),
    };
  }

  overview(actor: AdminActor): EditorPageSummary[] {
    requireAny(actor, 'design.view');
    return EDITABLE_PAGES.map((pageKey) => {
      const { published, ...rest } = this.pageJson(actor, pageKey);
      return { ...rest, sectionCount: published.length };
    });
  }

  getPage(actor: AdminActor, pageKey: string): EditorPage | null {
    requireAny(actor, 'design.view');
    return isEditablePage(pageKey) ? this.pageJson(actor, pageKey) : null;
  }

  saveDraft(
    actor: AdminActor,
    pageKey: string,
    sections: unknown,
    expectedDraftAt: string | null,
  ): AdminResult<{ draftUpdatedAt: string; baseVersion: number | null }> {
    requireAny(actor, 'design.edit');
    if (!isEditablePage(pageKey)) return { ok: false, code: 'invalid_page' };
    const problem = structuralProblem(sections);
    if (problem) return { ok: false, code: problem };
    const layout = structuredClone(sections) as LayoutSection[];
    const current = this.state.layoutDrafts[pageKey];
    let before: LayoutSection[];
    let baseVersion: number | null;
    if (current) {
      if (current.updatedAt !== expectedDraftAt) return { ok: false, code: 'draft_conflict' };
      before = current.sections;
      baseVersion = current.baseVersion;
    } else {
      if (expectedDraftAt !== null) return { ok: false, code: 'draft_gone' };
      before = this.live(pageKey);
      baseVersion = this.currentVersion(pageKey);
    }
    const updatedAt = this.ctx.stamp();
    this.state.layoutDrafts[pageKey] = {
      sections: layout,
      baseVersion,
      updatedAt,
      updatedBy: actor.name,
    };
    this.ctx.audit(
      actor,
      'site_editor.draft_saved',
      'public.page_layout_drafts',
      pageKey,
      { sections: before },
      { sections: layout },
      { sections: layout.length },
    );
    return { ok: true, draftUpdatedAt: updatedAt, baseVersion };
  }

  discardDraft(actor: AdminActor, pageKey: string): AdminResult {
    requireAny(actor, 'design.edit');
    const draft = isEditablePage(pageKey) ? this.state.layoutDrafts[pageKey] : undefined;
    if (!draft || !isEditablePage(pageKey)) return { ok: false, code: 'no_draft' };
    this.state.layoutDrafts = without(this.state.layoutDrafts, pageKey);
    this.ctx.audit(
      actor,
      'site_editor.draft_discarded',
      'public.page_layout_drafts',
      pageKey,
      { sections: draft.sections },
      null,
    );
    return { ok: true };
  }

  /** Replace the live layout (the demo storefront reads it through DemoAdminContent.sections). */
  private apply(pageKey: EditablePage, sections: LayoutSection[]) {
    this.state.layouts[pageKey] = structuredClone(sections);
    // Phase 06 per-section overrides are folded into the layout from now on.
    const keys = new Set(sections.map((s) => s.key));
    this.ctx.state.sections = Object.fromEntries(
      Object.entries(this.ctx.state.sections).filter(([key]) => !keys.has(key)),
    );
  }

  publish(
    actor: AdminActor,
    pageKey: string,
    note: string | null,
    force = false,
  ): AdminResult<{ version: number }> {
    requireAny(actor, 'design.publish');
    const draft = isEditablePage(pageKey) ? this.state.layoutDrafts[pageKey] : undefined;
    if (!draft || !isEditablePage(pageKey)) return { ok: false, code: 'no_draft' };
    if (!force && draft.baseVersion !== this.currentVersion(pageKey))
      return { ok: false, code: 'draft_conflict' };
    const problem = structuralProblem(draft.sections);
    if (problem) return { ok: false, code: problem };
    this.ensureInitial(pageKey);
    const before = this.live(pageKey);
    this.apply(pageKey, draft.sections);
    const version = this.recordVersion(pageKey, note?.trim() || null, actor);
    this.state.layoutDrafts = without(this.state.layoutDrafts, pageKey);
    this.ctx.audit(
      actor,
      'site_editor.published',
      'public.page_layout_versions',
      pageKey,
      { sections: before },
      { sections: draft.sections },
      { version, note, forced: force },
    );
    this.ctx.catalogChanged();
    return { ok: true, version };
  }

  versions(actor: AdminActor, pageKey: string, limit = 30): LayoutVersion[] {
    requireAny(actor, 'design.view');
    if (!isEditablePage(pageKey)) return [];
    const n = Math.max(1, Math.min(limit, 100));
    return structuredClone([...(this.state.layoutVersions[pageKey] ?? [])].reverse().slice(0, n));
  }

  rollback(
    actor: AdminActor,
    pageKey: string,
    version: number,
    note: string | null,
  ): AdminResult<{ version: number }> {
    requireAny(actor, 'design.publish');
    const target = isEditablePage(pageKey)
      ? this.state.layoutVersions[pageKey]?.find((v) => v.version === version)
      : undefined;
    if (!target || !isEditablePage(pageKey)) return { ok: false, code: 'version_not_found' };
    this.ensureInitial(pageKey);
    const before = this.live(pageKey);
    this.apply(pageKey, target.sections);
    const next = this.recordVersion(pageKey, note?.trim() || `Restored version ${version}`, actor);
    this.ctx.audit(
      actor,
      'site_editor.rolled_back',
      'public.page_layout_versions',
      pageKey,
      { sections: before },
      { sections: target.sections },
      { toVersion: version, version: next },
    );
    this.ctx.catalogChanged();
    return { ok: true, version: next };
  }
}
