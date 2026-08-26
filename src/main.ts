import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/sitting.css';

import { createAudioEngine } from './timer/audio';
import { bellDurationSeconds } from './timer/bell';
import { systemClock } from './timer/clock';
import {
  clearActiveSession,
  defaultStorage,
  loadActiveSession,
  saveActiveSession,
} from './timer/active-session';
import { Session, endsAt, type SessionConfig, type SessionRecord } from './timer/session';
import { createScreenWakeLock } from './timer/wakelock';
import { createSittingView } from './views/sitting';
import { query } from './views/dom';

/**
 * Phase 1 is the timer alone (SPEC.md section 14). Duration and interval are
 * hardcoded here; the Today screen that will set them arrives with the corpus.
 */
const CONFIG: SessionConfig = {
  durationMs: 10 * 60_000,
  intervalMs: 5 * 60_000,
  prepareMs: 10_000,
  // The closing bell is left its silence before anything is offered.
  leadOutMs: 12_000,
};

const app = query(document, '#app', HTMLElement);
const storage = defaultStorage();

start();

function start(): void {
  const resumable = findResumableSession();
  renderShell(resumable);
}

/** A stored session is only worth offering if it is still running. */
function findResumableSession(): SessionRecord | null {
  if (storage === null) return null;
  const record = loadActiveSession(storage);
  if (record === null) return null;
  if (endsAt(record) <= systemClock.wall()) {
    clearActiveSession(storage);
    return null;
  }
  return record;
}

function renderShell(resumable: SessionRecord | null): void {
  const shell = document.createElement('section');
  shell.className = 'shell';
  shell.innerHTML = `
    <h1 class="shell__title">gatha</h1>
    <p class="shell__note">Ten minutes. A bell at the start, at five, and at the end.</p>
    <div class="shell__actions">
      <button type="button" class="shell__begin">Begin</button>
    </div>
  `;

  const actions = query(shell, '.shell__actions', HTMLElement);
  const begin = query(shell, '.shell__begin', HTMLButtonElement);

  if (resumable === null) {
    begin.addEventListener('click', () => {
      run(Session.start(CONFIG, systemClock));
    });
  } else {
    begin.textContent = 'Resume';
    begin.addEventListener('click', () => {
      run(Session.resume(resumable, systemClock));
    });

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'shell__quiet';
    discard.textContent = 'Start again';
    discard.addEventListener('click', () => {
      if (storage !== null) clearActiveSession(storage);
      run(Session.start(CONFIG, systemClock));
    });
    actions.append(discard);

    query(shell, '.shell__note', HTMLElement).textContent = 'A sit is already in progress.';
  }

  show(shell, begin);
}

/**
 * Run a session to its end.
 *
 * Everything here happens inside the tap that started it: the AudioContext, the
 * bell schedule and the wake lock all need the user gesture. After that the
 * loop only ever reads the clock — no ticks are counted, and a frozen main
 * thread costs nothing but the frames it did not draw.
 */
function run(session: Session): void {
  const config = session.record.config;
  if (storage !== null) saveActiveSession(session.record, storage);

  const first = session.read();
  const engine = createAudioEngine({
    nowPlaying: { title: 'Sitting', artist: 'Gatha' },
  });
  engine?.scheduleFrom(session.remainingBells(first.elapsedMs), first.elapsedMs);

  const wakeLock = createScreenWakeLock();
  void wakeLock.acquire();

  const view = createSittingView({
    config,
    onEnd: () => {
      stop(session.read().elapsedMs, true);
      renderShell(null);
    },
  });

  let frame = 0;
  let running = true;

  const stop = (elapsedMs: number, immediate: boolean): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    view.destroy();
    void wakeLock.release();
    if (storage !== null) clearActiveSession(storage);
    closeAudio(engine, config, elapsedMs, immediate);
  };

  const tick = (): void => {
    if (!running) return;
    const reading = session.read();
    view.update(reading);
    if (reading.finished) {
      stop(reading.elapsedMs, false);
      renderDone();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return;
    // Back from a suspension: recompute from the wall clock rather than
    // resuming wherever the frames left off.
    engine?.resume();
    cancelAnimationFrame(frame);
    tick();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  show(view.element, view.element);
  view.update(first);
  frame = requestAnimationFrame(tick);
}

/**
 * Let the closing bell finish ringing after the screen has moved on — its decay
 * outlasts the silence held for it. An ended session cuts it off instead.
 */
function closeAudio(
  engine: ReturnType<typeof createAudioEngine>,
  config: SessionConfig,
  elapsedMs: number,
  immediate: boolean,
): void {
  if (engine === null) return;
  if (immediate) {
    engine.close();
    return;
  }

  const closingMs = config.prepareMs + config.durationMs;
  const tailMs = closingMs + bellDurationSeconds('closing') * 1000 - elapsedMs;
  if (tailMs <= 0) {
    engine.close();
    return;
  }
  setTimeout(() => {
    engine.close();
  }, tailMs);
}

function renderDone(): void {
  const done = document.createElement('section');
  done.className = 'shell';
  done.innerHTML = `
    <p class="shell__note">The sit is complete.</p>
    <div class="shell__actions">
      <button type="button" class="shell__quiet">Back</button>
    </div>
  `;

  const back = query(done, 'button', HTMLButtonElement);
  back.addEventListener('click', () => {
    start();
  });

  show(done, back);
}

/**
 * Swap the visible view. Every view after the first fades in and takes focus;
 * the first paint does neither — a cold load should not open on a blank screen
 * with a focus ring already drawn on it.
 */
function show(view: HTMLElement, focusTarget?: HTMLElement): void {
  const isTransition = app.childElementCount > 0;
  if (isTransition) view.classList.add('is-entering');
  app.replaceChildren(view);
  if (isTransition) focusTarget?.focus();
}
