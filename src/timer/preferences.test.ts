import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  intervalFits,
  loadPreferences,
  savePreferences,
  withDuration,
} from './preferences';
import type { StorageLike } from '../storage';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('preferences', () => {
  it('defaults to ten minutes with interval bells off', () => {
    expect(loadPreferences(new MemoryStorage())).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.intervalMs).toBeNull();
  });

  it('remembers what the sitter chose', () => {
    const storage = new MemoryStorage();
    savePreferences({ ...DEFAULT_CONFIG, durationMs: 1_200_000, intervalMs: 300_000 }, storage);

    const loaded = loadPreferences(storage);
    expect(loaded.durationMs).toBe(1_200_000);
    expect(loaded.intervalMs).toBe(300_000);
  });

  it('keeps the preparation delay and lead-out out of the sitter’s hands', () => {
    const storage = new MemoryStorage();
    storage.items.set(
      'gatha.preferences',
      JSON.stringify({ durationMs: 60_000, intervalMs: null, prepareMs: 9_999, leadOutMs: 9_999 }),
    );

    const loaded = loadPreferences(storage);
    expect(loaded.prepareMs).toBe(DEFAULT_CONFIG.prepareMs);
    expect(loaded.leadOutMs).toBe(DEFAULT_CONFIG.leadOutMs);
  });

  it('falls back to the defaults for anything that is not a preference', () => {
    const storage = new MemoryStorage();
    for (const value of ['{}', 'null', '[]', 'nonsense', '{"durationMs":0}', '{"durationMs":600000,"intervalMs":-1}']) {
      storage.items.set('gatha.preferences', value);
      expect(loadPreferences(storage)).toEqual(DEFAULT_CONFIG);
    }
  });

  it('works with no storage at all', () => {
    expect(loadPreferences(null)).toEqual(DEFAULT_CONFIG);
    expect(() => {
      savePreferences(DEFAULT_CONFIG, null);
    }).not.toThrow();
  });
});

describe('the interval bell and the duration together', () => {
  it('accepts an interval that rings inside the silence', () => {
    expect(intervalFits(300_000, 600_000)).toBe(true);
    expect(intervalFits(null, 300_000)).toBe(true);
  });

  it('rejects an interval that would never ring', () => {
    // bellSchedule places interval bells strictly inside the silence, so an
    // interval at or past the duration silently produces none at all.
    expect(intervalFits(900_000, 300_000)).toBe(false);
    expect(intervalFits(300_000, 300_000)).toBe(false);
  });

  it('drops an interval that no longer fits when the sit is shortened', () => {
    const chosen = { ...DEFAULT_CONFIG, durationMs: 1_200_000, intervalMs: 900_000 };

    expect(withDuration(chosen, 300_000).intervalMs).toBeNull();
    expect(withDuration(chosen, 1_800_000).intervalMs).toBe(900_000);
  });

  it('refuses to load a stored pair that cannot ring', () => {
    const storage = new MemoryStorage();
    storage.items.set('gatha.preferences', JSON.stringify({ durationMs: 300_000, intervalMs: 900_000 }));

    expect(loadPreferences(storage).intervalMs).toBeNull();
  });
});
