/**
 * Factwright's mark, and the app icon drawn from it. The mark is two lines of a resume, each
 * hanging from a ring on one thread that runs down to a solid dot: every line traces back to a
 * fact. It's drawn on the app icon's 120-unit square.
 */

/** One cut of the mark, in units of the app icon's 120-unit square. */
export interface MarkCut {
  /** The rings the lines hang from: their centers, radius and stroke. */
  rings: readonly (readonly [cx: number, cy: number])[];
  ringRadius: number;
  ringStroke: number;
  /** The solid dot the thread runs down to: the fact. */
  dot: readonly [cx: number, cy: number, r: number];
  /** The thread between the rings and the dot, as vertical runs. */
  links: readonly (readonly [x: number, top: number, bottom: number])[];
  linkStroke: number;
  /** The two lines, with round ends. */
  lines: readonly (readonly [x: number, y: number, width: number])[];
  lineHeight: number;
}

/** The mark as it's drawn above 28 px. */
export const MARK: MarkCut = {
  rings: [
    [31, 32],
    [31, 60],
  ],
  ringRadius: 7.5,
  ringStroke: 5,
  dot: [31, 88, 10],
  links: [
    [31, 42, 50],
    [31, 70, 78],
  ],
  linkStroke: 5,
  lines: [
    [48, 25, 50],
    [48, 53, 32],
  ],
  lineHeight: 14,
};

/** A heavier cut for 28 px and below, such as the top bar and a browser tab, so the rings stay open. */
export const MARK_SMALL: MarkCut = {
  rings: [
    [31, 32],
    [31, 60],
  ],
  ringRadius: 8,
  ringStroke: 7,
  dot: [31, 88, 11.5],
  links: [
    [31, 43.5, 48.5],
    [31, 71.5, 76.5],
  ],
  linkStroke: 6,
  lines: [
    [49, 23.5, 49],
    [49, 51.5, 31],
  ],
  lineHeight: 17,
};

/** The cut to draw at a size, in px. */
export function markCut(size: number): MarkCut {
  return size <= 28 ? MARK_SMALL : MARK;
}

/** A square that frames either cut on its own, as an SVG viewBox. */
export const MARK_VIEWBOX = '19 20 80 80';

/** The mark as SVG elements in one color, for files made outside React, such as icons. */
export function markSvg(cut: MarkCut, color: string): string {
  const thread = cut.links.map(([x, top, bottom]) => `M${x} ${top}V${bottom}`).join('');
  return [
    `<path d="${thread}" stroke="${color}" stroke-width="${cut.linkStroke}"/>`,
    ...cut.rings.map(
      ([cx, cy]) =>
        `<circle cx="${cx}" cy="${cy}" r="${cut.ringRadius}" fill="none" stroke="${color}" stroke-width="${cut.ringStroke}"/>`,
    ),
    `<circle cx="${cut.dot[0]}" cy="${cut.dot[1]}" r="${cut.dot[2]}" fill="${color}"/>`,
    ...cut.lines.map(
      ([x, y, width]) =>
        `<rect x="${x}" y="${y}" width="${width}" height="${cut.lineHeight}" rx="${cut.lineHeight / 2}" fill="${color}"/>`,
    ),
  ].join('');
}

/** The app icon's colors: the mark in white, on a blue that deepens toward the bottom. */
export const APP_ICON = {
  top: '#4260E4',
  bottom: '#2741BE',
  mark: '#FFFFFF',
  /** The soft shadow under the mark. */
  shade: '#0A1450',
} as const;

export interface AppIconOptions {
  /** The icon's width and height, in px. */
  size: number;
  /**
   * `square` fills the image, for phones and browsers that round the corners themselves. `mac`
   * draws the Mac's rounded square on Apple's icon grid, with its shadow.
   */
  shape: 'square' | 'mac';
  /** The mark's size against its full size. Home-screen icons shrink it to stay inside Android's masks. */
  markScale?: number;
}

/**
 * The app icon as a PNG. It's drawn with plain math and the platform's own compression, so it
 * needs no browser or image library, and draws the same pixels everywhere.
 */
export async function appIconPng({
  size,
  shape,
  markScale = 1,
}: AppIconOptions): Promise<Uint8Array> {
  const mac = shape === 'mac';
  // Apple's grid puts an 824 px rounded square in the middle of a 1024 px canvas.
  const inset = mac ? (size * 100) / 1024 : 0;
  const body = size - 2 * inset;
  const unit = body / 120;
  const top = rgb(APP_ICON.top);
  const bottom = rgb(APP_ICON.bottom);
  const mark = rgb(APP_ICON.mark);
  const shade = rgb(APP_ICON.shade);

  /** How far a pixel is from the mark, in px: negative inside. */
  const fromMark = (x: number, y: number) => {
    // The mark's ink is centered on (59.5, 60), and sits 2 units right of the icon's middle.
    const u = 59.5 + ((x - inset) / unit - 61.5) / markScale;
    const v = 60 + ((y - inset) / unit - 60) / markScale;
    return markDistance(MARK, u, v) * markScale * unit;
  };

  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const [x, y] = [column + 0.5, row + 0.5];
      const paint = new Paint();
      let inBody = 1;
      if (mac) {
        const shadow = squircleDistance(x, y - size * 0.012, size / 2, body / 2);
        paint.over(BLACK, 0.3 * fade(shadow, size * 0.028));
        inBody = cover(squircleDistance(x, y, size / 2, body / 2));
      }
      paint.over(mix(top, bottom, Math.min(Math.max((y - inset) / body, 0), 1)), inBody);
      paint.over(shade, 0.28 * inBody * fade(fromMark(x, y - 1.2 * unit), 1.6 * unit));
      paint.over(mark, inBody * cover(fromMark(x, y)));
      paint.write(pixels, (row * size + column) * 4);
    }
  }
  return encodePng(size, size, pixels);
}

/** The Mac disk image window's colors: the app's paper, with an arrow in its blue. */
export const DISK_IMAGE = {
  top: '#FAF9F6',
  bottom: '#F1EFE8',
  arrow: '#2F4BD0',
} as const;

/** Where the disk image's window shows its two icons, in points from its top left. */
export interface DiskImageLayout {
  window: { width: number; height: number };
  /** The icons' width and height. */
  iconSize: number;
  /** The centers of the app's icon and of the Applications folder. */
  app: { x: number; y: number };
  applications: { x: number; y: number };
}

/**
 * The picture behind the Mac disk image's window: an arrow from the app to the Applications
 * folder, to drag it onto. Finder keeps a window with a picture light, even in dark mode, and
 * labels its icons in black, so it's drawn for light. `scale` is pixels per point: 2 for Retina.
 */
export async function diskImagePng(layout: DiskImageLayout, scale: number): Promise<Uint8Array> {
  const width = Math.round(layout.window.width * scale);
  const height = Math.round(layout.window.height * scale);
  const top = rgb(DISK_IMAGE.top);
  const bottom = rgb(DISK_IMAGE.bottom);
  const arrow = rgb(DISK_IMAGE.arrow);
  // The arrow runs level between the icons, clear of each, in points.
  const clear = layout.iconSize / 2 + 22;
  const y = layout.app.y;
  const tail = layout.app.x + clear;
  const tip = layout.applications.x - clear;
  const half = 1.25;
  const head = 8;

  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      // The pixel's middle, in points.
      const [x, py] = [(column + 0.5) / scale, (row + 0.5) / scale];
      const fromArrow = Math.min(
        segmentDistance(x, py, tail, y, tip, y),
        segmentDistance(x, py, tip, y, tip - head, y - head),
        segmentDistance(x, py, tip, y, tip - head, y + head),
      );
      const paint = new Paint();
      paint.over(mix(top, bottom, row / Math.max(height - 1, 1)), 1);
      paint.over(arrow, cover((fromArrow - half) * scale));
      paint.write(pixels, (row * width + column) * 4);
    }
  }
  return encodePng(width, height, pixels);
}

/** How far a point is from a line segment. */
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const [dx, dy] = [bx - ax, by - ay];
  const along = Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0), 1);
  return Math.hypot(x - (ax + along * dx), y - (ay + along * dy));
}

/** How far a point is from the mark's ink, in the mark's units: negative inside. */
function markDistance(cut: MarkCut, x: number, y: number): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const [cx, cy] of cut.rings) {
    const ring = Math.abs(Math.hypot(x - cx, y - cy) - cut.ringRadius) - cut.ringStroke / 2;
    distance = Math.min(distance, ring);
  }
  const [dotX, dotY, dotRadius] = cut.dot;
  distance = Math.min(distance, Math.hypot(x - dotX, y - dotY) - dotRadius);
  for (const [linkX, top, bottom] of cut.links) {
    const link = box(x - linkX, y - (top + bottom) / 2, cut.linkStroke / 2, (bottom - top) / 2);
    distance = Math.min(distance, link);
  }
  const half = cut.lineHeight / 2;
  for (const [lineX, lineY, width] of cut.lines) {
    // A line with round ends is everything within half its height of its middle stretch.
    const along = Math.min(Math.max(x, lineX + half), lineX + width - half);
    distance = Math.min(distance, Math.hypot(x - along, y - (lineY + half)) - half);
  }
  return distance;
}

/** How far a point is from a box centered on the origin: negative inside. */
function box(x: number, y: number, halfWidth: number, halfHeight: number): number {
  const outX = Math.abs(x) - halfWidth;
  const outY = Math.abs(y) - halfHeight;
  return Math.hypot(Math.max(outX, 0), Math.max(outY, 0)) + Math.min(Math.max(outX, outY), 0);
}

/**
 * About how far a point is from the Mac's rounded square, a superellipse, in px: the curve's
 * value over its slope, which is close enough near the edge to smooth it.
 */
function squircleDistance(x: number, y: number, center: number, half: number): number {
  const dx = Math.abs(x - center) / half;
  const dy = Math.abs(y - center) / half;
  const slope = (5 / half) * Math.hypot(dx ** 4, dy ** 4);
  return slope > 1e-9 ? (dx ** 5 + dy ** 5 - 1) / slope : -half;
}

/** How much of a pixel a shape covers, from the pixel's distance to its edge. */
function cover(distance: number): number {
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

/** A soft edge, for shadows: 1 well inside the shape, 0 a `width` beyond it. */
function fade(distance: number, width: number): number {
  const t = Math.min(Math.max((width - distance) / (2 * width), 0), 1);
  return t * t * (3 - 2 * t);
}

type Rgb = readonly [red: number, green: number, blue: number];

const BLACK: Rgb = [0, 0, 0];

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const at = (i: 0 | 1 | 2) => from[i] + (to[i] - from[i]) * amount;
  return [at(0), at(1), at(2)];
}

/** One pixel, painted in layers, each over the ones before. Colors are kept premultiplied. */
class Paint {
  red = 0;
  green = 0;
  blue = 0;
  alpha = 0;

  over([red, green, blue]: Rgb, alpha: number): void {
    this.red = red * alpha + this.red * (1 - alpha);
    this.green = green * alpha + this.green * (1 - alpha);
    this.blue = blue * alpha + this.blue * (1 - alpha);
    this.alpha = alpha + this.alpha * (1 - alpha);
  }

  write(into: Uint8Array, at: number): void {
    const byte = (value: number) => Math.round(this.alpha > 0 ? (value / this.alpha) * 255 : 0);
    into.set([byte(this.red), byte(this.green), byte(this.blue), Math.round(this.alpha * 255)], at);
  }
}

/** An 8-bit RGBA PNG. */
async function encodePng(width: number, height: number, pixels: Uint8Array): Promise<Uint8Array> {
  const stride = width * 4;
  // Each row starts with its filter type: none.
  const rows = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    rows.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Deflates in zlib's wrapper, as PNG wants, with the platform's own compression. */
async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const written = writer.write(data).then(() => writer.close());
  const parts: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    parts.push(part.value);
  }
  await written;
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
