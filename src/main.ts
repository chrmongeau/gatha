import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/sitting.css';

import { dayNumber, passageForDay, rerollFrom } from './corpus/daily';
import { loadCorpus, loadDiscourse, type Corpus, type Passage } from './corpus/load';
import { Views, type Screen } from './state';
import { createAudioEngine } from './timer/audio';
import { bellDurationSeconds } from './timer/bell';
import { systemClock } from './timer/clock';
import {
  clearActiveSession,
  defaultStorage,
  loadActiveSession,
  saveActiveSession,
} from './timer/active-session';
import { loadPreferences, savePreferences } from './timer/preferences';
import { Session, endsAt, type SessionConfig, type SessionRecord } from './timer/session';
import { createScreenWakeLock } from './timer/wakelock';
import { createAfterView } from './views/after';
import { createDiscourseView } from './views/discourse';
import { createSittingView } from './views/sitting';
import { createTodayView, type TodayView } from './views/today';
import { query } from './views/dom';

const storage = defaultStorage();
const views = new Views(query(document, '#app', HTMLElement));

let corpus: Corpus | null = null;
let config: SessionConfig = loadPreferences(storage);
/** The day's passage, or whatever a re-roll has landed on since. */
let passageUid: string | null = null;

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
      run(Session.start(config, systemClock));
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
function run(session: Session): void {
  const sessionConfig = session.record.config;
  if (storage !== null) saveActiveSession(session.record, storage);

  const first = session.read();
  const passage = currentPassage();
  const wakeLock = createScreenWakeLock();

  const endEarly = (): void => {
    const at = session.elapsedMs;
    stop(at, true);
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
    cancelAnimationFrame(frame);
    clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('resume', onResume);
    void wakeLock.release();
    if (storage !== null) clearActiveSession(storage);
    closeAudio(engine, sessionConfig, elapsedMs, immediate);
  };

  const tick = (): void => {
    if (!running) return;
    const reading = session.read();
    view.update(reading);

    if (reading.finished) {
      stop(reading.elapsedMs, false);
      if (passage !== null) showAfter(passage);
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

