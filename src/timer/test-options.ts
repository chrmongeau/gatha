import type { SessionConfig } from './session';

/**
 * Session settings read from the URL, for device testing only.
 *
 * Phase 1 has no Today screen, so there is no way to change the duration from
 * inside the app, and the person testing it on a phone cannot edit the code.
 * This is the stopgap: `?minutes=20&interval=5`.
 *
 * It is a test affordance, not a feature. **Delete it when the Today screen
 * lands in phase 2** — that screen is where duration and interval belong.
 */

/** Guard rails, so a typo cannot produce a session that never ends. */
const MAX_MINUTES = 180;
const MAX_SECONDS = 600;

export interface TestOptions {
  readonly config: SessionConfig;
  /** Whether to show the diagnostic log on the done screen. */
  readonly showDiagnostics: boolean;
  /** True when the URL asked for anything at all, so the UI can say so. */
  readonly overridden: boolean;
}

export function readTestOptions(search: string, defaults: SessionConfig): TestOptions {
  const params = new URLSearchParams(search);

  const minutes = number(params.get('minutes'), 0, MAX_MINUTES);
  const interval = intervalFrom(params.get('interval'));
  const prepare = number(params.get('prepare'), 0, MAX_SECONDS);
  const leadOut = number(params.get('leadout'), 0, MAX_SECONDS);

  const config: SessionConfig = {
    durationMs: minutes === null ? defaults.durationMs : minutes * 60_000,
    intervalMs: interval === undefined ? defaults.intervalMs : interval,
    prepareMs: prepare === null ? defaults.prepareMs : prepare * 1000,
    leadOutMs: leadOut === null ? defaults.leadOutMs : leadOut * 1000,
  };

  return {
    // A zero-length sit is not a sit.
    config: config.durationMs > 0 ? config : defaults,
    showDiagnostics: params.get('diag') === '1',
    overridden: config.durationMs > 0 && !sameConfig(config, defaults),
  };
}

/** `interval=off` switches interval bells off; absent leaves the default alone. */
function intervalFrom(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  if (raw === 'off' || raw === '0') return null;
  const minutes = number(raw, 0, MAX_MINUTES);
  return minutes === null || minutes <= 0 ? null : minutes * 60_000;
}

/** Null for anything that is not a number inside the bounds. */
function number(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function sameConfig(a: SessionConfig, b: SessionConfig): boolean {
  return (
    a.durationMs === b.durationMs &&
    a.intervalMs === b.intervalMs &&
    a.prepareMs === b.prepareMs &&
    a.leadOutMs === b.leadOutMs
  );
}
