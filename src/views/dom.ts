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
