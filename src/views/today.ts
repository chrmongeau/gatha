import type { Passage } from '../corpus/load';
import type { SessionConfig } from '../timer/session';
import { stepDuration, stepInterval } from '../timer/preferences';
import { query, renderPassage, screenElement } from './dom';

/**
 * The day's passage, its source, and one action: Begin.
 *
 * Duration and interval are adjustable here, inline, without leaving the screen
 * (SPEC.md §4).
 */
export interface TodayView {
  readonly element: HTMLElement;
  /** Swap the passage in place, without rebuilding the screen around it. */
  showPassage(passage: Passage): void;
  destroy(): void;
}

export interface TodayViewOptions {
  readonly passage: Passage;
  readonly config: SessionConfig;
  /** False while today is still open, which is when the floor is worth stating. */
  readonly satToday: boolean;
  /** The sitter's own answer to "I'll sit after ___", if they gave one. */
  readonly anchor: string | null;
  /** True on a first run, when the anchor has not yet been asked for. */
  readonly askAnchor: boolean;
  readonly onAnchorAnswer: (anchor: string | null) => void;
  readonly onBegin: (config: SessionConfig) => void;
  readonly onReroll: () => void;
  readonly onRead: () => void;
  readonly onPractice: () => void;
}

const MARKUP = `
  <article class="today">
    <!--
      The screen carries no visible title by design — section 9 spends its
      boldness on the passage. But a screen without a heading is a screen a
      screen reader cannot navigate, so the heading is present and unseen.
    -->
    <h1 class="visually-hidden">Today’s passage</h1>
    <!-- Polite, so "Show another passage" is followed by the passage it showed (Tacet rule 16). -->
    <div class="today__passage" aria-live="polite">
      <p class="passage" lang="en"></p>
      <p class="passage__source"></p>
    </div>
    <!--
      Steppers rather than rows of options: seven 48px targets do not fit a row
      on a phone, and the value showing is the one chosen, so no marker is needed.
    -->
    <div class="today__controls steppers">
      <div class="stepper" role="group" aria-labelledby="duration-label">
        <span class="choice__legend" id="duration-label">Duration</span>
        <span class="stepper__control">
          <button type="button" class="stepper__button" data-role="duration-down" aria-label="Shorter sit">−</button>
          <output class="stepper__value" data-role="duration" aria-live="polite"></output>
          <button type="button" class="stepper__button" data-role="duration-up" aria-label="Longer sit">+</button>
        </span>
      </div>
      <div class="stepper" role="group" aria-labelledby="bell-label">
        <span class="choice__legend" id="bell-label">Bell</span>
        <span class="stepper__control">
          <button type="button" class="stepper__button" data-role="bell-down" aria-label="Bell less often">−</button>
          <output class="stepper__value" data-role="bell" aria-live="polite"></output>
          <button type="button" class="stepper__button" data-role="bell-up" aria-label="Bell more often">+</button>
        </span>
      </div>
    </div>
    <div class="today__actions">
      <button type="button" class="action action--primary" data-role="begin">Begin</button>
      <p class="today__floor" data-role="floor"></p>
      <div class="today__quiet">
        <button type="button" class="action" data-role="reroll">Show another passage</button>
        <button type="button" class="action" data-role="read">Read the discourse</button>
        <button type="button" class="action" data-role="practice">See practice</button>
      </div>
    </div>
  </article>
`;

export function createTodayView(options: TodayViewOptions): TodayView {
  const element = screenElement('today', MARKUP);

  const block = query(element, '.today__passage', HTMLElement);
  renderPassage(element, options.passage);

  let config = options.config;

  // The floor is stated only while the day is open. Once a sit is recorded there
  // is nothing to say: no tick, no praise, no remark on the day at all.
  const floor = query(element, '[data-role="floor"]', HTMLElement);
  if (options.satToday) {
    floor.remove();
  } else {
    const lines = ['Two minutes counts.'];
    if (options.anchor !== null) lines.push(`After ${options.anchor}.`);
    floor.textContent = lines.join(' ');
  }

  if (options.askAnchor) element.prepend(anchorPrompt(options.onAnchorAnswer));

  const controls = query(element, '.steppers', HTMLElement);
  const steppers = [
    { role: 'duration', step: stepDuration, show: (c: SessionConfig) => minutes(c.durationMs) },
    { role: 'bell', step: stepInterval, show: (c: SessionConfig) => (c.intervalMs === null ? 'None' : minutes(c.intervalMs)) },
  ].map(({ role, step, show }) => ({
    step,
    show,
    value: query(element, `[data-role="${role}"]`, HTMLOutputElement),
    down: query(element, `[data-role="${role}-down"]`, HTMLButtonElement),
    up: query(element, `[data-role="${role}-up"]`, HTMLButtonElement),
  }));

  const paint = (): void => {
    for (const stepper of steppers) {
      stepper.value.textContent = stepper.show(config);
      // Unavailable at either end rather than hidden, so nothing moves.
      stepper.down.disabled = stepper.step(config, -1) === null;
      stepper.up.disabled = stepper.step(config, 1) === null;
    }
  };

  for (const stepper of steppers) {
    for (const [button, direction] of [[stepper.down, -1], [stepper.up, 1]] as const) {
      button.addEventListener('click', () => {
        config = stepper.step(config, direction) ?? config;
        paint();
      });
    }
  }
  paint();

  /*
   * Label and stepper share a line while they fit, in a grid whose label column
   * is as wide as the longest label measures (Tacet rule 12). When they do not —
   * font scale 2.0 on a 390px phone — each label goes above its stepper instead
   * of the row running off the screen.
   */
  const widest = (selector: string): number =>
    Math.max(...[...controls.querySelectorAll(selector)].map((part) => part.getBoundingClientRect().width));
  const fit = (): void => {
    // Both parts are max-content wide in either layout, so measuring them does
    // not depend on the layout being decided — and deciding cannot loop.
    const gap = parseFloat(getComputedStyle(controls).columnGap) || 0;
    const needed = widest('.choice__legend') + gap + widest('.stepper__control');
    controls.classList.toggle('is-stacked', needed > controls.clientWidth);
  };
  const resizes = 'ResizeObserver' in window ? new ResizeObserver(fit) : null;
  resizes?.observe(controls);
  for (const label of controls.querySelectorAll('.choice__legend')) resizes?.observe(label);

  query(element, '[data-role="begin"]', HTMLButtonElement).addEventListener('click', () => {
    options.onBegin(config);
  });
  query(element, '[data-role="reroll"]', HTMLButtonElement).addEventListener('click', options.onReroll);
  query(element, '[data-role="read"]', HTMLButtonElement).addEventListener('click', options.onRead);
  query(element, '[data-role="practice"]', HTMLButtonElement).addEventListener('click', options.onPractice);

  return {
    element,

    showPassage(next: Passage): void {
      // Only the passage changes, so only the passage moves. A whole-screen
      // cross-fade is for going somewhere else, not for reading another verse.
      block.classList.remove('is-changing');
      void block.offsetWidth;
      block.classList.add('is-changing');
      renderPassage(element, next);
    },

    /*
     * The element and everything bound to it goes at once. No listener here is
     * attached to anything that outlives this subtree — no document, no window —
     * so unbinding them one by one was bookkeeping with nothing to keep.
     */
    destroy(): void {
      resizes?.disconnect();
      element.remove();
    },
  };
}

function minutes(ms: number): string {
  return `${String(Math.round(ms / 60_000))} min`;
}

/**
 * Asked once, on a first run, and never again however it is answered. Specifying
 * the cue in advance is the highest-leverage thing in the history system
 * (SPEC.md §7) and the only thing the app requests.
 */
function anchorPrompt(onAnswer: (anchor: string | null) => void): HTMLElement {
  const prompt = document.createElement('form');
  prompt.className = 'anchor';
  prompt.innerHTML = `
    <label class="choice__legend" for="first-anchor">I’ll sit after</label>
    <input class="practice__anchor" id="first-anchor" type="text" autocomplete="off"
           placeholder="my morning coffee" />
    <div class="practice__row">
      <button type="submit" class="action">Save</button>
      <button type="button" class="action" data-role="skip">Skip</button>
    </div>
  `;

  const input = prompt.querySelector('input');
  prompt.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input?.value.trim() ?? '';
    onAnswer(value === '' ? null : value);
    prompt.remove();
  });
  prompt.querySelector('[data-role="skip"]')?.addEventListener('click', () => {
    onAnswer(null);
    prompt.remove();
  });

  return prompt;
}
