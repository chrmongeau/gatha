/**
 * Just enough of the Web Audio API to record what a bell asks for.
 *
 * A real AudioContext cannot be run in a unit test, but the shape of a strike —
 * how many partials, at what ratios, with what envelope — is exactly the part
 * worth pinning down, and it is all expressed in these calls.
 */

export interface Automation {
  readonly kind: 'set' | 'linear' | 'exponential';
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  value = 0;
  readonly automation: Automation[] = [];

  setValueAtTime(value: number, time: number): this {
    this.automation.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.automation.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.automation.push({ kind: 'exponential', value, time });
    return this;
  }
}

class FakeNode {
  readonly connections: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export { FakeNode };

export class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  /** `when` is optional in the real API and defaults to immediately. */
  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
  disconnected = false;

  override disconnect(): void {
    this.disconnected = true;
    super.disconnect();
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

export class FakeBuffer {
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

export class FakeAudioContext {
  readonly sampleRate = 48_000;
  currentTime = 0;
  readonly destination = new FakeNode();

  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly filters: FakeFilter[] = [];

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  state = 'running';

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** The fake stands in for a BaseAudioContext at the call site. */
  asAudioContext(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }

  /** And for a full AudioContext, where the engine needs one. */
  asFullContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
