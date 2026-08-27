import type { Passage } from '../corpus/load';
import { query } from './dom';

/**
 * The bell has rung. The passage again, and the discourse it came from offered
 * but never insisted on (SPEC.md §4).
 *
 * No score and no congratulation. Nothing here grades the sit or remarks on it.
 * Confirming the session was recorded belongs with the practice history.
 */
export interface AfterView {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface AfterViewOptions {
  readonly passage: Passage;
  /** Whether the sit reached the two-minute floor and went into the log. */
  readonly recorded: boolean;
  readonly onRead: () => void;
  readonly onDone: () => void;
}

const MARKUP = `
  <article class="after">
    <h1 class="visually-hidden">The sit is over</h1>
    <p class="after__recorded" data-role="recorded"></p>
    <div class="today__passage">
      <p class="passage" lang="en"></p>
      <p class="passage__source"></p>
    </div>
    <div class="today__actions">
      <button type="button" class="action action--primary" data-role="read">Read the full discourse</button>
      <div class="today__quiet">
        <button type="button" class="action action--quiet" data-role="done">Close</button>
      </div>
    </div>
  </article>
`;

export function createAfterView(options: AfterViewOptions): AfterView {
  const element = document.createElement('section');
  element.className = 'screen screen--after';
  element.innerHTML = MARKUP;

  // Plain confirmation, no score and no congratulation (SPEC.md §4).
  const recorded = query(element, '[data-role="recorded"]', HTMLElement);
  recorded.textContent = options.recorded ? 'Recorded.' : 'Not recorded — under two minutes.';

  const passage = query(element, '.passage', HTMLElement);
  passage.textContent = options.passage.text;
  passage.dataset.length = options.passage.text.length > 180 ? 'long' : 'short';
  query(element, '.passage__source', HTMLElement).textContent = options.passage.reference;

  const read = query(element, '[data-role="read"]', HTMLButtonElement);
  const done = query(element, '[data-role="done"]', HTMLButtonElement);
  read.addEventListener('click', options.onRead);
  done.addEventListener('click', options.onDone);

  return {
    element,
    destroy(): void {
      read.removeEventListener('click', options.onRead);
      done.removeEventListener('click', options.onDone);
      element.remove();
    },
  };
}
