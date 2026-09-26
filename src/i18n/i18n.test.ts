import { describe, expect, it } from 'vitest';
import { adminAr } from '@/admin/i18n/ar';
import { adminEn } from '@/admin/i18n/en';
import { ar } from './messages/ar';
import { en } from './messages/en';
import { servicesAr } from './messages/services.ar';
import { servicesEn } from './messages/services.en';
import { localizePath, parseLocalePath, switchLocalePath } from './paths';
import { createTranslator, interpolate, isolate } from './translator';

function leaves(tree: object, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leaves(value as object, `${prefix}${key}.`),
  );
}

describe('dictionaries', () => {
  it.each([
    ['storefront', ar, en],
    ['services', servicesAr, servicesEn],
    ['admin', adminAr, adminEn],
  ])(
    '%s: Arabic and English have identical keys and no empty strings',
    (_name, arabic, english) => {
      const arKeys = leaves(arabic)
        .map(([key]) => key)
        .sort();
      const enKeys = leaves(english)
        .map(([key]) => key)
        .sort();
      expect(enKeys).toEqual(arKeys);
      for (const [key, value] of [...leaves(arabic), ...leaves(english)]) {
        expect(value.trim(), key).not.toBe('');
      }
    },
  );

  it('keeps placeholders consistent between languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const english = new Map([...leaves(en), ...leaves(servicesEn)]);
    for (const [key, value] of [...leaves(ar), ...leaves(servicesAr)]) {
      expect(placeholders(english.get(key) ?? ''), key).toEqual(placeholders(value));
    }
  });

  it('lazily registered service namespaces never shadow core namespaces', () => {
    for (const namespace of Object.keys(servicesAr))
      expect(Object.keys(ar)).not.toContain(namespace);
  });
});

describe('translator', () => {
  const t = createTranslator<string>(
    { a: { b: 'Hello {name}' } },
    { a: { b: 'مرحبا {name}', c: 'احتياطي' } },
  );

  it('interpolates, falls back to Arabic, then to the key', () => {
    expect(t('a.b', { name: 'Malek' })).toBe('Hello Malek');
    expect(t('a.c')).toBe('احتياطي');
    expect(t('missing.key')).toBe('missing.key');
  });

  it('resolves keys that contain dots (permission labels)', () => {
    const at = createTranslator<string>({ permissions: { 'orders.view': 'View orders' } }, {});
    expect(at('permissions.orders.view')).toBe('View orders');
    expect(at('permissions.orders.missing')).toBe('permissions.orders.missing');
  });

  it('leaves unknown placeholders visible', () => {
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });

  it('isolates LTR values for Arabic sentences', () => {
    expect(isolate('a@b.co')).toBe('\u2068a@b.co\u2069');
  });
});

describe('locale-aware paths', () => {
  it('keeps Arabic at the root and English under /en', () => {
    expect(localizePath('/store', 'ar')).toBe('/store');
    expect(localizePath('/store', 'en')).toBe('/en/store');
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('https://wa.me/20100', 'en')).toBe('https://wa.me/20100');
  });

  it('parses and switches locales preserving query and hash', () => {
    expect(parseLocalePath('/en/trade-in')).toEqual({ locale: 'en', path: '/trade-in' });
    expect(parseLocalePath('/en')).toEqual({ locale: 'en', path: '/' });
    expect(parseLocalePath('/english')).toEqual({ locale: 'ar', path: '/english' });
    expect(switchLocalePath({ pathname: '/store', search: '?q=iphone', hash: '#top' }, 'en')).toBe(
      '/en/store?q=iphone#top',
    );
    expect(switchLocalePath({ pathname: '/en/store' }, 'ar')).toBe('/store');
  });
});
