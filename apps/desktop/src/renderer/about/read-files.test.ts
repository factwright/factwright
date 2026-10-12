// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { csvRecords, linkedInUpload, readUpload, wordText } from './read-files.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A small Word file: a header with the name, then a heading, a list item, a table and a paragraph. */
function wordFile(): Uint8Array {
  return zipSync({
    'word/header1.xml': strToU8(
      `<w:hdr ${W}><w:p><w:r><w:t>Jordan Avery</w:t></w:r></w:p></w:hdr>`,
    ),
    'word/document.xml': strToU8(
      `<w:document ${W}><w:body>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Experience</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">Led the </w:t></w:r><w:r><w:t>rollout</w:t></w:r><w:r><w:tab/><w:t>2024</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Skills</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SQL</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8('<w:styles/>'),
  });
}

describe('wordText', () => {
  it('reads a Word file as lines, with its header first', () => {
    expect(wordText(wordFile())).toBe(
      [
        'Jordan Avery',
        '',
        '## Experience',
        '- Led the rollout\t2024',
        'Skills | SQL',
        'Line one\nline two',
      ].join('\n'),
    );
  });

  it('reads sections inside content controls, as Word’s own resume templates make them', () => {
    const file = zipSync({
      'word/document.xml': strToU8(
        `<w:document ${W}><w:body>` +
          `<w:p><w:r><w:t>Jordan Avery</w:t></w:r></w:p>` +
          `<w:sdt><w:sdtPr/><w:sdtContent>` +
          `<w:p><w:r><w:t>Senior PM, Northwind</w:t></w:r></w:p>` +
          `<w:customXml><w:p><w:r><w:t>Led the loyalty program</w:t></w:r></w:p></w:customXml>` +
          `</w:sdtContent></w:sdt>` +
          `</w:body></w:document>`,
      ),
    });
    expect(wordText(file)).toBe('Jordan Avery\nSenior PM, Northwind\nLed the loyalty program');
  });

  it('refuses a ZIP that isn’t a Word file', () => {
    expect(() => wordText(zipSync({ 'notes.txt': strToU8('hi') }))).toThrow(
      'That isn’t a Word document inside.',
    );
  });
});

describe('csvRecords', () => {
  it('reads quoted fields with commas, quotes and new lines', () => {
    expect(
      csvRecords('Title,Description\r\n"Lead, Platform","Said ""hi""\nthen left"\r\nEngineer,\r\n'),
    ).toEqual([
      { Title: 'Lead, Platform', Description: 'Said "hi"\nthen left' },
      { Title: 'Engineer', Description: '' },
    ]);
  });

  it('finds the header below LinkedIn’s notes, and takes one-column files', () => {
    expect(
      csvRecords('Notes:\n"Some emails may be missing."\n\nFirst Name,Last Name\nSam,Lee\n'),
    ).toEqual([{ 'First Name': 'Sam', 'Last Name': 'Lee' }]);
    expect(csvRecords('Name\nSQL\nFigma\n')).toEqual([{ Name: 'SQL' }, { Name: 'Figma' }]);
  });
});

describe('linkedInUpload', () => {
  const zip = zipSync({
    'Basic_LinkedInDataExport_10-12-2026/Profile.csv': strToU8(
      'First Name,Last Name,Birth Date,Headline,Summary,Geo Location\nJordan,Avery,Jan 1,Product Manager,Builds marketplaces,Denver\n',
    ),
    'Basic_LinkedInDataExport_10-12-2026/Positions.csv': strToU8(
      'Company Name,Title,Description,Location,Started On,Finished On\nNorthwind,Senior PM,"Led loyalty, and pricing",Denver,Apr 2021,\n',
    ),
    'Basic_LinkedInDataExport_10-12-2026/Skills.csv': strToU8('Name\nPricing\nSQL\n'),
    'Basic_LinkedInDataExport_10-12-2026/Recommendations_Received.csv': strToU8(
      'First Name,Last Name,Company,Job Title,Text,Creation Date,Status\nSam,Lee,Northwind,Engineer,"Jordan ships",10/1/26,VISIBLE\n',
    ),
    'Basic_LinkedInDataExport_10-12-2026/Connections.csv': strToU8(
      'First Name,Last Name\nSam,Lee\n',
    ),
    'Basic_LinkedInDataExport_10-12-2026/messages.csv': strToU8(
      'FROM,CONTENT\nSam,a private message\n',
    ),
  });

  it('keeps the profile’s spreadsheets and the connections, and nothing else', () => {
    const upload = linkedInUpload(zip, '2026-10-12');
    expect(upload.tables.map((table) => table.name).sort()).toEqual([
      'Connections.csv',
      'Positions.csv',
      'Profile.csv',
      'Recommendations_Received.csv',
      'Skills.csv',
    ]);
  });

  it('sums up the profile for Claude, without private details or colleagues’ names', () => {
    const { summary } = linkedInUpload(zip, '2026-10-12');
    for (const line of [
      'From the user’s LinkedIn data export, added 2026-10-12. Their connections are in `linkedin/Connections.csv`, for finding people to message.',
      '- **Headline:** Product Manager',
      '### Senior PM, Northwind (Apr 2021 – present)',
      'Led loyalty, and pricing',
      'Pricing, SQL',
      '- From a colleague (Engineer): Jordan ships',
    ]) {
      expect(summary).toContain(line);
    }
    expect(summary).not.toMatch(/Jan 1|Sam|Lee|private message/);
  });

  it('refuses a ZIP with no LinkedIn data', () => {
    expect(() => linkedInUpload(zipSync({ 'photo.png': strToU8('x') }), '2026-10-12')).toThrow(
      'That ZIP doesn’t hold LinkedIn data.',
    );
  });
});

describe('readUpload', () => {
  it('sends a Word file with its text, and a picture or text file as it is', async () => {
    const word = await readUpload(new File([wordFile().slice()], 'Resume.docx'), 'resume');
    expect(word.text).toContain('## Experience');
    expect(word.bytes.length).toBeGreaterThan(100);
    const picture = await readUpload(
      new File([new Uint8Array([0x89, 0x50])], 'shot.png'),
      'screenshot',
    );
    expect(picture).toMatchObject({ name: 'shot.png', kind: 'screenshot', text: null });
    expect((await readUpload(new File(['notes'], 'notes.md'), 'document')).text).toBeNull();
  });
});
