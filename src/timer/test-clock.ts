import type { Clock } from './clock';

/**
 * A clock under test control. The two readings move independently so the
 * awkward cases can be staged: a system clock correction moves `wall` alone,
 * a sleeping device moves `wall` while `monotonic` stalls, and a reload starts
 * a fresh clock whose monotonic origin has no relation to the old one.
 */
export class TestClock implements Clock {
  private monotonicMs: number;
  private wallMs: number;

  constructor(options: { monotonic?: number; wall?: number } = {}) {
    this.monotonicMs = options.monotonic ?? 0;
    this.wallMs = options.wall ?? 1_700_000_000_000;
  }

  monotonic(): number {
    return this.monotonicMs;
  }

  wall(): number {
    return this.wallMs;
  }

  /** Ordinary passing time: both clocks advance together. */
  advance(ms: number): this {
    this.monotonicMs += ms;
    this.wallMs += ms;
    return this;
  }

  /** A device asleep: real time passes, but the monotonic clock stalls. */
  sleep(ms: number): this {
    this.wallMs += ms;
    return this;
  }

  /** The system clock is corrected. Real time is unaffected. */
  shiftWall(ms: number): this {
    this.wallMs += ms;
    return this;
  }

  /** The monotonic clock misbehaves and reports an earlier reading. */
  shiftMonotonic(ms: number): this {
    this.monotonicMs += ms;
    return this;
  }
}
