// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  APP_ICON,
  appIconPng,
  type DiskImageLayout,
  diskImagePng,
  INSTALL_HEADER,
  installHeaderBmp,
  MARK,
  MARK_SMALL,
  markCut,
  markSvg,
} from './brand.ts';

/** Reads an 8-bit RGBA PNG back into its size and pixels. */
async function decode(
  png: Uint8Array,
): Promise<{ width: number; height: number; pixel: (x: number, y: number) => number[] }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const data: number[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') data.push(...png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const inflated = new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const stride = width * 4 + 1;
  return {
    width,
    height,
    pixel: (x, y) => [...inflated.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)],
  };
}

describe('the mark', () => {
  it('uses the heavier cut up to 28 px, so its rings stay open', () => {
    expect(markCut(16)).toBe(MARK_SMALL);
    expect(markCut(28)).toBe(MARK_SMALL);
    expect(markCut(29)).toBe(MARK);
  });

  it('draws two rings, a dot and two lines on one thread', () => {
    const svg = markSvg(MARK, 'red');
    expect(svg.match(/<circle [^>]*fill="none"/g)).toHaveLength(2);
    expect(svg.match(/<circle [^>]*fill="red"/g)).toHaveLength(1);
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).toContain('d="M31 42V50M31 70V78"');
  });

  it('joins the rings and the dot with its thread, in both cuts', () => {
    for (const cut of [MARK, MARK_SMALL]) {
      const outer = cut.ringRadius + cut.ringStroke / 2;
      const [, dotY, dotRadius] = cut.dot;
      // Where each shape on the thread starts and ends, top to bottom.
      const shapes = [
        ...cut.rings.map(([, cy]) => [cy - outer, cy + outer]),
        [dotY - dotRadius, dotY + dotRadius],
      ];
      cut.links.forEach(([, top, bottom], i) => {
        expect(top).toBe(shapes[i]?.[1]);
        expect(bottom).toBe(shapes[i + 1]?.[0]);
      });
    }
  });
});

describe('the app icon', () => {
  it('sits on the Mac’s grid: clear corners, a blue body, and the mark in white', async () => {
    const icon = await decode(await appIconPng({ size: 256, shape: 'mac' }));
    expect([icon.width, icon.height]).toEqual([256, 256]);
    expect(icon.pixel(0, 0)[3]).toBe(0);
    // Apple's grid insets the body by 100 of 1024, and the mark sits 2 units right.
    const unit = (256 * 824) / 1024 / 120;
    const at = (u: number, v: number) =>
      icon.pixel(Math.floor(25 + u * unit), Math.floor(25 + v * unit));
    expect(at(33, 88)).toEqual([255, 255, 255, 255]);
    const [red, green, blue, alpha] = at(100, 100);
    expect(alpha).toBe(255);
    expect(blue).toBeGreaterThan((red ?? 0) + 100);
    expect(blue).toBeGreaterThan((green ?? 0) + 100);
  });

  it('fills the whole square for phones, which round the corners themselves', async () => {
    const icon = await decode(await appIconPng({ size: 180, shape: 'square', markScale: 0.86 }));
    expect(icon.pixel(0, 0)[3]).toBe(255);
    expect(icon.pixel(179, 179)[3]).toBe(255);
  });
});

describe('the Mac disk image’s window', () => {
  const layout: DiskImageLayout = {
    window: { width: 560, height: 340 },
    iconSize: 96,
    app: { x: 150, y: 160 },
    applications: { x: 410, y: 160 },
  };

  it('fills the window, twice over for Retina, with an arrow from the app to Applications', async () => {
    for (const scale of [1, 2]) {
      const picture = await decode(await diskImagePng(layout, scale));
      expect([picture.width, picture.height]).toEqual([560 * scale, 340 * scale]);
      // The arrow, in the app's blue, halfway between the icons.
      expect(picture.pixel(280 * scale, 160 * scale)).toEqual([0x2f, 0x4b, 0xd0, 255]);
      // Light paper under the icons' labels, which Finder writes in black.
      const [red = 0, green = 0, blue = 0, alpha] = picture.pixel(150 * scale, 215 * scale);
      expect(alpha).toBe(255);
      expect(Math.min(red, green, blue)).toBeGreaterThan(230);
    }
  });
});

describe('the Windows install window’s header', () => {
  it('is a 24-bit BMP at each scaling, in the icon’s blue with the mark in white', () => {
    for (const scale of [1, 1.5, 2]) {
      const bmp = installHeaderBmp(scale);
      const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
      const width = Math.round(INSTALL_HEADER.width * scale);
      const height = Math.round(INSTALL_HEADER.height * scale);
      expect(String.fromCharCode(bmp[0] ?? 0, bmp[1] ?? 0)).toBe('BM');
      expect([view.getInt32(18, true), view.getInt32(22, true), view.getUint16(28, true)]).toEqual([
        width,
        height,
        24,
      ]);
      // Rows run bottom up, each padded to four bytes, blue first.
      const stride = Math.ceil((width * 3) / 4) * 4;
      expect(bmp.length).toBe(54 + stride * height);
      const pixel = (x: number, y: number) => {
        const at = 54 + (height - 1 - y) * stride + x * 3;
        return [bmp[at + 2], bmp[at + 1], bmp[at]];
      };
      const hex = (color: string) =>
        [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
      expect(pixel(0, 0)).toEqual(hex(APP_ICON.top));
      // The mark's dot, 64 points of mark centered on the header, is white.
      const [dotX, dotY] = MARK.dot;
      const unit = (64 / 80) * scale;
      const dot = pixel(
        Math.floor(width / 2 + (dotX - 59.5) * unit),
        Math.floor(height / 2 + (dotY - 60) * unit),
      );
      expect(dot).toEqual([255, 255, 255]);
    }
  });
});
