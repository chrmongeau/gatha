import { describe, expect, it } from 'vitest';

import { loadPreference, resolveTheme, savePreference } from './theme';
import type { StorageLike } from './timer/active-session';

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

describe('resolveTheme', () => {
  it('takes an explicit choice over what the phone is set to', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('the stored preference', () => {
  it('is dark until something else is chosen, whatever the phone prefers', () => {
    // The app's resting state is low-luminance; a light phone does not change
    // that on its own, because the Sitting screen is looked at in the dark.
    expect(loadPreference(new MemoryStorage())).toBe('dark');
    expect(loadPreference(null)).toBe('dark');
  });

  it('round-trips each choice', () => {
    const storage = new MemoryStorage();
    for (const preference of ['light', 'dark', 'system'] as const) {
      savePreference(preference, storage);
      expect(loadPreference(storage)).toBe(preference);
    }
  });

  it('falls back to dark for anything it does not recognise', () => {
    const storage = new MemoryStorage();
    storage.items.set('gatha.theme', 'sepia');

    expect(loadPreference(storage)).toBe('dark');
  });
});
