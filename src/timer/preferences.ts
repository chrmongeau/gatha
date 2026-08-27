import type { SessionConfig } from './session';
import type { StorageLike } from './active-session';

/**
 * The duration and interval the sitter last chose.
 *
 * Not the practice history — that is a different store with a different shape.
 * This is only what the Today screen's controls were set to, remembered so the
 * app opens where it was left.
 */

const KEY = 'gatha.preferences';

/**
 * Presets from SPEC.md §5, with the two-minute floor from §7 first in the row
 * rather than tucked at the end. It is a first-class option, not a consolation.
 */
export const DURATION_PRESETS_MS: readonly number[] = [
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  20 * 60_000,
  30 * 60_000,
  45 * 60_000,
];

/** Interval bells are off by default (SPEC.md §5). */
export const INTERVAL_PRESETS_MS: readonly (number | null)[] = [
  null,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
];

export const DEFAULT_CONFIG: SessionConfig = {
  durationMs: 10 * 60_000,
  intervalMs: null,
  prepareMs: 10_000,
  // The closing bell is left its silence before anything is offered.
  leadOutMs: 12_000,
};

/**
 * Whether an interval bell can actually ring in a session of this length.
 *
 * `bellSchedule` only places interval bells strictly inside the silence, so an
 * interval at or beyond the duration produces none at all — a setting that
 * looks set and does nothing. The choice should not be offered rather than
 * silently ignored.
 */
export function intervalFits(intervalMs: number | null, durationMs: number): boolean {
  return intervalMs === null || intervalMs < durationMs;
}

/**
 * Change the duration, dropping an interval bell that no longer fits inside it.
 * Shortening a sit should not leave an interval selected that cannot ring.
 */
export function withDuration(config: SessionConfig, durationMs: number): SessionConfig {
  return {
    ...config,
    durationMs,
    intervalMs: intervalFits(config.intervalMs, durationMs) ? config.intervalMs : null,
  };
}

export function loadPreferences(storage: StorageLike | null): SessionConfig {
  if (storage === null) return DEFAULT_CONFIG;
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (raw === null) return DEFAULT_CONFIG;

  try {
    return parse(JSON.parse(raw)) ?? DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function savePreferences(config: SessionConfig, storage: StorageLike | null): void {
  if (storage === null) return;
  try {
    storage.setItem(KEY, JSON.stringify({ durationMs: config.durationMs, intervalMs: config.intervalMs }));
  } catch {
    // Private mode, or a full quota. The session still runs.
  }
}

/** Only the two the sitter chooses are stored; the rest stay as the app decides. */
function parse(value: unknown): SessionConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const durationMs = record.durationMs;
  const intervalMs = record.intervalMs;

  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (intervalMs !== null && (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0)) {
    return null;
  }

  // A stored pair could have been written before the rule existed.
  return {
    ...DEFAULT_CONFIG,
    durationMs,
    intervalMs: intervalFits(intervalMs, durationMs) ? intervalMs : null,
  };
}
