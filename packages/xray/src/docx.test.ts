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
