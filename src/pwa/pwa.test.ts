import { describe, expect, it, vi } from 'vitest';
import manifest from '../../public/manifest.webmanifest?raw';
import { cacheName, cachePolicy, isStorable, type RequestShape } from './cacheRules';
import { isPwaContext, recoverFromStaleChunks } from './install';

const ORIGIN = 'https://malek.test';
const nav = (path: string): RequestShape => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode: 'navigate',
  destination: 'document',
});
const sub = (url: string, destination = 'script'): RequestShape => ({
  url: url.startsWith('http') ? url : `${ORIGIN}${url}`,
  method: 'GET',
  mode: 'cors',
  destination,
});

describe('service worker cache rules', () => {
  it('public pages are network-first cached; private areas never are', () => {
    for (const path of ['/', '/en', '/store', '/en/product/iphone', '/offers/x', '/news/y'])
      expect(cachePolicy(nav(path), ORIGIN, null)).toBe('page');
    for (const path of [
      '/admin',
      '/admin/orders',
      '/account',
      '/en/account/notifications',
      '/checkout',
      '/cart',
      '/order/MS-1',
      '/order/MS-1/invoice',
      '/wishlist',
      '/en/compare',
      '/search',
      '/en/search',
      '/store?brand=apple',
    ])
      expect(cachePolicy(nav(path), ORIGIN, null)).toBe('private-page');
  });

  it('never caches API calls, auth, private uploads, writes or requests from private pages', () => {
    const api = 'https://proj.supabase.co';
    expect(cachePolicy(sub(`${api}/rest/v1/rpc/storefront_catalog`, ''), ORIGIN, null)).toBe(
      'bypass',
    );
    expect(cachePolicy(sub(`${api}/auth/v1/token`, ''), ORIGIN, null)).toBe('bypass');
    expect(
      cachePolicy(
        sub(`${api}/storage/v1/object/sign/uploads/x.jpg?token=t`, 'image'),
        ORIGIN,
        null,
      ),
    ).toBe('bypass');
    expect(cachePolicy({ ...sub('/assets/a.js'), method: 'POST' }, ORIGIN, null)).toBe('bypass');
    // A built asset requested by the admin or the account area: straight to the network.
    expect(cachePolicy(sub('/assets/a.js'), ORIGIN, `${ORIGIN}/admin/orders`)).toBe('bypass');
    expect(cachePolicy(sub('/brand/logo.png', 'image'), ORIGIN, `${ORIGIN}/en/account`)).toBe(
      'bypass',
    );
    for (const path of ['/sw.js', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest'])
      expect(cachePolicy(sub(path, ''), ORIGIN, null)).toBe('bypass');
  });

  it('never caches optional integrations: analytics, Edge Functions, webhooks, health or sync', () => {
    const api = 'https://proj.supabase.co';
    for (const [url, destination] of [
      ['https://www.googletagmanager.com/gtag/js?id=G-TEST1234', 'script'],
      ['https://www.google-analytics.com/g/collect?v=2&tid=G-TEST1234', ''],
      ['https://region1.google-analytics.com/g/collect', ''],
      [`${api}/functions/v1/integrations`, ''],
      [`${api}/functions/v1/integration-webhook`, ''],
      [`${api}/rest/v1/rpc/admin_integrations_overview`, ''],
      [`${api}/rest/v1/rpc/storefront_integrations`, ''],
      [`${api}/auth/v1/settings`, ''],
      [`${api}/auth/v1/authorize?provider=google`, ''],
    ] as const)
      expect(cachePolicy(sub(url, destination), ORIGIN, null), url).toBe('bypass');
    expect(cachePolicy(nav('/admin/integrations'), ORIGIN, null)).toBe('private-page');
    expect(cachePolicy(nav('/admin/integrations/odoo?tab=sync'), ORIGIN, null)).toBe(
      'private-page',
    );
  });

  it('caches public static files: build assets, brand images, public storage images', () => {
    expect(cachePolicy(sub('/assets/index-abc.js'), ORIGIN, `${ORIGIN}/store`)).toBe('asset');
    expect(cachePolicy(sub('/brand/og.png', 'image'), ORIGIN, `${ORIGIN}/`)).toBe('static');
    expect(cachePolicy(sub('/demo/media/phone.svg', 'image'), ORIGIN, null)).toBe('static');
    expect(cachePolicy(sub('/offline.html', ''), ORIGIN, null)).toBe('static');
    expect(
      cachePolicy(
        sub('https://proj.supabase.co/storage/v1/object/public/catalog/p.webp', 'image'),
        ORIGIN,
        `${ORIGIN}/store`,
      ),
    ).toBe('public-image');
  });

  it('only stores complete public responses', () => {
    const headers = (values: Record<string, string>) => ({
      get: (name: string) => values[name] ?? null,
    });
    const ok = { ok: true, status: 200, type: 'basic', redirected: false, headers: headers({}) };
    expect(isStorable(ok)).toBe(true);
    expect(isStorable({ ...ok, status: 206 })).toBe(false);
    expect(isStorable({ ...ok, redirected: true })).toBe(false);
    expect(isStorable({ ...ok, type: 'opaque' })).toBe(false);
    expect(isStorable({ ...ok, headers: headers({ 'cache-control': 'private, max-age=0' }) })).toBe(
      false,
    );
    expect(isStorable({ ...ok, headers: headers({ 'cache-control': 'no-store' }) })).toBe(false);
  });

  it('page caches are per release; hashed assets survive releases', () => {
    expect(cacheName('page', 'v2')).toBe('malek-page-v2');
    expect(cacheName('asset', 'v2')).toBe(cacheName('asset', 'v1'));
  });
});

describe('install and registration context', () => {
  it('never registers inside the Site Editor preview or another frame', () => {
    const top = { name: '' } as Window;
    Object.assign(top, { self: top, top });
    expect(isPwaContext(top)).toBe(true);
    expect(isPwaContext({ ...top, name: 'malek-preview-draft', self: top, top } as Window)).toBe(
      false,
    );
    expect(isPwaContext({ name: '', self: {}, top } as unknown as Window)).toBe(false);
  });

  it('a stale chunk after a deploy reloads once, never in a loop', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const store = new Map<string, string>();
    const win = Object.assign(target, {
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    }) as unknown as Window;
    recoverFromStaleChunks(win);
    const fire = () => {
      const event = new Event('vite:preloadError', { cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // A second failure within a minute is a real outage: let the error surface instead.
    expect(fire()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the manifest is installable: standalone, scoped, 192/512 + maskable icons', () => {
    const data = JSON.parse(manifest) as {
      display: string;
      start_url: string;
      scope: string;
      icons: { sizes: string; purpose: string }[];
      shortcuts: { url: string }[];
    };
    expect(data.display).toBe('standalone');
    expect(data.start_url).toBe('/');
    expect(data.scope).toBe('/');
    expect(data.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual([
      '192x192:any',
      '512x512:any',
      '512x512:maskable',
    ]);
    expect(data.shortcuts.every((s) => s.url.startsWith('/'))).toBe(true);
  });
});
