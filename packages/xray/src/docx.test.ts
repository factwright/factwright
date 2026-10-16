import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx } from './docx.ts';
import { childrenOf, decodeXml, descendantsOf, parseXml } from './xml.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word file with a body, and any other parts, from their XML. */
function word(body: string, parts: Record<string, string> = {}): Uint8Array {
  return zipSync({
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    ),
    ...Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
  });
}

/** A Word file whose zip says one of its parts unpacks to `size` bytes, whatever it holds. */
function declaring(file: Uint8Array, name: string, size: number): Uint8Array {
  const data = file.slice();
  const view = new DataView(data.buffer);
  // Each entry in the zip's central directory: its signature, then its sizes and its name.
  for (let at = 0; at + 46 <= data.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const length = view.getUint16(at + 28, true);
    if (new TextDecoder().decode(data.subarray(at + 46, at + 46 + length)) === name) {
      view.setUint32(at + 24, size, true);
      return data;
    }
  }
  throw new Error(`No ${name} in the zip`);
}

/** Bits for a deflate stream, each Huffman code first bit first, filling each byte from its last bit. */
function bits() {
  const bytes: number[] = [];
  let byte = 0;
  let filled = 0;
  return {
    code(value: number, length: number) {
      for (let bit = length - 1; bit >= 0; bit--) {
        byte |= ((value >> bit) & 1) << filled;
        if (++filled === 8) {
          bytes.push(byte);
          byte = 0;
          filled = 0;
        }
      }
    },
    bytes: () => (filled > 0 ? [...bytes, byte] : bytes),
  };
}

/**
 * A deflate stream that unpacks to `size` zero bytes, in one block, written by hand, as zipping
 * that many would take seconds: a zero, then copies of the 258 bytes before, 13 bits each. Eight
 * copies make 13 whole bytes, so after a head of 3 bytes they repeat as bytes.
 */
function zeros(size: number): Uint8Array {
  const copy = 0b11000101_00000;
  const copies = Math.floor((size - 1) / 258);
  // The last block, with the fixed codes: its bits 1, then 1 and 0. Then a zero, and a copy.
  const head = bits();
  head.code(0b110, 3);
  head.code(0x30, 8);
  if (copies === 0) {
    // Too few for a copy: the rest as zeros, one by one, and the block's end.
    for (let left = size - 1; left > 0; left--) head.code(0x30, 8);
    head.code(0, 7);
    return new Uint8Array(head.bytes());
  }
  head.code(copy, 13);
  const eight = bits();
  for (let at = 0; at < 8; at++) eight.code(copy, 13);
  const group = eight.bytes();
  const groups = Math.floor((copies - 1) / 8);
  const tail = bits();
  for (let left = (copies - 1) % 8; left > 0; left--) tail.code(copy, 13);
  for (let left = (size - 1) % 258; left > 0; left--) tail.code(0x30, 8);
  tail.code(0, 7);
  const [start, end] = [head.bytes(), tail.bytes()];
  const stream = new Uint8Array(start.length + group.length * groups + end.length);
  stream.set(start, 0);
  for (let at = 0; at < groups; at++) stream.set(group, start.length + at * group.length);
  stream.set(end, start.length + group.length * groups);
  return stream;
}

/** A deflate stream of empty stored blocks, which unpacks to nothing however long it is. */
function emptyBlocks(count: number): Uint8Array {
  const bytes = new Uint8Array(count * 5 + 5);
  for (let at = 0; at < count; at++) bytes.set([0x00, 0x00, 0x00, 0xff, 0xff], at * 5);
  bytes.set([0x01, 0x00, 0x00, 0xff, 0xff], count * 5);
  return bytes;
}

/** A zip of one deflated part, which says it unpacks to `size` bytes, listed `times` times. */
function zipOf(name: string, packed: Uint8Array, size: number, times = 1): Uint8Array {
  const path = strToU8(name);
  const local = new Uint8Array(30 + path.length);
  const central = new Uint8Array(46 + path.length);
  const end = new Uint8Array(22);
  const [l, c, e] = [local, central, end].map((part) => new DataView(part.buffer)) as [
    DataView,
    DataView,
    DataView,
  ];
  l.setUint32(0, 0x04034b50, true);
  l.setUint16(8, 8, true);
  l.setUint32(18, packed.length, true);
  l.setUint32(22, size, true);
  l.setUint16(26, path.length, true);
  local.set(path, 30);
  c.setUint32(0, 0x02014b50, true);
  c.setUint16(10, 8, true);
  c.setUint32(20, packed.length, true);
  c.setUint32(24, size, true);
  c.setUint16(28, path.length, true);
  central.set(path, 46);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, times, true);
  e.setUint16(10, times, true);
  e.setUint32(12, central.length * times, true);
  e.setUint32(16, local.length + packed.length, true);
  const parts = [local, packed, ...Array.from({ length: times }, () => central), end];
  const zip = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    zip.set(part, at);
    at += part.length;
  }
  return zip;
}

const p = (text: string, props = '') =>
  `<w:p>${props}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const texts = (data: Uint8Array) =>
  readDocx(data).lines.map((line) => `${line.part}: ${line.text}`);

describe('readDocx', () => {
  it('reads paragraphs, tabs and line breaks', () => {
    const data = word(
      `${p('Jordan Avery')}<w:p><w:r><w:t>Engineer</w:t><w:tab/><w:t>2019 – 2021</w:t><w:br/><w:t>Acme</w:t></w:r></w:p>`,
    );
    expect(texts(data)).toEqual([
      'body: Jordan Avery',
      'body: Engineer\t2019 – 2021',
      'body: Acme',
    ]);
  });

  it('puts headers first and footers last, each once', () => {
    const header = `<w:hdr ${W}>${p('jordan@example.com')}</w:hdr>`;
    const data = word(p('Summary'), {
      'word/header1.xml': header,
      'word/header2.xml': header,
      'word/footer1.xml': `<w:ftr ${W}>${p('Page 1')}</w:ftr>`,
    });
    expect(texts(data)).toEqual(['header: jordan@example.com', 'body: Summary', 'footer: Page 1']);
  });

  it('reads a text box once, though Word saves it twice', () => {
    const box = `<w:txbxContent>${p('In a box')}</w:txbxContent>`;
    const run = `<w:r><mc:AlternateContent><mc:Choice><w:drawing>${box}</w:drawing></mc:Choice><mc:Fallback><w:pict>${box}</w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    expect(texts(word(`<w:p>${run}</w:p>`))).toEqual(['textbox: In a box']);
  });

  it('reads a table row by row, and notes its cells', () => {
    const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
    const file = readDocx(
      word(
        `<w:tbl><w:tr>${cell('A')}${cell('B')}</w:tr><w:tr>${cell('C')}${cell('D')}</w:tr></w:tbl>`,
      ),
    );
    expect(file.lines.map((line) => line.text)).toEqual(['A', 'B', 'C', 'D']);
    expect(file.tables).toEqual([
      {
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        first: 0,
        end: 4,
      },
    ]);
  });

  it('keeps a table in a header as the header’s, apart from the body’s tables', () => {
    const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
    const header = `<w:hdr ${W}><w:tbl><w:tr>${cell('Jordan Avery')}${cell('jordan@example.com')}</w:tr></w:tbl></w:hdr>`;
    const file = readDocx(
      word(p('Summary'), { 'word/header1.xml': header, 'word/header2.xml': header }),
    );
    expect(file.lines.map((line) => `${line.part}: ${line.text}`)).toEqual([
      'header: Jordan Avery',
      'header: jordan@example.com',
      'body: Summary',
    ]);
    expect(file.tables).toEqual([]);
  });

  it('reads content nested deeper than any real file without running out of room', () => {
    const deep = `${'<w:sdt><w:sdtContent>'.repeat(5000)}${p('Deep')}${'</w:sdtContent></w:sdt>'.repeat(5000)}`;
    expect(() => readDocx(word(`${p('Top')}${deep}`))).not.toThrow();
  });

  it('skips deleted text and field codes, and reads what’s inside links and content controls', () => {
    const body = [
      '<w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>',
      '<w:p><w:r><w:instrText>HYPERLINK "x"</w:instrText></w:r><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>',
      `<w:sdt><w:sdtContent>${p('in a control')}</w:sdtContent></w:sdt>`,
    ].join('');
    expect(texts(word(body))).toEqual(['body: kept', 'body: link', 'body: in a control']);
  });

  it('reads a Wingdings symbol as the private character systems get', () => {
    const data = word(
      '<w:p><w:r><w:sym w:font="Wingdings" w:char="F028"/><w:t> 555-0100</w:t></w:r></w:p>',
    );
    expect(readDocx(data).lines[0]?.text).toBe('\u{F028} 555-0100');
  });

  it('notes each paragraph’s look: its style, font, size, weight and capitals', () => {
    const props = '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>';
    const run =
      '<w:r><w:rPr><w:rFonts w:ascii="Calibri"/><w:b/><w:sz w:val="28"/></w:rPr><w:t>SKILLS</w:t></w:r>';
    const [line] = readDocx(word(`<w:p>${props}${run}</w:p>`)).lines;
    expect(line).toMatchObject({ look: 'Heading1|Calibri|14|bold|caps', size: 14 });
  });

  it('finds the fonts, from the theme when the text uses it, its columns and Word’s page count', () => {
    const data = word(
      `<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t>Hi</w:t></w:r></w:p><w:sectPr><w:cols w:num="2"/></w:sectPr>`,
      {
        'word/theme/theme1.xml':
          '<a:theme><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:theme>',
        'docProps/app.xml': '<Properties><Pages>2</Pages></Properties>',
      },
    );
    expect(readDocx(data)).toMatchObject({ fonts: ['Aptos'], columns: 2, pageCount: 2 });
  });

  it('reads no more of a part than the zip says it unpacks to', () => {
    const file = declaring(word(p('x'.repeat(100_000))), 'word/document.xml', 400);
    const text = readDocx(file)
      .lines.map((line) => line.text)
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(400);
  });

  it('reads at most 12 headers and footers', () => {
    const headers = Object.fromEntries(
      Array.from({ length: 20 }, (_, at) => [
        `word/header${at + 1}.xml`,
        `<w:hdr ${W}>${p(`Header ${at + 1}`)}</w:hdr>`,
      ]),
    );
    const lines = readDocx(word(p('Body'), headers)).lines;
    expect(lines.filter((line) => line.part === 'header')).toHaveLength(12);
    expect(lines.at(-1)?.text).toBe('Body');
  });

  it('refuses a file that isn’t a Word file', () => {
    expect(() => readDocx(zipSync({ 'notes.txt': strToU8('hello') }))).toThrow('isn’t a Word file');
    expect(() => readDocx(strToU8('not a zip at all'))).toThrow();
  });
});

describe('parseXml', () => {
  it('reads elements, attributes and text, with entities and CDATA', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- note --><a x="1 &amp; 2" y=\'>\'>Tom &lt;3 <![CDATA[<raw>]]><b/></a>',
    );
    expect(root).toMatchObject({ name: 'a', attrs: { x: '1 & 2', y: '>' } });
    expect(root.children).toEqual(['Tom <3 ', '<raw>', { name: 'b', attrs: {}, children: [] }]);
  });

  it('closes an end tag back to the element it names, and skips one that matches none', () => {
    const root = parseXml('<a><b><c>text</b></x><d/></a>');
    expect(childrenOf(root).map((child) => child.name)).toEqual(['b', 'd']);
  });

  it('reads end tags that match nothing in time with how many there are', () => {
    const started = performance.now();
    const root = parseXml(`${'<a>'.repeat(40_000)}${'</b>'.repeat(40_000)}`);
    // Each stray end tag looked back through every open element, which took seconds.
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(root.name).toBe('a');
  });

  it('reads deep nesting without running out of room', () => {
    const deep = `${'<a>'.repeat(20_000)}x${'</a>'.repeat(20_000)}`;
    expect(descendantsOf(parseXml(deep), 'a')).toHaveLength(19_999);
  });

  it('decodes numeric entities, and marks a number past the last character', () => {
    expect(decodeXml('&#8217;&#x2014;&#9999999;&unknown;')).toBe(
      '\u{2019}\u{2014}\u{FFFD}&unknown;',
    );
  });
});

describe('readDocx, on files made to blow up', () => {
  it('reads a text box in a text box once', () => {
    const box = (depth: number): string =>
      depth === 0
        ? ''
        : `<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Box ${depth}</w:t></w:r>${box(depth - 1)}</w:p></w:txbxContent></w:drawing></w:r>`;
    const lines = readDocx(word(`<w:p><w:r><w:t>Body</w:t></w:r>${box(16)}</w:p>`)).lines;
    // Each box read its inner ones again: 65,536 lines.
    expect(lines.map((line) => line.text)).toEqual([
      'Body',
      ...Array.from({ length: 16 }, (_, at) => `Box ${16 - at}`),
    ]);
  });

  it('reads a part listed many times once, and one that says it holds nothing not at all', () => {
    const stream = emptyBlocks(200_000);
    for (const size of [0, 4_096]) {
      const file = zipOf('word/document.xml', stream, size, 1_000);
      const started = performance.now();
      expect(() => readDocx(file)).toThrow();
      // Each listing unpacked a megabyte that holds nothing: about six seconds in all.
      expect(performance.now() - started, `${size}`).toBeLessThan(1_000);
    }
  });

  it('stops unpacking a part that holds far more than it says', () => {
    const file = zipOf('word/document.xml', zeros(2_000_000_000), 4_096);
    const started = performance.now();
    expect(() => readDocx(file)).toThrow();
    // Unpacking all of these two gigabytes, only to cut them off, took over three seconds.
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
