/**
 * Assert the shipped font carries every codepoint the corpus contains.
 *
 * SPEC.md §9 asks for this as a build check, and it is not ceremony: the whole
 * reason for choosing Gentium Plus is diacritic coverage, and a face swapped for
 * something more fashionable would fall back mid-word — Sāvatthī, nibbāna,
 * Theragāthā — which is the kind of breakage nobody notices until it ships.
 *
 * It reads the cmap out of the WOFF2 binaries themselves rather than trusting
 * the `unicode-range` declared in the CSS, because a wrong declaration is
 * exactly one of the things that could go wrong.
 */
import { brotliDecompressSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FONT_DIR = 'src/styles/fonts';
const CORPUS = 'public/corpus';

function main(): void {
  const needed = corpusCodepoints();
  const covered = new Set<number>();
  const files = readdirSync(FONT_DIR).filter((name) => name.endsWith('.woff2'));

  if (files.length === 0) throw new Error(`no fonts in ${FONT_DIR}`);
  for (const file of files) {
    const found = codepointsIn(readFileSync(join(FONT_DIR, file)));
    console.log(`  ${file}: ${String(found.size)} codepoints`);
    for (const codepoint of found) covered.add(codepoint);
  }

  const missing = [...needed].filter((codepoint) => !covered.has(codepoint)).sort((a, b) => a - b);
  if (missing.length > 0) {
    const shown = missing.map((c) => `${String.fromCodePoint(c)} (U+${c.toString(16).toUpperCase().padStart(4, '0')})`);
    throw new Error(
      `the corpus uses ${String(missing.length)} codepoints the shipped font cannot render:\n  ${shown.join('\n  ')}`,
    );
  }

  console.log(`\nfont covers all ${String(needed.size)} codepoints in the corpus`);
}

function corpusCodepoints(): Set<number> {
  const codepoints = new Set<number>();
  const add = (text: string): void => {
    for (const character of text) {
      const codepoint = character.codePointAt(0) ?? 0;
      // Newlines separate verse lines and spaces set the measure. Neither is
      // drawn, and neither is a font's job.
      if (codepoint > 0x20) codepoints.add(codepoint);
    }
  };

  const passages = readJson(join(CORPUS, 'en', 'passages.json')) as Record<
    string,
    { text: string; reference: string; title: string }
  >;
  for (const entry of Object.values(passages)) {
    add(entry.text);
    add(entry.reference);
    add(entry.title);
  }

  const suttaDir = join(CORPUS, 'en', 'suttas');
  for (const file of readdirSync(suttaDir)) {
    const sutta = readJson(join(suttaDir, file)) as {
      title: string;
      reference: string;
      blocks: { lines: string[] }[];
    };
    add(sutta.title);
    add(sutta.reference);
    for (const block of sutta.blocks) for (const line of block.lines) add(line);
  }

  return codepoints;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new Error(`missing ${path}: run "npm run corpus" first`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ------------------------------------------------------------ WOFF2 reading

/** Tags in the order the format assigns them, so a table can be named by index. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function codepointsIn(woff2: Buffer): Set<number> {
  if (woff2.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');

  const numTables = woff2.readUInt16BE(12);
  let at = 48;
  const tables: { tag: string; length: number }[] = [];

  for (let i = 0; i < numTables; i += 1) {
    const flags = woff2.readUInt8(at);
    at += 1;
    const index = flags & 0x3f;
    let tag: string;
    if (index === 0x3f) {
      tag = woff2.toString('latin1', at, at + 4);
      at += 4;
    } else {
      tag = KNOWN_TAGS[index] ?? '????';
    }

    const original = readBase128(woff2, at);
    at = original.at;
    let length = original.value;

    // glyf and loca are stored transformed, at a different length.
    const transformed = (flags >> 6) & 0x03;
    const nullTransform = tag === 'glyf' || tag === 'loca' ? transformed === 0 : transformed !== 0;
    if (nullTransform) {
      const transform = readBase128(woff2, at);
      at = transform.at;
      length = transform.value;
    }

    tables.push({ tag, length });
  }

  const font = brotliDecompressSync(woff2.subarray(at));

  let offset = 0;
  for (const table of tables) {
    if (table.tag === 'cmap') return codepointsInCmap(font, offset);
    offset += table.length;
  }
  throw new Error('no cmap table');
}

/** WOFF2's variable-length integer: seven bits per byte, high bit continues. */
function readBase128(buffer: Buffer, start: number): { value: number; at: number } {
  let value = 0;
  let at = start;
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer.readUInt8(at);
    at += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, at };
  }
  throw new Error('malformed base-128 integer');
}

function codepointsInCmap(font: Buffer, base: number): Set<number> {
  const codepoints = new Set<number>();
  const numTables = font.readUInt16BE(base + 2);

  for (let i = 0; i < numTables; i += 1) {
    const record = base + 4 + i * 8;
    const subtable = base + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(subtable);
    if (format === 4) readFormat4(font, subtable, codepoints);
    else if (format === 12) readFormat12(font, subtable, codepoints);
  }

  return codepoints;
}

/** A codepoint is only covered if it maps to a real glyph, not to glyph zero. */
function readFormat4(font: Buffer, at: number, into: Set<number>): void {
  const segCount = font.readUInt16BE(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;

  for (let segment = 0; segment < segCount; segment += 1) {
    const end = font.readUInt16BE(ends + segment * 2);
    const start = font.readUInt16BE(starts + segment * 2);
    if (start === 0xffff) continue;
    const delta = font.readInt16BE(deltas + segment * 2);
    const rangeOffset = font.readUInt16BE(rangeOffsets + segment * 2);

    for (let codepoint = start; codepoint <= end && codepoint !== 0x10000; codepoint += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (codepoint + delta) & 0xffff;
      } else {
        const glyphAt = rangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2;
        if (glyphAt + 1 >= font.length) continue;
        glyph = font.readUInt16BE(glyphAt);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) into.add(codepoint);
    }
  }
}

function readFormat12(font: Buffer, at: number, into: Set<number>): void {
  const groups = font.readUInt32BE(at + 12);
  for (let i = 0; i < groups; i += 1) {
    const group = at + 16 + i * 12;
    const start = font.readUInt32BE(group);
    const end = font.readUInt32BE(group + 4);
    const startGlyph = font.readUInt32BE(group + 8);
    if (startGlyph === 0) continue;
    for (let codepoint = start; codepoint <= end; codepoint += 1) into.add(codepoint);
  }
}

main();
