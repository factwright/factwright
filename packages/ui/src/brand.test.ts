// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { appIconPng, MARK, MARK_SMALL, markCut, markSvg } from './brand.ts';

/** Reads an 8-bit RGBA PNG back into its size and pixels. */
async function decode(
  png: Uint8Array,
): Promise<{ size: number; pixel: (x: number, y: number) => number[] }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const size = view.getUint32(16);
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
  const stride = size * 4 + 1;
  return {
    size,
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
    expect(icon.size).toBe(256);
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
