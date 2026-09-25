import { z } from 'zod';
import baseSeed from '@seed/base/site-settings.json';
import { NO_ACCESS, type AccessProfile } from '@/domain/access/access';
import { SYSTEM_ROLES, type RoleDefinition } from '@/domain/access/permissions';
import type { SettingRecord } from '@/domain/settings/resolve';
import { readStored, writeStored } from '@/lib/storage/localStore';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import {
  DEMO_SETTINGS_OVERLAY,
  DemoCommerceRepository,
  DemoCommerceStore,
  DemoOrderOperationsRepository,
} from './demoCommerce';
import {
  DemoCatalogRepository,
  DemoContentRepository,
  DemoCustomerRequestsRepository,
} from './demoStorefront';
import type {
  AccessRepository,
  Profile,
  ProfilePreferencesUpdate,
  ProfileRepository,
  Repositories,
  SettingsRepository,
} from '../types';

/** Simulated latency keeps loading states honest during demo previews. */
const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

class DemoSettingsRepository implements SettingsRepository {
  async listPublishedSettings(): Promise<SettingRecord[]> {
    await delay();
    return Object.entries(baseSeed.settings).map(([key, value]) => ({
      key,
      // Demo previews switch on promo codes (DEMO10); the real base configuration keeps them off.
      value:
        key === 'features' ? { ...(value as object), ...DEMO_SETTINGS_OVERLAY.features } : value,
      version: 1,
      updatedAt: null,
    }));
  }
}

class DemoAccessRepository implements AccessRepository {
  private readonly auth: DemoAuthService;

  constructor(auth: DemoAuthService) {
    this.auth = auth;
  }

  async getMyAccess(): Promise<AccessProfile | null> {
    await delay();
    const session = await this.auth.getSession();
    if (!session) return null;
    const role = SYSTEM_ROLES.find((r) => r.key === this.auth.demo.getRoleKey());
    if (!role) return NO_ACCESS(session.userId);
    return {
      userId: session.userId,
      roles: [{ key: role.key, rank: role.rank, name: role.name }],
      grantsAll: role.grantsAll,
      permissions: new Set(role.permissions),
    };
  }

  async listRoles(): Promise<RoleDefinition[]> {
    await delay();
    return SYSTEM_ROLES;
  }
}

const demoProfileSchema = z.object({
  preferredLocale: z.enum(['ar', 'en']),
  adminLocale: z.enum(['ar', 'en']).nullable(),
  fullName: z.string().nullable(),
});

class DemoProfileRepository implements ProfileRepository {
  private readonly auth: DemoAuthService;

  constructor(auth: DemoAuthService) {
    this.auth = auth;
  }

  private key(userId: string) {
    return `demo-profile:${userId}`;
  }

  async getMyProfile(): Promise<Profile | null> {
    const session = await this.auth.getSession();
    if (!session) return null;
    const stored = readStored(this.key(session.userId), demoProfileSchema, 'session');
    return {
      id: session.userId,
      email: session.email,
      phone: null,
      fullName: stored?.fullName ?? null,
      preferredLocale: stored?.preferredLocale ?? 'ar',
      adminLocale: stored?.adminLocale ?? null,
    };
  }

  async updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void> {
    const profile = await this.getMyProfile();
    if (!profile) return;
    writeStored(
      this.key(profile.id),
      {
        preferredLocale: update.preferredLocale ?? profile.preferredLocale,
        adminLocale: update.adminLocale ?? profile.adminLocale,
        fullName: profile.fullName,
      },
      'session',
    );
  }
}

export function createDemoRepositories(auth: DemoAuthService): Repositories {
  const store = new DemoCommerceStore();
  return {
    settings: new DemoSettingsRepository(),
    access: new DemoAccessRepository(auth),
    profiles: new DemoProfileRepository(auth),
    catalog: new DemoCatalogRepository(store),
    content: new DemoContentRepository(store),
    requests: new DemoCustomerRequestsRepository(),
    commerce: new DemoCommerceRepository(store, auth),
    orders: new DemoOrderOperationsRepository(store, auth),
  };
}
