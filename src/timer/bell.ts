import type { BellKind } from './session';

/**
 * A struck bowl, synthesised. No audio file ships with the app: additive
 * synthesis costs zero bytes, sidesteps sample licensing, and can be retuned
 * per bell type (SPEC.md section 6).
 *
 * The partials are deliberately inharmonic. Whole-number ratios would sound
 * like an organ; it is the 2.7 and the 4.2 that make it read as metal.
 */
const PARTIAL_RATIOS = [1, 2.0, 2.7, 4.2, 5.4] as const;

/** Descending, so the fundamental carries and the upper partials only colour it. */
const PARTIAL_GAINS = [1, 0.5, 0.34, 0.2, 0.11] as const;

/**
 * Every partial starts on the same 5ms attack, so their peaks land together and
 * sum coherently. Dividing by the total keeps a strike inside unity however many
 * partials it has.
 *
 * Without this the opening and closing bells peaked at 1.83 — most of a doubling
 * past full scale — and the output clipped. It was audible on a phone as a
 * scratchiness on those two bells but not on the quieter interval bell, which
 * only just crossed the line.
 */
const PARTIAL_GAIN_TOTAL = PARTIAL_GAINS.reduce((total, gain) => total + gain, 0);

/**
 * Decay per partial, as a fraction of the fundamental's. High partials die away
 * first — with an 8s fundamental this runs 8s down to about 1.5s.
 */
const PARTIAL_DECAYS = [1, 0.62, 0.42, 0.28, 0.19] as const;

/** A hard start is an audible click. */
const ATTACK_SECONDS = 0.005;

/** exponentialRampToValueAtTime cannot reach zero. */
const SILENCE = 0.0001;

interface BellVoice {
  readonly fundamentalHz: number;
  /** Decay of the fundamental partial, in seconds. */
  readonly decaySeconds: number;
  readonly gain: number;
  /** Strikes in one ringing of this bell. */
  readonly strikes: number;
  readonly strikeSpacingSeconds: number;
}

/**
 * The three bells differ by fundamental and strike count, so they are told
 * apart with the eyes closed and without counting.
 */
const VOICES: Record<BellKind, BellVoice> = {
  opening: {
    fundamentalHz: 196,
    decaySeconds: 8,
    gain: 0.85,
    strikes: 3,
    strikeSpacingSeconds: 4,
  },
  interval: {
    fundamentalHz: 294,
    decaySeconds: 5,
    gain: 0.5,
    strikes: 1,
    strikeSpacingSeconds: 0,
  },
  closing: {
    fundamentalHz: 174,
    decaySeconds: 11,
    gain: 0.85,
    strikes: 3,
    strikeSpacingSeconds: 4.5,
  },
};

export interface BellOptions {
  /** Defaults to the context's destination. */
  readonly destination?: AudioNode;
  /** Overall level, 0 to 1. */
  readonly volume?: number;
  /** Injected so a test can strike the same bell twice and compare. */
  readonly random?: () => number;
}

/** How long a ringing of this bell takes to fall silent. */
export function bellDurationSeconds(kind: BellKind): number {
  const voice = VOICES[kind];
  return (voice.strikes - 1) * voice.strikeSpacingSeconds + voice.decaySeconds;
}

/**
 * Ring a bell: one strike for an interval marker, three for the opening and
 * closing. Everything is scheduled against the audio clock, which runs off the
 * main thread and survives the page being backgrounded — so a whole session's
 * bells can be laid down in advance and left alone.
 */
export function scheduleBell(
  ctx: BaseAudioContext,
  when: number,
  kind: BellKind,
  options: BellOptions = {},
): void {
  const voice = VOICES[kind];
  for (let strike = 0; strike < voice.strikes; strike += 1) {
    strikeBell(ctx, when + strike * voice.strikeSpacingSeconds, kind, options);
  }
}

/** A single strike of the given bell. */
export function strikeBell(
  ctx: BaseAudioContext,
  when: number,
  kind: BellKind,
  options: BellOptions = {},
): void {
  const voice = VOICES[kind];
  const destination = options.destination ?? ctx.destination;
  const volume = options.volume ?? 1;
  const random = options.random ?? Math.random;
  if (volume <= 0) return;

  // A real bowl is never struck identically twice.
  const detuneCents = (random() * 2 - 1) * 8;
  const at = Math.max(when, ctx.currentTime);

  for (const [index, ratio] of PARTIAL_RATIOS.entries()) {
    const partialGain = PARTIAL_GAINS[index] ?? 0;
    const decay = voice.decaySeconds * (PARTIAL_DECAYS[index] ?? 1);
    const peak = (voice.gain * volume * partialGain) / PARTIAL_GAIN_TOTAL;

    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = voice.fundamentalHz * ratio;
    // Upper partials drift a little further, as a struck bowl's do.
    oscillator.detune.value = detuneCents * (1 + index * 0.35);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + ATTACK_SECONDS);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, at + decay);

    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + decay + 0.05);
  }

  strikeTransient(ctx, at, voice, destination, volume);
}

/**
 * The sound of the striker meeting the bowl: a short filtered noise burst.
 * Without it the partials fade up out of nowhere and the bell sounds synthetic.
 *
 * Kept brief and narrow. A longer, broader burst reads as a scrape rather than
 * a strike, which is the other half of sounding scratchy.
 */
function strikeTransient(
  ctx: BaseAudioContext,
  at: number,
  voice: BellVoice,
  destination: AudioNode,
  volume: number,
): void {
  const seconds = 0.03;
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Shaped as it is written; the burst is over before anything could ramp it.
    samples[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = voice.fundamentalHz * 6;
  filter.Q.value = 2.5;

  const envelope = ctx.createGain();
  const peak = voice.gain * volume * 0.05;
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(peak, at + 0.001);
  envelope.gain.exponentialRampToValueAtTime(SILENCE, at + seconds);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination);
  source.start(at);
  source.stop(at + seconds);
}
