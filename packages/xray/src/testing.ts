import type { Line, ReadFile, Run } from './read.ts';

/** A line as a Word file gives one: text, with no place on a page. */
export const wordLine = (text: string, extra: Partial<Line> = {}): Line => ({
  text,
  page: 1,
  part: 'body',
  look: '',
  size: 0,
  runs: [],
  ...extra,
});

/** A line of a PDF: one run of text at a place on the page, in points from its bottom left. */
export function pdfLine(text: string, x: number, y: number, extra: Partial<Run & Line> = {}): Line {
  const size = extra.size ?? 10;
  const run: Run = {
    text,
    x,
    y,
    width: text.length * size * 0.5,
    size,
    font: extra.font ?? 'Body',
  };
  return {
    text,
    page: extra.page ?? 1,
    part: 'body',
    look: extra.look ?? `${run.font}|${size}|`,
    size,
    runs: [run],
  };
}

/** A file of lines, on Letter pages for a PDF. */
export function fileOf(lines: Line[], extra: Partial<ReadFile> = {}): ReadFile {
  const pdf = lines.some((line) => line.runs.length > 0);
  const pages = Math.max(1, ...lines.map((line) => line.page));
  return {
    format: pdf ? 'pdf' : 'docx',
    lines,
    pages: pdf ? Array.from({ length: pages }, () => ({ width: 612, height: 792 })) : [],
    pageCount: pdf ? pages : null,
    partial: false,
    fonts: [],
    tables: [],
    columns: 1,
    ...extra,
  };
}
