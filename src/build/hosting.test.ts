import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import headersText from '../../public/_headers?raw';
import redirectsText from '../../public/_redirects?raw';
import { adminRoutes } from '@/admin/routes';
import { appRoutes } from '@/app/router';
import { headersFor, matchRedirect, parseHeaders, parseRedirects } from './hostingRules';
import generateSiteSource from './generateSite.ts?raw';

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

const redirects = parseRedirects(redirectsText);
const headers = parseHeaders(headersText);

describe('static host rewrite rules (public/_redirects)', () => {
  it('serves every app route (Arabic, English, admin) the SPA shell with 200', () => {
    const paths = collect([...appRoutes, adminRoutes] as RouteObject[]).filter(
      (p) => !p.endsWith('*'),
    );
    expect(paths.length).toBeGreaterThan(60);
    for (const path of paths) {
      const concrete = path.replace(/:\w+/g, 'sample');
      if (concrete === '/') continue; // dist/index.html
      const rule = matchRedirect(redirects, concrete);
      expect(rule, concrete).toMatchObject({ to: '/404.html', status: 200 });
    }
  });

  it('answers unknown URLs with a real 404 (the shell still renders the friendly page)', () => {
    for (const path of ['/nope', '/en/nope', '/product', '/wp-admin', '/en/xyz/abc'])
      expect(matchRedirect(redirects, path), path).toMatchObject({ to: '/404.html', status: 404 });
    expect(redirects.at(-1)).toEqual({ from: '/*', to: '/404.html', status: 404 });
  });
});

describe('security headers (public/_headers)', () => {
  const page = headersFor(headers, '/product/sample');
  const csp = page['Content-Security-Policy'] ?? '';

  it('sends a CSP and the baseline security headers on every page', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'"); // Site Editor preview is same-origin
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(page['X-Content-Type-Options']).toBe('nosniff');
    expect(page['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(page['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(page['Permissions-Policy']).toContain('camera=()');
  });

  it('pins the prerendered pages’ only inline script by its SHA-256 hash', async () => {
    const inline = /<script>([^<]+)<\/script>/.exec(generateSiteSource)?.[1];
    expect(inline).toBe("document.documentElement.classList.add('js')");
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inline ?? ''));
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(csp).toContain(`'sha256-${hash}'`);
  });

  it('never caches the service worker, offline page or manifest; hashed assets forever', () => {
    expect(headersFor(headers, '/sw.js')['Cache-Control']).toBe('no-cache');
    expect(headersFor(headers, '/offline.html')['Cache-Control']).toBe('no-cache');
    expect(headersFor(headers, '/manifest.webmanifest')['Cache-Control']).toBe('no-cache');
    expect(headersFor(headers, '/assets/index-abc.js')['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(page['Cache-Control']).toBeUndefined();
  });
});
