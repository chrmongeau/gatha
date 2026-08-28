/**
 * Build an element's markup once, then reach into it for the parts that move.
 * The expected type is checked rather than asserted, so a markup change that
 * loses an element fails loudly instead of at the first property access.
 */
export function query<T extends Element>(
  root: ParentNode,
  selector: string,
  kind: abstract new () => T,
): T {
  const found = root.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`missing element: ${selector}`);
  return found;
}

/** Minutes and seconds, for the elapsed time a tap reveals. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A screen's root element, built from its markup in one step.
 *
 * Every view opened with the same three lines. The class is always
 * `screen screen--<name>`, which is what the stylesheet expects.
 */
export function screenElement(name: string, markup: string): HTMLElement {
  const element = document.createElement('section');
  element.className = `screen screen--${name}`;
  element.innerHTML = markup;
  return element;
}

/**
 * The passage and its reference, set the same way wherever they appear.
 *
 * Canonical text, written with textContent and never innerHTML. Short passages
 * are centred and long ones are not (SPEC.md §9); the threshold lives here so
 * Today and After cannot drift apart on it.
 */
const CENTRE_UP_TO = 180;

export function renderPassage(
  root: ParentNode,
  passage: { readonly text: string; readonly reference: string },
): void {
  const text = query(root, '.passage', HTMLElement);
  text.textContent = passage.text;
  text.dataset.length = passage.text.length > CENTRE_UP_TO ? 'long' : 'short';
  query(root, '.passage__source', HTMLElement).textContent = passage.reference;
}
