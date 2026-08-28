import { describe, expect, it } from 'vitest';

import { formatDuration } from './dom';

/**
 * Every digit on the Sitting screen goes through this — the one number the app
 * shows during a sit, and only when it is asked for.
 */
describe('formatDuration', () => {
  it('counts whole seconds from the start', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1_000)).toBe('0:01');
    expect(formatDuration(61_000)).toBe('1:01');
  });

  it('pads the seconds, so the number does not jump about as it counts', () => {
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('rounds down, so a second is not shown before it has passed', () => {
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(60_001)).toBe('1:00');
  });

  it('keeps counting in minutes past an hour rather than starting a third field', () => {
    expect(formatDuration(3_600_000)).toBe('60:00');
    expect(formatDuration(5_400_000)).toBe('90:00');
  });

  it('shows nothing negative, whatever a clock does', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(-90_000)).toBe('0:00');
  });
});
