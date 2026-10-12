import { describe, expect, it } from 'vitest';
import { FONT_FACES, FONT_FILES, fontFaceCss } from './fonts.ts';
import { builtInTemplate, type Template } from './templates.ts';

/** A made-up font, just its WOFF2 signature, as the app passes fonts. */
const FONT = 'data:font/woff2;base64,d09GMgABAAAA';
const ALL = Object.fromEntries(FONT_FILES.map((file) => [file, FONT]));

describe('fontFaceCss', () => {
  it('writes a face for each file a template carries, in its order', () => {
    expect(
      fontFaceCss(['factwright-sans-italic.woff2', 'caladea-bold.woff2'], ALL).split('\n'),
    ).toEqual([
      `@font-face{font-family:"Factwright Sans";font-weight:400;font-style:italic;src:url(${FONT}) format("woff2")}`,
      `@font-face{font-family:"Caladea";font-weight:700;font-style:normal;src:url(${FONT}) format("woff2")}`,
    ]);
  });

  it('knows each font file’s family, weight and style', () => {
    for (const file of FONT_FILES) {
      const { family, weight, style } = FONT_FACES[file];
      expect(file.startsWith(family.toLowerCase().replace(' ', '-'))).toBe(true);
      expect(style === 'italic').toBe(file.includes('italic'));
      expect(weight).toBe(file.includes('semibold') ? 600 : file.includes('bold') ? 700 : 400);
    }
  });

  it('sets Classic in Cambria’s stand-in and Minimal in Segoe UI’s, with symbols from Factwright Sans', () => {
    const families = (template: Template) =>
      new Set(
        [...fontFaceCss(template.fonts, ALL).matchAll(/font-family:"([^"]+)"/g)].map(
          ([, family]) => family,
        ),
      );
    expect(families(builtInTemplate('classic') as Template)).toEqual(
      new Set(['Caladea', 'Factwright Sans']),
    );
    expect(families(builtInTemplate('minimal') as Template)).toEqual(
      new Set(['Selawik', 'Factwright Sans']),
    );
  });

  it('leaves out the files it isn’t given', () => {
    expect(fontFaceCss(['caladea-bold.woff2'], {})).toBe('');
    expect(
      fontFaceCss(['caladea-bold.woff2', 'barlow-bold.woff2'], { 'barlow-bold.woff2': FONT }),
    ).toBe(
      `@font-face{font-family:"Barlow";font-weight:700;font-style:normal;src:url(${FONT}) format("woff2")}`,
    );
  });

  it('takes only WOFF2 fonts in data: URLs', () => {
    for (const url of [
      'https://fonts.example/caladea-bold.woff2',
      'data:font/ttf;base64,AAEAAA==',
      `${FONT}) format("woff2")}</style><script>alert(1)</script>`,
    ]) {
      expect(() => fontFaceCss(['caladea-bold.woff2'], { 'caladea-bold.woff2': url })).toThrow(
        'caladea-bold.woff2 should be a data:font/woff2 URL.',
      );
    }
  });
});
