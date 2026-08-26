/**
 * The two clock readings a session needs.
 *
 * This is the only file under src/timer/ that is allowed to call `Date.now()`
 * or `performance.now()`. Everything else takes a `Clock`, which is what makes
 * the session model testable without waiting in real time — see CLAUDE.md.
 */
export interface Clock {
  /**
   * Milliseconds since an arbitrary origin, advancing at the rate of real time
   * and unaffected by changes to the system clock. Can stall while a device is
   * asleep, which the session model compensates for.
   */
  monotonic(): number;

  /**
   * Milliseconds since the Unix epoch. Survives a reload, but can jump in
   * either direction when the system clock is corrected.
   */
  wall(): number;
}

export const systemClock: Clock = {
  monotonic: () => performance.now(),
  wall: () => Date.now(),
};
