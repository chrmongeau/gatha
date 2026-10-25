import type { Passage } from '../corpus/load';
import { query, renderPassage, screenElement } from './dom';

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
    <!--
      Focus lands on the heading, so a screen reader hears whether the sit was
      recorded before anything else (Tacet rule 16); the visible line says the
      same, and is hidden from it so it is not heard twice.
    -->
    <h1 class="visually-hidden" tabindex="-1" data-role="heading"></h1>
    <p class="after__recorded" data-role="recorded" aria-hidden="true"></p>
    <div class="today__passage">
      <p class="passage" lang="en"></p>
      <p class="passage__source"></p>
    </div>
    <div class="today__actions">
      <button type="button" class="action action--primary" data-role="read">Read the full discourse</button>
      <div class="today__quiet">
        <button type="button" class="action" data-role="done">Close</button>
      </div>
    </div>
  </article>
`;

export function createAfterView(options: AfterViewOptions): AfterView {
  const element = screenElement('after', MARKUP);

  // Plain confirmation, no score and no congratulation (SPEC.md §4).
  const recorded = query(element, '[data-role="recorded"]', HTMLElement);
  recorded.textContent = options.recorded ? 'Recorded.' : 'Not recorded — under two minutes.';
  query(element, '[data-role="heading"]', HTMLElement).textContent = `The sit is over. ${recorded.textContent}`;

  renderPassage(element, options.passage);

  query(element, '[data-role="read"]', HTMLButtonElement).addEventListener('click', options.onRead);
  query(element, '[data-role="done"]', HTMLButtonElement).addEventListener('click', options.onDone);

  return {
    element,
    /*
     * The element and everything bound to it goes at once. No listener here is
     * attached to anything that outlives this subtree — no document, no window —
     * so unbinding them one by one was bookkeeping with nothing to keep.
     */
    destroy(): void {
      element.remove();
    },
  };
}
