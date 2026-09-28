import { z } from 'zod';
import {
  EDITABLE_PAGES,
  layoutSectionSchema,
  type LayoutSection,
} from '@/domain/siteEditor/schemas';

/**
 * Site Editor ⇄ preview frame messages (same-origin postMessage only). The admin editor holds the
 * drafts (loaded through permission-checked RPCs); the frame renders the real storefront with them.
 * The preview URL on its own shows nothing unpublished.
 */
export const PREVIEW_READY = 'malek-preview:ready';
export const PREVIEW_STATE = 'malek-preview:state';
/** Scroll the preview to a section (the one selected in the editor) and outline it briefly. */
export const PREVIEW_FOCUS = 'malek-preview:focus';
export const PREVIEW_FRAME_NAME = 'malek-preview';
export const SAMPLE_FRAME_NAME = 'malek-preview-sample';

/** Settings the editor may preview (the design settings plus page SEO and trust text). */
export const PREVIEW_SETTING_KEYS = [
  'theme',
  'navigation',
  'brand',
  'seo',
  'page_seo',
  'trust',
] as const;

export const previewStateSchema = z.object({
  type: z.literal(PREVIEW_STATE),
  layouts: z.partialRecord(z.enum(EDITABLE_PAGES), z.array(layoutSectionSchema)),
  settings: z.partialRecord(z.enum(PREVIEW_SETTING_KEYS), z.record(z.string(), z.unknown())),
});
export type PreviewStateMessage = z.infer<typeof previewStateSchema>;

export interface PreviewState {
  layouts: Partial<Record<(typeof EDITABLE_PAGES)[number], LayoutSection[]>>;
  settings: Partial<Record<(typeof PREVIEW_SETTING_KEYS)[number], Record<string, unknown>>>;
}

export const previewFocusSchema = z.object({
  type: z.literal(PREVIEW_FOCUS),
  key: z.string().regex(/^[a-z0-9-]{1,60}$/),
});

export const previewReadySchema = z.object({
  type: z.literal(PREVIEW_READY),
  sample: z.boolean(),
  /** Sample store refused (live mode without the demo-catalog feature enabled). */
  sampleBlocked: z.boolean(),
});
export type PreviewReadyMessage = z.infer<typeof previewReadySchema>;
