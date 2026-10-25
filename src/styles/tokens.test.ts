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
