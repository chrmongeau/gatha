/**
 * Screen wake lock, held for the duration of a sit.
 *
 * If the screen stays on, most of the background-suspension problem disappears
 * (SPEC.md section 5). The API is not everywhere — Firefox in particular — so
 * every call is feature-detected and a missing API degrades to doing nothing.
 *
 * The browser releases the lock whenever the page is hidden, so it has to be
 * re-requested each time the page comes back. That listener is this module's
 * only real work.
 */

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

interface WakeLockEnvironment {
  readonly navigator: { readonly wakeLock?: WakeLockLike };
  readonly document: {
    readonly visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
}

export interface ScreenWakeLock {
  /** False when the browser has no Wake Lock API at all. */
  readonly supported: boolean;
  /** True while a sentinel is actually held. */
  readonly held: boolean;
  /** Take the lock, and keep re-taking it whenever the page returns. */
  acquire(): Promise<void>;
  /** Give it up and stop re-taking it. */
  release(): Promise<void>;
}

export function createScreenWakeLock(
  environment: WakeLockEnvironment = defaultEnvironment(),
): ScreenWakeLock {
  const wakeLock = environment.navigator.wakeLock;
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;

  const take = async (): Promise<void> => {
    if (wakeLock === undefined || !wanted || sentinel !== null) return;
    if (environment.document.visibilityState !== 'visible') return;
    try {
      sentinel = await wakeLock.request('screen');
    } catch {
      // Denied by the platform — low battery, an unsupported surface. The sit
      // continues; the wall clock does not depend on the screen being awake.
      sentinel = null;
    }
  };

  const onVisibilityChange = (): void => {
    if (environment.document.visibilityState !== 'visible') {
      // The browser has already dropped it; forget the stale sentinel.
      sentinel = null;
      return;
    }
    void take();
  };

  return {
    supported: wakeLock !== undefined,

    get held(): boolean {
      return sentinel !== null && !sentinel.released;
    },

    async acquire(): Promise<void> {
      if (wakeLock === undefined || wanted) return;
      wanted = true;
      environment.document.addEventListener('visibilitychange', onVisibilityChange);
      await take();
    },

    async release(): Promise<void> {
      if (!wanted) return;
      wanted = false;
      environment.document.removeEventListener('visibilitychange', onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      if (held !== null && !held.released) {
        try {
          await held.release();
        } catch {
          // Already gone. Nothing to do.
        }
      }
    },
  };
}

function defaultEnvironment(): WakeLockEnvironment {
  // `navigator.wakeLock` is typed as always present but is absent in browsers
  // that have not shipped it, which is what the optional member here guards.
  return { navigator, document };
}
