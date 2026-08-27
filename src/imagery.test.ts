import { describe, expect, it } from 'vitest';

import { imageForDay, sourceSet, type DayImage } from './imagery';

const image = (id: string): DayImage => ({
  id,
  aspect: 1.5,
  widths: [1600, 900],
  placeholder: 'data:image/png;base64,abc',
  credit: { photographer: 'Someone' },
});

const IMAGES = [image('a'), image('b'), image('c')];

describe('imageForDay', () => {
  it('gives an image that is stable for the day', () => {
    expect(imageForDay(IMAGES, 100)?.id).toBe(imageForDay(IMAGES, 100)?.id);
  });

  it('rotates through the set before repeating', () => {
    const seen = [0, 1, 2].map((day) => imageForDay(IMAGES, day)?.id);

    expect(new Set(seen).size).toBe(3);
    expect(imageForDay(IMAGES, 3)?.id).toBe(imageForDay(IMAGES, 0)?.id);
  });

  it('reports nothing when no photographs have been added', () => {
    // The manifest is legitimately empty until images exist, and the Today
    // screen has to render without one.
    expect(imageForDay([], 1)).toBeNull();
  });

  it('copes with a clock set before the epoch', () => {
    expect(imageForDay(IMAGES, -1)).not.toBeNull();
  });
});

describe('sourceSet', () => {
  it('lists the widths ascending, as srcset expects', () => {
    const base = `${import.meta.env.BASE_URL}imagery`;

    expect(sourceSet(image('a'), 'avif')).toBe(
      `${base}/a-900.avif 900w, ${base}/a-1600.avif 1600w`,
    );
  });

  it('never hardcodes a leading slash of its own', () => {
    // Built from BASE_URL, because the site is served from a subpath.
    expect(sourceSet(image('a'), 'webp')).toContain(`${import.meta.env.BASE_URL}imagery/`);
  });
});
