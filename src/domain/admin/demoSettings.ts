import type { PermissionKey } from '@/domain/access/permissions';
import { SETTING_DEFINITIONS, SETTING_SCHEMAS, type SettingKey } from '@/domain/settings/registry';
import type { AdminResult, SettingOverview, SettingVersion } from './schemas';

/**
 * DEMO MODE ONLY — the site_settings draft → publish → version → rollback workflow in this
 * browser (same rules as supabase/migrations/*_site_settings.sql + admin_foundation):
 * one shared draft per key, stale-draft detection on save, publish refuses a draft that was based
 * on an older published version unless forced, rollback republishes an old version as a new one.
 * The demo storefront reads `published()`, so a publish is visible immediately.
 */
type Json = Record<string, unknown>;

interface DemoDraft {
  value: Json;
  updatedAt: string;
  baseVersion: number | null;
  by: string | null;
}

export interface DemoSettingsState {
  version: 1;
  versions: Record<string, SettingVersion[]>;
  drafts: Record<string, DemoDraft>;
}

export const emptyDemoSettingsState = (): DemoSettingsState => ({
  version: 1,
  versions: {},
  drafts: {},
});

export interface DemoSettingsActor {
  userId: string | null;
  name: string | null;
  can: (permission: PermissionKey) => boolean;
}

const MAX_SETTING_BYTES = 64 * 1024;

export class DemoSettings {
  private state: DemoSettingsState;
  private readonly base: Record<string, Json>;
  private readonly storage: { load(): DemoSettingsState | null; save(s: DemoSettingsState): void };
  private readonly now: () => Date;
  private lastStamp = 0;

  constructor(options: {
    base: Record<string, Json>;
    storage: { load(): DemoSettingsState | null; save(s: DemoSettingsState): void };
    now?: () => Date;
  }) {
    this.base = options.base;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.state = this.storage.load() ?? emptyDemoSettingsState();
  }

  private persist() {
    this.storage.save(this.state);
  }

  /** Strictly increasing timestamps so two quick saves never share an updatedAt. */
  private stamp(): string {
    const ms = Math.max(this.now().getTime(), this.lastStamp + 1);
    this.lastStamp = ms;
    return new Date(ms).toISOString();
  }

  private history(key: string): SettingVersion[] {
    const own = this.state.versions[key];
    if (own?.length) return own;
    const base = this.base[key];
    return base
      ? [
          {
            version: 1,
            value: base,
            note: 'Base configuration',
            publishedAt: '',
            publishedBy: null,
          },
        ]
      : [];
  }

  private latest(key: string): SettingVersion | null {
    const h = this.history(key);
    return h[h.length - 1] ?? null;
  }

  /** Published value of a key (what the storefront and demo engines use). */
  published(key: string): Json | null {
    return this.latest(key)?.value ?? null;
  }

  publishedAll(): { key: string; value: Json; version: number }[] {
    return SETTING_DEFINITIONS.filter((d) => d.isPublic).flatMap((d) => {
      const latest = this.latest(d.key);
      return latest ? [{ key: d.key, value: latest.value, version: latest.version }] : [];
    });
  }

  private definition(key: string) {
    return SETTING_DEFINITIONS.find((d) => d.key === key);
  }

  private canSee(actor: DemoSettingsActor, key: string) {
    const d = this.definition(key);
    if (!d) return false;
    return (
      actor.can(d.editPermission) ||
      actor.can(d.publishPermission) ||
      (d.scope !== 'security' && actor.can('settings.view'))
    );
  }

  overview(actor: DemoSettingsActor): SettingOverview[] {
    return SETTING_DEFINITIONS.filter((d) => this.canSee(actor, d.key))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => {
        const latest = this.latest(d.key);
        const draft = this.state.drafts[d.key];
        return {
          key: d.key,
          scope: d.scope,
          isPublic: d.isPublic,
          canEdit: actor.can(d.editPermission),
          canPublish: actor.can(d.publishPermission),
          published: latest?.value ?? null,
          version: latest?.version ?? null,
          publishedAt: latest?.publishedAt || null,
          publishedBy: latest?.publishedBy ?? null,
          draft: draft?.value ?? null,
          draftUpdatedAt: draft?.updatedAt ?? null,
          draftBaseVersion: draft?.baseVersion ?? null,
          draftBy: draft?.by ?? null,
        };
      });
  }

  versions(actor: DemoSettingsActor, key: string, limit = 30): SettingVersion[] | 'forbidden' {
    if (!this.canSee(actor, key)) return 'forbidden';
    return [...this.history(key)].reverse().slice(0, limit);
  }

  /** Validate a value against the registry schema (the database stores what the app accepts). */
  private validate(key: string, value: Json): boolean {
    const schema = SETTING_SCHEMAS[key as SettingKey];
    return schema ? schema.safeParse(value).success : false;
  }

  saveDraft(
    actor: DemoSettingsActor,
    key: string,
    value: Json,
    expectedDraftAt: string | null,
  ): AdminResult<{ draftUpdatedAt: string; baseVersion: number | null }> | 'forbidden' {
    const d = this.definition(key);
    if (!d || !actor.can(d.editPermission)) return 'forbidden';
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { ok: false, code: 'invalid_value' };
    if (JSON.stringify(value).length > MAX_SETTING_BYTES) return { ok: false, code: 'too_large' };
    if (!this.validate(key, value)) return { ok: false, code: 'invalid_value' };
    const current = this.state.drafts[key];
    if (current && current.updatedAt !== expectedDraftAt)
      return { ok: false, code: 'draft_conflict' };
    if (!current && expectedDraftAt !== null) return { ok: false, code: 'draft_gone' };
    const draft: DemoDraft = {
      value,
      updatedAt: this.stamp(),
      baseVersion: current?.baseVersion ?? this.latest(key)?.version ?? null,
      by: actor.name,
    };
    this.state.drafts[key] = draft;
    this.persist();
    return { ok: true, draftUpdatedAt: draft.updatedAt, baseVersion: draft.baseVersion };
  }

  private dropDraft(key: string) {
    this.state.drafts = Object.fromEntries(
      Object.entries(this.state.drafts).filter(([k]) => k !== key),
    );
  }

  discard(actor: DemoSettingsActor, key: string): 'forbidden' | 'ok' {
    const d = this.definition(key);
    if (!d || !actor.can(d.editPermission)) return 'forbidden';
    this.dropDraft(key);
    this.persist();
    return 'ok';
  }

  private push(key: string, value: Json, note: string | null, by: string | null): number {
    const version = (this.latest(key)?.version ?? 0) + 1;
    this.state.versions[key] = [
      ...this.history(key),
      { version, value, note, publishedAt: this.stamp(), publishedBy: by },
    ];
    return version;
  }

  publish(
    actor: DemoSettingsActor,
    key: string,
    note: string | null,
    force = false,
  ): AdminResult<{ version: number }> | 'forbidden' {
    const d = this.definition(key);
    if (!d || !actor.can(d.publishPermission)) return 'forbidden';
    const draft = this.state.drafts[key];
    if (!draft) return { ok: false, code: 'no_draft' };
    const current = this.latest(key)?.version ?? null;
    if (!force && draft.baseVersion !== current) return { ok: false, code: 'draft_conflict' };
    const version = this.push(key, draft.value, note, actor.name);
    this.dropDraft(key);
    this.persist();
    return { ok: true, version };
  }

  rollback(
    actor: DemoSettingsActor,
    key: string,
    version: number,
    note: string | null,
  ): AdminResult<{ version: number }> | 'forbidden' {
    const d = this.definition(key);
    if (!d || !actor.can(d.publishPermission)) return 'forbidden';
    const target = this.history(key).find((v) => v.version === version);
    if (!target) return { ok: false, code: 'version_not_found' };
    const next = this.push(key, target.value, note ?? `Rollback to v${version}`, actor.name);
    this.persist();
    return { ok: true, version: next };
  }

  /** Backup payload (every key except security, like admin_export_backup). */
  backup(): Record<string, Json> {
    return Object.fromEntries(
      SETTING_DEFINITIONS.filter((d) => d.scope !== 'security').flatMap((d) => {
        const v = this.published(d.key);
        return v ? [[d.key, v]] : [];
      }),
    );
  }
}
