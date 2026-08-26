import { describe, expect, it } from 'vitest';

import { createScreenWakeLock } from './wakelock';

class FakeSentinel {
  released = false;

  release(): Promise<void> {
    this.released = true;
    return Promise.resolve();
  }
}

class FakeEnvironment {
  visibilityState = 'visible';
  requests = 0;
  readonly sentinels: FakeSentinel[] = [];
  private readonly listeners = new Set<() => void>();
  private failNext = false;

  readonly navigator = {
    wakeLock: {
      request: (type: 'screen'): Promise<FakeSentinel> => {
        expect(type).toBe('screen');
        this.requests += 1;
        if (this.failNext) {
          this.failNext = false;
          return Promise.reject(new Error('denied'));
        }
        const sentinel = new FakeSentinel();
        this.sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      },
    },
  };

  readonly document = {
    visibilityState: 'visible',
    addEventListener: (_type: 'visibilitychange', listener: () => void): void => {
      this.listeners.add(listener);
    },
    removeEventListener: (_type: 'visibilitychange', listener: () => void): void => {
      this.listeners.delete(listener);
    },
  };

  get listenerCount(): number {
    return this.listeners.size;
  }

  denyNext(): void {
    this.failNext = true;
  }

  setVisibility(state: 'visible' | 'hidden'): void {
    this.document.visibilityState = state;
    // The browser drops a held lock of its own accord when the page is hidden.
    if (state === 'hidden') {
      for (const sentinel of this.sentinels) sentinel.released = true;
    }
    for (const listener of [...this.listeners]) listener();
  }
}

describe('createScreenWakeLock', () => {
  it('holds the lock while a session runs', async () => {
    const environment = new FakeEnvironment();
    const lock = createScreenWakeLock(environment);

    expect(lock.supported).toBe(true);
    expect(lock.held).toBe(false);

    await lock.acquire();
    expect(lock.held).toBe(true);
    expect(environment.requests).toBe(1);

    await lock.release();
    expect(lock.held).toBe(false);
    expect(environment.sentinels[0]?.released).toBe(true);
  });

  it('re-takes the lock when the page comes back into view', async () => {
    const environment = new FakeEnvironment();
    const lock = createScreenWakeLock(environment);
    await lock.acquire();

    environment.setVisibility('hidden');
    expect(lock.held).toBe(false);

    environment.setVisibility('visible');
    await Promise.resolve();

    expect(environment.requests).toBe(2);
    expect(lock.held).toBe(true);
  });

  it('stops re-taking the lock once released', async () => {
    const environment = new FakeEnvironment();
    const lock = createScreenWakeLock(environment);

    await lock.acquire();
    await lock.release();
    expect(environment.listenerCount).toBe(0);

    environment.setVisibility('hidden');
    environment.setVisibility('visible');
    await Promise.resolve();

    expect(environment.requests).toBe(1);
    expect(lock.held).toBe(false);
  });

  it('carries on when the platform refuses the lock', async () => {
    const environment = new FakeEnvironment();
    const lock = createScreenWakeLock(environment);
    environment.denyNext();

    await expect(lock.acquire()).resolves.toBeUndefined();
    expect(lock.held).toBe(false);

    // And it tries again the next time the page is shown.
    environment.setVisibility('hidden');
    environment.setVisibility('visible');
    await Promise.resolve();
    expect(lock.held).toBe(true);
  });

  it('degrades quietly where there is no Wake Lock API', async () => {
    const environment = new FakeEnvironment();
    const lock = createScreenWakeLock({
      navigator: {},
      document: environment.document,
    });

    expect(lock.supported).toBe(false);
    await expect(lock.acquire()).resolves.toBeUndefined();
    expect(lock.held).toBe(false);
    expect(environment.listenerCount).toBe(0);
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
