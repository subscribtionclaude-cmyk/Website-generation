import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AccessProfile } from '@/domain/access/access';
import { isPermissionKey, type RoleDefinition } from '@/domain/access/permissions';
import { localizedTextSchema } from '@/domain/localized';
import type { SettingRecord } from '@/domain/settings/resolve';
import type {
  AccessRepository,
  Profile,
  ProfilePreferencesUpdate,
  ProfileRepository,
  Repositories,
  SettingsRepository,
} from '../types';

/** Normalised repository error so the UI can show "backend unavailable" states consistently. */
export class RepositoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'RepositoryError';
  }
}

function fail(operation: string, error: unknown): never {
  throw new RepositoryError(`Supabase ${operation} failed`, error);
}

const settingRowSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  version: z.number().int(),
  updated_at: z.string().nullable(),
});

class SupabaseSettingsRepository implements SettingsRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async listPublishedSettings(): Promise<SettingRecord[]> {
    // RLS returns public settings to everyone; drafts live in a separate staff-only table.
    const { data, error } = await this.client
      .from('site_settings')
      .select('key, value, version, updated_at');
    if (error) fail('site_settings select', error);
    return z
      .array(settingRowSchema)
      .parse(data)
      .map((row) => ({
        key: row.key,
        value: row.value,
        version: row.version,
        updatedAt: row.updated_at,
      }));
  }
}

const myAccessSchema = z.object({
  userId: z.string().nullable(),
  grantsAll: z.boolean(),
  roles: z.array(z.object({ key: z.string(), rank: z.number(), name: localizedTextSchema })),
  permissions: z.array(z.string()),
});

const roleRowSchema = z.object({
  key: z.string(),
  rank: z.number(),
  grants_all: z.boolean(),
  is_system: z.boolean(),
  name: localizedTextSchema,
  role_permissions: z.array(z.object({ permission_key: z.string() })),
});

class SupabaseAccessRepository implements AccessRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getMyAccess(): Promise<AccessProfile | null> {
    const { data, error } = await this.client.rpc('get_my_access');
    if (error) fail('get_my_access', error);
    const parsed = myAccessSchema.parse(data);
    if (!parsed.userId) return null;
    return {
      userId: parsed.userId,
      roles: parsed.roles,
      grantsAll: parsed.grantsAll,
      permissions: new Set(parsed.permissions.filter(isPermissionKey)),
    };
  }

  async listRoles(): Promise<RoleDefinition[]> {
    const { data, error } = await this.client
      .from('roles')
      .select('key, rank, grants_all, is_system, name, role_permissions(permission_key)')
      .is('deleted_at', null)
      .order('rank', { ascending: false });
    if (error) fail('roles select', error);
    return z
      .array(roleRowSchema)
      .parse(data)
      .map((row) => ({
        key: row.key,
        rank: row.rank,
        grantsAll: row.grants_all,
        isSystem: row.is_system,
        name: row.name,
        permissions: row.role_permissions.map((rp) => rp.permission_key).filter(isPermissionKey),
      }));
  }
}

const profileRowSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  preferred_locale: z.enum(['ar', 'en']),
  admin_locale: z.enum(['ar', 'en']).nullable(),
});

class SupabaseProfileRepository implements ProfileRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private async currentUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async getMyProfile(): Promise<Profile | null> {
    const userId = await this.currentUserId();
    if (!userId) return null;
    const { data, error } = await this.client
      .from('profiles')
      .select('id, email, full_name, phone, preferred_locale, admin_locale')
      .eq('id', userId)
      .maybeSingle();
    if (error) fail('profiles select', error);
    if (!data) return null;
    const row = profileRowSchema.parse(data);
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      preferredLocale: row.preferred_locale,
      adminLocale: row.admin_locale,
    };
  }

  async updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void> {
    const userId = await this.currentUserId();
    if (!userId) return;
    const patch: Record<string, string> = {};
    if (update.preferredLocale) patch.preferred_locale = update.preferredLocale;
    if (update.adminLocale) patch.admin_locale = update.adminLocale;
    if (Object.keys(patch).length === 0) return;
    const { error } = await this.client.from('profiles').update(patch).eq('id', userId);
    if (error) fail('profiles update', error);
  }
}

export function createSupabaseRepositories(client: SupabaseClient): Repositories {
  return {
    settings: new SupabaseSettingsRepository(client),
    access: new SupabaseAccessRepository(client),
    profiles: new SupabaseProfileRepository(client),
  };
}
