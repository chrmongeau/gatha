/**
 * assets/imagery → public/imagery
 *
 * Run by hand when images are added, not on every build. See SPEC.md §8.
 *
 *   npm run imagery
 *
 * Curated at build time and committed, never fetched at runtime: Unsplash Source
 * has been switched off entirely, and the full API needs a key that cannot be
 * kept secret in a client-side app. Processing here means the app ships fixed,
 * offline-capable files with a consistent visual register, which a random API
 * would never give.
 *
 * Photographs are not in this repository yet. The pipeline runs against an empty
 * directory without complaint, so adding them later is a data operation: drop
 * files in `assets/imagery/`, name the photographer in `credits.json`, rerun.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';

const SOURCE = 'assets/imagery';
const OUT = 'public/imagery';
const CREDITS = join(SOURCE, 'credits.json');

/** One for a phone, one for everything larger. */
const WIDTHS = [900, 1600] as const;

/** SPEC.md §8. Quality is stepped down until a file fits. */
const MAX_BYTES = 150 * 1024;
const QUALITY_STEPS = [62, 54, 46, 38, 30, 24, 18];

/** The placeholder: sixteen pixels, so nothing pops in. */
const PLACEHOLDER_SIZE = 4;

const SOURCE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

interface Credit {
  readonly photographer: string;
  readonly url?: string;
  readonly license?: string;
}

interface Entry {
  readonly id: string;
  /** Width over height, so the view can reserve space and never shift. */
  readonly aspect: number;
  readonly widths: number[];
  /** A 4×4 average as a data URI, scaled up under the real image while it loads. */
  readonly placeholder: string;
  readonly credit: Credit | null;
}

async function main(): Promise<void> {
  const credits = readCredits();
  const sources = existsSync(SOURCE)
    ? readdirSync(SOURCE).filter((name) => SOURCE_TYPES.has(extname(name).toLowerCase())).sort()
    : [];

  // Cleared either way. Removing an image from the source directory has to
  // remove what was generated from it, or the old file lingers in the deploy.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  if (sources.length === 0) {
    console.log(`no images in ${SOURCE}/ — writing an empty manifest`);
    write([]);
    return;
  }

  const entries: Entry[] = [];
  const oversize: string[] = [];
  let uncredited = 0;

  for (const name of sources) {
    const id = basename(name, extname(name));
    const entry = await processImage(join(SOURCE, name), id, credits[id] ?? null, oversize);
    if (entry.credit === null) uncredited += 1;
    entries.push(entry);
  }

  write(entries);
  console.log(`\nwrote ${String(entries.length)} images to ${OUT}`);
  if (uncredited > 0) {
    console.log(`  ${String(uncredited)} without a photographer in ${CREDITS}`);
  }

  // Reported at the end and with a non-zero exit, because a warning in the
  // middle of a long run is a warning nobody reads. The files are still
  // written: which image to re-crop or drop is a judgement, not the tool's.
  if (oversize.length > 0) {
    console.error(
      `\n${String(oversize.length)} file(s) over ${String(MAX_BYTES / 1024)}KB even at the lowest quality:`,
    );
    for (const file of oversize) console.error(`  ${file}`);
    console.error('\nCrop them tighter, or leave them out.');
    process.exitCode = 1;
  }
}

async function processImage(
  path: string,
  id: string,
  credit: Credit | null,
  oversize: string[],
): Promise<Entry> {
  const image = sharp(path).rotate(); // Honour EXIF orientation before anything else.
  const { width, height } = await image.metadata();
  // Typed as always present, but a truncated file is a thing that happens.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${path}: no usable dimensions`);
  }

  const widths: number[] = [];
  for (const target of WIDTHS) {
    // Never upscale: a small original stays small rather than being blurred up.
    const at = Math.min(target, width);
    if (widths.includes(at)) continue;
    widths.push(at);

    for (const format of ['avif', 'webp'] as const) {
      const bytes = await encode(path, at, format);
      writeFileSync(join(OUT, `${id}-${String(at)}.${format}`), bytes);
      const kb = (bytes.length / 1024).toFixed(0);
      const name = `${id}-${String(at)}.${format}`;
      if (bytes.length > MAX_BYTES) oversize.push(`${name} (${kb}KB)`);
      console.log(`  ${name.padEnd(24)} ${kb.padStart(4)}KB${bytes.length > MAX_BYTES ? '  OVER' : ''}`);
    }
  }

  const placeholder = await sharp(path)
    .rotate()
    .resize(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    id,
    aspect: Number((width / height).toFixed(4)),
    widths,
    placeholder: `data:image/png;base64,${placeholder.toString('base64')}`,
    credit,
  };
}

/** Step the quality down until the file fits, rather than shipping a heavy one. */
async function encode(path: string, width: number, format: 'avif' | 'webp'): Promise<Buffer> {
  let last: Buffer | null = null;
  for (const quality of QUALITY_STEPS) {
    const pipeline = sharp(path).rotate().resize({ width, withoutEnlargement: true });
    last =
      format === 'avif'
        ? await pipeline.avif({ quality, effort: 4 }).toBuffer()
        : await pipeline.webp({ quality, effort: 5 }).toBuffer();
    if (last.length <= MAX_BYTES) return last;
  }
  return last ?? Buffer.alloc(0);
}

function readCredits(): Record<string, Credit> {
  if (!existsSync(CREDITS)) return {};
  try {
    return JSON.parse(readFileSync(CREDITS, 'utf8')) as Record<string, Credit>;
  } catch {
    console.log(`  ${CREDITS} could not be read; continuing without credits`);
    return {};
  }
}

function write(entries: readonly Entry[]): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(entries)}\n`);
}

await main();
