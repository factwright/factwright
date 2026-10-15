import type { getDocument as GetDocument, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { familyOf, type Line, type ReadFile, type Run } from './read.ts';

/** The most pages read. A resume is far shorter, so a longer file is read only in part. */
export const MAX_PAGES = 10;

const isText = (item: unknown): item is TextItem =>
  typeof item === 'object' && item !== null && 'str' in item;

/** A line's look: its first piece's font and size, and whether it's all capitals. */
function lookOf(runs: Run[], text: string): string {
  const first = runs.find((run) => run.text.trim()) ?? runs[0];
  const caps = /\p{L}/u.test(text) && !/\p{Ll}/u.test(text);
  return [first?.font ?? '', (first?.size ?? 0).toFixed(1), caps ? 'caps' : ''].join('|');
}

/**
 * A font's name as the file has it, such as "Caladea-Bold", without the six letters a PDF adds to
 * a font it carries only part of. pdf.js has it once the page's drawing is read.
 */
function fontName(page: PDFPageProxy, id: string): string {
  try {
    const font = page.commonObjs.get(id) as { name?: unknown } | null;
    return typeof font?.name === 'string' ? font.name.replace(/^[A-Z]{6}\+/, '') : id;
  } catch {
    return id;
  }
}

/** A page's lines: its text in the order the file draws it, a line at a time. */
function linesOf(
  items: TextItem[],
  page: number,
  origin: [number, number],
  names: Map<string, string>,
) {
  const lines: Line[] = [];
  let runs: Run[] = [];
  const finish = () => {
    const text = runs
      .map((run) => run.text)
      .join('')
      .trim();
    if (text) {
      const first = runs.find((run) => run.text.trim()) ?? runs[0];
      lines.push({
        text,
        page,
        part: 'body',
        look: lookOf(runs, text),
        size: first?.size ?? 0,
        runs,
      });
    }
    runs = [];
  };
  for (const item of items) {
    const [a = 0, b = 0, , , e = 0, f = 0] = item.transform as number[];
    const size = Math.hypot(a, b) || item.height;
    const font = names.get(item.fontName) ?? item.fontName;
    const run = {
      text: item.str,
      x: e - origin[0],
      y: f - origin[1],
      width: item.width,
      size,
      font,
    };
    const last = runs.at(-1);
    // A line pdf.js didn't end, but that goes on lower down or higher up, is a new line.
    if (last && item.str && Math.abs(run.y - last.y) > Math.max(size, last.size) * 0.5) finish();
    if (item.str) runs.push(run);
    if (item.hasEOL) finish();
  }
  finish();
  return lines;
}

/**
 * Reads a PDF as a parser gets it, with pdf.js: its text in the order the file draws it, line by
 * line, and where each piece sits. It's the order Apache Tika, pypdf and pdf.js itself give, and
 * the one most systems work from. The text is as the file has it, without the clean-up pdf.js
 * can do, so letters joined into one character show as they are. Pass pdf.js's getDocument,
 * ready to use: in a browser, with its worker set.
 */
export async function readPdf(
  data: Uint8Array,
  getDocument: typeof GetDocument,
): Promise<ReadFile> {
  const loading = getDocument({
    // pdf.js hands the bytes it's given to its worker, so it gets a copy.
    data: data.slice(),
    // For the fonts' names. It never adds the file's fonts to the page.
    fontExtraProperties: true,
    disableFontFace: true,
    enableXfa: false,
    verbosity: 0,
  });
  const pdf = await loading.promise;
  try {
    const lines: Line[] = [];
    const pages: ReadFile['pages'] = [];
    const count = Math.min(pdf.numPages, MAX_PAGES);
    for (let number = 1; number <= count; number++) {
      const page = await pdf.getPage(number);
      const [left = 0, bottom = 0, right = 612, top = 792] = page.view;
      pages.push({ width: right - left, height: top - bottom });
      const items = (await page.getTextContent({ disableNormalization: true })).items.filter(
        isText,
      );
      // The fonts' names come with what the page draws, not with its text.
      await page.getOperatorList();
      const names = new Map(items.map((item) => [item.fontName, fontName(page, item.fontName)]));
      lines.push(...linesOf(items, number, [left, bottom], names));
      page.cleanup();
    }
    const fonts = lines.flatMap((line) =>
      line.runs.filter((run) => run.text.trim()).map((run) => familyOf(run.font)),
    );
    return {
      format: 'pdf',
      lines,
      pages,
      pageCount: pdf.numPages,
      partial: pdf.numPages > count,
      fonts: [...new Set(fonts)],
      tables: [],
      columns: 1,
    };
  } finally {
    await loading.destroy();
  }
}
