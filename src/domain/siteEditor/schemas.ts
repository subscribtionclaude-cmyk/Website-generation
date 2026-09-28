import { z } from 'zod';
import { sectionDesignSchema } from '@/domain/content/sections';

/**
 * Visual Site Editor (Phase 07) contracts. A page layout is an ordered list of sections — the same
 * { type, isVisible, props } rows the storefront renders (public.page_sections) plus a structured
 * `design`. Drafts and versions live in page_layout_drafts / page_layout_versions (see
 * supabase/migrations/20261001100000_site_editor.sql); publishing replaces the live rows.
 */
export const EDITABLE_PAGES = ['home', 'apple', 'offers'] as const;
export type EditablePage = (typeof EDITABLE_PAGES)[number];

export function isEditablePage(value: string): value is EditablePage {
  return (EDITABLE_PAGES as readonly string[]).includes(value);
}

/** Mirrors app.validate_page_layout. */
export const MAX_SECTIONS = 40;
export const MAX_PROPS_BYTES = 65_536;
export const SECTION_KEY_RE = /^[a-z0-9-]{1,60}$/;

/** Raster only: SVG can carry script, so the editor never uploads it (the bucket would allow it). */
export const SITE_MEDIA_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};
/** The site-media bucket limit (storage migration). */
export const SITE_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export const layoutSectionSchema = z.object({
  key: z.string(),
  type: z.string(),
  isVisible: z.boolean(),
  props: z.record(z.string(), z.unknown()),
  /** Unknown design keys are dropped (the database refuses them anyway). */
  design: sectionDesignSchema.optional().catch(undefined),
});
export type LayoutSection = z.infer<typeof layoutSectionSchema>;

const isoN = z.string().nullable();
const versionN = z.number().int().nullable();

export const editorPageSchema = z.object({
  pageKey: z.enum(EDITABLE_PAGES),
  published: z.array(layoutSectionSchema),
  version: versionN,
  publishedAt: isoN,
  publishedBy: z.string().nullable(),
  draft: z.array(layoutSectionSchema).nullable(),
  draftUpdatedAt: isoN,
  draftBaseVersion: versionN,
  draftBy: z.string().nullable(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
});
export type EditorPage = z.infer<typeof editorPageSchema>;

export const editorPageSummarySchema = editorPageSchema
  .omit({ published: true })
  .extend({ sectionCount: z.coerce.number().int() });
export type EditorPageSummary = z.infer<typeof editorPageSummarySchema>;

export const layoutVersionSchema = z.object({
  version: z.number().int(),
  note: z.string().nullable(),
  publishedAt: z.string(),
  publishedBy: z.string().nullable(),
  sections: z.array(layoutSectionSchema),
});
export type LayoutVersion = z.infer<typeof layoutVersionSchema>;

/** Business outcomes of the editor RPCs (anything else is a thrown RepositoryError). */
export const LAYOUT_PROBLEMS = [
  'invalid_page',
  'invalid_layout',
  'too_many_sections',
  'invalid_key',
  'duplicate_key',
  'unknown_type',
  'invalid_props',
  'invalid_design',
  'draft_conflict',
  'draft_gone',
  'no_draft',
  'version_not_found',
] as const;
export type LayoutProblem = (typeof LAYOUT_PROBLEMS)[number];
