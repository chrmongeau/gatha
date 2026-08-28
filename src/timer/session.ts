import type { Clock } from './clock';

export type BellKind = 'opening' | 'interval' | 'closing';

export interface SessionConfig {
  /** The silence itself: from the opening bell to the closing bell. */
  readonly durationMs: number;
  /** An interval bell every N ms during the silence, or null for none. */
  readonly intervalMs: number | null;
  /** Quiet delay before the opening bell, so the phone can be set down. */
  readonly prepareMs: number;
  /** Silence held after the closing bell before the session is over. */
  readonly leadOutMs: number;
}

export interface ScheduledBell {
  readonly kind: BellKind;
  /** Offset from the session start. t = 0 is the start of the preparation delay. */
  readonly offsetMs: number;
}

export type SessionPhase = 'preparing' | 'sitting' | 'leadOut' | 'finished';

export interface SessionReading {
  /** Time since the session started, including the preparation delay. */
  readonly elapsedMs: number;
  /** Time since the opening bell, clamped to the silence. What a tap reveals. */
  readonly sittingMs: number;
  readonly phase: SessionPhase;
  /** 0 at the opening bell, 1 at the closing bell. What the incised line draws. */
  readonly progress: number;
  readonly finished: boolean;
  /** Bells that fell due since the previous reading, near enough to still mark. */
  readonly due: readonly ScheduledBell[];
  /** Bells whose moment passed unobserved. Recorded, never replayed. */
  readonly skipped: readonly ScheduledBell[];
}

/** What is persisted so a reload mid-session can offer to resume. */
export interface SessionRecord {
  /** Wall clock, so it survives the monotonic clock's origin being reset. */
  readonly startedAt: number;
  readonly config: SessionConfig;
}

/**
 * A bell later than this has had its moment. It is marked as skipped rather
 * than sounded: never fire a backlog (SPEC.md section 5).
 */
export const RESYNC_TOLERANCE_MS = 2_000;

/**
 * Divergence beyond this between the two clocks means the monotonic clock
 * stalled while the device slept, and the wall clock is the better reading.
 */
export const SUSPENSION_TOLERANCE_MS = 2_000;

/**
 * Every bell of the session, in order, as offsets from the start. Computed once
 * so the whole schedule can be handed to the audio clock in advance.
 */
export function bellSchedule(config: SessionConfig): ScheduledBell[] {
  const bells: ScheduledBell[] = [{ kind: 'opening', offsetMs: config.prepareMs }];

  const { intervalMs } = config;
  if (intervalMs !== null && intervalMs > 0) {
    // A marker landing exactly on the closing bell is not a marker.
    for (let at = intervalMs; at < config.durationMs; at += intervalMs) {
      bells.push({ kind: 'interval', offsetMs: config.prepareMs + at });
    }
  }

  bells.push({ kind: 'closing', offsetMs: config.prepareMs + config.durationMs });
  return bells;
}

export function totalDurationMs(config: SessionConfig): number {
  return config.prepareMs + config.durationMs + config.leadOutMs;
}

export function phaseAt(config: SessionConfig, elapsedMs: number): SessionPhase {
  if (elapsedMs < config.prepareMs) return 'preparing';
  if (elapsedMs < config.prepareMs + config.durationMs) return 'sitting';
  if (elapsedMs < totalDurationMs(config)) return 'leadOut';
  return 'finished';
}

export function progressAt(config: SessionConfig, elapsedMs: number): number {
  if (config.durationMs <= 0) return 1;
  const intoSilence = elapsedMs - config.prepareMs;
  return clamp(intoSilence / config.durationMs, 0, 1);
}

function sittingMsAt(config: SessionConfig, elapsedMs: number): number {
  return clamp(elapsedMs - config.prepareMs, 0, config.durationMs);
}

/**
 * The wall time the session ends at, used for the record when the app comes
 * back to a session that should already have finished.
 */
export function endsAt(record: SessionRecord): number {
  return record.startedAt + totalDurationMs(record.config);
}

/**
 * A running session. Holds a start instant and an injected clock, and nothing
 * else — no timers, no accumulator, no DOM. Every reading is derived from the
 * clock at the moment it is asked for, so a suspended main thread costs
 * accuracy in nothing but the frame that was not drawn.
 */
export class Session {
  readonly record: SessionRecord;
  readonly schedule: readonly ScheduledBell[];

  private readonly clock: Clock;
  private readonly startedMonotonic: number;
  private nextBell = 0;
  private lastElapsedMs: number;

  private constructor(record: SessionRecord, clock: Clock, elapsedMs: number) {
    this.record = record;
    this.clock = clock;
    this.schedule = bellSchedule(record.config);
    this.startedMonotonic = clock.monotonic() - elapsedMs;
    this.lastElapsedMs = elapsedMs;

    // Bells already behind us at construction have had their moment elsewhere:
    // they sounded before the reload, or they never will. Either way, past.
    while (this.nextBell < this.schedule.length) {
      const bell = this.schedule[this.nextBell];
      if (bell === undefined || bell.offsetMs > elapsedMs) break;
      this.nextBell += 1;
    }
  }

  /** Begin now. Reads the clock once; from here on the start instant is fixed. */
  static start(config: SessionConfig, clock: Clock): Session {
    return new Session({ startedAt: clock.wall(), config }, clock, 0);
  }

  /**
   * Pick a persisted session back up. The monotonic origin is gone after a
   * reload, so elapsed time is reconstructed from the wall clock once, here,
   * and tracked monotonically from then on.
   */
  static resume(record: SessionRecord, clock: Clock): Session {
    const elapsedMs = Math.max(0, clock.wall() - record.startedAt);
    return new Session(record, clock, elapsedMs);
  }

  /**
   * The current state. Safe to call on every animation frame and again on
   * every visibilitychange; the two are indistinguishable to the model.
   */
  read(): SessionReading {
    const elapsedMs = this.measure();
    const config = this.record.config;

    const due: ScheduledBell[] = [];
    const skipped: ScheduledBell[] = [];
    while (this.nextBell < this.schedule.length) {
      const bell = this.schedule[this.nextBell];
      if (bell === undefined || bell.offsetMs > elapsedMs) break;
      if (elapsedMs - bell.offsetMs <= RESYNC_TOLERANCE_MS) due.push(bell);
      else skipped.push(bell);
      this.nextBell += 1;
    }

    const phase = phaseAt(config, elapsedMs);
    return {
      elapsedMs,
      sittingMs: sittingMsAt(config, elapsedMs),
      phase,
      progress: progressAt(config, elapsedMs),
      finished: phase === 'finished',
      due,
      skipped,
    };
  }

  /**
   * Elapsed time on its own, without consuming any bell that has fallen due.
   *
   * Anything that only wants the clock must use this. `read()` advances the
   * bell cursor, so calling it from a second place silently swallows the bells
   * the caller of `read()` was waiting for.
   */
  get elapsedMs(): number {
    return this.measure();
  }

  /** Bells still ahead of the given elapsed time, for handing to the audio clock. */
  remainingBells(elapsedMs: number): ScheduledBell[] {
    return this.schedule.filter((bell) => bell.offsetMs >= elapsedMs);
  }

  get endsAt(): number {
    return endsAt(this.record);
  }

  /**
   * Elapsed time, from the monotonic clock, cross-checked against the wall clock.
   *
   * The monotonic clock is preferred because a system clock correction mid-sit
   * must not move the bells. But `performance.now()` can stall outright while a
   * phone sleeps, which would run the session long — so when the wall clock has
   * advanced materially further, it is believed instead. A wall clock running
   * *behind* the monotonic one has been set backwards, and is ignored.
   */
  private measure(): number {
    const monotonicElapsed = this.clock.monotonic() - this.startedMonotonic;
    const wallElapsed = this.clock.wall() - this.record.startedAt;
    const measured =
      wallElapsed - monotonicElapsed > SUSPENSION_TOLERANCE_MS ? wallElapsed : monotonicElapsed;

    // A session's elapsed time never goes down, whatever the clocks say.
    const elapsedMs = Math.max(measured, this.lastElapsedMs, 0);
    this.lastElapsedMs = elapsedMs;
    return elapsedMs;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
