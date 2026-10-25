import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function files(dir: string, extension: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith(extension) && !name.endsWith(`.test${extension}`))
    .map((name) => readFileSync(join(dir, name), 'utf8'));
}

/*
 * An undefined custom property fails silently: the declaration is dropped and
 * the property inherits. Restructuring tokens.css once deleted `--line-weight`,
 * `--font-ui` and `--font-canon` together. The line vanished and was noticed;
 * the fonts fell back to the browser default and were not, for months, while
 * the glyph-coverage check went on passing.
 */
describe('custom properties', () => {
  it('are all defined somewhere they are used', () => {
    const css = files(join(root, 'styles'), '.css').join('\n');
    const scripts = files(root, '.ts').join('\n');

    const defined = new Set([
      ...[...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
      // Set per element from the views, such as a notch's position.
      ...[...scripts.matchAll(/setProperty\('(--[\w-]+)'/g)].map((match) => match[1]),
    ]);
    // A var() with a fallback is allowed to be unset.
    const used = [...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((match) => match[1]);

    expect([...new Set(used)].filter((name) => !defined.has(name))).toEqual([]);
  });
});

/** WCAG 2.2 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The literal colours one theme block of tokens.css declares. */
function theme(selector: string): Record<string, string> {
  const css = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const colours: Record<string, string> = {};
  for (const [, token = '', value = ''] of block.matchAll(/(--[\w-]+):\s*#([0-9a-f]{6});/g)) {
    colours[token] = value;
  }
  return colours;
}

/* Tacet's colour-role minimums (~/tacet/DESIGN.md), measured against each theme's own ground. */
describe.each([
  ['dark', ':root'],
  ['light', ":root[data-theme='light']"],
])('the %s palette', (_name, selector) => {
  const colours = theme(selector);
  const against = (token: string): number => {
    const value = colours[token];
    const ground = colours['--ground'];
    if (value === undefined || ground === undefined) throw new Error(`${token} is not a literal colour`);
    return contrast(value, ground);
  };

  it('gives Ink at least 7:1', () => {
    expect(against('--text')).toBeGreaterThanOrEqual(7);
  });

  it('gives Muted at least 4.5:1', () => {
    expect(against('--text-quiet')).toBeGreaterThanOrEqual(4.5);
  });

  // Rule 5: unavailable reads differently from unselected, about 3:1, never hidden.
  it('gives Faded about 3:1, and less than Muted', () => {
    expect(against('--text-faded')).toBeGreaterThanOrEqual(2.8);
    expect(against('--text-faded')).toBeLessThanOrEqual(3.5);
    expect(against('--text-faded')).toBeLessThan(against('--text-quiet'));
  });

  it('gives Line at least 3:1', () => {
    expect(against('--line-track')).toBeGreaterThanOrEqual(3);
  });

  it('gives the accent 3:1 as a mark and 4.5:1 as text', () => {
    expect(against('--accent')).toBeGreaterThanOrEqual(3);
    expect(against('--accent-text')).toBeGreaterThanOrEqual(4.5);
  });
});
