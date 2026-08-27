/**
 * The day's image.
 *
 * Curated and processed at build time by `tools/build-imagery.mts`, never
 * fetched at runtime (SPEC.md §8). Rotated by the same day number as the
 * passage, so the pairing is stable for the day and identical on every device.
 *
 * The manifest is legitimately empty until photographs are added. Every caller
 * has to cope with that, and the Today screen simply has no image.
 */
import { passageForDay } from './corpus/daily';

export interface ImageCredit {
  readonly photographer: string;
  readonly url?: string;
  readonly license?: string;
}

export interface DayImage {
  readonly id: string;
  /** Width over height, for reserving space before the file arrives. */
  readonly aspect: number;
  readonly widths: readonly number[];
  /** A 4×4 average as a data URI, held under the image so nothing pops in. */
  readonly placeholder: string;
  readonly credit: ImageCredit | null;
}

export function imageryUrl(path: string): string {
  return `${import.meta.env.BASE_URL}imagery/${path}`;
}

export async function loadImagery(): Promise<DayImage[]> {
  try {
    const response = await fetch(imageryUrl('manifest.json'));
    if (!response.ok) return [];
    const entries = (await response.json()) as unknown;
    return Array.isArray(entries) ? (entries as DayImage[]) : [];
  } catch {
    // No imagery is a state the Today screen handles; it is not an error.
    return [];
  }
}

/** Null when there are no images. Rotated by day, like the passage. */
export function imageForDay(images: readonly DayImage[], day: number): DayImage | null {
  if (images.length === 0) return null;
  const id = passageForDay(
    images.map((image) => image.id),
    day,
  );
  return images.find((image) => image.id === id) ?? null;
}

/** Widest last, which is the order `srcset` wants. */
export function sourceSet(image: DayImage, format: 'avif' | 'webp'): string {
  return [...image.widths]
    .sort((a, b) => a - b)
    .map((width) => `${imageryUrl(`${image.id}-${String(width)}.${format}`)} ${String(width)}w`)
    .join(', ');
}
