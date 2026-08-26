import { bellSchedule, type SessionConfig, type SessionReading } from '../timer/session';
import { formatDuration, query } from './dom';

/**
 * The Sitting screen: a hairline, notches where the interval bells fall, and
 * nothing else. See SPEC.md section 9 — this screen's restraint is the point.
 *
 * A thin adapter over the session model. It holds no time of its own; it is
 * handed a reading and draws it.
 */
export interface SittingView {
  readonly element: HTMLElement;
  update(reading: SessionReading): void;
  destroy(): void;
}

export interface SittingViewOptions {
  readonly config: SessionConfig;
  readonly onEnd: () => void;
}

const MARKUP = `
  <button type="button" class="sitting__reveal" aria-pressed="false">
    <span class="visually-hidden">Show elapsed time</span>
  </button>
  <div class="sitting__line" aria-hidden="true">
    <div class="sitting__fill"></div>
  </div>
  <p class="sitting__elapsed" data-visible="false" aria-hidden="true"></p>
  <button type="button" class="sitting__end">End</button>
  <p class="visually-hidden" role="status" aria-live="polite"></p>
`;

export function createSittingView(options: SittingViewOptions): SittingView {
  const element = document.createElement('section');
  element.className = 'sitting';
  // So focus can move here on arrival rather than falling back to the document.
  element.tabIndex = -1;
  element.dataset.phase = 'preparing';
  element.innerHTML = MARKUP;

  const line = query(element, '.sitting__line', HTMLElement);
  const fill = query(element, '.sitting__fill', HTMLElement);
  const elapsed = query(element, '.sitting__elapsed', HTMLElement);
  const reveal = query(element, '.sitting__reveal', HTMLButtonElement);
  const end = query(element, '.sitting__end', HTMLButtonElement);
  const status = query(element, '[role="status"]', HTMLElement);

  for (const bell of bellSchedule(options.config)) {
    if (bell.kind !== 'interval') continue;
    const notch = document.createElement('div');
    notch.className = 'sitting__notch';
    const at = (bell.offsetMs - options.config.prepareMs) / options.config.durationMs;
    notch.style.setProperty('--at', at.toFixed(6));
    line.append(notch);
  }

  let showElapsed = false;
  let lastElapsedText = '';
  let announced = '';

  const onReveal = (): void => {
    showElapsed = !showElapsed;
    elapsed.dataset.visible = String(showElapsed);
    reveal.setAttribute('aria-pressed', String(showElapsed));
    query(reveal, 'span', HTMLElement).textContent = showElapsed
      ? 'Hide elapsed time'
      : 'Show elapsed time';
  };

  reveal.addEventListener('click', onReveal);
  end.addEventListener('click', options.onEnd);

  /** Quiet for screen readers: the start and the end, never the progress. */
  const announce = (message: string): void => {
    if (announced === message) return;
    announced = message;
    status.textContent = message;
  };

  return {
    element,

    update(reading: SessionReading): void {
      fill.style.setProperty('--progress', reading.progress.toFixed(5));
      element.dataset.phase = reading.phase;

      const text = formatDuration(reading.sittingMs);
      if (text !== lastElapsedText) {
        lastElapsedText = text;
        elapsed.textContent = text;
      }

      if (reading.phase === 'sitting') announce('The sit has begun.');
      else if (reading.phase === 'leadOut' || reading.finished) announce('The sit is complete.');
    },

    destroy(): void {
      reveal.removeEventListener('click', onReveal);
      end.removeEventListener('click', options.onEnd);
      element.remove();
    },
  };
}
