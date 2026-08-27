import type { Passage } from '../corpus/load';
import type { SessionConfig } from '../timer/session';
import { DURATION_PRESETS_MS, INTERVAL_PRESETS_MS } from '../timer/preferences';
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
  readonly onBegin: (config: SessionConfig) => void;
  readonly onReroll: () => void;
  readonly onRead: () => void;
  /** Rendered under the actions while the timer is still being verified. */
  readonly extras?: HTMLElement;
}

const MARKUP = `
  <article class="today">
    <div class="today__passage">
      <p class="passage" lang="en"></p>
      <p class="passage__source"></p>
    </div>
    <div class="today__controls">
      <fieldset class="choice">
        <legend class="choice__legend">Duration</legend>
        <div class="choice__row" data-role="durations"></div>
      </fieldset>
      <fieldset class="choice">
        <legend class="choice__legend">Interval bell</legend>
        <div class="choice__row" data-role="intervals"></div>
      </fieldset>
    </div>
    <div class="today__actions">
      <button type="button" class="action action--primary" data-role="begin">Begin</button>
      <div class="today__quiet">
        <button type="button" class="action action--quiet" data-role="reroll">Another passage</button>
        <button type="button" class="action action--quiet" data-role="read">Read the discourse</button>
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

  const durations = query(element, '[data-role="durations"]', HTMLElement);
  const intervals = query(element, '[data-role="intervals"]', HTMLElement);

  const paint = (): void => {
    for (const button of durations.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.ms) === config.durationMs));
    }
    for (const button of intervals.querySelectorAll('button')) {
      const value = button.dataset.ms === '' ? null : Number(button.dataset.ms);
      button.setAttribute('aria-pressed', String(value === config.intervalMs));
    }
  };

  for (const ms of DURATION_PRESETS_MS) {
    const minutes = Math.round(ms / 60_000);
    durations.append(
      choiceButton({
        value: String(ms),
        label: `${String(minutes)} min`,
        // The two rows carry the same visible labels, so the accessible name
        // has to say which row it belongs to or they are indistinguishable.
        description: `Sit for ${String(minutes)} minutes`,
        onPick: () => {
          config = { ...config, durationMs: ms };
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
        label: ms === null ? 'None' : `${String(minutes)} min`,
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

  const onBegin = (): void => {
    options.onBegin(config);
  };
  begin.addEventListener('click', onBegin);
  reroll.addEventListener('click', options.onReroll);
  read.addEventListener('click', options.onRead);

  if (options.extras !== undefined) query(element, '.today', HTMLElement).append(options.extras);

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
      element.remove();
    },
  };
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
