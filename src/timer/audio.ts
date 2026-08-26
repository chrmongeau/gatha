import { scheduleBell } from './bell';
import { RESYNC_TOLERANCE_MS, type ScheduledBell } from './session';

/**
 * The audio side of a session: one AudioContext, every bell laid down in
 * advance, and whatever it takes to stop iOS suspending the context while the
 * phone is in a pocket (SPEC.md section 5).
 *
 * Must be constructed inside the user gesture that starts the session, or
 * autoplay policy will hand back a context that never resumes.
 */

type AudioContextConstructor = new () => AudioContext;

interface MediaSessionLike {
  metadata: unknown;
  playbackState?: string;
  setActionHandler?: (action: string, handler: (() => void) | null) => void;
}

export interface AudioEngineOptions {
  /** Overall bell volume, 0 to 1. */
  readonly volume?: number;
  /** Shown on the lock screen while the session runs. */
  readonly nowPlaying?: { readonly title: string; readonly artist: string };
  /** Called if the listener ends the sit from the lock screen. */
  readonly onStop?: () => void;
}

export interface AudioEngine {
  /** The context's state, for the diagnostic log. 'closed' once shut down. */
  readonly state: string;
  /**
   * Schedule every bell at or after `elapsedMs`, measured from the session's
   * start. Bells are laid down all at once rather than one at a time as the
   * session runs: the schedule has to outlive a suspended main thread.
   */
  scheduleFrom(bells: readonly ScheduledBell[], elapsedMs: number): void;
  /**
   * Re-lay the bells still ahead against the wall clock, and report how far the
   * audio clock has drifted, in seconds. Negative means the audio clock fell
   * behind — every pending bell was going to fire that much late.
   */
  resync(bells: readonly ScheduledBell[], elapsedMs: number): number;
  /** Nudge a context the OS suspended. Safe to call on every visibilitychange. */
  resume(): void;
  /** Stop the keepalive and let the context go. */
  close(): void;
}

/**
 * One ringing of a bell, kept so it can be called off if the audio clock turns
 * out to have drifted. Everything for the bell hangs off its own gain node, so
 * cancelling is one disconnect rather than chasing down each oscillator.
 */
interface PlacedBell {
  readonly when: number;
  readonly gain: GainNode;
}

/** Null when the browser has no Web Audio at all; the session still runs, silently. */
export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine | null {
  const Constructor = audioContextConstructor();
  if (Constructor === null) return null;

  const ctx = new Constructor();
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const keepAlive = startKeepAlive(ctx);
  announce(options.nowPlaying, options.onStop);

  let closed = false;
  let placed: PlacedBell[] = [];
  /** Where session t = 0 sits on the audio clock, as last laid down. */
  let origin: number | null = null;

  const place = (bells: readonly ScheduledBell[], elapsedMs: number): void => {
    const volume = options.volume ?? 1;
    // Offsets are relative to the session start; anchor them to the audio clock.
    origin = ctx.currentTime - elapsedMs / 1000;
    for (const bell of bells) {
      const when = origin + bell.offsetMs / 1000;
      // A bell whose moment has passed is not rung late: never a backlog.
      if (when < ctx.currentTime - RESYNC_TOLERANCE_MS / 1000) continue;
      const at = Math.max(when, ctx.currentTime);
      const gain = ctx.createGain();
      gain.connect(master);
      scheduleBell(ctx, at, bell.kind, { destination: gain, volume });
      placed.push({ when: at, gain });
    }
  };

  return {
    get state(): string {
      return closed ? 'closed' : ctx.state;
    },

    scheduleFrom(bells: readonly ScheduledBell[], elapsedMs: number): void {
      if (closed) return;
      place(bells, elapsedMs);
    },

    resync(bells: readonly ScheduledBell[], elapsedMs: number): number {
      if (closed) return 0;

      const anchor = ctx.currentTime - elapsedMs / 1000;
      const drift = origin === null ? 0 : anchor - origin;

      // Silence everything not yet sounding and lay it down again against the
      // wall clock. A bell already ringing is left alone to finish.
      const ringing: PlacedBell[] = [];
      for (const bell of placed) {
        if (bell.when > ctx.currentTime) bell.gain.disconnect();
        else ringing.push(bell);
      }
      placed = ringing;

      place(bells, elapsedMs);
      return drift;
    },

    resume(): void {
      if (closed) return;
      void resumeContext(ctx);
    },

    close(): void {
      if (closed) return;
      closed = true;
      keepAlive();
      setPlaybackState('none');
      setActionHandler('stop', null);
      void ctx.close().catch(() => {
        // Already closed by the platform.
      });
    },
  };
}

function audioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Below this, a browser calls the tab silent. Chrome's audio power monitor puts
 * its silence threshold near -72 dBFS, and a tab it considers silent is one it
 * will freeze outright once hidden — taking every scheduled bell with it. The
 * first attempt at a keepalive sat at -80 dBFS, under the threshold, and was
 * frozen ninety seconds after the screen locked.
 */
const KEEPALIVE_GAIN = 0.002; // about -54 dBFS: eighteen decibels of margin.

/**
 * Low enough that no phone speaker can reproduce it and no ear can find it.
 * Level is what the browser measures, not frequency, so the tab reads as
 * playing audio while nothing is audible.
 */
const KEEPALIVE_HZ = 30;

/**
 * A continuous inaudible tone, for as long as the session lasts.
 *
 * Two jobs: iOS suspends an AudioContext that is not actually playing anything,
 * and Chrome freezes a hidden tab that is not making a sound. A tone answers
 * both, where the near-silent noise it replaces answered neither — and that
 * noise was audible as a faint hiss, which a tone at this frequency is not.
 */
function startKeepAlive(ctx: AudioContext): () => void {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = KEEPALIVE_HZ;

  const gain = ctx.createGain();
  gain.gain.value = KEEPALIVE_GAIN;

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();

  void resumeContext(ctx);

  return () => {
    try {
      oscillator.stop();
    } catch {
      // Already stopped.
    }
    oscillator.disconnect();
    gain.disconnect();
  };
}

async function resumeContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Outside a gesture the platform may refuse. The next tap will do it.
    }
  }
}

/**
 * Tell the OS this is media, so the session is treated as playing rather than
 * as a stray tab, and so it reads properly on a lock screen (SPEC.md section 5).
 *
 * A tab the system recognises as active media is one it is far less willing to
 * freeze, which is the failure this is really guarding against. Only `stop` is
 * offered: a sit has no meaningful pause, and a transport control that does
 * nothing is worse than no control.
 */
function announce(
  nowPlaying: AudioEngineOptions['nowPlaying'],
  onStop: AudioEngineOptions['onStop'],
): void {
  const session = mediaSession();
  if (session === null) return;

  const MetadataConstructor = (globalThis as { MediaMetadata?: new (init: object) => unknown })
    .MediaMetadata;
  if (nowPlaying !== undefined && MetadataConstructor !== undefined) {
    session.metadata = new MetadataConstructor({
      title: nowPlaying.title,
      artist: nowPlaying.artist,
    });
  }
  setPlaybackState('playing');
  if (onStop !== undefined) setActionHandler('stop', onStop);
}

/** Unsupported actions throw rather than reporting themselves. */
function setActionHandler(action: string, handler: (() => void) | null): void {
  const session = mediaSession();
  if (session?.setActionHandler === undefined) return;
  try {
    session.setActionHandler(action, handler);
  } catch {
    // This platform does not offer the action. Nothing is lost.
  }
}

function setPlaybackState(state: 'playing' | 'none'): void {
  const session = mediaSession();
  if (session === null) return;
  if ('playbackState' in session) session.playbackState = state;
}

function mediaSession(): MediaSessionLike | null {
  const scope = globalThis as { navigator?: { mediaSession?: MediaSessionLike } };
  return scope.navigator?.mediaSession ?? null;
}
