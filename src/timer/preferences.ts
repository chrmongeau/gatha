import { readJson, writeJson, type StorageLike } from '../storage';
import type { SessionConfig } from './session';

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

/**
 * One step of the duration stepper: the next preset up or down, or null at
 * either end, which is what makes the button there unavailable. A stored length
 * that is not a preset steps to the nearest one in that direction.
 */
export function stepDuration(config: SessionConfig, direction: 1 | -1): SessionConfig | null {
  const next = stepFrom(DURATION_PRESETS_MS, config.durationMs, direction);
  return next === undefined ? null : withDuration(config, next);
}

/**
 * One step of the bell stepper, from none up through the presets. Stops at the
 * last bell that can ring inside this sit rather than offering one that cannot.
 */
export function stepInterval(config: SessionConfig, direction: 1 | -1): SessionConfig | null {
  const next = stepFrom(INTERVAL_PRESETS_MS, config.intervalMs, direction);
  if (next === undefined || !intervalFits(next, config.durationMs)) return null;
  return { ...config, intervalMs: next };
}

/** The nearest preset strictly above or below a value; no bell counts as zero. */
function stepFrom<T extends number | null>(presets: readonly T[], from: T, direction: 1 | -1): T | undefined {
  const ordered = direction === 1 ? presets : [...presets].reverse();
  return ordered.find((ms) => ((ms ?? 0) - (from ?? 0)) * direction > 0);
}

export function loadPreferences(storage: StorageLike | null): SessionConfig {
  return readJson(storage, KEY, parse, DEFAULT_CONFIG);
}

export function savePreferences(config: SessionConfig, storage: StorageLike | null): void {
  writeJson(storage, KEY, { durationMs: config.durationMs, intervalMs: config.intervalMs });
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
