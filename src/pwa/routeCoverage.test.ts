import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '@/app/router';
import { isPrivatePath, STATIC_ROUTES } from '@/domain/seo/site';
import { cachePolicy } from './cacheRules';

/** Every concrete path in the app's route table (Arabic tree, /en tree, admin). */
function collect(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((r) => {
    const here = r.path
      ? r.path.startsWith('/')
        ? r.path
        : `${parent.replace(/\/$/, '')}/${r.path}`
      : parent;
    return [...(r.path ? [here] : []), ...collect(r.children ?? [], here)];
  });
}

/**
 * Public routes (cacheable by the service worker, may be prerendered / listed in the sitemap).
 * Anything not listed here must be private — a new account / admin / checkout style route is
 * then caught by this test instead of silently becoming cacheable.
 */
const PUBLIC = new Set([
  ...STATIC_ROUTES.map((r) => r.path),
  '/product/:slug',
  '/category/:slug',
  '/brand/:slug',
  '/offers/:slug',
  '/news/:slug',
  '/legal/:page',
  '/budget',
  '/search', // public, but never cached or indexed (personal / unbounded)
  '/repairs/request',
  '/trade-in/request',
  '/used/request',
  '/after-sales/request',
  '/*',
]);

describe('route table vs. private areas', () => {
  const paths = collect(appRoutes as RouteObject[]).map((p) =>
    p === '/en' ? '/' : p.startsWith('/en/') ? p.slice(3) : p,
  );

  it('finds the storefront and admin routes', () => {
    expect(paths).toContain('/product/:slug');
    expect(paths).toContain('/account/orders');
    expect(paths.some((p) => p.startsWith('/admin/'))).toBe(true);
  });

  it('every route is either a known public page or a private area', () => {
    const unknown = [...new Set(paths)].filter((p) => !PUBLIC.has(p) && !isPrivatePath(p));
    expect(unknown).toEqual([]);
  });

  it('no private route is ever cached by the service worker', () => {
    for (const path of new Set(paths.filter((p) => isPrivatePath(p)))) {
      const url = `https://malek.test${path.replace(/:\w+/g, 'x')}`;
      const policy = cachePolicy(
        { url, method: 'GET', mode: 'navigate', destination: 'document' },
        'https://malek.test',
        null,
      );
      expect(policy, path).toBe('private-page');
    }
  });
});
