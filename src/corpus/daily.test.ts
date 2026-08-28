import { describe, expect, it } from 'vitest';

import { dayNumber } from '../day';
import { passageForDay, rerollFrom } from './daily';

const ORDER = ['a', 'b', 'c', 'd'];

describe('dayNumber', () => {
  it('is the same all day and changes at local midnight', () => {
    const morning = dayNumber(new Date(2026, 7, 27, 6, 30));
    const night = dayNumber(new Date(2026, 7, 27, 23, 59, 59));
    const tomorrow = dayNumber(new Date(2026, 7, 28, 0, 0, 1));

    expect(morning).toBe(night);
    expect(tomorrow).toBe(morning + 1);
  });

  it('counts consecutive days consecutively across a month boundary', () => {
    expect(dayNumber(new Date(2026, 7, 1))).toBe(dayNumber(new Date(2026, 6, 31)) + 1);
  });

  it('reads the local calendar date, not UTC', () => {
    // Late evening local time is already the next day in UTC, and the passage
    // must not change under someone at 23:00.
    const evening = new Date(2026, 7, 27, 23, 0);
    expect(dayNumber(evening)).toBe(dayNumber(new Date(2026, 7, 27, 1, 0)));
  });
});

describe('passageForDay', () => {
  it('gives every passage in turn before repeating any', () => {
    const seen = [0, 1, 2, 3].map((day) => passageForDay(ORDER, day));

    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(passageForDay(ORDER, 4)).toBe('a');
  });

  it('is stable for a given day', () => {
    expect(passageForDay(ORDER, 19_000)).toBe(passageForDay(ORDER, 19_000));
  });

  it('copes with a clock set before the epoch', () => {
    expect(passageForDay(ORDER, -1)).toBe('d');
    expect(passageForDay(ORDER, -5)).toBe('d');
  });

  it('reports nothing rather than throwing on an empty corpus', () => {
    expect(passageForDay([], 1)).toBeNull();
  });
});

describe('rerollFrom', () => {
  it('walks the order, so a re-roll never repeats the day just shown', () => {
    expect(rerollFrom(ORDER, 'a')).toBe('b');
    expect(rerollFrom(ORDER, 'd')).toBe('a');
  });

  it('falls back to the start if the current passage is not in the order', () => {
    expect(rerollFrom(ORDER, 'zz')).toBe('a');
  });

  it('reports nothing rather than throwing on an empty corpus', () => {
    expect(rerollFrom([], 'a')).toBeNull();
  });
});
