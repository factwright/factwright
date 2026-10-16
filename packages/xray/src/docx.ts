import { Inflate } from 'fflate';
import { familyOf, type Line, type Part, type ReadFile, type Table } from './read.ts';
import { childOf, childrenOf, descendantsOf, parseXml, type XmlElement } from './xml.ts';

/** The most one part of a Word file may hold, unpacked, and all of them together. */
const MAX_PART_BYTES = 8_000_000;
const MAX_TOTAL_BYTES = 24_000_000;

/** The most headers and footers read. Word makes at most three of each for every section. */
const MAX_HEADERS = 12;

/** The most lines read. A resume has a few hundred; a file made to blow up stops here. */
const MAX_LINES = 5_000;

/** How much of a packed part is unpacked at a time, so one that holds too much stops soon. */
const UNPACK_STEP = 4_096;

/** The parts read: the package's links, Word's page count, and the document's own XML parts. */
const WANTED = /^(?:_rels\/\.rels|docProps\/app\.xml|word\/(?:theme\/)?[^/]+\.xml)$/;

/** How deep the reader follows tables in tables and boxes in boxes. Real files stop far sooner. */
const MAX_DEPTH = 32;

/** Wrappers that hold a document's content without changing it, such as a content control. */
const WRAPPERS = new Set(['w:sdt', 'w:sdtContent', 'w:customXml', 'w:smartTag']);

/**
 * What's inside a wrapper, or an AlternateContent's first choice, as if it stood there itself.
 * Wrappers nested deeper than any real file has them are left out.
 */
function unwrapped(element: XmlElement, depth = 0): XmlElement[] {
  if (depth > MAX_DEPTH) return [];
  return childrenOf(element).flatMap((child) => {
    if (child.name === 'mc:AlternateContent') {
      const choice = childOf(child, 'mc:Choice') ?? childOf(child, 'mc:Fallback');
      return choice ? unwrapped(choice, depth + 1) : [];
    }
    return WRAPPERS.has(child.name) ? unwrapped(child, depth + 1) : [child];
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
  /** Whether it stopped at the most lines it reads. */
  full = false;

  /** Block content: paragraphs and tables, in order. */
  blocks(element: XmlElement, part: Part, depth = 0): void {
    if (depth > MAX_DEPTH || this.full) return;
    for (const child of unwrapped(element)) {
      if (child.name === 'w:p') this.paragraph(child, part, depth);
      else if (child.name === 'w:tbl') this.table(child, part, depth);
    }
  }

  /**
   * A table's rows and cells. In the body its lines are a table's, which the checks look at. In a
   * header, footer or text box, they stay that part's, which is what matters there.
   */
  private table(table: XmlElement, part: Part, depth: number): void {
    const first = this.lines.length;
    const rows: string[][] = [];
    const inside: Part = part === 'body' ? 'table' : part;
    for (const row of unwrapped(table).filter((child) => child.name === 'w:tr')) {
      const cells: string[] = [];
      for (const cell of unwrapped(row).filter((child) => child.name === 'w:tc')) {
        const from = this.lines.length;
        this.blocks(cell, inside, depth + 1);
        cells.push(
          this.lines
            .slice(from)
            .map((line) => line.text)
            .join('\n'),
        );
      }
      rows.push(cells);
    }
    if (inside === 'table') this.tables.push({ rows, first, end: this.lines.length });
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
            // A box inside this one is read with it, so each is read once.
            boxes.push(...descendantsOf(child, 'w:txbxContent', { outermost: true }));
            break;
        }
      }
    };
    const inline = (element: XmlElement, level = 0) => {
      if (level > MAX_DEPTH) return;
      for (const child of unwrapped(element)) {
        if (child.name === 'w:r') run(child);
        else if (
          ['w:hyperlink', 'w:ins', 'w:fldSimple', 'w:bdo', 'w:dir', 'w:moveTo'].includes(child.name)
        )
          inline(child, level + 1);
      }
    };
    inline(paragraph);
    const { look, size } = lookOf(paragraph, firstRun, text);
    for (const piece of text.split('\n')) {
      const line = piece.replace(/[ \u{A0}]+$/u, '').replace(/^[ \u{A0}]+/u, '');
      if (!line.trim()) continue;
      if (this.lines.length >= MAX_LINES) {
        this.full = true;
        return;
      }
      this.lines.push({ text: line, page: 1, part, look, size, runs: [] });
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

/** Two and four bytes of a zip, least significant first. */
const u16 = (data: Uint8Array, at: number) => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
const u32 = (data: Uint8Array, at: number) => (u16(data, at) | (u16(data, at + 2) << 16)) >>> 0;

/** A part of a zip, as the list of its contents at its end gives it. */
interface ZipEntry {
  name: string;
  /** 0 when it's stored as it is, 8 when it's deflated. */
  method: number;
  /** Its size packed, and the size it says it unpacks to. */
  packed: number;
  size: number;
  /** Where its own header is. */
  header: number;
}

/** A zip's list of its contents, from its end. Throws for a file that isn't a zip. */
function zipEntries(data: Uint8Array): ZipEntry[] {
  // The list's end record is the zip's last 22 bytes, or before a comment of up to 65,535.
  let end = -1;
  for (let at = data.length - 22; at >= 0 && at >= data.length - 22 - 65_535; at--) {
    if (u32(data, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('This isn’t a Word file the X-ray can read.');
  const names = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let at = u32(data, end + 16);
  for (let left = u16(data, end + 10); left > 0 && at + 46 <= data.length; left--) {
    if (u32(data, at) !== 0x02014b50) break;
    const length = u16(data, at + 28);
    entries.push({
      name: names.decode(data.subarray(at + 46, at + 46 + length)),
      method: u16(data, at + 10),
      packed: u32(data, at + 20),
      size: u32(data, at + 24),
      header: u32(data, at + 42),
    });
    at += 46 + length + u16(data, at + 30) + u16(data, at + 32);
  }
  return entries;
}

/**
 * The most a part's packed bytes can be for the size it says it holds: its bytes stored as they
 * are, with 5 bytes for each block of 65,535, and a little over. Packing never makes more.
 */
const mostPacked = (size: number) => size + Math.ceil(size / 65_535) * 5 + 1_024;

/**
 * A part's bytes, unpacked no further than the size it says it holds, from no more packed bytes
 * than that size can take. It's unpacked a little at a time, so one that holds far more than it
 * says stops soon after, rather than unpacking for a minute only to be cut off.
 */
function unpack(data: Uint8Array, entry: ZipEntry): Uint8Array | null {
  if (u32(data, entry.header) !== 0x04034b50) return null;
  const start = entry.header + 30 + u16(data, entry.header + 26) + u16(data, entry.header + 28);
  const packed = data.subarray(start, start + Math.min(entry.packed, mostPacked(entry.size)));
  if (entry.method === 0) return packed.slice(0, entry.size);
  if (entry.method !== 8) return null;
  const out = new Uint8Array(entry.size);
  let length = 0;
  const inflater = new Inflate((chunk) => {
    if (length < out.length) out.set(chunk.subarray(0, out.length - length), length);
    length += chunk.length;
  });
  for (let from = 0; from < packed.length && length <= out.length; from += UNPACK_STEP) {
    inflater.push(packed.subarray(from, from + UNPACK_STEP), from + UNPACK_STEP >= packed.length);
  }
  return out.subarray(0, Math.min(length, out.length));
}

/**
 * Reads a Word file (.docx) as a parser gets it: the body's paragraphs and tables in order, then
 * its headers and footers, which many systems skip, marked as such. Text in text boxes is marked
 * too. Throws when the file isn't a Word file it can read.
 */
export function readDocx(data: Uint8Array): ReadFile {
  // Each part, and all of them, are capped by the size the file says they unpack to. A part
  // that says less than it holds is cut off there, and soon, so the caps hold either way.
  const files: Record<string, Uint8Array> = {};
  const read = new Set<number>();
  let total = 0;
  let margins = 0;
  for (const entry of zipEntries(data)) {
    if (!WANTED.test(entry.name) || entry.size === 0 || entry.size > MAX_PART_BYTES) continue;
    // A part listed twice, by name or by where it is, is read once.
    if (entry.name in files || read.has(entry.header)) continue;
    read.add(entry.header);
    if (/^word\/(?:header|footer)\d*\.xml$/.test(entry.name) && ++margins > MAX_HEADERS) continue;
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) break;
    const bytes = unpack(data, entry);
    if (bytes) files[entry.name] = bytes;
  }
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
      // The same header again, for the first page or for even pages, is read once.
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
    partial: reader.full,
    fonts: fontsOf([root, ...headers, ...footers, ...defaults], theme),
    tables: reader.tables,
    columns: Math.max(
      1,
      ...descendantsOf(root, 'w:cols').map((cols) => Number(cols.attrs['w:num']) || 1),
    ),
  };
}
