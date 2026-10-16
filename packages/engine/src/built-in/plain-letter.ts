import { FONT_FACES, type FontFile } from '../fonts.ts';
import type { LetterLayout, Template } from '../templates.ts';
import { letterCss, PLAIN_LETTER } from './markup.ts';

/** The open font each Windows font stands in for, drawn to its widths or in its look. */
const STAND_INS: Readonly<Record<string, string>> = {
  calibri: 'Factwright Sans',
  cambria: 'Caladea',
  'segoe ui': 'Selawik',
  bahnschrift: 'Barlow',
};

/**
 * Fonts with serifs, by name, to fall back on one when the font named isn't there: not a "Sans
 * Serif", and "Book" only in serif names such as Book Antiqua.
 */
const SERIF =
  /cambria|caladea|georgia|times|garamond|palatino|baskerville|caslon|constantia|goudy|bodoni|rockwell|book antiqua|bookman|century(?! gothic)|(?<!sans[\s-]?)serif/i;

/** The open fonts that can set a letter's text, by their regular face, and their kind. */
const TEXT_FONTS: Readonly<Partial<Record<FontFile, 'serif' | 'sans-serif'>>> = {
  'caladea-regular.woff2': 'serif',
  'factwright-sans-regular.woff2': 'sans-serif',
  'selawik-regular.woff2': 'sans-serif',
};

/**
 * A font-family for one of a template's Word fonts. The open font it stands in for goes first,
 * when the template carries it, so the letter matches the resume's PDF. Otherwise the font
 * itself, then the template's own first font of the same kind, for a computer without it, such
 * as Garamond on a Mac: the computer's own stand-in, such as Times, can write letters such as
 * "fi" into the PDF as one character, which applicant systems misread.
 */
function family(word: string, fonts: readonly FontFile[]): string {
  const stand = STAND_INS[word.toLowerCase()];
  const generic = SERIF.test(stand ?? word) ? 'serif' : 'sans-serif';
  if (stand && fonts.some((file) => FONT_FACES[file].family === stand)) {
    return [`"${stand}"`, `"${word}"`, generic].join(',');
  }
  const kin = fonts.find((file) => TEXT_FONTS[file] === generic);
  const open = kin && FONT_FACES[kin].family;
  const fallback = open && open.toLowerCase() !== word.toLowerCase() ? [`"${open}"`] : [];
  return [`"${word}"`, ...fallback, generic].join(',');
}

/**
 * A plain letter for a template with no letter layout of its own, such as one of the user's:
 * their name across the top and the letter under it, in the template's fonts and colors, as its
 * Word look names them. It uses none of the template's own styles, which may lay a page out in
 * ways a letter can't follow, such as a side column. The Word look was checked with the
 * template, so it holds only font names, colors as hex, sizes and yes or no.
 */
export function plainLetter(template: Template): LetterLayout {
  const t = template.word;
  // A letter reads best a little larger than a resume, which packs in more.
  const size = Math.max(t.size, 21) / 2;
  return {
    css: `
      :root{--ink:#1d2026;--name:#${t.nameColor};--headline:#${t.headlineColor};--muted:#${t.muted};--rule:#${t.ruleColor}}
      body{font-family:${family(t.body, template.fonts)};font-size:${size}pt;line-height:1.5}
      .hdr{padding-bottom:10px;border-bottom:1.5px solid var(--rule)${t.center ? ';text-align:center' : ''}}
      .name{font-family:${family(t.head, template.fonts)};font-size:${t.nameSize / 2}pt;font-weight:700;line-height:1.05;color:var(--name)${t.nameCaps ? ';text-transform:uppercase;letter-spacing:2px' : ''}}
      .headline{margin-top:5px;font-size:${size + 1}pt;color:var(--headline)}
      .contact{margin-top:6px;font-size:${size - 1}pt;color:var(--muted)}
      .contact span+span:before{content:"·";padding:0 8px}${letterCss({ center: t.center, size, sign: 700 })}`,
    body: PLAIN_LETTER,
  };
}
