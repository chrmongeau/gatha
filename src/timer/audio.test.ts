import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAudioEngine } from './audio';
import { FakeAudioContext, FakeGain } from './fake-audio-context';
import type { ScheduledBell } from './session';

const BELLS: ScheduledBell[] = [
  { kind: 'opening', offsetMs: 10_000 },
  { kind: 'interval', offsetMs: 310_000 },
  { kind: 'closing', offsetMs: 610_000 },
];

const made: FakeAudioContext[] = [];

/** The engine reaches for a global AudioContext; hand it a fake one. */
function installFakeAudio(): void {
  const Constructor = function (): FakeAudioContext {
    const fake = new FakeAudioContext();
    made.push(fake);
    return fake;
  } as unknown as new () => AudioContext;
  (globalThis as { AudioContext?: new () => AudioContext }).AudioContext = Constructor;
}

const context = (): FakeAudioContext => {
  const ctx = made[0];
  if (ctx === undefined) throw new Error('no context was created');
  return ctx;
};

/** Onsets of every strike scheduled so far, in creation order. */
const onsets = (): number[] => context().bufferSources.map((source) => source.startedAt ?? -1);

beforeEach(() => {
  made.length = 0;
  installFakeAudio();
});

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe('createAudioEngine', () => {
  it('lays the whole schedule down at once, against the audio clock', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);

    // Three strikes, one, and three.
    expect(onsets()).toEqual([10, 14, 18, 310, 610, 614.5, 619]);
  });

  it('holds the tab above the level a browser calls silent', () => {
    createAudioEngine();

    // Chrome freezes a hidden tab it considers silent, taking every scheduled
    // bell with it. Its threshold sits near -72 dBFS.
    // gains[0] is the master; gains[1] is the keepalive's own level.
    const [keepAlive] = context().oscillators;
    const level = context().gains[1]?.gain.value ?? 0;
    const dbfs = 20 * Math.log10(level);

    expect(keepAlive?.startedAt).toBe(0);
    expect(keepAlive?.stoppedAt).toBeNull();
    expect(dbfs).toBeGreaterThan(-72);
  });

  it('keeps the tab alive at a pitch nothing can reproduce or hear', () => {
    createAudioEngine();

    expect(context().oscillators[0]?.frequency.value).toBeLessThan(40);
  });

  it('picks up mid-session without ringing the bells already behind it', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom([BELLS[1], BELLS[2]] as ScheduledBell[], 310_000);

    // Anchored so the interval bell is now, and the closing bell 300s out.
    expect(onsets()).toEqual([0, 300, 304.5, 309]);
  });

  it('reports how far the audio clock has drifted', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);

    // Five minutes of wall time pass; the audio clock advanced two seconds.
    context().currentTime = 2;
    const drift = engine?.resync([BELLS[2]] as ScheduledBell[], 300_000);

    expect(drift).toBeCloseTo(-298, 6);
  });

  it('re-lays the pending bells against the wall clock after a suspension', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);
    const before = onsets().length;

    context().currentTime = 12;
    engine?.resync([BELLS[1], BELLS[2]] as ScheduledBell[], 300_000);

    // The closing bell would have rung at 610 on the stalled clock. It is now
    // laid at 322, which is ten seconds of real time away, as it should be.
    expect(onsets().slice(before)).toEqual([22, 322, 326.5, 331]);
  });

  it('silences the bells it re-lays, so none of them rings twice', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);

    context().currentTime = 12;
    engine?.resync([BELLS[1], BELLS[2]] as ScheduledBell[], 300_000);

    const cancelled = context().gains.filter((gain: FakeGain) => gain.disconnected);
    expect(cancelled).toHaveLength(2);
  });

  it('leaves a bell that is already ringing alone', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);

    // Mid-way through the opening peal.
    context().currentTime = 12;
    engine?.resync([BELLS[1], BELLS[2]] as ScheduledBell[], 300_000);

    // The opening bell's strikes at 14 and 18 are still scheduled and audible.
    expect(onsets()).toContain(14);
    expect(onsets()).toContain(18);
  });

  it('reports no drift and does nothing once closed', () => {
    const engine = createAudioEngine();
    engine?.scheduleFrom(BELLS, 0);
    const before = onsets().length;

    engine?.close();

    expect(engine?.state).toBe('closed');
    expect(engine?.resync(BELLS, 0)).toBe(0);
    expect(onsets()).toHaveLength(before);
  });

  it('degrades to silence where there is no Web Audio', () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;

    expect(createAudioEngine()).toBeNull();
  });
});
