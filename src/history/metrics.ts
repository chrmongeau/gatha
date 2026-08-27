import { dayNumber } from '../day';
import type { SessionRecord } from './store';

/**
 * What the practice view counts, and deliberately what it does not.
 *
 * Named for what it is rather than `streak.ts`: there is no streak here, and a
 * file called that invites someone to add one. SPEC.md §7 sets out at length why
 * a consecutive-day counter is the wrong mechanic — it is inhibitional by
 * construction, its whole value is in not being broken, and breaking it is what
 * makes people quit. Everything below is either a floor or something that only
 * rises.
 */

/** The unit of success: any session of two minutes or more (SPEC.md §7). */
export const FLOOR_MS = 2 * 60_000;

/** Robust to gaps, recovers on its own, and no single day can destroy it. */
export const WINDOW_DAYS = 30;

export interface DaySummary {
  readonly day: number;
  readonly totalMs: number;
  readonly sessions: number;
}

export interface Totals {
  /** Days on which a session met the floor. Monotonic. */
  readonly days: number;
  /** Time sat, across every qualifying session. Monotonic. */
  readonly totalMs: number;
}

/** A sit counts once it reaches the floor. A short sit is not a partial success. */
export function counts(session: SessionRecord): boolean {
  return session.durationMs >= FLOOR_MS;
}

export function dayOf(session: SessionRecord): number {
  return dayNumber(new Date(session.startedAt));
}

/** Every day with a qualifying session, and how much was sat on it. */
export function byDay(sessions: readonly SessionRecord[]): Map<number, DaySummary> {
  const days = new Map<number, DaySummary>();
  for (const session of sessions) {
    if (!counts(session)) continue;
    const day = dayOf(session);
    const existing = days.get(day);
    days.set(day, {
      day,
      totalMs: (existing?.totalMs ?? 0) + session.durationMs,
      sessions: (existing?.sessions ?? 0) + 1,
    });
  }
  return days;
}

/**
 * The primary metric: days sat in the last thirty, shown as a fraction.
 *
 * This is where the two or three days of slack live — structurally, with no
 * grace mechanic to configure or spend, and nothing that can be lost.
 */
export function daysInWindow(
  sessions: readonly SessionRecord[],
  today: number,
  window: number = WINDOW_DAYS,
): number {
  const days = byDay(sessions);
  let sat = 0;
  for (let day = today - window + 1; day <= today; day += 1) {
    if (days.has(day)) sat += 1;
  }
  return sat;
}

/** Both only ever rise, so the app never shows something being lost. */
export function totals(sessions: readonly SessionRecord[]): Totals {
  const days = byDay(sessions);
  let totalMs = 0;
  for (const summary of days.values()) totalMs += summary.totalMs;
  return { days: days.size, totalMs };
}

/**
 * The heat map. Squares for the last few months, oldest first, so gaps read as
 * texture rather than as failure.
 */
export function calendar(
  sessions: readonly SessionRecord[],
  today: number,
  length: number,
): DaySummary[] {
  const days = byDay(sessions);
  const out: DaySummary[] = [];
  for (let day = today - length + 1; day <= today; day += 1) {
    out.push(days.get(day) ?? { day, totalMs: 0, sessions: 0 });
  }
  return out;
}

/**
 * How dark a square is drawn, from 0 to 1. Length shades a square; it never
 * scores one, and every day that met the floor is clearly marked whether it ran
 * two minutes or forty.
 */
export function intensity(totalMs: number): number {
  if (totalMs <= 0) return 0;
  const hour = 60 * 60_000;
  return 0.35 + 0.65 * Math.min(1, Math.log1p(totalMs / hour) / Math.log1p(1));
}

export function hasSatOn(sessions: readonly SessionRecord[], day: number): boolean {
  return byDay(sessions).has(day);
}
