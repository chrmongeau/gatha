import { describe, expect, it } from 'vitest';

import type { SessionPhase, SessionReading } from '../timer/session';
import { announcement } from './sitting';

const reading = (phase: SessionPhase, progress = 0, finished = false): SessionReading => ({
  elapsedMs: 0,
  sittingMs: 0,
  phase,
  progress,
  finished,
  due: [],
  skipped: [],
});

/* Tacet rule 16: a screen reader hears what the sitter caused or must know, never progress. */
describe('what a screen reader hears during a sit', () => {
  it('hears nothing while the bell is still being prepared', () => {
    expect(announcement(reading('preparing'), false)).toBeNull();
  });

  it('hears the start once the opening bell rings', () => {
    expect(announcement(reading('sitting'), false)).toBe('The sit has begun.');
  });

  it('hears that a reloaded sit has resumed, not that it has begun', () => {
    expect(announcement(reading('sitting', 0.4), true)).toBe('The sit has resumed.');
  });

  it('hears the end at the closing bell', () => {
    expect(announcement(reading('leadOut', 1), false)).toBe('The sit is complete.');
    expect(announcement(reading('finished', 1, true), true)).toBe('The sit is complete.');
  });

  it('hears nothing new as the sit runs', () => {
    const heard = new Set([0.01, 0.25, 0.5, 0.99].map((p) => announcement(reading('sitting', p), false)));
    expect([...heard]).toEqual(['The sit has begun.']);
  });
});
