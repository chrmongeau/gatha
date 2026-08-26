import type { SessionConfig, SessionRecord } from './session';

/**
 * The session in progress, persisted so a reload mid-sit can offer to resume
 * rather than losing the sit (SPEC.md section 5).
 *
 * Only the start instant and the configuration are stored. Elapsed time is
 * always derived, never written down — an accumulator in storage would drift
 * exactly the way a tick counter does.
 */

const KEY = 'gatha.activeSession';

/** The narrow slice of the Storage API used here, so tests need no DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveActiveSession(record: SessionRecord, storage: StorageLike): void {
  try {
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Private mode, or a full quota. Resuming is a convenience, not the session.
  }
}

export function clearActiveSession(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing to do about it.
  }
}

/** Null if there is nothing stored, or if what is stored is not a session. */
export function loadActiveSession(storage: StorageLike): SessionRecord | null {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    return parseRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Blocked by the browser's storage settings.
    return null;
  }
}

function parseRecord(value: unknown): SessionRecord | null {
  if (!isRecord(value)) return null;

  const startedAt = value.startedAt;
  const config = parseConfig(value.config);
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || config === null) return null;

  return { startedAt, config };
}

function parseConfig(value: unknown): SessionConfig | null {
  if (!isRecord(value)) return null;

  const durationMs = value.durationMs;
  const intervalMs = value.intervalMs;
  const prepareMs = value.prepareMs;
  const leadOutMs = value.leadOutMs;

  if (!isDuration(durationMs) || durationMs <= 0) return null;
  if (!isDuration(prepareMs) || !isDuration(leadOutMs)) return null;
  if (intervalMs !== null && !isDuration(intervalMs)) return null;

  return { durationMs, intervalMs, prepareMs, leadOutMs };
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
