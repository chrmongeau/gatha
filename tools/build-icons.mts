/**
 * The app icon, drawn rather than designed in a file.
 *
 *   npm run icons
 *
 * The mark is the app's own: the incised line of SPEC.md §9 with the notches
 * that stand for interval bells, bronze on ink. It is generated because a
 * committed PNG is a thing nobody can edit and everybody has to trust, and
 * because encoding one costs fifty lines of `node:zlib` — where the alternative
 * is putting an image library back into a project that no longer has one.
 *
 * Everything sits inside the middle 60% so the icon survives a maskable crop,
 * which takes the inner 80% circle.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/icons';

/** SPEC.md §9, and the same values the stylesheet resolves to. */
const INK: RGB = [0x12, 0x15, 0x11];
const BRONZE: RGB = [0x8e, 0x7b, 0x4a];
/** 32% leaf over ink: the part of the line not yet cut. */
const TRACK: RGB = [0x51, 0x50, 0x47];
/** 80% leaf over ink: the part already cut. */
const CUT: RGB = [0xb0, 0xaa, 0x98];

const SIZES = [48, 180, 192, 512] as const;

type RGB = readonly [number, number, number];

function main(): void {
  mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    const file = join(OUT, `icon-${String(size)}.png`);
    writeFileSync(file, encodePng(size, size, draw(size)));
    console.log(`  ${file}`);
  }
}

/**
 * A sit in progress, which is the one image this app has: the line cut from the
 * left as far as it has got, the rest still to come, and the interval bells
 * notched into it — one behind, one ahead. Proportions rather than pixels, so 48
 * and 512 are the same drawing.
 */
function draw(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  fill(pixels, size, INK);

  const at = (fraction: number): number => Math.round(size * fraction);

  const weight = Math.max(1, at(0.045));
  const left = at(0.16);
  const right = at(0.84);
  const span = right - left;
  const top = Math.round((size - weight) / 2);

  // Half still to run, one bell behind and one ahead.
  rect(pixels, size, left, top, span, weight, TRACK);
  rect(pixels, size, left, top, Math.round(span * 0.52), weight, CUT);

  const notchHeight = Math.max(3, at(0.11));
  for (const position of [1 / 3, 2 / 3]) {
    rect(
      pixels,
      size,
      Math.round(left + span * position - weight / 2),
      Math.round(top + weight / 2 - notchHeight / 2),
      weight,
      notchHeight,
      BRONZE,
    );
  }

  return pixels;
}

function fill(pixels: Uint8Array, size: number, colour: RGB): void {
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 3] = colour[0];
    pixels[i * 3 + 1] = colour[1];
    pixels[i * 3 + 2] = colour[2];
  }
}

function rect(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: RGB,
): void {
  for (let row = Math.max(0, y); row < Math.min(size, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(size, x + width); column += 1) {
      const at = (row * size + column) * 3;
      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
    }
  }
}

/** Truecolour, 8 bits a channel, no filtering. The smallest PNG that says this. */
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.subarray(row * stride, (row + 1) * stride)).copy(
      raw,
      row * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10, 11, 12 are compression, filter and interlace methods, all zero.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

main();
