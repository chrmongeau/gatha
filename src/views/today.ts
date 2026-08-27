import type { Passage } from '../corpus/load';
import type { SessionConfig } from '../timer/session';
import {
  DURATION_PRESETS_MS,
  INTERVAL_PRESETS_MS,
  intervalFits,
  withDuration,
} from '../timer/preferences';
import { query } from './dom';

/**
 * The day's passage, its source, and one action: Begin.
 *
 * Duration and interval are adjustable here, inline, without leaving the screen
 * (SPEC.md §4). The day's image belongs here too and arrives in phase 4.
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
    <div class="today__passage">
      <p class="passage" lang="en"></p>
      <p class="passage__source"></p>
    </div>
    <div class="today__controls">
      <fieldset class="choice">
        <legend class="choice__legend">Duration <span class="choice__unit">minutes</span></legend>
        <div class="choice__row choice__row--even" data-role="durations"></div>
      </fieldset>
      <fieldset class="choice">
        <legend class="choice__legend">Interval bell <span class="choice__unit">minutes</span></legend>
        <div class="choice__row" data-role="intervals"></div>
      </fieldset>
    </div>
    <div class="today__actions">
      <button type="button" class="action action--primary" data-role="begin">Begin</button>
      <p class="today__floor" data-role="floor"></p>
      <div class="today__quiet">
        <button type="button" class="action action--quiet" data-role="reroll">Another passage</button>
        <button type="button" class="action action--quiet" data-role="read">Read the discourse</button>
        <button type="button" class="action action--quiet" data-role="practice">Practice</button>
      </div>
    </div>
  </article>
`;

export function createTodayView(options: TodayViewOptions): TodayView {
  const element = document.createElement('section');
  element.className = 'screen screen--today';
  element.innerHTML = MARKUP;

  const block = query(element, '.today__passage', HTMLElement);
  const passage = query(element, '.passage', HTMLElement);
  const source = query(element, '.passage__source', HTMLElement);

  const showPassage = (next: Passage): void => {
    // Canonical text, set verbatim from the corpus. textContent, never innerHTML.
    passage.textContent = next.text;
    // Short passages are centred; long ones are not (SPEC.md §9).
    passage.dataset.length = next.text.length > 180 ? 'long' : 'short';
    source.textContent = next.reference;
  };
  showPassage(options.passage);

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

  const durations = query(element, '[data-role="durations"]', HTMLElement);
  const intervals = query(element, '[data-role="intervals"]', HTMLElement);

  const paint = (): void => {
    for (const button of durations.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.ms) === config.durationMs));
    }
    for (const button of intervals.querySelectorAll('button')) {
      const value = button.dataset.ms === '' ? null : Number(button.dataset.ms);
      button.setAttribute('aria-pressed', String(value === config.intervalMs));
      // An interval that cannot ring inside this sit is not offered. Disabled
      // rather than hidden, so the row does not reflow as the duration changes.
      button.disabled = !intervalFits(value, config.durationMs);
    }
  };

  for (const ms of DURATION_PRESETS_MS) {
    const minutes = Math.round(ms / 60_000);
    durations.append(
      choiceButton({
        value: String(ms),
        // Bare numbers, so all six presets fit one row on a narrow phone. The
        // unit is in the legend, and the accessible name spells it out.
        label: String(minutes),
        description: `Sit for ${String(minutes)} minutes`,
        onPick: () => {
          config = withDuration(config, ms);
          paint();
        },
      }),
    );
  }

  for (const ms of INTERVAL_PRESETS_MS) {
    const minutes = ms === null ? 0 : Math.round(ms / 60_000);
    intervals.append(
      choiceButton({
        value: ms === null ? '' : String(ms),
        label: ms === null ? 'None' : String(minutes),
        description: ms === null ? 'No interval bell' : `Interval bell every ${String(minutes)} minutes`,
        onPick: () => {
          config = { ...config, intervalMs: ms };
          paint();
        },
      }),
    );
  }
  paint();

  const begin = query(element, '[data-role="begin"]', HTMLButtonElement);
  const reroll = query(element, '[data-role="reroll"]', HTMLButtonElement);
  const read = query(element, '[data-role="read"]', HTMLButtonElement);
  const practice = query(element, '[data-role="practice"]', HTMLButtonElement);
  practice.addEventListener('click', options.onPractice);

  const onBegin = (): void => {
    options.onBegin(config);
  };
  begin.addEventListener('click', onBegin);
  reroll.addEventListener('click', options.onReroll);
  read.addEventListener('click', options.onRead);

  return {
    element,

    showPassage(next: Passage): void {
      // Only the passage changes, so only the passage moves. A whole-screen
      // cross-fade is for going somewhere else, not for reading another verse.
      block.classList.remove('is-changing');
      void block.offsetWidth;
      block.classList.add('is-changing');
      showPassage(next);
    },

    destroy(): void {
      begin.removeEventListener('click', onBegin);
      reroll.removeEventListener('click', options.onReroll);
      read.removeEventListener('click', options.onRead);
      practice.removeEventListener('click', options.onPractice);
      element.remove();
    },
  };
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
      <button type="submit" class="choice__button">Save</button>
      <button type="button" class="action action--quiet" data-role="skip">Not now</button>
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

interface Choice {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly onPick: () => void;
}

function choiceButton(choice: Choice): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice__button';
  button.dataset.ms = choice.value;
  button.textContent = choice.label;
  button.setAttribute('aria-label', choice.description);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', choice.onPick);
  return button;
}
