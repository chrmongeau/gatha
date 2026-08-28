/**
 * Which passage belongs to which day.
 *
 * The order is a fixed shuffle generated at build time, so indexing into it by
 * day number gives a passage that is stable for the whole day, identical on
 * every device, and does not repeat until the corpus is exhausted (SPEC.md §3).
 *
 * Pure, and takes the day rather than reading a clock — the same reason the
 * session model does.
 */

/** The passage id for a day. Null only when the corpus is empty. */
export function passageForDay(order: readonly string[], day: number): string | null {
  if (order.length === 0) return null;
  // A negative day number is possible on a badly set clock; keep the index positive.
  const index = ((day % order.length) + order.length) % order.length;
  return order[index] ?? null;
}

/**
 * The next passage along, for a re-roll. Walks the same fixed order rather than
 * choosing at random, so re-rolling never repeats what the day already showed
 * and never lands back on the day's own passage until it has been all the way
 * round.
 */
export function rerollFrom(order: readonly string[], current: string): string | null {
  if (order.length === 0) return null;
  const at = order.indexOf(current);
  if (at < 0) return order[0] ?? null;
  return order[(at + 1) % order.length] ?? null;
}
