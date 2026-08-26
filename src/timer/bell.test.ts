import { describe, expect, it } from 'vitest';

import { bellDurationSeconds, scheduleBell, strikeBell } from './bell';
import { FakeAudioContext, type FakeOscillator } from './fake-audio-context';

const fixedRandom = (): number => 0.5;

/** Oscillator frequencies of one strike, in the order the partials were built. */
const partialsOf = (oscillators: readonly FakeOscillator[]): number[] =>
  oscillators.map((oscillator) => oscillator.frequency.value);

describe('strikeBell', () => {
  it('builds five inharmonic partials above the fundamental', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 1, 'opening', { random: fixedRandom });

    const partials = partialsOf(ctx.oscillators);
    expect(partials).toHaveLength(5);

    const fundamental = partials[0] ?? 0;
    const ratios = partials.map((hz) => hz / fundamental);
    expect(ratios).toEqual([1, 2.0, 2.7, 4.2, 5.4]);

    // Inharmonic: past the octave, no partial is a whole multiple.
    expect(ratios.slice(2).every((ratio) => !Number.isInteger(ratio))).toBe(true);
    expect(ctx.oscillators.every((oscillator) => oscillator.type === 'sine')).toBe(true);
  });

  it('gives every partial a 5ms attack rather than a hard start', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 2, 'opening', { random: fixedRandom });

    const partialEnvelopes = ctx.gains.slice(0, 5);
    for (const envelope of partialEnvelopes) {
      const [start, attack] = envelope.gain.automation;
      expect(start).toEqual({ kind: 'set', value: 0, time: 2 });
      expect(attack?.kind).toBe('linear');
      expect(attack?.time).toBeCloseTo(2.005, 10);
      expect(attack?.value).toBeGreaterThan(0);
    }
  });

  it('decays lower partials for longer, and never ramps to zero', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 0, 'opening', { random: fixedRandom });

    const decays = ctx.gains.slice(0, 5).map((envelope) => {
      const release = envelope.gain.automation.at(-1);
      expect(release?.kind).toBe('exponential');
      expect(release?.value).toBeGreaterThan(0);
      return release?.time ?? 0;
    });

    expect(decays[0]).toBeCloseTo(8, 10);
    expect(decays.at(-1)).toBeLessThan(2);
    for (let i = 1; i < decays.length; i += 1) {
      expect(decays[i]).toBeLessThan(decays[i - 1] ?? 0);
    }
  });

  it('descends the partial gains so the fundamental carries the strike', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 0, 'opening', { random: fixedRandom });

    const peaks = ctx.gains.slice(0, 5).map((envelope) => envelope.gain.automation[1]?.value ?? 0);
    for (let i = 1; i < peaks.length; i += 1) {
      expect(peaks[i]).toBeLessThan(peaks[i - 1] ?? 0);
    }
  });

  it('adds a filtered noise burst at the onset for the strike transient', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 3, 'opening', { random: fixedRandom });

    expect(ctx.bufferSources).toHaveLength(1);
    const [transient] = ctx.bufferSources;
    expect(transient?.startedAt).toBe(3);
    expect(transient?.buffer?.length).toBeGreaterThan(0);

    const [filter] = ctx.filters;
    expect(filter?.type).toBe('bandpass');

    // Short: it is the striker, not another partial.
    expect((transient?.stoppedAt ?? 0) - (transient?.startedAt ?? 0)).toBeLessThan(0.1);
  });

  it('detunes each strike a little, so repeated bells are not identical', () => {
    const first = new FakeAudioContext();
    const second = new FakeAudioContext();

    strikeBell(first.asAudioContext(), 0, 'opening', { random: () => 0.1 });
    strikeBell(second.asAudioContext(), 0, 'opening', { random: () => 0.9 });

    const detuneOf = (ctx: FakeAudioContext): number => ctx.oscillators[0]?.detune.value ?? 0;
    expect(detuneOf(first)).not.toBe(detuneOf(second));

    // Only a little: this is a bowl, not a bend.
    expect(Math.abs(detuneOf(first))).toBeLessThan(15);
    expect(Math.abs(detuneOf(second))).toBeLessThan(15);
  });

  it('never schedules a strike in the past', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 5;

    strikeBell(ctx.asAudioContext(), 1, 'interval', { random: fixedRandom });

    expect(ctx.oscillators.every((oscillator) => (oscillator.startedAt ?? 0) >= 5)).toBe(true);
  });

  it('makes nothing at all at zero volume', () => {
    const ctx = new FakeAudioContext();

    strikeBell(ctx.asAudioContext(), 0, 'opening', { volume: 0, random: fixedRandom });

    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.bufferSources).toHaveLength(0);
  });

  it('scales with volume', () => {
    const loud = new FakeAudioContext();
    const quiet = new FakeAudioContext();

    strikeBell(loud.asAudioContext(), 0, 'opening', { random: fixedRandom });
    strikeBell(quiet.asAudioContext(), 0, 'opening', { volume: 0.25, random: fixedRandom });

    const peakOf = (ctx: FakeAudioContext): number => ctx.gains[0]?.gain.automation[1]?.value ?? 0;
    expect(peakOf(quiet)).toBeCloseTo(peakOf(loud) * 0.25, 10);
  });
});

describe('the three bells', () => {
  it('rings the opening bell as three strikes about four seconds apart', () => {
    const ctx = new FakeAudioContext();

    scheduleBell(ctx.asAudioContext(), 0, 'opening', { random: fixedRandom });

    const onsets = ctx.bufferSources.map((source) => source.startedAt);
    expect(onsets).toEqual([0, 4, 8]);
    expect(ctx.oscillators).toHaveLength(15);
  });

  it('rings the interval bell as a single lighter strike, higher than the opening', () => {
    const interval = new FakeAudioContext();
    const opening = new FakeAudioContext();

    scheduleBell(interval.asAudioContext(), 0, 'interval', { random: fixedRandom });
    scheduleBell(opening.asAudioContext(), 0, 'opening', { random: fixedRandom });

    expect(interval.bufferSources).toHaveLength(1);
    expect(interval.oscillators).toHaveLength(5);

    const fundamentalOf = (ctx: FakeAudioContext): number =>
      ctx.oscillators[0]?.frequency.value ?? 0;
    const peakOf = (ctx: FakeAudioContext): number => ctx.gains[0]?.gain.automation[1]?.value ?? 0;

    expect(fundamentalOf(interval)).toBeGreaterThan(fundamentalOf(opening));
    expect(peakOf(interval)).toBeLessThan(peakOf(opening));
  });

  it('rings the closing bell as three strikes with the longest decay', () => {
    const closing = new FakeAudioContext();

    scheduleBell(closing.asAudioContext(), 0, 'closing', { random: fixedRandom });

    expect(closing.bufferSources).toHaveLength(3);
    expect(bellDurationSeconds('closing')).toBeGreaterThan(bellDurationSeconds('opening'));
    expect(bellDurationSeconds('opening')).toBeGreaterThan(bellDurationSeconds('interval'));
  });

  it('schedules every strike relative to the moment it is given', () => {
    const ctx = new FakeAudioContext();

    scheduleBell(ctx.asAudioContext(), 100, 'closing', { random: fixedRandom });

    expect(ctx.bufferSources.map((source) => source.startedAt)).toEqual([100, 104.5, 109]);
  });
});
