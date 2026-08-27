/**
 * Days, counted in the viewer's own timezone.
 *
 * Shared because two unrelated things need the same notion of "today": which
 * passage the day shows, and which day a sit belongs to. If they disagreed, a
 * sit at 00:30 could land on the previous day's square.
 */
export function dayNumber(at: Date): number {
  const local = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.floor(local.getTime() / 86_400_000);
}
