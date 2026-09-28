import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminProblemSchema, type AdminResult } from '@/domain/admin/schemas';
import {
  editorPageSchema,
  editorPageSummarySchema,
  layoutVersionSchema,
  SITE_MEDIA_MAX_BYTES,
  SITE_MEDIA_TYPES,
  type EditablePage,
  type LayoutSection,
} from '@/domain/siteEditor/schemas';
import type { SiteEditorRepository } from '../adminTypes';
import { RepositoryError } from './errors';
import { rpc } from './rpc';

const result = <T extends z.ZodRawShape>(shape: T) =>
  z.union([z.object({ ok: z.literal(true), ...shape }), adminProblemSchema]);

const draftResult = result({
  draftUpdatedAt: z.string(),
  baseVersion: z.number().int().nullable(),
});
const versionResult = result({ version: z.number().int() });
const plainResult = result({});

/**
 * Site Editor port over the SECURITY DEFINER RPCs in 20261001100000_site_editor.sql. The database
 * checks design.view / design.edit / design.publish, validates layouts, detects stale drafts and
 * writes the audit log; this adapter shapes arguments and validates responses.
 */
export class SupabaseSiteEditorRepository implements SiteEditorRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async overview() {
    const rows = await rpc(
      this.client,
      'site_editor_overview',
      {},
      z.array(editorPageSummarySchema).nullable(),
    );
    return rows ?? [];
  }
  getPage(pageKey: EditablePage) {
    return rpc(
      this.client,
      'site_editor_get_page',
      { p_page_key: pageKey },
      editorPageSchema.nullable(),
    );
  }
  saveDraft(pageKey: EditablePage, sections: LayoutSection[], expectedDraftAt: string | null) {
    return rpc(
      this.client,
      'site_editor_save_draft',
      { p_page_key: pageKey, p_sections: sections, p_expected_draft_at: expectedDraftAt },
      draftResult,
    ) as Promise<AdminResult<{ draftUpdatedAt: string; baseVersion: number | null }>>;
  }
  discardDraft(pageKey: EditablePage) {
    return rpc(this.client, 'site_editor_discard_draft', { p_page_key: pageKey }, plainResult);
  }
  publish(pageKey: EditablePage, note: string | null, force = false) {
    return rpc(
      this.client,
      'site_editor_publish',
      { p_page_key: pageKey, p_note: note, p_force: force },
      versionResult,
    );
  }
  versions(pageKey: EditablePage, limit = 30) {
    return rpc(
      this.client,
      'site_editor_versions',
      { p_page_key: pageKey, p_limit: limit },
      z.array(layoutVersionSchema),
    );
  }
  rollback(pageKey: EditablePage, version: number, note: string | null) {
    return rpc(
      this.client,
      'site_editor_rollback',
      { p_page_key: pageKey, p_version: version, p_note: note },
      versionResult,
    );
  }
  async uploadMedia(file: Blob, mime: string) {
    const ext = SITE_MEDIA_TYPES[mime];
    if (!ext) throw new RepositoryError('unsupported media type', null, 'invalid_response');
    if (file.size > SITE_MEDIA_MAX_BYTES)
      throw new RepositoryError('file too large', null, 'invalid_response');
    // Storage policy: insert into site-media requires design.edit (checked by the database).
    const path = `editor/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.client.storage
      .from('site-media')
      .upload(path, file, { contentType: mime, upsert: false, cacheControl: '31536000' });
    if (error) throw new RepositoryError('upload failed', error, 'unavailable');
    return { url: this.client.storage.from('site-media').getPublicUrl(path).data.publicUrl };
  }
}
