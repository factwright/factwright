// Draws the web view's home-screen icons from Factwright's mark: its check, on the accent color.
// They fill the whole square, since phones round the corners themselves, and the check stays
// inside the middle that Android's masks keep. Run it again after changing the mark.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

type Point = readonly [number, number];

const ACCENT = { r: 0x2f, g: 0x4b, b: 0xd0 };
const INK = { r: 0xff, g: 0xff, b: 0xff };

/** The check, on the mark's 24-unit grid, where the box runs from 2 to 22. */
const START: Point = [7.5, 12.5];
const CORNER: Point = [10.5, 15.5];
const END: Point = [16.5, 8.5];
const STROKE = 2.2;

const SIZES = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

/** How far a point is from a line segment. */
function distance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const mix = (from: number, to: number, amount: number) => Math.round(from + (to - from) * amount);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A square PNG of the icon, with the check's edges smoothed. */
function icon(size: number): Buffer {
  const scale = size / 20;
  const place = ([x, y]: Point): Point => [(x - 2) * scale, (y - 2) * scale];
  const [start, corner, end] = [place(START), place(CORNER), place(END)];
  const half = (STROKE * scale) / 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    // Each row starts with its filter type: none.
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const pixel: Point = [x + 0.5, y + 0.5];
      const away = Math.min(distance(pixel, start, corner), distance(pixel, corner, end));
      const cover = Math.max(0, Math.min(1, half - away + 0.5));
      row.set(
        [mix(ACCENT.r, INK.r, cover), mix(ACCENT.g, INK.g, cover), mix(ACCENT.b, INK.b, cover)],
        1 + x * 3,
      );
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of Object.entries(SIZES)) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), icon(size));
}
