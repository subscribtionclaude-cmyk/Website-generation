import { DemoServiceOperationsRepository, DemoServiceRequestsRepository } from './demoServices';
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
  DemoAccountRepository,
  DemoCustomerOperationsRepository,
  DemoCustomerRequestsRepository,
  DemoNotificationsRepository,
  DemoRecentlyViewedRepository,
  DemoReviewsRepository,
  DemoWishlistRepository,
} from './demoCustomer';
import { DemoCatalogRepository, DemoContentRepository } from './demoStorefront';
import { RepositoryError } from '../supabase/errors';
import type { CustomerProfileInput } from '@/domain/customer/types';
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

const demoPreferencesSchema = z.object({ adminLocale: z.enum(['ar', 'en']).nullable() });

/** Profile data lives in the demo customer store (localStorage); the admin language per tab. */
class DemoProfileRepository implements ProfileRepository {
  private readonly auth: DemoAuthService;
  private readonly store: DemoCommerceStore;

  constructor(auth: DemoAuthService, store: DemoCommerceStore) {
    this.auth = auth;
    this.store = store;
  }

  private key(userId: string) {
    return `demo-profile:${userId}`;
  }

  async getMyProfile(): Promise<Profile | null> {
    const session = await this.auth.getSession();
    if (!session) return null;
    const stored = readStored(this.key(session.userId), demoPreferencesSchema, 'session');
    const profile = this.store.customer.profile(session.userId);
    return {
      id: session.userId,
      email: session.email,
      phone: profile.phone,
      fullName: profile.fullName,
      preferredLocale: profile.preferredLocale,
      adminLocale: stored?.adminLocale ?? null,
      createdAt: profile.createdAt,
    };
  }

  async updateMyPreferences(update: ProfilePreferencesUpdate): Promise<void> {
    const profile = await this.getMyProfile();
    if (!profile) return;
    if (update.adminLocale)
      writeStored(this.key(profile.id), { adminLocale: update.adminLocale }, 'session');
    if (update.preferredLocale)
      this.store.customer.updateProfile(profile.id, {
        fullName: profile.fullName ?? '',
        phone: profile.phone ?? '',
        preferredLocale: update.preferredLocale,
      });
  }

  async updateMyProfile(input: CustomerProfileInput) {
    await delay(200);
    const session = await this.auth.getSession();
    if (!session) throw new RepositoryError('authentication required', null, 'forbidden');
    return this.store.customer.updateProfile(session.userId, input);
  }
}

export function createDemoRepositories(auth: DemoAuthService): Repositories {
  const store = new DemoCommerceStore();
  return {
    settings: new DemoSettingsRepository(),
    access: new DemoAccessRepository(auth),
    profiles: new DemoProfileRepository(auth, store),
    catalog: new DemoCatalogRepository(store),
    content: new DemoContentRepository(store),
    requests: new DemoCustomerRequestsRepository(store, auth),
    commerce: new DemoCommerceRepository(store, auth),
    orders: new DemoOrderOperationsRepository(store, auth),
    account: new DemoAccountRepository(store, auth),
    wishlist: new DemoWishlistRepository(store, auth),
    recent: new DemoRecentlyViewedRepository(store, auth),
    notifications: new DemoNotificationsRepository(store, auth),
    reviews: new DemoReviewsRepository(store, auth),
    customerOps: new DemoCustomerOperationsRepository(store, auth),
    services: new DemoServiceRequestsRepository(store, auth),
    serviceOps: new DemoServiceOperationsRepository(store, auth),
  };
}
