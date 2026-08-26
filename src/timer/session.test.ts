import { describe, expect, it } from 'vitest';

import {
  RESYNC_TOLERANCE_MS,
  Session,
  bellSchedule,
  endsAt,
  phaseAt,
  progressAt,
  totalDurationMs,
  type ScheduledBell,
  type SessionConfig,
} from './session';
import { TestClock } from './test-clock';

const MINUTE = 60_000;

/** What phase 1 hardcodes: ten minutes of silence, a bell at five. */
const TEN_MINUTES: SessionConfig = {
  durationMs: 10 * MINUTE,
  intervalMs: 5 * MINUTE,
  prepareMs: 10_000,
  leadOutMs: 12_000,
};

const kinds = (bells: readonly ScheduledBell[]): string[] => bells.map((bell) => bell.kind);
const offsets = (bells: readonly ScheduledBell[]): number[] => bells.map((bell) => bell.offsetMs);

describe('bellSchedule', () => {
  it('places the opening bell after the preparation delay and the closing bell after the silence', () => {
    const bells = bellSchedule(TEN_MINUTES);

    expect(kinds(bells)).toEqual(['opening', 'interval', 'closing']);
    expect(offsets(bells)).toEqual([10_000, 5 * MINUTE + 10_000, 10 * MINUTE + 10_000]);
  });

  it('does not place an interval bell on top of the closing bell', () => {
    const bells = bellSchedule({ ...TEN_MINUTES, intervalMs: 10 * MINUTE });

    expect(kinds(bells)).toEqual(['opening', 'closing']);
  });

  it('spaces interval bells evenly through the silence', () => {
    const bells = bellSchedule({ ...TEN_MINUTES, durationMs: 30 * MINUTE, intervalMs: 5 * MINUTE });

    expect(kinds(bells)).toEqual([
      'opening',
      'interval',
      'interval',
      'interval',
      'interval',
      'interval',
      'closing',
    ]);
    expect(offsets(bells)).toEqual(
      [0, 5, 10, 15, 20, 25, 30].map((minutes) => 10_000 + minutes * MINUTE),
    );
  });

  it('omits interval bells when they are switched off', () => {
    expect(kinds(bellSchedule({ ...TEN_MINUTES, intervalMs: null }))).toEqual([
      'opening',
      'closing',
    ]);
  });

  it('omits interval bells longer than the session', () => {
    expect(kinds(bellSchedule({ ...TEN_MINUTES, intervalMs: 25 * MINUTE }))).toEqual([
      'opening',
      'closing',
    ]);
  });

  it('starts the opening bell immediately with no preparation delay', () => {
    const bells = bellSchedule({ ...TEN_MINUTES, prepareMs: 0 });

    expect(offsets(bells)).toEqual([0, 5 * MINUTE, 10 * MINUTE]);
  });
});

describe('phase and progress', () => {
  it('runs preparing, sitting, lead-out, finished', () => {
    expect(phaseAt(TEN_MINUTES, 0)).toBe('preparing');
    expect(phaseAt(TEN_MINUTES, 9_999)).toBe('preparing');
    expect(phaseAt(TEN_MINUTES, 10_000)).toBe('sitting');
    expect(phaseAt(TEN_MINUTES, 10_000 + 10 * MINUTE - 1)).toBe('sitting');
    expect(phaseAt(TEN_MINUTES, 10_000 + 10 * MINUTE)).toBe('leadOut');
    expect(phaseAt(TEN_MINUTES, totalDurationMs(TEN_MINUTES))).toBe('finished');
  });

  it('holds the line at zero through the preparation delay', () => {
    expect(progressAt(TEN_MINUTES, 0)).toBe(0);
    expect(progressAt(TEN_MINUTES, 9_000)).toBe(0);
  });

  it('fills the line across the silence and stops at full', () => {
    expect(progressAt(TEN_MINUTES, 10_000 + 5 * MINUTE)).toBeCloseTo(0.5, 10);
    expect(progressAt(TEN_MINUTES, 10_000 + 10 * MINUTE)).toBe(1);
    expect(progressAt(TEN_MINUTES, 10_000 + 40 * MINUTE)).toBe(1);
  });
});

describe('a session running normally', () => {
  it('marks each bell once, as it falls due', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    expect(session.read().due).toEqual([]);

    clock.advance(10_000);
    expect(kinds(session.read().due)).toEqual(['opening']);
    expect(session.read().due).toEqual([]);

    clock.advance(5 * MINUTE);
    expect(kinds(session.read().due)).toEqual(['interval']);

    clock.advance(5 * MINUTE);
    const closing = session.read();
    expect(kinds(closing.due)).toEqual(['closing']);
    expect(closing.phase).toBe('leadOut');
    expect(closing.progress).toBe(1);
    expect(closing.finished).toBe(false);

    clock.advance(12_000);
    expect(session.read().finished).toBe(true);
  });

  it('reports elapsed time within the silence, not including the preparation delay', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(4_000);
    expect(session.read().sittingMs).toBe(0);

    clock.advance(6_000 + 90_000);
    expect(session.read().sittingMs).toBe(90_000);

    clock.advance(60 * MINUTE);
    expect(session.read().sittingMs).toBe(10 * MINUTE);
  });

  it('records the wall time the session ends at', () => {
    const clock = new TestClock({ wall: 1_700_000_000_000 });
    const session = Session.start(TEN_MINUTES, clock);

    expect(session.endsAt).toBe(1_700_000_000_000 + 10_000 + 10 * MINUTE + 12_000);
    expect(endsAt(session.record)).toBe(session.endsAt);
  });
});

describe('reading the clock without consuming bells', () => {
  it('reports elapsed time without taking the bells that have fallen due', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000);

    // Whatever else asks the session for the time — a resync, a log line — must
    // not swallow the bell the animation frame is about to report.
    expect(session.elapsedMs).toBe(10_000);
    expect(session.elapsedMs).toBe(10_000);

    expect(kinds(session.read().due)).toEqual(['opening']);
  });

  it('still never goes backwards when only peeked at', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(60_000);
    expect(session.elapsedMs).toBe(60_000);

    clock.shiftWall(-30_000);
    expect(session.elapsedMs).toBe(60_000);
  });
});

describe('a suspension mid-session', () => {
  it('resyncs after forty minutes asleep without firing a backlog', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    // The opening bell sounds, then the phone is locked and put down.
    clock.advance(10_000);
    expect(kinds(session.read().due)).toEqual(['opening']);

    // Forty minutes pass with the main thread frozen: no frames, no readings.
    clock.sleep(40 * MINUTE);

    const back = session.read();
    expect(back.due).toEqual([]);
    expect(kinds(back.skipped)).toEqual(['interval', 'closing']);
    expect(back.finished).toBe(true);
    expect(back.progress).toBe(1);

    // And nothing is left over to fire on the next frame.
    const next = session.read();
    expect(next.due).toEqual([]);
    expect(next.skipped).toEqual([]);
  });

  it('trusts the wall clock when the monotonic clock stalls while the device sleeps', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.sleep(3 * MINUTE);

    expect(session.read().elapsedMs).toBe(3 * MINUTE);
  });

  it('still marks a bell that fell due during a brief pause', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000 + RESYNC_TOLERANCE_MS - 1);

    expect(kinds(session.read().due)).toEqual(['opening']);
  });

  it('skips a bell whose moment has passed by more than the tolerance', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000 + RESYNC_TOLERANCE_MS + 1);

    const reading = session.read();
    expect(reading.due).toEqual([]);
    expect(kinds(reading.skipped)).toEqual(['opening']);
  });

  it('reports a session that ended while the app was away, with its true end time', () => {
    const clock = new TestClock({ wall: 1_700_000_000_000 });
    const session = Session.start(TEN_MINUTES, clock);

    clock.sleep(90 * MINUTE);

    const reading = session.read();
    expect(reading.finished).toBe(true);
    expect(session.endsAt).toBe(1_700_000_000_000 + totalDurationMs(TEN_MINUTES));
    expect(session.endsAt).toBeLessThan(clock.wall());
  });
});

describe('a reload mid-session', () => {
  it('resumes at the right point with a clock whose monotonic origin has been reset', () => {
    const clock = new TestClock({ monotonic: 1_500, wall: 1_700_000_000_000 });
    const started = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000);
    expect(kinds(started.read().due)).toEqual(['opening']);
    clock.advance(3 * MINUTE);

    // The page reloads: same wall clock, a monotonic clock starting over.
    const afterReload = new TestClock({ monotonic: 0, wall: clock.wall() });
    const resumed = Session.resume(started.record, afterReload);

    const reading = resumed.read();
    expect(reading.elapsedMs).toBe(10_000 + 3 * MINUTE);
    expect(reading.phase).toBe('sitting');
    expect(reading.progress).toBeCloseTo(0.3, 10);

    // The opening bell already sounded before the reload. It is not replayed.
    expect(reading.due).toEqual([]);
    expect(reading.skipped).toEqual([]);
  });

  it('carries on from the resumed point and rings only the bells still ahead', () => {
    const clock = new TestClock();
    const record = Session.start(TEN_MINUTES, clock).record;

    clock.advance(10_000 + 3 * MINUTE);
    const resumed = Session.resume(record, new TestClock({ monotonic: 0, wall: clock.wall() }));

    expect(offsets(resumed.remainingBells(resumed.read().elapsedMs))).toEqual([
      10_000 + 5 * MINUTE,
      10_000 + 10 * MINUTE,
    ]);
  });

  it('resumes a session that finished while the page was closed', () => {
    const clock = new TestClock();
    const record = Session.start(TEN_MINUTES, clock).record;

    clock.advance(4 * 60 * MINUTE);
    const resumed = Session.resume(record, new TestClock({ monotonic: 0, wall: clock.wall() }));

    const reading = resumed.read();
    expect(reading.finished).toBe(true);
    expect(reading.due).toEqual([]);
    expect(reading.skipped).toEqual([]);
  });

  it('treats a wall clock set backwards before the reload as no time passed', () => {
    const clock = new TestClock();
    const record = Session.start(TEN_MINUTES, clock).record;

    clock.shiftWall(-2 * 60 * MINUTE);
    const resumed = Session.resume(record, new TestClock({ monotonic: 0, wall: clock.wall() }));

    const reading = resumed.read();
    expect(reading.elapsedMs).toBe(0);
    expect(reading.phase).toBe('preparing');
  });
});

describe('the system clock changing mid-session', () => {
  it('ignores a wall clock jumping backwards', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000);
    expect(kinds(session.read().due)).toEqual(['opening']);
    clock.advance(2 * MINUTE);

    clock.shiftWall(-60 * MINUTE);

    const reading = session.read();
    expect(reading.elapsedMs).toBe(10_000 + 2 * MINUTE);
    expect(reading.phase).toBe('sitting');
    expect(reading.finished).toBe(false);

    // The remaining bells still fall where they always did.
    clock.advance(3 * MINUTE);
    expect(kinds(session.read().due)).toEqual(['interval']);

    clock.advance(5 * MINUTE);
    expect(kinds(session.read().due)).toEqual(['closing']);
  });

  it('never lets elapsed time go backwards, even if the monotonic clock does', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000);
    session.read();
    clock.advance(4 * MINUTE);
    const before = session.read().elapsedMs;

    clock.shiftMonotonic(-30_000);
    clock.shiftWall(-30_000);

    expect(session.read().elapsedMs).toBe(before);
  });

  it('does not re-mark a bell after the clock is set back across it', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(10_000);
    expect(kinds(session.read().due)).toEqual(['opening']);
    clock.advance(5 * MINUTE);
    expect(kinds(session.read().due)).toEqual(['interval']);

    // The clock is set back to before the interval bell.
    clock.shiftWall(-4 * MINUTE);
    expect(session.read().due).toEqual([]);

    // The closing bell still lands ten minutes after the opening one.
    clock.advance(5 * MINUTE - 1);
    expect(session.read().due).toEqual([]);
    clock.advance(1);
    expect(kinds(session.read().due)).toEqual(['closing']);
  });

  it('does not resync forward on a small clock correction', () => {
    const clock = new TestClock();
    const session = Session.start(TEN_MINUTES, clock);

    clock.advance(60_000);
    clock.shiftWall(1_000);

    expect(session.read().elapsedMs).toBe(60_000);
  });
});
