/**
 * Reading and writing local storage, which can fail at every step.
 *
 * `localStorage` is not a property access that always works: touching it at all
 * throws where the browser has blocked site data, `getItem` can throw, and what
 * comes back was written by an older version of the app or by nothing at all.
 * Five call sites each grew their own guard-catch-parse ladder saying the same
 * thing; this is that thing, said once.
 *
 * Every function here answers with the fallback rather than throwing. A sit is
 * never worth failing over storage — the timer runs perfectly well with none.
 */

/** The narrow slice of the Storage API the app uses, so tests need no DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Blocked by the browser's storage settings.
    return null;
  }
}

export function readText(storage: StorageLike | null, key: string): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Read stored JSON and hand it to a validator.
 *
 * The fallback is used for all four ways this goes wrong: no storage, nothing
 * stored, text that is not JSON, and JSON that is not the shape expected.
 */
export function readJson<T>(
  storage: StorageLike | null,
  key: string,
  parse: (value: unknown) => T | null,
  fallback: T,
): T {
  const raw = readText(storage, key);
  if (raw === null) return fallback;
  try {
    return parse(JSON.parse(raw) as unknown) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeText(storage: StorageLike | null, key: string, value: string): void {
  if (storage === null) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Private mode, or a full quota.
  }
}

export function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  writeText(storage, key, JSON.stringify(value));
}

export function removeStored(storage: StorageLike | null, key: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do about it.
  }
}
