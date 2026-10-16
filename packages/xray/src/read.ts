/**
 * A resume file as a parser reads it: its lines in the order the parser gets them, and enough
 * about how each one looks and where it sits to check the layout. The PDF and Word readers make
 * one; everything else works from it.
 */

/** Where a line is in a Word file. Everything in a PDF is on the page. */
export type Part = 'body' | 'table' | 'header' | 'footer' | 'textbox';

/** A piece of a PDF's line: text drawn in one font and size, in one go. */
export interface Run {
  text: string;
  /** Its left edge and its baseline, in points from the page's bottom left. */
  x: number;
  y: number;
  width: number;
  /** Its size in points. */
  size: number;
  /** Its font, by an ID that stays the same for the same font throughout the file. */
  font: string;
}

/** One line of text, as a parser gets it. */
export interface Line {
  text: string;
  /** Its page, from 1. A Word file has no pages of its own, so its lines are all on page 1. */
  page: number;
  part: Part;
  /**
   * How it's set, such as its font, size and weight, so lines set the same way as a heading the
   * parser knows can be told apart from the text around them.
   */
  look: string;
  /** Its size in points. */
  size: number;
  /** In a PDF: each piece of it, where it sits. Empty for a Word file. */
  runs: Run[];
}

/** A table in a Word file. */
export interface Table {
  /** Each row's cells, as text. */
  rows: string[][];
  /** Its lines, as indexes into the file's lines: from `first`, up to but not including `end`. */
  first: number;
  end: number;
}

export interface ReadFile {
  format: 'pdf' | 'docx';
  /** Every line, in the order a parser reads them. */
  lines: Line[];
  /** A PDF's pages, in points. Word lays out its own pages, so it has none here. */
  pages: { width: number; height: number }[];
  /** How many pages the file has, when it says: a PDF always, a Word file only once Word saved it. */
  pageCount: number | null;
  /** True when a long PDF was read only in part. */
  partial: boolean;
  /** The fonts it uses, by name, such as "Caladea" or "Calibri". */
  fonts: string[];
  /** For a Word file: its tables, and the most columns any of its sections has. */
  tables: Table[];
  columns: number;
}

/** A file's text, line by line, as the parser reads it. */
export const textOf = (file: ReadFile): string => file.lines.map((line) => line.text).join('\n');

/**
 * A font's family as people know it: without the six letters a PDF adds to a font it carries
 * only part of, its weight or style, or Adobe's endings. "AAAAAA+Caladea-Bold" is "Caladea", and
 * "TimesNewRomanPSMT" is "Times New Roman".
 */
export function familyOf(font: string): string {
  const base = font.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0] ?? '';
  const family = base.replace(/(?:PSMT|PS|MT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return family.trim() || font;
}
