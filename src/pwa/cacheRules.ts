import { isPrivatePath } from '@/domain/seo/site';

/**
 * Service worker cache rules (pure, unit-tested; src/pwa/sw.ts applies them).
 *
 * Only PUBLIC, anonymous content is ever stored: built assets, brand / demo images, public
 * storage images and the prerendered public pages. Never cached: admin pages, account pages,
 * orders and invoices, checkout and cart, wishlist / compare, search, any API call (Supabase
 * REST / RPC / auth — catalog data, notifications, payments…), signed (private) uploads, and
 * every request made BY a private page. The private-area list is the same one robots.txt uses
 * (`PRIVATE_PATH_PREFIXES`).
 */
export type CachePolicy =
  /** Hashed build output (/assets/…): cache first, immutable. */
  | 'asset'
  /** Public images and brand files: stale-while-revalidate. */
  | 'static'
  /** Public images in Supabase Storage's public buckets: stale-while-revalidate. */
  | 'public-image'
  /** Public page navigation: network first, cached copy (then the offline page) when offline. */
  | 'page'
  /** Private or personalised navigation: network only, the offline page when offline. */
  | 'private-page'
  /** Everything else: the service worker stays out of the way. */
  | 'bypass';

export interface RequestShape {
  url: string;
  method: string;
  mode: string;
  destination: string;
}

const STATIC_PREFIXES = ['/brand/', '/icons/', '/demo/media/'];
const NEVER = ['/sw.js', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest'];

export const OFFLINE_URL = '/offline.html';

export const CACHE_LIMITS = { asset: 200, static: 150, 'public-image': 150, page: 60 } as const;

export function cachePolicy(
  request: RequestShape,
  origin: string,
  /** URL of the page that made the request (null for navigations / unknown). */
  clientUrl: string | null,
): CachePolicy {
  if (request.method !== 'GET') return 'bypass';
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    if (url.origin !== origin) return 'bypass';
    // Search results and filtered views are personal / unbounded: never stored.
    const path = url.pathname;
    if (isPrivatePath(path) || /^(\/en)?\/search\/?$/.test(path) || url.search)
      return 'private-page';
    return 'page';
  }
  // Nothing requested by an admin / account / checkout page is ever read from or written to a cache.
  if (clientUrl && isPrivatePath(new URL(clientUrl).pathname)) return 'bypass';
  if (url.origin !== origin) {
    return request.destination === 'image' && /\/storage\/v1\/object\/public\//.test(url.pathname)
      ? 'public-image'
      : 'bypass';
  }
  if (url.search || NEVER.includes(url.pathname)) return 'bypass';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  if (url.pathname === OFFLINE_URL || STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)))
    return 'static';
  return 'bypass';
}

export interface ResponseShape {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  headers: { get(name: string): string | null };
}

/** Only complete, public, non-redirected responses may be stored. */
export function isStorable(response: ResponseShape): boolean {
  if (!response.ok || response.status !== 200 || response.redirected) return false;
  if (response.type !== 'basic' && response.type !== 'cors') return false;
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (/no-store|private/i.test(cacheControl)) return false;
  return !response.headers.get('set-cookie');
}

export function cacheName(
  policy: Exclude<CachePolicy, 'private-page' | 'bypass'>,
  version: string,
) {
  // Hashed assets outlive a release (a page still open may lazy-load an older chunk).
  return policy === 'asset' ? 'malek-assets' : `malek-${policy}-${version}`;
}
