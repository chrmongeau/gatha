import { readJson, readText, removeStored, writeJson, writeText, type StorageLike } from '../storage';

/**
 * The practice log. Local, and there is no backend and will not be one.
 *
 * A record is about eighty bytes, so a decade of daily practice is under 300KB
 * — comfortably inside quota (SPEC.md §7).
 */

const SESSIONS_KEY = 'gatha.sessions';
const ANCHOR_KEY = 'gatha.anchor';
const ANCHOR_ASKED_KEY = 'gatha.anchorAsked';
const EXPORT_VERSION = 1;

export interface SessionRecord {
  /** Wall clock, when the sit began. */
  readonly startedAt: number;
  /** Time actually sat, from the opening bell. */
  readonly durationMs: number;
  /** Whether it ran to the closing bell rather than being ended early. */
  readonly completed: boolean;
  /** The passage that opened it, or null if there was none. */
  readonly passageId: string | null;
}

interface Backup {
  readonly version: number;
  readonly exported: string;
  readonly sessions: readonly SessionRecord[];
  readonly anchor: string | null;
}

export function loadSessions(storage: StorageLike | null): SessionRecord[] {
  return readJson(storage, SESSIONS_KEY, parseSessions, []);
}

/** Appended in order. A repeated start instant replaces rather than duplicates. */
export function addSession(record: SessionRecord, storage: StorageLike | null): SessionRecord[] {
  const sessions = merge(loadSessions(storage), [record]);
  writeSessions(sessions, storage);
  return sessions;
}

/** A full quota should not take the sit down with it, so a failed write is quiet. */
function writeSessions(sessions: readonly SessionRecord[], storage: StorageLike | null): void {
  writeJson(storage, SESSIONS_KEY, sessions);
}

/** The if-then anchor: "I'll sit after ___". Asked once, never nagged (SPEC.md §7). */
export function loadAnchor(storage: StorageLike | null): string | null {
  const raw = readText(storage, ANCHOR_KEY);
  return raw === null || raw.trim() === '' ? null : raw;
}

export function saveAnchor(anchor: string | null, storage: StorageLike | null): void {
  if (anchor === null || anchor.trim() === '') removeStored(storage, ANCHOR_KEY);
  else writeText(storage, ANCHOR_KEY, anchor.trim());
}

/**
 * Whether the anchor has been asked for. Asked once on a first run, however it
 * is answered, and never again (SPEC.md §7).
 *
 * With no storage to remember the answer in, the honest reading is that it has
 * been asked: better to leave the question unasked than to ask it every load.
 */
export function anchorAsked(storage: StorageLike | null): boolean {
  if (storage === null) return true;
  // The one read in the app that has to tell "not stored" apart from "cannot be
  // stored", so it does its own catch rather than using the shared reader.
  // Nowhere to record an answer would mean asking again on every single load,
  // and §7 allows the question once. Better unasked than nagging.
  try {
    return storage.getItem(ANCHOR_ASKED_KEY) !== null;
  } catch {
    return true;
  }
}

export function markAnchorAsked(storage: StorageLike | null): void {
  writeText(storage, ANCHOR_ASKED_KEY, '1');
}

/**
 * Everything, as a file. With no account this is the only way a practice
 * survives a cleared cache or a new phone, so it is not buried (SPEC.md §7).
 */
export function exportBackup(storage: StorageLike | null, now: Date): string {
  const backup: Backup = {
    version: EXPORT_VERSION,
    exported: now.toISOString(),
    sessions: loadSessions(storage),
    anchor: loadAnchor(storage),
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export interface ImportResult {
  readonly added: number;
  readonly alreadyHad: number;
}

/**
 * Merged, never replaced. Importing a backup onto a phone that has been sat on
 * since should not delete the sits made in between.
 */
export function importBackup(text: string, storage: StorageLike | null): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Gatha backup.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('That file is not a Gatha backup.');

  const record = parsed as Record<string, unknown>;
  const incoming = parseSessions(record.sessions);
  if (incoming.length === 0 && !Array.isArray(record.sessions)) {
    throw new Error('That file is not a Gatha backup.');
  }

  const existing = loadSessions(storage);
  const before = existing.length;
  const merged = merge(existing, incoming);
  writeSessions(merged, storage);

  const anchor = record.anchor;
  if (typeof anchor === 'string' && loadAnchor(storage) === null) saveAnchor(anchor, storage);

  return { added: merged.length - before, alreadyHad: incoming.length - (merged.length - before) };
}

function merge(existing: readonly SessionRecord[], incoming: readonly SessionRecord[]): SessionRecord[] {
  const byStart = new Map(existing.map((session) => [session.startedAt, session]));
  for (const session of incoming) byStart.set(session.startedAt, session);
  return [...byStart.values()].sort((a, b) => a.startedAt - b.startedAt);
}

function parseSessions(value: unknown): SessionRecord[] {
  if (!Array.isArray(value)) return [];
  const sessions: SessionRecord[] = [];
  for (const entry of value) {
    const session = parseSession(entry);
    if (session !== null) sessions.push(session);
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

function parseSession(value: unknown): SessionRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const startedAt = record.startedAt;
  const durationMs = record.durationMs;
  const passageId = record.passageId;

  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;

  return {
    startedAt,
    durationMs,
    completed: record.completed === true,
    passageId: typeof passageId === 'string' ? passageId : null,
  };
}
