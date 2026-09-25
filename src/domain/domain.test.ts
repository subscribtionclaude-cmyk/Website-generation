import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import demoCatalog from '@seed/demo/catalog.json';
import demoManifest from '@seed/demo/manifest.json';
import {
  hasPermission,
  highestRank,
  isStaff,
  NO_ACCESS,
  type AccessProfile,
} from './access/access';
import catalog from './access/access-catalog.json';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
} from './access/permissions';
import { resolveLocalized } from './localized';
import { BASE_SETTINGS } from './settings/defaults';
import { PUBLIC_SETTING_KEYS, SETTING_DEFINITIONS, SETTING_SCHEMAS } from './settings/registry';
import { resolveSettings } from './settings/resolve';
import { isSafeHref } from './settings/schemas';

describe('localized text', () => {
  it('falls back to Arabic when English is missing or blank', () => {
    expect(resolveLocalized({ ar: 'الصيانة', en: 'Repairs' }, 'en')).toBe('Repairs');
    expect(resolveLocalized({ ar: 'الصيانة' }, 'en')).toBe('الصيانة');
    expect(resolveLocalized({ ar: 'الصيانة', en: '  ' }, 'en')).toBe('الصيانة');
    expect(resolveLocalized(null, 'ar')).toBe('');
  });
});

describe('access catalog', () => {
  it('TypeScript permission keys match the shared JSON contract', () => {
    expect([...PERMISSION_KEYS].sort()).toEqual(catalog.permissions.map((p) => p.key).sort());
    expect(PERMISSION_DEFINITIONS).toHaveLength(catalog.permissions.length);
    expect([...SYSTEM_ROLE_KEYS].sort()).toEqual(catalog.roles.map((r) => r.key).sort());
  });

  it('every role grant references a known permission and Super Admin gets all', () => {
    for (const role of catalog.roles) {
      if (role.permissions === '*') continue;
      for (const key of role.permissions as string[])
        expect(PERMISSION_KEYS, `${role.key}:${key}`).toContain(key);
    }
    expect(SYSTEM_ROLES.find((r) => r.key === 'super_admin')?.permissions).toHaveLength(
      PERMISSION_KEYS.length,
    );
    expect(SYSTEM_ROLES.filter((r) => r.grantsAll).map((r) => r.key)).toEqual(['owner']);
  });

  it('hasPermission honours grantsAll and explicit grants', () => {
    const sales: AccessProfile = {
      userId: 'u1',
      roles: [{ key: 'sales', rank: 40, name: { ar: 'المبيعات' } }],
      grantsAll: false,
      permissions: new Set(['orders.view']),
    };
    expect(hasPermission(sales, 'orders.view')).toBe(true);
    expect(hasPermission(sales, 'pricing.manage')).toBe(false);
    expect(hasPermission({ ...sales, grantsAll: true }, 'security.manage')).toBe(true);
    expect(hasPermission(null, 'dashboard.view')).toBe(false);
    expect(isStaff(sales)).toBe(true);
    expect(isStaff(NO_ACCESS('c1'))).toBe(false);
    expect(highestRank(sales)).toBe(40);
  });
});

describe('site settings', () => {
  it('every setting definition has a schema (and vice versa)', () => {
    expect(SETTING_DEFINITIONS.map((d) => d.key).sort()).toEqual(
      Object.keys(SETTING_SCHEMAS).sort(),
    );
    expect(PUBLIC_SETTING_KEYS).not.toContain('security');
  });

  it('the base seed is valid for every key and carries the owner-supplied store details', () => {
    for (const [key, schema] of Object.entries(SETTING_SCHEMAS)) {
      const parsed = schema.safeParse((baseSeed.settings as Record<string, unknown>)[key]);
      expect(parsed.success, `${key}: ${parsed.error?.message}`).toBe(true);
    }
    const branch = BASE_SETTINGS.store.branches[0];
    expect(branch?.phones).toEqual(['01212004229', '01212003775']);
    expect(branch?.address.en).toBe('72 Abbasseya Street');
    expect(branch?.landmark?.en).toBe('In front of Abdou Pasha Metro');
    expect(BASE_SETTINGS.store.whatsappNumber).toBeNull(); // never assumed
    expect(BASE_SETTINGS.brand.name).toBe('MALEK STORE');
    expect(BASE_SETTINGS.navigation.primary.map((i) => i.id)).toEqual([
      'home',
      'apple',
      'store',
      'offers',
      'new',
      'trade-in',
      'repairs',
      'used',
      'news',
      'contact',
    ]);
    expect(BASE_SETTINGS.features).toEqual({
      promoCodes: false,
      loyalty: false,
      showDemoCatalog: false,
    });
  });

  it('the demo manifest lists every demo dataset with counts matching the generated catalog', () => {
    expect(demoManifest.datasets.map((d) => d.key)).toEqual([
      'catalog',
      'offers',
      'content',
      'media',
    ]);
    const catalog = demoManifest.datasets[0];
    expect(catalog?.counts).toEqual({
      brands: demoCatalog.brands.length,
      categories: demoCatalog.categories.length,
      products: demoCatalog.products.length,
      variants: demoCatalog.products.reduce((n, p) => n + p.variants.length, 0),
    });
    expect(demoManifest.datasets[1]?.counts).toEqual({ offers: demoCatalog.offers.length });
    expect(demoManifest.datasets[2]?.counts).toEqual({ entries: demoCatalog.entries.length });
  });

  it('merges backend rows over defaults and never lets invalid rows through', () => {
    const resolved = resolveSettings([
      {
        key: 'brand',
        value: { ...BASE_SETTINGS.brand, name: 'MALEK STORE ✦' },
        version: 3,
        updatedAt: null,
      },
      { key: 'store', value: { branches: [] }, version: 2, updatedAt: null },
    ]);
    expect(resolved.settings.brand.name).toBe('MALEK STORE ✦');
    expect(resolved.sources.brand).toBe('backend');
    expect(resolved.versions.brand).toBe(3);
    expect(resolved.sources.store).toBe('default');
    expect(resolved.settings.store).toEqual(BASE_SETTINGS.store);
    expect(resolved.issues).toContainEqual(
      expect.objectContaining({ key: 'store', reason: 'invalid' }),
    );
    expect(resolved.issues).toContainEqual({ key: 'seo', reason: 'missing' });
  });

  it('rejects unsafe navigation links and theme values (no script/CSS injection)', () => {
    expect(isSafeHref('/store')).toBe(true);
    expect(isSafeHref('https://instagram.com/malek')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('http://insecure.example')).toBe(false);
    expect(
      SETTING_SCHEMAS.theme.safeParse({ tokens: { brandPrimary: 'red;}body{display:none' } })
        .success,
    ).toBe(false);
    expect(SETTING_SCHEMAS.theme.safeParse({ tokens: { notAToken: '#000000' } }).success).toBe(
      false,
    );
    expect(SETTING_SCHEMAS.theme.safeParse({ tokens: { brandPrimary: '#FD4E00' } }).success).toBe(
      true,
    );
  });
});
