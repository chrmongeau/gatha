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
}

export interface AudioEngineOptions {
  /** Overall bell volume, 0 to 1. */
  readonly volume?: number;
  /** Shown on the lock screen while the session runs. */
  readonly nowPlaying?: { readonly title: string; readonly artist: string };
}

export interface AudioEngine {
  /**
   * Schedule every bell at or after `elapsedMs`, measured from the session's
   * start. Called once. Bells are never scheduled one at a time as the session
   * runs: the whole point is that the schedule outlives a suspended main thread.
   */
  scheduleFrom(bells: readonly ScheduledBell[], elapsedMs: number): void;
  /** Nudge a context the OS suspended. Safe to call on every visibilitychange. */
  resume(): void;
  /** Stop the keepalive and let the context go. */
  close(): void;
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
  announce(options.nowPlaying);

  let closed = false;

  return {
    scheduleFrom(bells: readonly ScheduledBell[], elapsedMs: number): void {
      if (closed) return;
      const volume = options.volume ?? 1;
      // Offsets are relative to the session start; the audio clock starts now.
      const origin = ctx.currentTime - elapsedMs / 1000;
      for (const bell of bells) {
        const when = origin + bell.offsetMs / 1000;
        // A bell whose moment has passed is not rung late: never a backlog.
        if (when < ctx.currentTime - RESYNC_TOLERANCE_MS / 1000) continue;
        scheduleBell(ctx, Math.max(when, ctx.currentTime), bell.kind, {
          destination: master,
          volume,
        });
      }
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
 * A looping, near-silent source. iOS suspends an AudioContext that is not
 * actually playing anything, which would take the scheduled bells down with it.
 * Inaudible, but not digital silence — silence is what gets optimised away.
 */
function startKeepAlive(ctx: AudioContext): () => void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    samples[i] = (Math.random() * 2 - 1) * 0.0001;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(ctx.destination);
  source.start();

  void resumeContext(ctx);

  return () => {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
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
 * as a stray tab. It also reads nicely on a lock screen.
 */
function announce(nowPlaying: AudioEngineOptions['nowPlaying']): void {
  const session = mediaSession();
  if (session === null || nowPlaying === undefined) return;

  const MetadataConstructor = (globalThis as { MediaMetadata?: new (init: object) => unknown })
    .MediaMetadata;
  if (MetadataConstructor !== undefined) {
    session.metadata = new MetadataConstructor({
      title: nowPlaying.title,
      artist: nowPlaying.artist,
    });
  }
  setPlaybackState('playing');
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
