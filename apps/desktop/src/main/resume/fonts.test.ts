import { brotliDecompressSync } from 'node:zlib';
import { FONT_FILES } from '@factwright/engine';
import { expect, it } from 'vitest';
import { RESUME_FONTS } from './fonts.ts';

/** A resume font's bytes, as the app builds it in. */
const bytesOf = (file: (typeof FONT_FILES)[number]) => {
  const url = RESUME_FONTS[file] ?? '';
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};

/** The tables a WOFF2 file names by number that a reader has to know: see its table directory. */
const KNOWN_TABLES: Readonly<Record<number, string>> = { 0: 'cmap', 10: 'glyf', 11: 'loca' };

/**
 * Whether a WOFF2 font maps a character to a shape of its own, read from its cmap table, the
 * way a browser picks a shape for each character.
 */
function characterMap(font: Buffer): (code: number) => boolean {
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = font[at++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if (byte < 0x80) break;
    }
    return value;
  };
  // Each table's tag and its length in the decompressed data, which holds them in this order.
  const tables: { tag: string; length: number }[] = [];
  for (let count = font.readUInt16BE(12); count > 0; count--) {
    const flags = font[at++] ?? 0;
    let tag = KNOWN_TABLES[flags & 0x3f] ?? '';
    if ((flags & 0x3f) === 63) {
      tag = font.toString('latin1', at, at + 4);
      at += 4;
    }
    const length = base128();
    // glyf and loca are stored transformed unless their version is 3, the rest unless it's 0.
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(font.subarray(at, at + font.readUInt32BE(20)));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 'cmap') break;
    offset += table.length;
  }
  const cmap = data.subarray(offset);
  const subtables = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) =>
    cmap.subarray(cmap.readUInt32BE(8 + i * 8)),
  );
  return (code) =>
    subtables.some((table) => {
      const format = table.readUInt16BE(0);
      if (format === 4) {
        const segments = table.readUInt16BE(6) / 2;
        for (let i = 0; i < segments; i++) {
          const start = table.readUInt16BE(16 + segments * 2 + i * 2);
          if (code < start || code > table.readUInt16BE(14 + i * 2)) continue;
          const delta = table.readUInt16BE(16 + segments * 4 + i * 2);
          const rangeAt = 16 + segments * 6 + i * 2;
          const range = table.readUInt16BE(rangeAt);
          const glyph =
            range === 0 ? code : table.readUInt16BE(rangeAt + range + (code - start) * 2);
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
      }
      if (format === 12) {
        for (let i = 0; i < table.readUInt32BE(12); i++) {
          if (code >= table.readUInt32BE(16 + i * 12) && code <= table.readUInt32BE(20 + i * 12)) {
            return true;
          }
        }
      }
      return false;
    });
}

it('builds every resume font into the app as a WOFF2 data: URL', () => {
  expect(Object.keys(RESUME_FONTS).sort()).toEqual([...FONT_FILES].sort());
  for (const file of FONT_FILES) {
    const url = RESUME_FONTS[file] ?? '';
    expect(url).toMatch(/^data:font\/woff2;base64,/);
    const bytes = bytesOf(file);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(bytes.length).toBeGreaterThan(10_000);
  }
});

it('gives letters joined into one, such as fi, no character of their own, so a PDF holds the letters', () => {
  // A font can draw fi as one shape. With no character of its own, the shape goes into the PDF
  // as the letters it was drawn for. One that's also "ﬁ" (U+FB01) goes in as that, which
  // applicant systems misread.
  for (const file of FONT_FILES) {
    const maps = characterMap(bytesOf(file));
    expect([...'fil'].every((letter) => maps(letter.codePointAt(0) ?? 0))).toBe(true);
    const joined = Array.from({ length: 7 }, (_, i) => 0xfb00 + i).filter(maps);
    expect({ file, joined }).toEqual({ file, joined: [] });
  }
});
