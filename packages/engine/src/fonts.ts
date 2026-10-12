/**
 * The font files in this package's fonts folder: open fonts drawn to the widths of the Windows
 * fonts the templates were designed with, so a resume looks the same on any computer.
 */
export const FONT_FILES = [
  'factwright-sans-regular.woff2',
  'factwright-sans-bold.woff2',
  'factwright-sans-italic.woff2',
  'caladea-regular.woff2',
  'caladea-bold.woff2',
  'caladea-italic.woff2',
  'selawik-regular.woff2',
  'selawik-semibold.woff2',
  'selawik-bold.woff2',
  'barlow-bold.woff2',
] as const;

export type FontFile = (typeof FONT_FILES)[number];

/** Each font file as a data: URL, which keeps the page self-contained. */
export type FontUrls = Partial<Record<FontFile, string>>;

interface Face {
  family: string;
  weight: 400 | 600 | 700;
  style: 'normal' | 'italic';
}

/**
 * The face each file draws:
 * - Factwright Sans has Calibri's widths, and the symbols the other fonts lack, such as →.
 * - Caladea has Cambria's widths, for templates set in a serif.
 * - Selawik has Segoe UI's widths.
 * - Barlow has Bahnschrift's look, for display headings, where it can't move a line break.
 */
export const FONT_FACES: Readonly<Record<FontFile, Face>> = {
  'factwright-sans-regular.woff2': { family: 'Factwright Sans', weight: 400, style: 'normal' },
  'factwright-sans-bold.woff2': { family: 'Factwright Sans', weight: 700, style: 'normal' },
  'factwright-sans-italic.woff2': { family: 'Factwright Sans', weight: 400, style: 'italic' },
  'caladea-regular.woff2': { family: 'Caladea', weight: 400, style: 'normal' },
  'caladea-bold.woff2': { family: 'Caladea', weight: 700, style: 'normal' },
  'caladea-italic.woff2': { family: 'Caladea', weight: 400, style: 'italic' },
  'selawik-regular.woff2': { family: 'Selawik', weight: 400, style: 'normal' },
  'selawik-semibold.woff2': { family: 'Selawik', weight: 600, style: 'normal' },
  'selawik-bold.woff2': { family: 'Selawik', weight: 700, style: 'normal' },
  'barlow-bold.woff2': { family: 'Barlow', weight: 700, style: 'normal' },
};

const DATA_URL = /^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/;

/**
 * The @font-face rules for a template's font files, one for each file it's given. Only data:
 * URLs of WOFF2 fonts are taken, so the page never loads anything from anywhere else.
 */
export function fontFaceCss(files: readonly FontFile[], urls: FontUrls): string {
  return files
    .flatMap((file) => {
      const { family, weight, style } = FONT_FACES[file];
      const url = urls[file];
      if (url === undefined) return [];
      if (!DATA_URL.test(url)) throw new Error(`${file} should be a data:font/woff2 URL.`);
      return [
        `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(${url}) format("woff2")}`,
      ];
    })
    .join('\n');
}
