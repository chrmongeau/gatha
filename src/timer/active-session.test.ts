import { describe, expect, it } from 'vitest';

import {
  clearActiveSession,
  loadActiveSession,
  saveActiveSession,
  type StorageLike,
} from './active-session';
import { Session, type SessionConfig } from './session';
import { TestClock } from './test-clock';

const CONFIG: SessionConfig = {
  durationMs: 600_000,
  intervalMs: 300_000,
  prepareMs: 10_000,
  leadOutMs: 12_000,
};

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

class BrokenStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('storage is blocked');
  }

  setItem(): void {
    throw new Error('storage is blocked');
  }

  removeItem(): void {
    throw new Error('storage is blocked');
  }
}

describe('the active session record', () => {
  it('round-trips a running session so a reload can pick it up', () => {
    const storage = new MemoryStorage();
    const clock = new TestClock();
    const session = Session.start(CONFIG, clock);

    saveActiveSession(session.record, storage);

    const loaded = loadActiveSession(storage);
    expect(loaded).toEqual(session.record);

    // And the resumed session lands where the original one is.
    clock.advance(10_000 + 4 * 60_000);
    expect(loaded).not.toBeNull();
    const resumed = Session.resume(loaded ?? session.record, clock);
    expect(resumed.read().elapsedMs).toBe(session.read().elapsedMs);
  });

  it('is gone once cleared', () => {
    const storage = new MemoryStorage();
    saveActiveSession({ startedAt: 1, config: CONFIG }, storage);

    clearActiveSession(storage);

    expect(loadActiveSession(storage)).toBeNull();
  });

  it('reports nothing when there is nothing stored', () => {
    expect(loadActiveSession(new MemoryStorage())).toBeNull();
  });

  it('refuses anything that is not a session record', () => {
    const storage = new MemoryStorage();
    const rejected = [
      'not json at all',
      'null',
      '[]',
      '{}',
      '{"startedAt":"soon","config":{}}',
      '{"startedAt":1,"config":{"durationMs":0,"intervalMs":null,"prepareMs":0,"leadOutMs":0}}',
      '{"startedAt":1,"config":{"durationMs":600000,"intervalMs":"five","prepareMs":0,"leadOutMs":0}}',
      '{"startedAt":1,"config":{"durationMs":600000,"prepareMs":0,"leadOutMs":0}}',
    ];

    for (const value of rejected) {
      storage.items.set('gatha.activeSession', value);
      expect(loadActiveSession(storage)).toBeNull();
    }
  });

  it('accepts a session with interval bells switched off', () => {
    const storage = new MemoryStorage();
    const record = { startedAt: 1, config: { ...CONFIG, intervalMs: null } };

    saveActiveSession(record, storage);

    expect(loadActiveSession(storage)).toEqual(record);
  });

  it('survives storage being unavailable', () => {
    const storage = new BrokenStorage();

    expect(() => {
      saveActiveSession({ startedAt: 1, config: CONFIG }, storage);
    }).not.toThrow();
    expect(loadActiveSession(storage)).toBeNull();
    expect(() => {
      clearActiveSession(storage);
    }).not.toThrow();
  });
});
