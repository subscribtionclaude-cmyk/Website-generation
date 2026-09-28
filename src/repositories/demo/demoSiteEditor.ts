import {
  SITE_MEDIA_TYPES,
  type EditablePage,
  type LayoutSection,
} from '@/domain/siteEditor/schemas';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import type { SiteEditorRepository } from '../adminTypes';
import { RepositoryError } from '../supabase/errors';
import { actorOf, guard, type DemoCommerceStore } from './demoCommerce';
import type { AdminActor } from '@/domain/admin/demo/demoAdmin';

const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));
/** Demo uploads stay inline in this browser; larger files would exhaust localStorage. */
const MAX_DEMO_MEDIA_BYTES = 450_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * DEMO MODE ONLY — SiteEditorRepository over the in-browser layout engine
 * (src/domain/admin/demo/layouts.ts): same permissions, validation codes, stale-draft detection,
 * versions and audit entries as the site_editor_* RPCs.
 */
export class DemoSiteEditorRepository implements SiteEditorRepository {
  private readonly store: DemoCommerceStore;
  private readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  private get layouts() {
    return this.store.admin.layouts;
  }

  private async run<T>(fn: (actor: AdminActor) => T, ms = 140): Promise<T> {
    await delay(ms);
    const actor = await actorOf(this.auth, this.store);
    if (!actor.userId) throw new RepositoryError('forbidden', null, 'forbidden');
    return guard(() => fn(actor));
  }

  overview() {
    return this.run((a) => this.layouts.overview(a));
  }
  getPage(pageKey: EditablePage) {
    return this.run((a) => this.layouts.getPage(a, pageKey));
  }
  saveDraft(pageKey: EditablePage, sections: LayoutSection[], expectedDraftAt: string | null) {
    return this.run((a) => this.layouts.saveDraft(a, pageKey, sections, expectedDraftAt), 220);
  }
  discardDraft(pageKey: EditablePage) {
    return this.run((a) => this.layouts.discardDraft(a, pageKey));
  }
  publish(pageKey: EditablePage, note: string | null, force = false) {
    return this.run((a) => this.layouts.publish(a, pageKey, note, force), 260);
  }
  versions(pageKey: EditablePage, limit = 30) {
    return this.run((a) => this.layouts.versions(a, pageKey, limit));
  }
  rollback(pageKey: EditablePage, version: number, note: string | null) {
    return this.run((a) => this.layouts.rollback(a, pageKey, version, note), 260);
  }
  async uploadMedia(file: Blob, mime: string) {
    await this.run((a) => {
      if (!a.can('design.edit')) throw new RepositoryError('forbidden', null, 'forbidden');
    }, 250);
    if (!SITE_MEDIA_TYPES[mime])
      throw new RepositoryError('unsupported media type', null, 'invalid_response');
    if (file.size > MAX_DEMO_MEDIA_BYTES)
      throw new RepositoryError('Image too large for the demo preview', null, 'invalid_response');
    return { url: await blobToDataUrl(file) };
  }
}
