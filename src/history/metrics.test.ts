import { describe, expect, it } from 'vitest';

import {
  FLOOR_MS,
  calendar,
  counts,
  daysInWindow,
  hasSatOn,
  intensity,
  totals,
  weekdayOffset,
} from './metrics';
import { dayNumber } from '../day';
import type { SessionRecord } from './store';

const TODAY = dayNumber(new Date(2026, 7, 27, 9, 0));

/** A sit on the day `daysAgo` before today. */
function sat(daysAgo: number, minutes = 20, completed = true): SessionRecord {
  const date = new Date(2026, 7, 27 - daysAgo, 7, 30);
  return { startedAt: date.getTime(), durationMs: minutes * 60_000, completed, passageId: 'ud1.1' };
}

describe('the floor', () => {
  it('counts two minutes as fully as thirty', () => {
    expect(counts(sat(0, 2))).toBe(true);
    expect(counts(sat(0, 30))).toBe(true);
  });

  it('does not count a sit under the floor', () => {
    expect(counts(sat(0, 1))).toBe(false);
    expect(FLOOR_MS).toBe(120_000);
  });

  it('counts a sit that was ended early, if it reached the floor', () => {
    // Length is not the variable being trained. A short sit is not a partial
    // success, and an interrupted one is not a failure.
    expect(counts(sat(0, 5, false))).toBe(true);
  });
});

describe('days in the last thirty', () => {
  it('is the count of days sat, not a run of consecutive ones', () => {
    const sessions = [sat(0), sat(1), sat(5), sat(11), sat(29)];

    expect(daysInWindow(sessions, TODAY)).toBe(5);
  });

  it('is unmoved by a gap in the middle', () => {
    const unbroken = [sat(0), sat(1), sat(2), sat(3)];
    const withGap = [sat(0), sat(1), sat(9), sat(20)];

    expect(daysInWindow(unbroken, TODAY)).toBe(4);
    expect(daysInWindow(withGap, TODAY)).toBe(4);
  });

  it('cannot be destroyed by one missed day', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => sat(i));
    const before = daysInWindow(sessions, TODAY);

    // A day missed costs exactly one day, and comes back on its own.
    const missed = sessions.filter((_, i) => i !== 3);
    expect(before - daysInWindow(missed, TODAY)).toBe(1);
  });

  it('recovers on its own as the window moves', () => {
    // Ten days away, then sat every day since.
    const sessions = Array.from({ length: 5 }, (_, i) => sat(i));

    expect(daysInWindow(sessions, TODAY)).toBe(5);
    expect(daysInWindow([...sessions, sat(-1)], TODAY + 1)).toBe(6);
  });

  it('ignores anything older than the window', () => {
    expect(daysInWindow([sat(30), sat(45)], TODAY)).toBe(0);
    expect(daysInWindow([sat(29)], TODAY)).toBe(1);
  });

  it('counts a day once however many times it was sat', () => {
    const twice = [sat(0, 10), { ...sat(0, 10), startedAt: sat(0).startedAt + 3_600_000 }];

    expect(daysInWindow(twice, TODAY)).toBe(1);
  });
});

describe('totals', () => {
  it('only ever rise', () => {
    const sessions = [sat(0, 20), sat(1, 10), sat(40, 30)];
    const before = totals(sessions);
    const after = totals([...sessions, sat(2, 15)]);

    expect(after.days).toBeGreaterThan(before.days);
    expect(after.totalMs).toBeGreaterThan(before.totalMs);
  });

  it('include days outside the thirty-day window', () => {
    expect(totals([sat(100), sat(0)]).days).toBe(2);
  });

  it('leave out sits under the floor', () => {
    expect(totals([sat(0, 1)]).days).toBe(0);
  });
});

describe('the calendar', () => {
  it('returns a square for every day, sat or not', () => {
    const squares = calendar([sat(0), sat(3)], TODAY, 7);

    expect(squares).toHaveLength(7);
    expect(squares.at(-1)?.day).toBe(TODAY);
    expect(squares.filter((square) => square.totalMs > 0)).toHaveLength(2);
  });

  it('runs oldest first, so it reads left to right', () => {
    const squares = calendar([], TODAY, 5);

    expect(squares[0]?.day).toBe(TODAY - 4);
  });

  it('sums a day that was sat more than once', () => {
    const twice = [sat(0, 10), { ...sat(0, 10), startedAt: sat(0).startedAt + 3_600_000 }];

    expect(calendar(twice, TODAY, 1)[0]?.totalMs).toBe(20 * 60_000);
    expect(calendar(twice, TODAY, 1)[0]?.sessions).toBe(2);
  });
});

describe('intensity', () => {
  it('is nothing on a day not sat', () => {
    expect(intensity(0)).toBe(0);
  });

  it('marks a two-minute day clearly, not faintly', () => {
    // A short sit counts as fully as a long one, so its square must be legible.
    expect(intensity(FLOOR_MS)).toBeGreaterThan(0.3);
  });

  it('rises with length but never runs away', () => {
    expect(intensity(60 * 60_000)).toBeGreaterThan(intensity(10 * 60_000));
    expect(intensity(10 * 60 * 60_000)).toBeLessThanOrEqual(1);
  });
});

describe('hasSatOn', () => {
  it('knows whether today is still open', () => {
    expect(hasSatOn([sat(1)], TODAY)).toBe(false);
    expect(hasSatOn([sat(0)], TODAY)).toBe(true);
    expect(hasSatOn([sat(0, 1)], TODAY)).toBe(false);
  });
});

/**
 * Where a calendar column starts. Real arithmetic, previously inline in the DOM
 * code that paints the squares, where nothing could reach it.
 */
describe('the calendar’s first column', () => {
  // Day 0 of the epoch is 1 January 1970, a Thursday.
  const THURSDAY = 0;

  it('leaves room for the days of the week before the first one', () => {
    // Monday first: Thursday is the fourth row down, so three blanks precede it.
    expect(weekdayOffset(THURSDAY)).toBe(3);
  });

  it('starts a column on Monday with no blanks at all', () => {
    // 5 January 1970 was a Monday.
    expect(weekdayOffset(THURSDAY + 4)).toBe(0);
  });

  it('walks one row per day and wraps after seven', () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((offset) => weekdayOffset(THURSDAY + offset));
    expect(week).toEqual([3, 4, 5, 6, 0, 1, 2]);
    expect(weekdayOffset(THURSDAY + 7)).toBe(3);
  });

  it('stays positive for a day before the epoch, which a badly set clock gives', () => {
    // 31 December 1969 was a Wednesday: two rows down from Monday.
    expect(weekdayOffset(-1)).toBe(2);
    expect(weekdayOffset(-8)).toBe(2);
    expect(weekdayOffset(-4)).toBe(6);
  });
});
