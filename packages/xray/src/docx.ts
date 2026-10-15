import { unzipSync } from 'fflate';
import { familyOf, type Line, type Part, type ReadFile, type Table } from './read.ts';
import { childOf, childrenOf, descendantsOf, parseXml, type XmlElement } from './xml.ts';

/** The most one part of a Word file may hold, unpacked. A resume's are far smaller. */
const MAX_PART_BYTES = 8_000_000;

/** The parts read: the package's links, Word's page count, and the document's own XML parts. */
const WANTED = /^(?:_rels\/\.rels|docProps\/app\.xml|word\/(?:theme\/)?[^/]+\.xml)$/;

/** How deep the reader follows tables in tables and boxes in boxes. Real files stop far sooner. */
const MAX_DEPTH = 32;

/** Wrappers that hold a document's content without changing it, such as a content control. */
const WRAPPERS = new Set(['w:sdt', 'w:sdtContent', 'w:customXml', 'w:smartTag']);

/** What's inside a wrapper, or an AlternateContent's first choice, as if it stood there itself. */
function unwrapped(element: XmlElement): XmlElement[] {
  return childrenOf(element).flatMap((child) => {
    if (child.name === 'mc:AlternateContent') {
      const choice = childOf(child, 'mc:Choice') ?? childOf(child, 'mc:Fallback');
      return choice ? unwrapped(choice) : [];
    }
    return WRAPPERS.has(child.name) ? unwrapped(child) : [child];
  });
}

const textOfElement = (element: XmlElement) =>
  element.children.filter((node): node is string => typeof node === 'string').join('');

/** How a paragraph is set: its style, and its first run's font, size, weight and capitals. */
function lookOf(paragraph: XmlElement, run: XmlElement | undefined, text: string) {
  const paragraphProps = childOf(paragraph, 'w:pPr');
  const style = paragraphProps ? childOf(paragraphProps, 'w:pStyle') : undefined;
  const props = run ? childOf(run, 'w:rPr') : undefined;
  const fonts = props ? childOf(props, 'w:rFonts') : undefined;
  const font = fonts?.attrs['w:ascii'] ?? fonts?.attrs['w:hAnsi'] ?? '';
  const half = Number(props && childOf(props, 'w:sz')?.attrs['w:val']);
  const size = Number.isFinite(half) && half > 0 ? half / 2 : 0;
  const on = (name: string) => {
    const element = props && childOf(props, name);
    return !!element && !['0', 'false', 'off'].includes(element.attrs['w:val'] ?? '');
  };
  const caps = on('w:caps') || (/\p{L}/u.test(text) && !/\p{Ll}/u.test(text));
  return {
    look: [
      style?.attrs['w:val'] ?? '',
      font,
      size,
      on('w:b') ? 'bold' : '',
      caps ? 'caps' : '',
    ].join('|'),
    size,
  };
}

/** Reads a Word file's parts into lines, as a parser that reads the whole document gets them. */
class WordReader {
  readonly lines: Line[] = [];
  readonly tables: Table[] = [];

  /** Block content: paragraphs and tables, in order. */
  blocks(element: XmlElement, part: Part, depth = 0): void {
    if (depth > MAX_DEPTH) return;
    for (const child of unwrapped(element)) {
      if (child.name === 'w:p') this.paragraph(child, part, depth);
      else if (child.name === 'w:tbl') this.table(child, depth);
    }
  }

  private table(table: XmlElement, depth: number): void {
    const first = this.lines.length;
    const rows: string[][] = [];
    for (const row of unwrapped(table).filter((child) => child.name === 'w:tr')) {
      const cells: string[] = [];
      for (const cell of unwrapped(row).filter((child) => child.name === 'w:tc')) {
        const from = this.lines.length;
        this.blocks(cell, 'table', depth + 1);
        cells.push(
          this.lines
            .slice(from)
            .map((line) => line.text)
            .join('\n'),
        );
      }
      rows.push(cells);
    }
    this.tables.push({ rows, first, end: this.lines.length });
  }

  private paragraph(paragraph: XmlElement, part: Part, depth: number): void {
    let text = '';
    let firstRun: XmlElement | undefined;
    const boxes: XmlElement[] = [];
    const run = (element: XmlElement) => {
      for (const child of unwrapped(element)) {
        switch (child.name) {
          case 'w:t': {
            const words = textOfElement(child);
            if (words && !firstRun) firstRun = element;
            text += words;
            break;
          }
          case 'w:tab':
          case 'w:ptab':
            text += '\t';
            break;
          case 'w:br':
          case 'w:cr':
            text += '\n';
            break;
          case 'w:noBreakHyphen':
            text += '-';
            break;
          case 'w:sym': {
            // A symbol from a font such as Wingdings, which reads as a private character, if at all.
            const code = Number.parseInt(child.attrs['w:char'] ?? '', 16);
            if (code > 0 && code <= 0x10ffff) text += String.fromCodePoint(code);
            break;
          }
          case 'w:drawing':
          case 'w:pict':
          case 'w:object':
            boxes.push(...descendantsOf(child, 'w:txbxContent'));
            break;
        }
      }
    };
    const inline = (element: XmlElement) => {
      for (const child of unwrapped(element)) {
        if (child.name === 'w:r') run(child);
        else if (
          ['w:hyperlink', 'w:ins', 'w:fldSimple', 'w:bdo', 'w:dir', 'w:moveTo'].includes(child.name)
        )
          inline(child);
      }
    };
    inline(paragraph);
    const { look, size } = lookOf(paragraph, firstRun, text);
    for (const piece of text.split('\n')) {
      const line = piece.replace(/[ \u{A0}]+$/u, '').replace(/^[ \u{A0}]+/u, '');
      if (line.trim()) this.lines.push({ text: line, page: 1, part, look, size, runs: [] });
    }
    for (const box of boxes) this.blocks(box, 'textbox', depth + 1);
  }
}

/** The fonts a Word file sets its text in, by name, with its theme's fonts where it uses them. */
function fontsOf(parts: XmlElement[], theme: XmlElement | undefined): string[] {
  const names = new Set<string>();
  const themed = new Set<string>();
  for (const part of parts) {
    for (const fonts of descendantsOf(part, 'w:rFonts')) {
      const name = fonts.attrs['w:ascii'] ?? fonts.attrs['w:hAnsi'];
      if (name) names.add(name);
      const fromTheme = fonts.attrs['w:asciiTheme'] ?? fonts.attrs['w:hAnsiTheme'];
      if (fromTheme) themed.add(fromTheme.startsWith('major') ? 'a:majorFont' : 'a:minorFont');
    }
  }
  if (theme) {
    for (const which of themed) {
      const latin = descendantsOf(theme, which).flatMap((font) => descendantsOf(font, 'a:latin'));
      const face = latin[0]?.attrs.typeface;
      if (face) names.add(face);
    }
  }
  return [...new Set([...names].map(familyOf))];
}

/** Where the main document is: word/document.xml, or wherever the package's links say. */
function mainPart(files: Record<string, Uint8Array>, decode: (bytes: Uint8Array) => string) {
  if (files['word/document.xml']) return 'word/document.xml';
  const rels = files['_rels/.rels'];
  if (!rels) return null;
  const link = descendantsOf(parseXml(decode(rels)), 'Relationship').find((each) =>
    each.attrs.Type?.endsWith('/officeDocument'),
  );
  return link?.attrs.Target?.replace(/^\//, '') ?? null;
}

/**
 * Reads a Word file (.docx) as a parser gets it: the body's paragraphs and tables in order, then
 * its headers and footers, which many systems skip, marked as such. Text in text boxes is marked
 * too. Throws when the file isn't a Word file it can read.
 */
export function readDocx(data: Uint8Array): ReadFile {
  const files = unzipSync(data, {
    filter: (file) => WANTED.test(file.name) && file.originalSize <= MAX_PART_BYTES,
  });
  const decoder = new TextDecoder('utf-8');
  const decode = (bytes: Uint8Array) => decoder.decode(bytes);
  const main = mainPart(files, decode);
  const document = main ? files[main] : undefined;
  if (!document) throw new Error('This isn’t a Word file the X-ray can read.');
  const root = parseXml(decode(document));
  const body = childOf(root, 'w:body');
  if (!body) throw new Error('This Word file has no body.');

  const reader = new WordReader();
  const partsByName = (prefix: string) =>
    Object.keys(files)
      .filter((name) => new RegExp(`^word/${prefix}\\d*\\.xml$`).test(name))
      .sort()
      .map((name) => parseXml(decode(files[name] as Uint8Array)));
  const headers = partsByName('header');
  const footers = partsByName('footer');

  // Headers first and footers last, as parsers that read them put them, each the same text once.
  const once = (parts: XmlElement[], part: Part) => {
    const seen = new Set<string>();
    for (const each of parts) {
      const from = reader.lines.length;
      reader.blocks(each, part);
      const text = reader.lines
        .slice(from)
        .map((line) => line.text)
        .join('\n');
      if (seen.has(text)) reader.lines.length = from;
      seen.add(text);
    }
  };
  once(headers, 'header');
  reader.blocks(body, 'body');
  once(footers, 'footer');

  const styles = files['word/styles.xml'] ? parseXml(decode(files['word/styles.xml'])) : undefined;
  const themeName = Object.keys(files).find((name) => /^word\/theme\/theme\d*\.xml$/.test(name));
  const theme = themeName ? parseXml(decode(files[themeName] as Uint8Array)) : undefined;
  const defaults = styles ? descendantsOf(styles, 'w:docDefaults') : [];

  // Word notes how many pages it laid out when it saved the file. Other programs may not.
  const app = files['docProps/app.xml'] ? parseXml(decode(files['docProps/app.xml'])) : undefined;
  const pagesNoted = app ? descendantsOf(app, 'Pages')[0] : undefined;
  const pages = pagesNoted ? Number(textOfElement(pagesNoted)) : Number.NaN;

  return {
    format: 'docx',
    lines: reader.lines,
    pages: [],
    pageCount: Number.isInteger(pages) && pages > 0 ? pages : null,
    partial: false,
    fonts: fontsOf([root, ...headers, ...footers, ...defaults], theme),
    tables: reader.tables,
    columns: Math.max(
      1,
      ...descendantsOf(root, 'w:cols').map((cols) => Number(cols.attrs['w:num']) || 1),
    ),
  };
}
