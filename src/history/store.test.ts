import { describe, expect, it } from 'vitest';

import {
  addSession,
  exportBackup,
  importBackup,
  loadAnchor,
  loadSessions,
  saveAnchor,
  type SessionRecord,
} from './store';
import type { StorageLike } from '../timer/active-session';

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

const session = (startedAt: number, durationMs = 600_000): SessionRecord => ({
  startedAt,
  durationMs,
  completed: true,
  passageId: 'ud1.1',
});

describe('the session log', () => {
  it('appends sits in the order they happened', () => {
    const storage = new MemoryStorage();
    addSession(session(3_000), storage);
    addSession(session(1_000), storage);

    expect(loadSessions(storage).map((s) => s.startedAt)).toEqual([1_000, 3_000]);
  });

  it('does not duplicate a sit recorded twice', () => {
    const storage = new MemoryStorage();
    addSession(session(1_000), storage);
    addSession({ ...session(1_000), durationMs: 900_000 }, storage);

    const sessions = loadSessions(storage);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.durationMs).toBe(900_000);
  });

  it('discards anything that is not a session', () => {
    const storage = new MemoryStorage();
    storage.items.set(
      'gatha.sessions',
      JSON.stringify([session(1_000), null, 'x', { startedAt: 'soon' }, { durationMs: 1 }]),
    );

    expect(loadSessions(storage)).toHaveLength(1);
  });

  it('survives storage being unavailable', () => {
    expect(loadSessions(null)).toEqual([]);
    expect(() => addSession(session(1), null)).not.toThrow();
  });
});

describe('the if-then anchor', () => {
  it('round-trips, trimmed', () => {
    const storage = new MemoryStorage();
    saveAnchor('  my morning coffee  ', storage);

    expect(loadAnchor(storage)).toBe('my morning coffee');
  });

  it('treats an empty answer as no answer', () => {
    const storage = new MemoryStorage();
    saveAnchor('   ', storage);

    expect(loadAnchor(storage)).toBeNull();
  });
});

describe('export and import', () => {
  it('round-trips a practice', () => {
    const from = new MemoryStorage();
    addSession(session(1_000), from);
    addSession(session(2_000), from);
    saveAnchor('coffee', from);

    const to = new MemoryStorage();
    const result = importBackup(exportBackup(from, new Date(2026, 7, 27)), to);

    expect(result.added).toBe(2);
    expect(loadSessions(to).map((s) => s.startedAt)).toEqual([1_000, 2_000]);
    expect(loadAnchor(to)).toBe('coffee');
  });

  it('merges rather than replaces, so sits made since are not lost', () => {
    const backup = new MemoryStorage();
    addSession(session(1_000), backup);
    const text = exportBackup(backup, new Date());

    const phone = new MemoryStorage();
    addSession(session(5_000), phone);
    const result = importBackup(text, phone);

    expect(result.added).toBe(1);
    expect(loadSessions(phone).map((s) => s.startedAt)).toEqual([1_000, 5_000]);
  });

  it('reports what it already had rather than double-counting', () => {
    const storage = new MemoryStorage();
    addSession(session(1_000), storage);
    const text = exportBackup(storage, new Date());

    expect(importBackup(text, storage)).toEqual({ added: 0, alreadyHad: 1 });
  });

  it('does not overwrite an anchor already answered', () => {
    const from = new MemoryStorage();
    saveAnchor('coffee', from);
    const to = new MemoryStorage();
    saveAnchor('the kids leaving', to);

    importBackup(exportBackup(from, new Date()), to);

    expect(loadAnchor(to)).toBe('the kids leaving');
  });

  it('refuses a file that is not a backup', () => {
    const storage = new MemoryStorage();
    for (const text of ['not json', '"a string"', '{"nope":1}', 'null']) {
      expect(() => importBackup(text, storage)).toThrow(/not a Gatha backup/);
    }
  });

  it('accepts a backup with no sits in it', () => {
    const storage = new MemoryStorage();
    expect(importBackup('{"sessions":[]}', storage)).toEqual({ added: 0, alreadyHad: 0 });
  });
});
