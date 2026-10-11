import type { Layout } from './schema.ts';

/**
 * The font files in this package's fonts folder: open fonts drawn to the widths of the Windows
 * fonts the layouts were designed with, so a resume looks the same on any computer.
 */
export const FONT_FILES = [
  'factwright-sans-regular.woff2',
  'factwright-sans-bold.woff2',
  'factwright-sans-italic.woff2',
  'caladea-bold.woff2',
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
  file: FontFile;
}

const face = (
  family: string,
  weight: Face['weight'],
  file: FontFile,
  style: Face['style'] = 'normal',
): Face => ({ family, weight, style, file });

/** Calibri's widths, and the symbols the other fonts lack, such as →. */
const SANS = [
  face('Factwright Sans', 400, 'factwright-sans-regular.woff2'),
  face('Factwright Sans', 700, 'factwright-sans-bold.woff2'),
];

/** Segoe UI's widths. */
const SELAWIK = [
  face('Selawik', 400, 'selawik-regular.woff2'),
  face('Selawik', 600, 'selawik-semibold.woff2'),
  face('Selawik', 700, 'selawik-bold.woff2'),
];

/** The faces each layout's styles call for. */
const LAYOUT_FACES: Record<Layout, readonly Face[]> = {
  executive: [
    ...SANS,
    face('Factwright Sans', 400, 'factwright-sans-italic.woff2', 'italic'),
    face('Caladea', 700, 'caladea-bold.woff2'),
  ],
  modern: [...SELAWIK, ...SANS],
  timeline: [...SELAWIK, face('Barlow', 700, 'barlow-bold.woff2'), ...SANS],
};

const DATA_URL = /^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/;

/**
 * The @font-face rules for a layout's fonts, one for each file it's given. Only data: URLs of
 * WOFF2 fonts are taken, so the page never loads anything from anywhere else.
 */
export function fontFaceCss(layout: Layout, urls: FontUrls): string {
  return LAYOUT_FACES[layout]
    .flatMap(({ family, weight, style, file }) => {
      const url = urls[file];
      if (url === undefined) return [];
      if (!DATA_URL.test(url)) throw new Error(`${file} should be a data:font/woff2 URL.`);
      return [
        `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(${url}) format("woff2")}`,
      ];
    })
    .join('\n');
}
