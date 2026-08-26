/**
 * A log of what actually happened during a session, shown on the done screen
 * when `?diag=1` and copyable as text.
 *
 * This exists because the person testing on a phone has no console. Without it
 * a failed bell reports as "it did not ring", which says nothing about whether
 * the audio context was suspended, the wake lock was dropped, or the session
 * model never marked the bell at all. It is testing scaffolding — **remove it
 * once the timer is trusted on real devices.**
 */

/** Enough to cover a long sit; a runaway loop cannot grow this without bound. */
const MAX_ENTRIES = 300;

export interface DiagnosticEntry {
  /** Elapsed session time, in ms. */
  readonly at: number;
  readonly label: string;
}

export interface DiagnosticsHeader {
  readonly startedAt: number;
  readonly durationMs: number;
  readonly intervalMs: number | null;
  readonly wakeLockSupported: boolean;
  readonly audioSupported: boolean;
  readonly userAgent: string;
}

export class Diagnostics {
  private readonly entries: DiagnosticEntry[] = [];
  private dropped = 0;

  constructor(private readonly header: DiagnosticsHeader) {}

  add(at: number, label: string): void {
    if (this.entries.length >= MAX_ENTRIES) {
      this.dropped += 1;
      return;
    }
    this.entries.push({ at, label });
  }

  get length(): number {
    return this.entries.length;
  }

  toText(): string {
    const { header } = this;
    const lines = [
      'gatha diagnostics',
      `started    ${new Date(header.startedAt).toISOString()}`,
      `duration   ${minutes(header.durationMs)}`,
      `interval   ${header.intervalMs === null ? 'off' : minutes(header.intervalMs)}`,
      `wake lock  ${header.wakeLockSupported ? 'supported' : 'NOT SUPPORTED'}`,
      `web audio  ${header.audioSupported ? 'supported' : 'NOT SUPPORTED'}`,
      `agent      ${header.userAgent}`,
      '',
    ];

    for (const entry of this.entries) {
      lines.push(`${stamp(entry.at)}  ${entry.label}`);
    }
    if (this.dropped > 0) lines.push(`… ${String(this.dropped)} further entries dropped`);

    return lines.join('\n');
  }
}

/** m:ss.t, so a bell a second late is visible as a second late. */
function stamp(ms: number): string {
  const total = Math.max(0, ms);
  const mins = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(tenths)}`;
}

function minutes(ms: number): string {
  return `${String(Math.round((ms / 60_000) * 100) / 100)}m`;
}
