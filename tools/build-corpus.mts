/**
 * bilara-data → public/corpus
 *
 * Run by hand, not on every build: the canon is not changing. See SPEC.md §3.
 *
 *   npm run corpus                       # en / sujato
 *   npm run corpus -- --lang de --translator sabbamitta
 *
 * The language and translator are parameters everywhere. What is written to
 * `selection.json` and `order.json` is language-neutral — which segments make a
 * passage is a structural fact about the canon, not about English — so adding a
 * language is a data operation: run this again with a new `--lang`, and one more
 * directory appears beside the others.
 *
 * Nothing in this file may write, paraphrase or repair canonical text. Every
 * word of a passage or a discourse is copied from bilara-data verbatim. If a
 * passage looks wrong, the selection rules below are what to change.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const SOURCE_REPO = 'https://github.com/suttacentral/bilara-data';
const SOURCE_BRANCH = 'published';
const CACHE = '.cache/bilara-data';
const OUT = 'public/corpus';

/** A passage that needs its context is a bad passage (SPEC.md §3). */
const MAX_WORDS = 60;

/** Two passages this similar are the same peyyāla text with a term swapped. */
const DUPLICATE_SIMILARITY = 0.75;

type Policy = 'whole' | 'closing';

interface Collection {
  /** Segment-id prefix, and the key used in logs. */
  readonly code: string;
  /**
   * Citation label. Bibliographic metadata, not canonical text — the titles and
   * every word of every passage still come from the data.
   */
  readonly reference: string;
  /** Path under `sutta/` in both the translation and html trees. */
  readonly dir: string;
  /**
   * `whole`: the sutta is a verse and must fit entire, or be skipped. Taking
   * part of a poem produces a fragment that needs the rest of it.
   * `closing`: the sutta ends in a verse — the inspired utterance — and that
   * block alone is the passage.
   */
  readonly policy: Policy;
}

const COLLECTIONS: readonly Collection[] = [
  { code: 'ud', reference: 'Udāna', dir: 'kn/ud', policy: 'closing' },
  { code: 'iti', reference: 'Itivuttaka', dir: 'kn/iti', policy: 'closing' },
  { code: 'dhp', reference: 'Dhammapada', dir: 'kn/dhp', policy: 'whole' },
  { code: 'thag', reference: 'Theragāthā', dir: 'kn/thag', policy: 'whole' },
  { code: 'thig', reference: 'Therīgāthā', dir: 'kn/thig', policy: 'whole' },
  { code: 'kp', reference: 'Khuddakapāṭha', dir: 'kn/kp', policy: 'whole' },
  { code: 'snp', reference: 'Sutta Nipāta', dir: 'kn/snp', policy: 'whole' },
  { code: 'sn', reference: 'Saṁyutta Nikāya', dir: 'sn', policy: 'closing' },
];

interface Options {
  readonly lang: string;
  readonly translator: string;
  readonly reference: boolean;
}

interface Segment {
  readonly id: string;
  readonly text: string;
  readonly verse: boolean;
  readonly opensBlock: boolean;
}

interface Sutta {
  readonly uid: string;
  /** What SuttaCentral serves as one document, which is not always the uid. */
  readonly parentUid: string;
  readonly collection: Collection;
  readonly title: string;
  readonly segments: readonly Segment[];
}

interface Passage {
  readonly uid: string;
  readonly parentUid: string;
  readonly collection: string;
  readonly reference: string;
  readonly segmentIds: readonly string[];
}

function main(): void {
  const options = readOptions(process.argv.slice(2));
  ensureCheckout(options);

  const suttas = readSuttas(options);
  console.log(`read ${String(suttas.length)} suttas`);

  if (options.reference) {
    const chosen = selectPassages(suttas, options);
    writeOutput(chosen.passages, chosen.byUid, options);
    return;
  }

  // A second language re-derives nothing. Which segments make a passage was
  // settled once, in the reference language, and written to selection.json —
  // that split is the whole parameterisation (SPEC.md §3 step 6). All this run
  // does is render those same segments from another translation.
  renderExisting(suttas, options);
}

function renderExisting(suttas: readonly Sutta[], options: Options): void {
  const selectionPath = join(OUT, 'selection.json');
  if (!existsSync(selectionPath)) {
    throw new Error(`no ${selectionPath}: build the reference language first`);
  }
  const selection = JSON.parse(readFileSync(selectionPath, 'utf8')) as {
    passages: { uid: string; parentUid: string; collection: string; segmentIds: string[] }[];
  };

  const byUid = new Map(suttas.map((sutta) => [sutta.uid, sutta]));
  const covered: Passage[] = [];
  let missing = 0;

  for (const entry of selection.passages) {
    const sutta = byUid.get(entry.uid);
    // Not every language has every collection translated. A language legitimately
    // covers a subset; the app falls back per passage (SPEC.md §3 step 6).
    if (sutta === undefined || !entry.segmentIds.every((id) => sutta.segments.some((s) => s.id === id))) {
      missing += 1;
      continue;
    }
    const collection = COLLECTIONS.find((c) => c.code === entry.collection);
    covered.push({
      uid: entry.uid,
      parentUid: entry.parentUid,
      collection: entry.collection,
      reference: `${collection?.reference ?? entry.collection} ${entry.uid.replace(entry.collection, '')}`,
      segmentIds: entry.segmentIds,
    });
  }

  const total = selection.passages.length;
  console.log(
    `\ncovered ${String(covered.length)} of ${String(total)} passages` +
      ` (${String(Math.round((covered.length / total) * 100))}%), ${String(missing)} not translated`,
  );
  writeOutput(covered, byUid, options);
}

function readOptions(argv: readonly string[]): Options {
  const value = (name: string, fallback: string): string => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? (argv[at + 1] ?? fallback) : fallback;
  };
  return {
    lang: value('lang', process.env['LANG_CODE'] ?? 'en'),
    translator: value('translator', process.env['TRANSLATOR'] ?? 'sujato'),
    // The 60-word cap and the choice of segments are validated against one
    // language only. Word counts differ between languages; the structure must not.
    reference: !argv.includes('--secondary'),
  };
}

/**
 * Shallow, blobless, sparse. The Pali root text is deliberately not fetched —
 * it is never displayed (SPEC.md §15). The html tree is, because it carries the
 * verse markup that says which segments are verse, and that is a structural
 * fact shared by every language.
 */
function ensureCheckout(options: Options): void {
  if (!existsSync(CACHE)) {
    console.log(`cloning ${SOURCE_REPO} (${SOURCE_BRANCH})`);
    mkdirSync(dirname(CACHE), { recursive: true });
    run('git', [
      'clone', '--depth', '1', '--filter=blob:none', '--sparse',
      '-b', SOURCE_BRANCH, SOURCE_REPO, CACHE,
    ]);
  }
  const paths = [
    `translation/${options.lang}/${options.translator}`,
    ...COLLECTIONS.map((collection) => `html/pli/ms/sutta/${collection.dir}`),
  ];
  run('git', ['-C', CACHE, 'sparse-checkout', 'set', ...paths]);
}

function run(command: string, args: readonly string[]): string {
  return execFileSync(command, args as string[], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function readSuttas(options: Options): Sutta[] {
  const suttas: Sutta[] = [];

  for (const collection of COLLECTIONS) {
    const root = join(CACHE, 'translation', options.lang, options.translator, 'sutta', collection.dir);
    if (!existsSync(root)) {
      console.log(`  ${collection.code}: absent for ${options.lang}, skipped`);
      continue;
    }

    let found = 0;
    for (const file of jsonFilesUnder(root)) {
      const text = readJson(file);
      const markup = readJson(htmlPathFor(file, options));
      const parentUid = uidFromFilename(file);

      for (const [uid, ids] of groupByUid(Object.keys(text))) {
        const segments: Segment[] = [];
        const titleParts: string[] = [];

        for (const id of ids) {
          const raw = (text[id] ?? '').trim();
          const html = markup[id] ?? '';
          if (raw === '') continue;
          if (isHeading(id)) {
            titleParts.push(raw);
            continue;
          }
          segments.push({
            id,
            text: raw,
            verse: html.includes('verse-line'),
            opensBlock: html.includes('<p') || html.includes('<blockquote'),
          });
        }

        if (segments.length === 0) continue;
        suttas.push({
          uid,
          parentUid,
          collection,
          title: titleParts.at(-1) ?? uid,
          segments,
        });
        found += 1;
      }
    }
    console.log(`  ${collection.code}: ${String(found)} suttas`);
  }

  return suttas;
}

function selectPassages(
  suttas: readonly Sutta[],
  options: Options,
): { passages: Passage[]; byUid: Map<string, Sutta> } {
  const passages: Passage[] = [];
  const byUid = new Map<string, Sutta>();
  const kept: Set<string>[] = [];

  let noVerse = 0;
  let tooLong = 0;
  let duplicate = 0;

  for (const sutta of suttas) {
    const block = choosePassage(sutta);
    if (block === null) {
      noVerse += 1;
      continue;
    }

    const words = block.map((segment) => segment.text).join(' ');
    if (options.reference && countWords(words) > MAX_WORDS) {
      tooLong += 1;
      continue;
    }

    // The peyyāla series repeat one text with a single term swapped, dozens of
    // times over. Pulling from them at random serves the same passage all week.
    // Compared across the whole corpus, not within a collection: the Mettā and
    // Maṅgala suttas appear in both Khuddakapāṭha and the Sutta Nipāta, and the
    // day's passage should not be the same text under two names.
    const tokens = normalise(words);
    if (kept.some((seen) => similarity(seen, tokens) >= DUPLICATE_SIMILARITY)) {
      duplicate += 1;
      continue;
    }
    kept.push(tokens);

    passages.push({
      uid: sutta.uid,
      parentUid: sutta.parentUid,
      collection: sutta.collection.code,
      reference: `${sutta.collection.reference} ${sutta.uid.replace(sutta.collection.code, '')}`,
      segmentIds: block.map((segment) => segment.id),
    });
    byUid.set(sutta.uid, sutta);
  }

  console.log(
    `\nselected ${String(passages.length)} passages` +
      `\n  skipped, no verse that stands alone: ${String(noVerse)}` +
      `\n  skipped, over ${String(MAX_WORDS)} words: ${String(tooLong)}` +
      `\n  dropped as near-duplicates: ${String(duplicate)}`,
  );
  return { passages, byUid };
}

/** Null when nothing in this sutta stands on its own. Bias is toward null. */
function choosePassage(sutta: Sutta): Segment[] | null {
  const blocks = verseBlocks(sutta.segments);
  if (blocks.length === 0) return null;

  if (sutta.collection.policy !== 'whole') {
    // The sutta ends in an utterance. That block is the passage; the prose
    // around it is the scene, and the scene is what the full discourse is for.
    return blocks.at(-1) ?? null;
  }

  // The sutta is a verse. Take all of it if it fits.
  const whole = blocks.flat();
  if (countWords(whole.map((segment) => segment.text).join(' ')) <= MAX_WORDS) return whole;

  // It does not fit, so it is a long poem — Mettā and Maṅgala are both a single
  // blockquote of ten stanzas. Fall back to one stanza, and only one that reads
  // without the rest of the poem around it. Most do not, and are skipped.
  for (const stanza of stanzasOf(whole)) {
    const text = stanza.map((segment) => segment.text).join(' ');
    if (countWords(text) <= MAX_WORDS && standsAlone(text)) return stanza;
  }
  return null;
}

/** Segment ids carry the stanza: `snp1.8:3.2` is the second line of stanza 3. */
function stanzasOf(segments: readonly Segment[]): Segment[][] {
  const stanzas = new Map<string, Segment[]>();
  for (const segment of segments) {
    const key = segment.id.slice(segment.id.indexOf(':') + 1).split('.')[0] ?? '';
    const group = stanzas.get(key);
    if (group === undefined) stanzas.set(key, [segment]);
    else group.push(segment);
  }
  return [...stanzas.values()];
}

/**
 * Words that make a line depend on the line before it. A stanza opening with
 * one of these is the middle of a thought, whatever else it has going for it.
 */
const CONTINUATIONS = new Set([
  'and', 'but', 'or', 'nor', 'yet', 'so', 'then', 'for', 'thus', 'therefore',
  'that', 'this', 'these', 'those', 'such', 'it', 'they', 'he', 'she', 'him',
  'her', 'them', 'who', 'whom', 'whose', 'which', 'where', 'when', 'while',
  'both', 'also', 'again', 'still', 'there',
]);

function standsAlone(text: string): boolean {
  const trimmed = text.trim();
  const first = trimmed.replace(/^[^\p{Letter}]+/u, '').split(/\s+/)[0] ?? '';
  if (CONTINUATIONS.has(first.toLowerCase())) return false;
  // A stanza that does not finish a sentence is not finished.
  return /[.!?][”"’']?$/.test(trimmed);
}

function verseBlocks(segments: readonly Segment[]): Segment[][] {
  const blocks: Segment[][] = [];
  let current: Segment[] = [];
  for (const segment of segments) {
    if (segment.verse) {
      current.push(segment);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function writeOutput(passages: readonly Passage[], byUid: Map<string, Sutta>, options: Options): void {
  const langDir = join(OUT, options.lang);
  if (options.reference) {
    mkdirSync(OUT, { recursive: true });
  }
  rmSync(join(langDir, 'suttas'), { recursive: true, force: true });
  mkdirSync(join(langDir, 'suttas'), { recursive: true });

  if (options.reference) {
    writeJson(join(OUT, 'selection.json'), {
      passages: passages.map((passage) => ({
        uid: passage.uid,
        parentUid: passage.parentUid,
        collection: passage.collection,
        segmentIds: passage.segmentIds,
      })),
    });
    // A fixed shuffle, seeded so that rebuilding does not reshuffle the year.
    writeJson(join(OUT, 'order.json'), shuffle(passages.map((passage) => passage.uid)));
    writeJson(join(OUT, 'SOURCE'), {
      repository: SOURCE_REPO,
      branch: SOURCE_BRANCH,
      commit: run('git', ['-C', CACHE, 'rev-parse', 'HEAD']).trim(),
      extracted: new Date().toISOString().slice(0, 10),
    });
  }

  const rendered: Record<string, { text: string; reference: string; title: string; parentUid: string }> = {};
  for (const passage of passages) {
    const sutta = byUid.get(passage.uid);
    if (sutta === undefined) continue;
    const lines = passage.segmentIds
      .map((id) => sutta.segments.find((segment) => segment.id === id)?.text ?? '')
      .filter((line) => line !== '');
    rendered[passage.uid] = {
      text: lines.join('\n'),
      reference: passage.reference,
      title: sutta.title,
      parentUid: passage.parentUid,
    };
  }
  writeJson(join(langDir, 'passages.json'), rendered);

  const written = new Set<string>();
  for (const passage of passages) {
    if (written.has(passage.parentUid)) continue;
    written.add(passage.parentUid);
    const family = [...byUid.values()].filter((sutta) => sutta.parentUid === passage.parentUid);
    writeJson(join(langDir, 'suttas', `${passage.parentUid}.json`), {
      uid: passage.parentUid,
      title: family[0]?.title ?? passage.parentUid,
      reference: passage.reference,
      blocks: family.flatMap((sutta) => blocksOf(sutta.segments)),
    });
  }

  mergeLanguages(options);
  console.log(`\nwrote ${String(passages.length)} passages and ${String(written.size)} discourses to ${langDir}`);
}

/** Group segments into paragraphs and stanzas, so the view can just render them. */
function blocksOf(segments: readonly Segment[]): { kind: 'prose' | 'verse'; lines: string[] }[] {
  const blocks: { kind: 'prose' | 'verse'; lines: string[] }[] = [];
  for (const segment of segments) {
    const kind = segment.verse ? 'verse' : 'prose';
    const last = blocks.at(-1);
    if (last === undefined || last.kind !== kind || (segment.opensBlock && kind === 'prose')) {
      blocks.push({ kind, lines: [segment.text] });
    } else {
      last.lines.push(segment.text);
    }
  }
  return blocks;
}

function mergeLanguages(options: Options): void {
  const path = join(OUT, 'languages.json');
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { code: string; translator: string }[])
    : [];
  const others = existing.filter((entry) => entry.code !== options.lang);
  writeJson(path, [...others, { code: options.lang, translator: options.translator }].sort((a, b) => a.code.localeCompare(b.code)));
}

// ---------------------------------------------------------------- utilities

function jsonFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...jsonFilesUnder(path));
    else if (entry.name.endsWith('.json')) found.push(path);
  }
  return found.sort();
}

function readJson(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

function htmlPathFor(file: string, options: Options): string {
  return file
    .replace(join('translation', options.lang, options.translator), join('html', 'pli', 'ms'))
    .replace(`_translation-${options.lang}-${options.translator}.json`, '_html.json');
}

function uidFromFilename(file: string): string {
  return basename(file).replace(/_.*$/, '');
}

function groupByUid(ids: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const uid = id.slice(0, id.indexOf(':'));
    const group = groups.get(uid);
    if (group === undefined) groups.set(uid, [id]);
    else group.push(id);
  }
  return groups;
}

/** `:0.x` carries collection, chapter and title, never the text itself. */
function isHeading(id: string): boolean {
  return /:0\./.test(id);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** Lowercased, stripped of punctuation, for comparing one passage to another. */
function normalise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{Letter}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word !== ''),
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(a.size, b.size, 1);
}

/**
 * Deterministic shuffle. The order must be fixed so every device shows the same
 * passage on the same day, and stable so that rebuilding does not reshuffle it.
 */
function shuffle(ids: readonly string[]): string[] {
  const out = [...ids];
  let seed = 0x9e3779b9;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, path.endsWith('SOURCE') ? 2 : 0)}\n`);
}

main();
