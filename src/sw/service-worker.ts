/// <reference lib="webworker" />
/**
 * Gatha's service worker.
 *
 * Hand-written rather than generated: section 2 rules out runtime dependencies,
 * and what this needs to do is a precache, a stale-while-revalidate, and an
 * update rule that will not interrupt a sit. Workbox would be more code than
 * the worker.
 *
 * Built by the plugin in `vite.config.ts`, which fills in the two constants
 * below from what the build actually emitted. The decisions live in `routes.ts`
 * so they can be tested without a browser.
 */
import { isShellNavigation, shellUrl, strategyFor, type Routes } from './routes';

declare const __PRECACHE__: readonly string[];
declare const __VERSION__: string;

const worker = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `gatha-${__VERSION__}`;

const routes: Routes = {
  base: new URL(worker.registration.scope).pathname,
  precached: new Set(__PRECACHE__),
};

worker.addEventListener('install', (event) => {
  // No skipWaiting. A new worker waits until the old one has no pages left,
  // which is the only way to be certain a sit in progress is never disturbed
  // (SPEC.md §10). The page asks for it explicitly when it is safe.
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(__PRECACHE__);
    }),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('gatha-') && name !== CACHE) await caches.delete(name);
      }
      // So the first load is offline-capable without needing a second one.
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('message', (event: ExtendableMessageEvent) => {
  // Sent by the page once it knows nothing is in progress. See src/pwa.ts.
  if ((event.data as { type?: string } | null)?.type === 'apply-update') {
    void worker.skipWaiting();
  }
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const origin = worker.location.origin;

  if (isShellNavigation(routes, request, origin)) {
    event.respondWith(shell(request));
    return;
  }

  switch (strategyFor(routes, request, origin)) {
    case 'cache-first':
      event.respondWith(cacheFirst(request));
      return;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(request));
      return;
    case 'passthrough':
      return;
  }
});

/**
 * One document for every route. Cache first, because the point of the app is
 * that it opens at six in the morning on a plane; an update reaches it through
 * the worker, not through this request.
 */
async function shell(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(shellUrl(routes));
  if (cached !== undefined) return cached;
  return fetch(request);
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch((error: unknown) => {
      // Offline with nothing cached is a real answer for the caller to handle,
      // not something to swallow here.
      if (cached === undefined) throw error;
      return cached;
    });

  if (cached !== undefined) {
    // Let the refresh finish even though we answered from the cache.
    void fresh.catch(() => undefined);
    return cached;
  }
  return fresh;
}
