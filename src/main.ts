import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/sitting.css';

import { passageForDay, rerollFrom } from './corpus/daily';
import { loadCorpus, loadDiscourse, type Corpus, type Passage } from './corpus/load';
import { Views, type Screen } from './state';
import { applyTheme, loadPreference, savePreference, watchSystemTheme, type ThemePreference } from './theme';
import { dayNumber } from './day';
import { counts, hasSatOn } from './history/metrics';
import {
  addSession,
  anchorAsked,
  exportBackup,
  importBackup,
  loadAnchor,
  loadSessions,
  markAnchorAsked,
  saveAnchor,
  type SessionRecord as LoggedSession,
} from './history/store';
import { createMethodView } from './views/method';
import { createPracticeView, reportResult } from './views/practice';
import { createAudioEngine } from './timer/audio';
import { bellDurationSeconds } from './timer/bell';
import { systemClock } from './timer/clock';
import { clearActiveSession, loadActiveSession, saveActiveSession } from './timer/active-session';
import { defaultStorage } from './storage';
import { loadPreferences, savePreferences } from './timer/preferences';
import { Session, endsAt, type SessionConfig, type SessionRecord } from './timer/session';
import { createScreenWakeLock } from './timer/wakelock';
import { createAfterView } from './views/after';
import { createDiscourseView } from './views/discourse';
import { createSittingView } from './views/sitting';
import { createTodayView, type TodayView } from './views/today';
import { registerServiceWorker } from './pwa';
import { query } from './views/dom';

const storage = defaultStorage();
const views = new Views(query(document, '#app', HTMLElement));

/*
 * Offline is the expected case, not an edge case: someone sits at six in the
 * morning on airplane mode (SPEC.md §10). Registered here and asked for its
 * opinion only when the app is idle — see applyUpdateWhenIdle below.
 */
const serviceWorker = registerServiceWorker(import.meta.env.BASE_URL);

/** True from the opening bell to the closing one. Nothing reloads while it is. */
let sitting = false;
/** True while Today is the visible screen: the one screen a reload costs nothing. */
let onToday = false;

/**
 * Swap the screen, and remember whether it was Today.
 *
 * Views itself is deliberately ignorant of which screen is which; this is the
 * one caller that needs to know, so the knowledge lives here rather than there.
 */
function present(screen: Screen, focus?: HTMLElement | null, isToday = false): void {
  onToday = isToday;
  views.show(screen, focus);
}

/**
 * Hand over to a waiting service worker, but only on Today, only between sits,
 * and only when the app has just come back into view — so the reload happens
 * where nothing is lost and nobody is looking (SPEC.md §10). Otherwise it waits,
 * which is the default behaviour and costs nothing: the new version takes over
 * the next time the app is opened from cold.
 */
function applyUpdateWhenIdle(): void {
  if (document.visibilityState !== 'visible') return;
  if (sitting || !onToday) return;
  if (serviceWorker.updateReady()) serviceWorker.applyUpdate();
}

document.addEventListener('visibilitychange', applyUpdateWhenIdle);

let corpus: Corpus | null = null;
let config: SessionConfig = loadPreferences(storage);
/** The day's passage, or whatever a re-roll has landed on since. */
let passageUid: string | null = null;
let sessions: LoggedSession[] = loadSessions(storage);
let anchor: string | null = loadAnchor(storage);
let theme: ThemePreference = loadPreference(storage);

applyTheme(theme);
watchSystemTheme(() => theme);

void boot();

async function boot(): Promise<void> {
  const settled = pending();
  try {
    corpus = await loadCorpus();
  } catch {
    settled();
    present(
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
    present(message('…'));
  }, 400);
  return () => {
    clearTimeout(timer);
  };
}

/** The one answer to "I'll sit after ___", however the screen asked for it. */
function setAnchor(answer: string | null): void {
  anchor = answer;
  saveAnchor(answer, storage);
  markAnchorAsked(storage);
}

function currentPassage(): Passage | null {
  if (corpus === null || passageUid === null) return null;
  return corpus.passages.get(passageUid) ?? null;
}

function showToday(): void {
  const passage = currentPassage();
  if (passage === null) {
    present(message('No passage for today.'));
    return;
  }

  const resumable = findResumableSession();
  // Held by the re-roll callback, which is built before the view it swaps the
  // passage on. Scoped to this screen, so the last one is not kept after the
  // app has moved on somewhere else.
  let view: TodayView | null = null;
  view = createTodayView({
    passage,
    config,
    satToday: hasSatOn(sessions, dayNumber(new Date())),
    anchor,
    askAnchor: !anchorAsked(storage),
    onAnchorAnswer: setAnchor,
    onBegin: (chosen) => {
      config = chosen;
      savePreferences(config, storage);
      run(Session.start(config, systemClock));
    },
    onReroll: () => {
      if (corpus === null || passageUid === null) return;
      passageUid = rerollFrom(corpus.order, passageUid);
      const next = currentPassage();
      if (next !== null) view?.showPassage(next);
    },
    onRead: () => {
      // Read at click time, not captured: a re-roll changes the passage in
      // place, and this must open the one on screen rather than the one that
      // was on screen when the screen was built.
      const showing = currentPassage();
      if (showing !== null) void showDiscourse(showing, showToday);
    },
    onPractice: showPractice,
  });

  if (resumable !== null) view.element.prepend(resumeBanner(resumable));
  present(view, view.element.querySelector<HTMLElement>('[data-role="begin"]'), true);
}

/** A stored session is only worth offering while it is still running. */
function findResumableSession(): SessionRecord | null {
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
    run(Session.resume(record, systemClock));
  });
  return banner;
}

async function showDiscourse(passage: Passage, back: () => void): Promise<void> {
  const settled = pending();
  try {
    const discourse = await loadDiscourse(passage.parentUid);
    settled();
    const view = createDiscourseView({ discourse, onBack: back });
    present(view, view.element.querySelector<HTMLElement>('[data-role="back"]'));
  } catch {
    settled();
    present(message('That discourse could not be loaded.'));
  }
}

function showPractice(): void {
  const view = createPracticeView({
    sessions,
    today: dayNumber(new Date()),
    anchor,
    onAnchorChange: setAnchor,
    onExport: () => {
      downloadBackup();
      reportResult(view, 'Saved.');
    },
    onImport: (file) => {
      void file.text().then(
        (text) => {
          try {
            const result = importBackup(text, storage);
            sessions = loadSessions(storage);
            anchor = loadAnchor(storage);
            reportResult(
              view,
              `Added ${String(result.added)}, already had ${String(result.alreadyHad)}.`,
            );
          } catch (error) {
            reportResult(view, error instanceof Error ? error.message : 'That file could not be read.');
          }
        },
        () => {
          reportResult(view, 'That file could not be read.');
        },
      );
    },
    theme,
    onThemeChange: (preference) => {
      theme = preference;
      savePreference(preference, storage);
      applyTheme(preference);
    },
    onMethod: showMethod,
    onBack: showToday,
  });
  present(view, view.element.querySelector<HTMLElement>('[data-role="back"]'));
}

function showMethod(): void {
  const view = createMethodView({ onBack: showPractice });
  present(view, view.element.querySelector<HTMLElement>('[data-role="back"]'));
}

/** The only way a practice survives a cleared cache, so it is a plain file. */
function downloadBackup(): void {
  const now = new Date();
  const blob = new Blob([exportBackup(storage, now)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gatha-${now.toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function showAfter(passage: Passage, recorded: boolean): void {
  const view = createAfterView({
    passage,
    recorded,
    onRead: () => {
      void showDiscourse(passage, () => {
        showAfter(passage, recorded);
      });
    },
    onDone: showToday,
  });
  present(view, view.element.querySelector<HTMLElement>('[data-role="read"]'));
}

/**
 * Run a session to its end.
 *
 * Everything here happens inside the tap that started it: the AudioContext, the
 * bell schedule and the wake lock all need the user gesture. After that the loop
 * only ever reads the clock.
 */
function run(session: Session): void {
  const sessionConfig = session.record.config;
  sitting = true;
  saveActiveSession(session.record, storage);

  const first = session.read();
  const passage = currentPassage();
  const wakeLock = createScreenWakeLock();

  const endEarly = (): void => {
    const at = session.elapsedMs;
    stop(at, true);
    record(session, at);
    showToday();
  };

  const engine = createAudioEngine({
    nowPlaying: { title: passage?.reference ?? 'Sitting', artist: 'Gatha' },
    onStop: endEarly,
  });

  const scheduled = session.remainingBells(first.elapsedMs);
  engine?.scheduleFrom(scheduled, first.elapsedMs);

  void wakeLock.acquire();

  const view = createSittingView({ config: sessionConfig, onEnd: endEarly });

  let frame = 0;
  let running = true;

  /**
   * Put the audio back in step with the wall clock. Reachable from every event
   * that can mean the page has come back, because no single one of them can be
   * relied on: a device test showed a page frozen for eight minutes and thawed
   * without `visibilitychange` ever firing.
   */
  const resyncAudio = (): void => {
    if (!running || engine === null) return;
    const at = session.elapsedMs;
    engine.resume();
    engine.resync(session.remainingBells(at), at);
  };

  // A suspended context does not announce itself, and a throttled background
  // timer is still a chance to notice.
  const heartbeat = window.setInterval(() => {
    if (engine !== null && engine.state !== 'running') resyncAudio();
  }, 30_000);

  const onResume = (): void => {
    resyncAudio();
    cancelAnimationFrame(frame);
    tick();
  };

  const stop = (elapsedMs: number, immediate: boolean): void => {
    if (!running) return;
    running = false;
    sitting = false;
    cancelAnimationFrame(frame);
    clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('resume', onResume);
    void wakeLock.release();
    clearActiveSession(storage);
    closeAudio(engine, sessionConfig, elapsedMs, immediate);
  };

  const tick = (): void => {
    if (!running) return;
    const reading = session.read();
    view.update(reading);

    if (reading.finished) {
      stop(reading.elapsedMs, false);
      const logged = record(session, reading.elapsedMs);
      if (passage !== null) showAfter(passage, logged);
      else showToday();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return;
    resyncAudio();
    cancelAnimationFrame(frame);
    tick();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  // Chrome fires this when it thaws a page it had frozen, and it does not
  // always follow with a visibilitychange.
  document.addEventListener('resume', onResume);

  present(view, view.element);
  view.update(first);
  frame = requestAnimationFrame(tick);
}

/**
 * Write the sit to the log.
 *
 * The duration recorded is time actually sat, from the opening bell — not the
 * length that was chosen. A sit ended early is still a sit, and one that reaches
 * the floor counts as fully as one that ran to the closing bell.
 */
function record(session: Session, elapsedMs: number): boolean {
  const sessionConfig = session.record.config;
  const satMs = Math.max(0, Math.min(elapsedMs - sessionConfig.prepareMs, sessionConfig.durationMs));
  if (satMs <= 0) return false;

  const entry: LoggedSession = {
    startedAt: session.record.startedAt,
    durationMs: satMs,
    completed: satMs >= sessionConfig.durationMs,
    passageId: passageUid,
  };
  sessions = addSession(entry, storage);
  return counts(entry);
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

