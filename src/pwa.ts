/**
 * Registering the service worker, and deciding when a new one may take over.
 *
 * The worker never calls `skipWaiting()` itself. A new version sits waiting
 * until this module says it is safe, which is the only way to be sure a reload
 * never lands in the middle of a sit (SPEC.md §10).
 */

export interface ServiceWorkerHandle {
  /** True once a newer worker is installed and waiting for permission. */
  updateReady(): boolean;
  /**
   * Hand over to the waiting worker and reload. Callers are responsible for
   * only asking when nothing would be lost — see `applyUpdateWhenIdle` in
   * main.ts. A no-op when nothing is waiting.
   */
  applyUpdate(): void;
}

const NOTHING_WAITING: ServiceWorkerHandle = {
  updateReady: () => false,
  applyUpdate: () => undefined,
};

export function registerServiceWorker(base: string): ServiceWorkerHandle {
  // Feature-detected and degraded rather than thrown (CLAUDE.md). Also absent
  // over plain http from anywhere but localhost, which is where dev runs.
  if (!('serviceWorker' in navigator)) return NOTHING_WAITING;

  let waiting: ServiceWorker | null = null;

  const handle: ServiceWorkerHandle = {
    updateReady: () => waiting !== null,
    applyUpdate() {
      if (waiting === null) return;
      // The page reloads when the new worker takes control, and only then —
      // reloading first would just re-run the old one.
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          window.location.reload();
        },
        { once: true },
      );
      waiting.postMessage({ type: 'apply-update' });
      waiting = null;
    },
  };

  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registration) => {
      // One may already be waiting from a previous visit.
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        waiting = registration.waiting;
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          // With no controller this is the first install, not an update: it is
          // already the newest thing there is and there is nothing to hand over.
          if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
            waiting = installing;
          }
        });
      });
    })
    .catch(() => {
      // An app that works offline is better than an app that refuses to start
      // because it could not arrange to.
    });

  return handle;
}
