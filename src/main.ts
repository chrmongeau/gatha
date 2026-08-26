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
import { Diagnostics } from './timer/diagnostics';
import { readTestOptions } from './timer/test-options';
import { createScreenWakeLock } from './timer/wakelock';
import { createSittingView } from './views/sitting';
import { query } from './views/dom';

/**
 * Phase 1 is the timer alone (SPEC.md section 14). Duration and interval are
 * hardcoded here; the Today screen that will set them arrives with the corpus.
 */
const DEFAULT_CONFIG: SessionConfig = {
  durationMs: 10 * 60_000,
  intervalMs: 5 * 60_000,
  prepareMs: 10_000,
  // The closing bell is left its silence before anything is offered.
  leadOutMs: 12_000,
};

// Device testing only, until the Today screen lands. See timer/test-options.ts.
const OPTIONS = readTestOptions(window.location.search, DEFAULT_CONFIG);

/**
 * SCAFFOLDING for phase 1 verification, and nothing more.
 *
 * The person testing this works from a phone with no checkout, so the session
 * length has to be selectable in the app and the log has to be on screen. Query
 * parameters were the first attempt and proved too easy to lose in transit — a
 * stripped URL silently runs the default session, which reads as a broken
 * timer. Buttons cannot be stripped.
 *
 * Setting this to false restores the app the spec describes: one Begin button,
 * ten minutes, no panel. Delete both when the Today screen lands in phase 2.
 */
function scaffoldingEnabled(): boolean {
  return true;
}

const TEST_PRESETS: readonly { readonly label: string; readonly config: SessionConfig }[] = [
  {
    label: '1 min',
    config: { durationMs: 60_000, intervalMs: 30_000, prepareMs: 5_000, leadOutMs: 4_000 },
  },
  {
    label: '3 min',
    config: { durationMs: 180_000, intervalMs: 60_000, prepareMs: 5_000, leadOutMs: 6_000 },
  },
  { label: '10 min', config: DEFAULT_CONFIG },
  {
    label: '20 min',
    config: { durationMs: 1_200_000, intervalMs: 300_000, prepareMs: 10_000, leadOutMs: 12_000 },
  },
];

/** What Begin will start. The URL sets it; a preset button replaces it. */
let activeConfig: SessionConfig = OPTIONS.config;

const showDiagnostics = scaffoldingEnabled() || OPTIONS.showDiagnostics;

const app = query(document, '#app', HTMLElement);
const storage = defaultStorage();

/** The log of the session just finished, kept so the done screen can show it. */
let lastDiagnostics: Diagnostics | null = null;

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
    <p class="shell__note"></p>
    <div class="shell__actions">
      <button type="button" class="shell__begin">Begin</button>
    </div>
  `;

  const actions = query(shell, '.shell__actions', HTMLElement);
  const begin = query(shell, '.shell__begin', HTMLButtonElement);
  const note = query(shell, '.shell__note', HTMLElement);
  note.textContent = describe(activeConfig);

  if (resumable === null) {
    begin.addEventListener('click', () => {
      run(Session.start(activeConfig, systemClock), false);
    });
  } else {
    begin.textContent = 'Resume';
    begin.addEventListener('click', () => {
      run(Session.resume(resumable, systemClock), true);
    });

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'shell__quiet';
    discard.textContent = 'Start again';
    discard.addEventListener('click', () => {
      if (storage !== null) clearActiveSession(storage);
      run(Session.start(activeConfig, systemClock), false);
    });
    actions.append(discard);

    note.textContent = 'A sit is already in progress.';
  }

  if (scaffoldingEnabled() && resumable === null) shell.append(presetPicker(note));

  show(shell, begin);
}

/**
 * SCAFFOLDING. A row of session lengths, so a device test does not depend on a
 * URL surviving the trip to the phone. Goes with the rest of it in phase 2.
 */
function presetPicker(note: HTMLElement): HTMLElement {
  const picker = document.createElement('div');
  picker.className = 'presets';
  picker.innerHTML = `<p class="presets__label">for testing</p>`;

  const row = document.createElement('div');
  row.className = 'presets__row';

  for (const preset of TEST_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'presets__button';
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', String(preset.config === activeConfig));
    button.addEventListener('click', () => {
      activeConfig = preset.config;
      note.textContent = describe(activeConfig);
      for (const other of row.children) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    });
    row.append(button);
  }

  picker.append(row);
  return picker;
}

/**
 * Run a session to its end.
 *
 * Everything here happens inside the tap that started it: the AudioContext, the
 * bell schedule and the wake lock all need the user gesture. After that the
 * loop only ever reads the clock — no ticks are counted, and a frozen main
 * thread costs nothing but the frames it did not draw.
 */
function run(session: Session, resumed: boolean): void {
  const config = session.record.config;
  if (storage !== null) saveActiveSession(session.record, storage);

  const first = session.read();
  const engine = createAudioEngine({
    nowPlaying: { title: 'Sitting', artist: 'Gatha' },
  });
  const wakeLock = createScreenWakeLock();

  const log = new Diagnostics({
    startedAt: session.record.startedAt,
    durationMs: config.durationMs,
    intervalMs: config.intervalMs,
    wakeLockSupported: wakeLock.supported,
    audioSupported: engine !== null,
    userAgent: navigator.userAgent,
  });
  lastDiagnostics = log;
  log.add(first.elapsedMs, resumed ? 'session resumed' : 'session started');

  const scheduled = session.remainingBells(first.elapsedMs);
  engine?.scheduleFrom(scheduled, first.elapsedMs);
  log.add(first.elapsedMs, `${String(scheduled.length)} bells scheduled, audio ${audioState(engine)}`);

  void wakeLock.acquire().then(() => {
    log.add(session.read().elapsedMs, `wake lock ${wakeLock.held ? 'held' : 'NOT held'}`);
  });

  const view = createSittingView({
    config,
    onEnd: () => {
      const at = session.read().elapsedMs;
      log.add(at, 'ended early');
      stop(at, true);
      // Ending early normally just goes back. While testing it must not throw
      // away the log — that is exactly when the log is worth reading.
      if (showDiagnostics) renderDone(false);
      else renderShell(null);
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

    for (const bell of reading.due) log.add(reading.elapsedMs, `bell ${bell.kind} due`);
    for (const bell of reading.skipped) {
      const late = (reading.elapsedMs - bell.offsetMs) / 1000;
      log.add(reading.elapsedMs, `bell ${bell.kind} SKIPPED, ${late.toFixed(1)}s late`);
    }

    if (reading.finished) {
      log.add(reading.elapsedMs, `finished, audio ${audioState(engine)}`);
      stop(reading.elapsedMs, false);
      renderDone(true);
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  function onVisibilityChange(): void {
    const at = session.read().elapsedMs;
    if (document.visibilityState !== 'visible') {
      log.add(at, `hidden, audio ${audioState(engine)}, lock ${wakeLock.held ? 'held' : 'released'}`);
      return;
    }
    log.add(at, `visible, audio ${audioState(engine)}, lock ${wakeLock.held ? 'held' : 'released'}`);
    // Back from a suspension: recompute from the wall clock rather than
    // resuming wherever the frames left off.
    engine?.resume();

    // The audio clock stops while the context is suspended, which would push
    // every pending bell late by the length of the suspension. Re-lay them.
    const drift = engine?.resync(session.remainingBells(at), at) ?? 0;
    if (Math.abs(drift) > 0.25) {
      log.add(at, `audio clock drifted ${drift.toFixed(1)}s, bells re-laid`);
    }

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

function renderDone(completed: boolean): void {
  const done = document.createElement('section');
  done.className = 'shell';
  done.innerHTML = `
    <p class="shell__note"></p>
    <div class="shell__actions">
      <button type="button" class="shell__quiet">Back</button>
    </div>
  `;

  query(done, '.shell__note', HTMLElement).textContent = completed
    ? 'The sit is complete.'
    : 'The sit was ended.';

  const back = query(done, 'button', HTMLButtonElement);
  back.addEventListener('click', () => {
    start();
  });

  if (showDiagnostics && lastDiagnostics !== null) {
    done.append(diagnosticsPanel(lastDiagnostics));
  }

  show(done, back);
}

/** Testing scaffolding: the session's log, on screen, copyable. */
function diagnosticsPanel(log: Diagnostics): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'diagnostics';
  panel.innerHTML = `
    <button type="button" class="shell__quiet diagnostics__copy">Copy log</button>
    <pre class="diagnostics__text"></pre>
  `;

  const text = log.toText();
  query(panel, '.diagnostics__text', HTMLElement).textContent = text;

  const copy = query(panel, '.diagnostics__copy', HTMLButtonElement);
  copy.addEventListener('click', () => {
    // The Clipboard API is typed as always present but is absent outside a
    // secure context, where reaching for it throws rather than returning null.
    try {
      void navigator.clipboard.writeText(text).then(
        () => {
          copy.textContent = 'Copied';
        },
        () => {
          copy.textContent = 'Select the text below';
        },
      );
    } catch {
      copy.textContent = 'Select the text below';
    }
  });

  return panel;
}

function audioState(engine: ReturnType<typeof createAudioEngine>): string {
  return engine === null ? 'unsupported' : engine.state;
}

/** Plain words for whatever session the URL asked for. */
function describe(config: SessionConfig): string {
  const interval =
    config.intervalMs === null
      ? 'A bell at the start and at the end.'
      : `A bell at the start, every ${minutes(config.intervalMs)}, and at the end.`;
  return `${capitalise(minutes(config.durationMs))}. ${interval}`;
}

/** Whole minutes where it divides, seconds where it does not. */
function minutes(ms: number): string {
  if (ms < 60_000 || ms % 60_000 !== 0) {
    const seconds = Math.round(ms / 1000);
    return `${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  const value = ms / 60_000;
  return `${String(value)} ${value === 1 ? 'minute' : 'minutes'}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
