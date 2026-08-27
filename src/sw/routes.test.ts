import { describe, expect, it } from 'vitest';
import { isShellNavigation, shellUrl, strategyFor, type Requested, type Routes } from './routes';

const ORIGIN = 'https://chrmongeau.github.io';

const routes: Routes = {
  base: '/gatha/',
  precached: new Set([
    '/gatha/',
    '/gatha/assets/index-abc123.js',
    '/gatha/assets/gentium-plus-latin-xyz.woff2',
    '/gatha/corpus/order.json',
    '/gatha/corpus/en/passages.json',
  ]),
};

function get(url: string, mode = 'cors'): Requested {
  return { url, method: 'GET', mode };
}

describe('strategyFor', () => {
  it('serves precached shell assets from the cache', () => {
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/assets/index-abc123.js`), ORIGIN)).toBe(
      'cache-first',
    );
    expect(
      strategyFor(routes, get(`${ORIGIN}/gatha/assets/gentium-plus-latin-xyz.woff2`), ORIGIN),
    ).toBe('cache-first');
  });

  it('serves the two corpus files the app cannot start without from the cache', () => {
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/corpus/order.json`), ORIGIN)).toBe(
      'cache-first',
    );
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/corpus/en/passages.json`), ORIGIN)).toBe(
      'cache-first',
    );
  });

  it('revalidates discourses, which are read on demand and not precached', () => {
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/corpus/en/suttas/dhp235-255.json`), ORIGIN)).toBe(
      'stale-while-revalidate',
    );
  });

  it('leaves another origin alone', () => {
    expect(strategyFor(routes, get('https://suttacentral.net/dhp235-255'), ORIGIN)).toBe(
      'passthrough',
    );
  });

  it('leaves anything outside the base path alone', () => {
    // The same host serves other projects from other subpaths.
    expect(strategyFor(routes, get(`${ORIGIN}/something-else/app.js`), ORIGIN)).toBe('passthrough');
    expect(strategyFor(routes, get(`${ORIGIN}/`), ORIGIN)).toBe('passthrough');
  });

  it('leaves anything that is not a GET alone', () => {
    expect(
      strategyFor(routes, { url: `${ORIGIN}/gatha/corpus/order.json`, method: 'POST', mode: 'cors' }, ORIGIN),
    ).toBe('passthrough');
  });

  it('ignores the query string when matching a precached file', () => {
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/corpus/order.json?v=2`), ORIGIN)).toBe(
      'cache-first',
    );
  });

  it('keeps an unlisted file inside the scope rather than dropping it', () => {
    expect(strategyFor(routes, get(`${ORIGIN}/gatha/icons/icon-512.png`), ORIGIN)).toBe(
      'stale-while-revalidate',
    );
  });
});

describe('isShellNavigation', () => {
  it('answers any page load inside the scope with the one document', () => {
    expect(isShellNavigation(routes, get(`${ORIGIN}/gatha/`, 'navigate'), ORIGIN)).toBe(true);
    expect(isShellNavigation(routes, get(`${ORIGIN}/gatha/practice`, 'navigate'), ORIGIN)).toBe(
      true,
    );
  });

  it('is not a navigation when it is a fetch for data', () => {
    expect(isShellNavigation(routes, get(`${ORIGIN}/gatha/corpus/order.json`), ORIGIN)).toBe(false);
  });

  it('does not claim a page load outside the scope', () => {
    expect(isShellNavigation(routes, get(`${ORIGIN}/`, 'navigate'), ORIGIN)).toBe(false);
    expect(isShellNavigation(routes, get('https://suttacentral.net/', 'navigate'), ORIGIN)).toBe(
      false,
    );
  });

  it('caches the shell under the base, which is what a page load asks for', () => {
    expect(shellUrl(routes)).toBe('/gatha/');
  });
});
