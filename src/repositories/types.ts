import type { AccessProfile } from '@/domain/access/access';
import type { RoleDefinition } from '@/domain/access/permissions';
import type { SettingRecord } from '@/domain/settings/resolve';
import type { Locale } from '@/i18n/config';

/**
 * Repository ports. UI and features depend only on these interfaces; the concrete adapter
 * (demo seed data or Supabase) is chosen once at boot from the explicit data mode.
 * A future backend (or an ERP/POS sync layer) implements the same ports.
 */
export interface SettingsRepository {
  /** Published values of public settings (drafts are never returned). */
  listPublishedSettings(): Promise<SettingRecord[]>;
}

export interface AccessRepository {
  /** Effective access of the signed-in user; null when signed out. */
  getMyAccess(): Promise<AccessProfile | null>;
  /** Role definitions with their permissions (staff only). */
  listRoles(): Promise<RoleDefinition[]>;
}

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  preferredLocale: Locale;
  adminLocale: Locale | null;
}

export interface ProfilePreferencesUpdate {
  preferredLocale?: Locale;
  adminLocale?: Locale;
}

export interface ProfileRepository {
  getMyProfile(): Promise<Profile | null>;
  updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void>;
}

export interface Repositories {
  settings: SettingsRepository;
  access: AccessRepository;
  profiles: ProfileRepository;
}
