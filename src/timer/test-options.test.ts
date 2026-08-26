import { describe, expect, it } from 'vitest';

import { readTestOptions } from './test-options';
import type { SessionConfig } from './session';

const DEFAULTS: SessionConfig = {
  durationMs: 600_000,
  intervalMs: 300_000,
  prepareMs: 10_000,
  leadOutMs: 12_000,
};

const configFrom = (search: string): SessionConfig => readTestOptions(search, DEFAULTS).config;

describe('readTestOptions', () => {
  it('leaves the defaults alone when the URL asks for nothing', () => {
    const options = readTestOptions('', DEFAULTS);

    expect(options.config).toEqual(DEFAULTS);
    expect(options.overridden).toBe(false);
    expect(options.showDiagnostics).toBe(false);
  });

  it('sets the duration and interval for a device test', () => {
    const options = readTestOptions('?minutes=20&interval=5', DEFAULTS);

    expect(options.config.durationMs).toBe(20 * 60_000);
    expect(options.config.intervalMs).toBe(5 * 60_000);
    expect(options.overridden).toBe(true);
  });

  it('switches interval bells off', () => {
    expect(configFrom('?interval=off').intervalMs).toBeNull();
    expect(configFrom('?interval=0').intervalMs).toBeNull();
  });

  it('shortens the preparation delay and the lead-out for a quick check', () => {
    const config = configFrom('?minutes=1&prepare=2&leadout=3');

    expect(config.durationMs).toBe(60_000);
    expect(config.prepareMs).toBe(2_000);
    expect(config.leadOutMs).toBe(3_000);
  });

  it('accepts fractional minutes, so a whole session can be run in seconds', () => {
    expect(configFrom('?minutes=0.5').durationMs).toBe(30_000);
  });

  it('shows the diagnostic log only when asked', () => {
    expect(readTestOptions('?diag=1', DEFAULTS).showDiagnostics).toBe(true);
    expect(readTestOptions('?diag=0', DEFAULTS).showDiagnostics).toBe(false);
    expect(readTestOptions('?diag=yes', DEFAULTS).showDiagnostics).toBe(false);
  });

  it('ignores nonsense rather than building a broken session', () => {
    for (const search of ['?minutes=abc', '?minutes=-5', '?minutes=99999', '?minutes=']) {
      expect(configFrom(search)).toEqual(DEFAULTS);
    }
    expect(configFrom('?prepare=abc').prepareMs).toBe(DEFAULTS.prepareMs);
    expect(configFrom('?interval=abc').intervalMs).toBeNull();
  });

  it('never produces a session of no length', () => {
    expect(configFrom('?minutes=0')).toEqual(DEFAULTS);
  });

  it('does not report an override when the URL restates the defaults', () => {
    expect(readTestOptions('?minutes=10&interval=5', DEFAULTS).overridden).toBe(false);
  });
});
