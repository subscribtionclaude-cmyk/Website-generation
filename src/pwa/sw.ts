/// <reference lib="webworker" />
import {
  CACHE_LIMITS,
  OFFLINE_URL,
  cacheName,
  cachePolicy,
  isStorable,
  type CachePolicy,
} from './cacheRules';

/**
 * MALEK STORE service worker (built by scripts/generate-site.mjs into dist/sw.js).
 * Rules live in ./cacheRules.ts: public content only, private areas are never cached.
 */
declare const self: ServiceWorkerGlobalScope;
/** Replaced at build time: release version and the files every visitor gets offline. */
declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string[];

const VERSION = __SW_VERSION__;
const PRECACHE = `malek-precache-${VERSION}`;
type Stored = Exclude<CachePolicy, 'private-page' | 'bypass'>;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(__SW_PRECACHE__))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([
    PRECACHE,
    cacheName('asset', VERSION),
    cacheName('static', VERSION),
    cacheName('public-image', VERSION),
    cacheName('page', VERSION),
  ]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name: string, max: number) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function store(policy: Stored, request: Request, response: Response) {
  if (!isStorable(response)) return;
  const name = cacheName(policy, VERSION);
  const cache = await caches.open(name);
  await cache.put(request, response);
  await trim(name, CACHE_LIMITS[policy]);
}

async function fromCache(request: Request) {
  return (await caches.match(request, { ignoreVary: true })) ?? null;
}

async function offline() {
  return (
    (await caches.match(OFFLINE_URL)) ??
    new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
  );
}

async function handle(event: FetchEvent, policy: CachePolicy): Promise<Response> {
  const { request } = event;
  switch (policy) {
    case 'page':
      try {
        const response = await fetch(request);
        event.waitUntil(store('page', request, response.clone()));
        return response;
      } catch {
        return (await fromCache(request)) ?? offline();
      }
    case 'private-page':
      try {
        return await fetch(request);
      } catch {
        return offline();
      }
    case 'asset': {
      const cached = await fromCache(request);
      if (cached) return cached;
      const response = await fetch(request);
      event.waitUntil(store('asset', request, response.clone()));
      return response;
    }
    default: {
      // 'static' / 'public-image': stale-while-revalidate.
      const stored = policy as Stored;
      const cached = await fromCache(request);
      const network = fetch(request).then((response) => {
        event.waitUntil(store(stored, request, response.clone()));
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      return network;
    }
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Decided synchronously first: API calls, cross-origin requests and anything else bypassed are
  // never intercepted at all.
  if (cachePolicy(request, self.location.origin, null) === 'bypass') return;
  event.respondWith(
    (async () => {
      // Requests made by a private page (admin, account, checkout …) are never cached either.
      const client = event.clientId ? await self.clients.get(event.clientId) : null;
      const policy = cachePolicy(request, self.location.origin, client?.url ?? null);
      return policy === 'bypass' ? fetch(request) : handle(event, policy);
    })(),
  );
});
