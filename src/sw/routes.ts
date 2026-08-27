/**
 * Which caching strategy a request gets.
 *
 * Pure, so the decisions can be tested without a service worker, a browser, or
 * a network — the worker itself is a thin adapter over this (CLAUDE.md).
 */
export type Strategy =
  /** Precached with the app: serve from the cache, and never go to the network. */
  | 'cache-first'
  /** Serve what we have, fetch a fresh copy for next time. SPEC.md §10. */
  | 'stale-while-revalidate'
  /** Not ours to cache: hand it back to the browser untouched. */
  | 'passthrough';

export interface Routes {
  /** The app's base path, e.g. `/gatha/`. Always ends in a slash. */
  readonly base: string;
  /** Exact URLs, path-only, put in the cache at install time. */
  readonly precached: ReadonlySet<string>;
}

export interface Requested {
  readonly url: string;
  readonly method: string;
  /** `navigate` for a page load, as `Request.mode` reports it. */
  readonly mode: string;
}

/**
 * A page load, whatever the URL. There is one HTML document and the app routes
 * itself, so any navigation inside the scope is answered with the shell.
 */
export function isShellNavigation(routes: Routes, request: Requested, origin: string): boolean {
  if (request.method !== 'GET' || request.mode !== 'navigate') return false;
  const path = pathOf(request.url, origin);
  return path?.startsWith(routes.base) ?? false;
}

/** The URL the shell is cached under: the base itself, which is what a load asks for. */
export function shellUrl(routes: Routes): string {
  return routes.base;
}

export function strategyFor(routes: Routes, request: Requested, origin: string): Strategy {
  // Never a POST, and never suttacentral.net — an outbound link is the user's
  // business and not something to keep a copy of.
  if (request.method !== 'GET') return 'passthrough';

  const path = pathOf(request.url, origin);
  if (!path?.startsWith(routes.base)) return 'passthrough';

  if (routes.precached.has(path)) return 'cache-first';

  // The discourses: 673 files and three megabytes, fetched only when someone
  // asks to read the whole thing. Kept once read, refreshed quietly after.
  if (path.startsWith(`${routes.base}corpus/`)) return 'stale-while-revalidate';

  // Anything else inside the scope is a build artefact we did not list —
  // a font variant, say. Worth keeping once it has been asked for.
  return 'stale-while-revalidate';
}

/** Path only, ignoring the query and hash, or null if it is another origin. */
function pathOf(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url, origin);
    return parsed.origin === new URL(origin).origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}
