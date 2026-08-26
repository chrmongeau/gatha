import { describe, expect, it } from 'vitest';

import { Diagnostics, type DiagnosticsHeader } from './diagnostics';

const HEADER: DiagnosticsHeader = {
  startedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  durationMs: 600_000,
  intervalMs: 300_000,
  wakeLockSupported: true,
  audioSupported: true,
  userAgent: 'test agent',
};

describe('Diagnostics', () => {
  it('renders a header and a stamped line per entry', () => {
    const log = new Diagnostics(HEADER);

    log.add(0, 'session started');
    log.add(10_100, 'bell opening due');
    log.add(305_400, 'bell interval skipped, 5.4s late');

    const text = log.toText();
    expect(text).toContain('started    2026-01-02T03:04:05.000Z');
    expect(text).toContain('duration   10m');
    expect(text).toContain('interval   5m');
    expect(text).toContain('wake lock  supported');
    expect(text).toContain('00:00.0  session started');
    expect(text).toContain('00:10.1  bell opening due');
    expect(text).toContain('05:05.4  bell interval skipped, 5.4s late');
  });

  it('calls out a missing API loudly, since that is the likely cause', () => {
    const text = new Diagnostics({
      ...HEADER,
      wakeLockSupported: false,
      audioSupported: false,
    }).toText();

    expect(text).toContain('wake lock  NOT SUPPORTED');
    expect(text).toContain('web audio  NOT SUPPORTED');
  });

  it('says interval bells are off rather than showing a zero', () => {
    expect(new Diagnostics({ ...HEADER, intervalMs: null }).toText()).toContain('interval   off');
  });

  it('stops growing, and says how much it dropped', () => {
    const log = new Diagnostics(HEADER);
    for (let i = 0; i < 400; i += 1) log.add(i, `entry ${String(i)}`);

    expect(log.length).toBe(300);
    expect(log.toText()).toContain('100 further entries dropped');
  });
});
