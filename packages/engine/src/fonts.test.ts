import { describe, expect, it } from 'vitest';
import { FONT_FILES, fontFaceCss } from './fonts.ts';
import { LAYOUTS } from './schema.ts';

/** A made-up font, just its WOFF2 signature, as the app passes fonts. */
const FONT = 'data:font/woff2;base64,d09GMgABAAAA';
const ALL = Object.fromEntries(FONT_FILES.map((file) => [file, FONT]));

describe('fontFaceCss', () => {
  it('gives the executive layout Calibri’s and Cambria’s stand-ins', () => {
    expect(fontFaceCss('executive', ALL).split('\n')).toEqual([
      `@font-face{font-family:"Factwright Sans";font-weight:400;font-style:normal;src:url(${FONT}) format("woff2")}`,
      `@font-face{font-family:"Factwright Sans";font-weight:700;font-style:normal;src:url(${FONT}) format("woff2")}`,
      `@font-face{font-family:"Factwright Sans";font-weight:400;font-style:italic;src:url(${FONT}) format("woff2")}`,
      `@font-face{font-family:"Caladea";font-weight:700;font-style:normal;src:url(${FONT}) format("woff2")}`,
    ]);
  });

  it('gives the other layouts Segoe UI’s, with Factwright Sans for the symbols it lacks', () => {
    const families = (layout: 'modern' | 'timeline') =>
      [...fontFaceCss(layout, ALL).matchAll(/font-family:"([^"]+)";font-weight:(\d+)/g)].map(
        ([, family, weight]) => `${family} ${weight}`,
      );
    expect(families('modern')).toEqual([
      'Selawik 400',
      'Selawik 600',
      'Selawik 700',
      'Factwright Sans 400',
      'Factwright Sans 700',
    ]);
    expect(families('timeline')).toContain('Barlow 700');
  });

  it('uses every font file, and leaves out the ones it isn’t given', () => {
    const used = new Set(LAYOUTS.flatMap((layout) => fontFaceCss(layout, ALL).split('\n')));
    expect(used.size).toBe(FONT_FILES.length);
    expect(fontFaceCss('executive', {})).toBe('');
    expect(fontFaceCss('executive', { 'caladea-bold.woff2': FONT })).toContain('"Caladea"');
    for (const file of FONT_FILES) {
      const one = { [file]: FONT };
      expect(LAYOUTS.some((layout) => fontFaceCss(layout, one) !== '')).toBe(true);
    }
  });

  it('takes only WOFF2 fonts in data: URLs', () => {
    for (const url of [
      'https://fonts.example/caladea-bold.woff2',
      'data:font/ttf;base64,AAEAAA==',
      `${FONT}) format("woff2")}</style><script>alert(1)</script>`,
    ]) {
      expect(() => fontFaceCss('executive', { 'caladea-bold.woff2': url })).toThrow(
        'caladea-bold.woff2 should be a data:font/woff2 URL.',
      );
    }
  });
});
