import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/sitting.css';

import { dayNumber, passageForDay, rerollFrom } from './corpus/daily';
import { loadCorpus, loadDiscourse, type Corpus, type Passage } from './corpus/load';
import { Views, type Screen } from './state';
import { createAudioEngine, createBellPreview } from './timer/audio';
import { bellDurationSeconds } from './timer/bell';
import { systemClock } from './timer/clock';
import {
  clearActiveSession,
  defaultStorage,
  loadActiveSession,
  saveActiveSession,
} from './timer/active-session';
import { loadPreferences, savePreferences } from './timer/preferences';
import { Diagnostics } from './timer/diagnostics';
import { Session, endsAt, type SessionConfig, type SessionRecord } from './timer/session';
import { createScreenWakeLock } from './timer/wakelock';
import { createAfterView } from './views/after';
import { createDiscourseView } from './views/discourse';
import { createSittingView } from './views/sitting';
import { createTodayView, type TodayView } from './views/today';
import { query } from './views/dom';

/**
 * SCAFFOLDING, kept on while the timer is still being verified on devices: a
 * bell preview and the diagnostic log of the last session. Neither is a feature.
 * Both come out once the timer is trusted.
 */
function scaffoldingEnabled(): boolean {
  return true;
}

const storage = defaultStorage();
const views = new Views(query(document, '#app', HTMLElement));

let corpus: Corpus | null = null;
let config: SessionConfig = loadPreferences(storage);
/** The day's passage, or whatever a re-roll has landed on since. */
let passageUid: string | null = null;
let lastDiagnostics: Diagnostics | null = null;

void boot();

async function boot(): Promise<void> {
  const settled = pending();
  try {
    corpus = await loadCorpus();
  } catch {
    settled();
    views.show(
      message(
        'The passages could not be loaded. They are stored with the app, so this is usually a connection that dropped mid-download.',
      ),
    );
    return;
  }
  settled();
  passageUid = passageForDay(corpus.order, dayNumber(new Date()));
  showToday();
}

/**
 * Announce a wait only if there is one. The corpus is served alongside the app
 * and usually arrives in a few milliseconds; flashing a placeholder and then
 * cross-fading for two seconds makes a fast load look slow.
 */
function pending(): () => void {
  const timer = window.setTimeout(() => {
    views.show(message('…'));
  }, 400);
  return () => {
    clearTimeout(timer);
  };
}

function currentPassage(): Passage | null {
  if (corpus === null || passageUid === null) return null;
  return corpus.passages.get(passageUid) ?? null;
}

let today: TodayView | null = null;

function showToday(): void {
  const passage = currentPassage();
  if (passage === null) {
    views.show(message('No passage for today.'));
    return;
  }

  const resumable = findResumableSession();
  const view = createTodayView({
    passage,
    config,
    onBegin: (chosen) => {
      config = chosen;
      savePreferences(config, storage);
      run(Session.start(config, systemClock), false);
    },
    onReroll: () => {
      if (corpus === null || passageUid === null) return;
      passageUid = rerollFrom(corpus.order, passageUid);
      const next = currentPassage();
      if (next !== null) today?.showPassage(next);
    },
    onRead: () => {
      // Read at click time, not captured: a re-roll changes the passage in
      // place, and this must open the one on screen rather than the one that
      // was on screen when the screen was built.
      const showing = currentPassage();
      if (showing !== null) void showDiscourse(showing, showToday);
    },
    ...(scaffoldingEnabled() ? { extras: scaffolding() } : {}),
  });

  if (resumable !== null) view.element.prepend(resumeBanner(resumable));
  today = view;
  views.show(view, view.element.querySelector<HTMLElement>('[data-role="begin"]'));
}

/** A stored session is only worth offering while it is still running. */
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

function resumeBanner(record: SessionRecord): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'resume';
  banner.innerHTML = `
    <p class="resume__text">A sit is already in progress.</p>
    <button type="button" class="action action--quiet" data-role="resume">Resume it</button>
  `;
  query(banner, '[data-role="resume"]', HTMLButtonElement).addEventListener('click', () => {
    run(Session.resume(record, systemClock), true);
  });
  return banner;
}

async function showDiscourse(passage: Passage, back: () => void): Promise<void> {
  const settled = pending();
  try {
    const discourse = await loadDiscourse(passage.parentUid);
    settled();
    const view = createDiscourseView({ discourse, onBack: back });
    views.show(view, view.element.querySelector<HTMLElement>('[data-role="back"]'));
  } catch {
    settled();
    views.show(message('That discourse could not be loaded.'));
  }
}

function showAfter(passage: Passage): void {
  const view = createAfterView({
    passage,
    onRead: () => {
      void showDiscourse(passage, () => {
        showAfter(passage);
      });
    },
    onDone: showToday,
  });
  views.show(view, view.element.querySelector<HTMLElement>('[data-role="read"]'));
}

/**
 * Run a session to its end.
 *
 * Everything here happens inside the tap that started it: the AudioContext, the
 * bell schedule and the wake lock all need the user gesture. After that the loop
 * only ever reads the clock.
 */
function run(session: Session, resumed: boolean): void {
  const sessionConfig = session.record.config;
  if (storage !== null) saveActiveSession(session.record, storage);

  const first = session.read();
  const passage = currentPassage();
  const wakeLock = createScreenWakeLock();

  const log = new Diagnostics({
    startedAt: session.record.startedAt,
    durationMs: sessionConfig.durationMs,
    intervalMs: sessionConfig.intervalMs,
    wakeLockSupported: wakeLock.supported,
    audioSupported: true,
    userAgent: navigator.userAgent,
  });
  lastDiagnostics = log;
  log.add(first.elapsedMs, resumed ? 'session resumed' : 'session started');

  const endEarly = (): void => {
    const at = session.elapsedMs;
    log.add(at, 'ended early');
    stop(at, true);
    showToday();
  };

  const engine = createAudioEngine({
    nowPlaying: { title: passage?.reference ?? 'Sitting', artist: 'Gatha' },
    onStop: endEarly,
  });

  const scheduled = session.remainingBells(first.elapsedMs);
  engine?.scheduleFrom(scheduled, first.elapsedMs);
  log.add(first.elapsedMs, `${String(scheduled.length)} bells scheduled, audio ${audioState(engine)}`);

  void wakeLock.acquire().then(() => {
    log.add(session.elapsedMs, `wake lock ${wakeLock.held ? 'held' : 'NOT held'}`);
  });

  const view = createSittingView({ config: sessionConfig, onEnd: endEarly });

  let frame = 0;
  let running = true;

  const resyncAudio = (reason: string): void => {
    if (!running || engine === null) return;
    const at = session.elapsedMs;
    engine.resume();
    const drift = engine.resync(session.remainingBells(at), at);
    log.add(at, `resync on ${reason}: audio ${engine.state}, drift ${drift.toFixed(1)}s`);
  };

  const heartbeat = window.setInterval(() => {
    const at = systemClock.wall() - session.record.startedAt;
    log.add(
      at,
      `heartbeat (wall), audio ${audioState(engine)}, lock ${wakeLock.held ? 'held' : 'released'}, page ${document.visibilityState}`,
    );
    if (engine !== null && engine.state !== 'running') resyncAudio('heartbeat');
  }, 30_000);

  const onFreeze = (): void => {
    log.add(systemClock.wall() - session.record.startedAt, 'page FROZEN by the browser');
  };
  const onResume = (): void => {
    log.add(systemClock.wall() - session.record.startedAt, 'page thawed');
    resyncAudio('thaw');
    cancelAnimationFrame(frame);
    tick();
  };

  const stop = (elapsedMs: number, immediate: boolean): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    void wakeLock.release();
    if (storage !== null) clearActiveSession(storage);
    closeAudio(engine, sessionConfig, elapsedMs, immediate);
  };

  const tick = (): void => {
    if (!running) return;
    const reading = session.read();
    view.update(reading);

    for (const bell of reading.due) log.add(reading.elapsedMs, `bell ${bell.kind} due`);
    for (const bell of reading.skipped) {
      const late = (reading.elapsedMs - bell.offsetMs) / 1000;
      log.add(
        reading.elapsedMs,
        `bell ${bell.kind} not marked live, ${late.toFixed(1)}s late (audio was scheduled ahead)`,
      );
    }

    if (reading.finished) {
      log.add(reading.elapsedMs, `finished, audio ${audioState(engine)}`);
      stop(reading.elapsedMs, false);
      if (passage !== null) showAfter(passage);
      else showToday();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  function onVisibilityChange(): void {
    const at = session.elapsedMs;
    if (document.visibilityState !== 'visible') {
      log.add(at, `hidden, audio ${audioState(engine)}, lock ${wakeLock.held ? 'held' : 'released'}`);
      return;
    }
    log.add(at, `visible, audio ${audioState(engine)}, lock ${wakeLock.held ? 'held' : 'released'}`);
    resyncAudio('visible');
    cancelAnimationFrame(frame);
    tick();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);

  views.show(view, view.element);
  view.update(first);
  frame = requestAnimationFrame(tick);
}

/**
 * Let the closing bell finish ringing after the screen has moved on — its decay
 * outlasts the silence held for it. An ended session cuts it off instead.
 */
function closeAudio(
  engine: ReturnType<typeof createAudioEngine>,
  sessionConfig: SessionConfig,
  elapsedMs: number,
  immediate: boolean,
): void {
  if (engine === null) return;
  if (immediate) {
    engine.close();
    return;
  }
  const closingMs = sessionConfig.prepareMs + sessionConfig.durationMs;
  const tailMs = closingMs + bellDurationSeconds('closing') * 1000 - elapsedMs;
  if (tailMs <= 0) {
    engine.close();
    return;
  }
  setTimeout(() => {
    engine.close();
  }, tailMs);
}

function audioState(engine: ReturnType<typeof createAudioEngine>): string {
  return engine === null ? 'unsupported' : engine.state;
}

function message(text: string): Screen {
  const element = document.createElement('section');
  element.className = 'screen screen--message';
  const paragraph = document.createElement('p');
  paragraph.className = 'message';
  paragraph.textContent = text;
  element.append(paragraph);
  return {
    element,
    destroy(): void {
      element.remove();
    },
  };
}

/** SCAFFOLDING. The bell preview, and the log of the session just finished. */
function scaffolding(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'scaffold';
  panel.innerHTML = `<p class="scaffold__label">for testing</p><div class="scaffold__row"></div>`;

  const row = query(panel, '.scaffold__row', HTMLElement);
  const ring = createBellPreview();
  for (const kind of ['opening', 'interval', 'closing'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice__button';
    button.textContent = kind;
    button.disabled = ring === null;
    button.addEventListener('click', () => {
      ring?.(kind);
    });
    row.append(button);
  }

  const log = lastDiagnostics;
  if (log !== null) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'choice__button';
    copy.textContent = 'Copy last log';
    const text = log.toText();
    copy.addEventListener('click', () => {
      try {
        void navigator.clipboard.writeText(text).then(
          () => {
            copy.textContent = 'Copied';
          },
          () => {
            copy.textContent = 'Copy failed';
          },
        );
      } catch {
        copy.textContent = 'Copy failed';
      }
    });
    row.append(copy);

    const pre = document.createElement('pre');
    pre.className = 'scaffold__text';
    pre.textContent = text;
    panel.append(pre);
  }

  return panel;
}
