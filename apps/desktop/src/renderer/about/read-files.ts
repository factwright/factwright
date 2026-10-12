import { strFromU8, unzipSync } from 'fflate';
import type { FileKind } from '../../shared/about.ts';
import { type FileUpload, LINKEDIN_TABLES, type LinkedInUpload } from '../../shared/profile.ts';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Whether an element sits in a part Word keeps only for old apps, which repeats the text. */
const isFallback = (element: Element) => {
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at.localName === 'Fallback') return true;
  }
  return false;
};

/** A paragraph's text: its runs, tabs and line breaks. */
function paragraphText(paragraph: Element): string {
  let text = '';
  for (const node of paragraph.getElementsByTagNameNS(WORD, '*')) {
    if (isFallback(node)) continue;
    if (node.localName === 't') text += node.textContent ?? '';
    else if (node.localName === 'tab') text += '\t';
    else if (node.localName === 'br' || node.localName === 'cr') text += '\n';
  }
  return text;
}

/**
 * The paragraphs and tables in a part of a Word file, in order, including those inside content
 * controls and custom XML, which Word's own resume templates wrap whole sections in.
 */
function blocks(parent: Element): Element[] {
  return [...parent.children].flatMap((child) => {
    if (child.localName === 'p' || child.localName === 'tbl') return [child];
    if (['sdt', 'sdtContent', 'customXml', 'smartTag'].includes(child.localName))
      return blocks(child);
    return [];
  });
}

/** One part of a Word file as lines: headings marked "##", list items "-", tables by row. */
function partLines(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.getElementsByTagNameNS(WORD, 'body')[0] ?? doc.documentElement;
  const lines: string[] = [];
  for (const child of blocks(root)) {
    if (child.localName === 'p') {
      const text = paragraphText(child).trim();
      const style =
        child.getElementsByTagNameNS(WORD, 'pStyle')[0]?.getAttributeNS(WORD, 'val') ?? '';
      const listed = child.getElementsByTagNameNS(WORD, 'numPr').length > 0;
      if (!text) lines.push('');
      else if (/^(heading|title)/i.test(style)) lines.push(`## ${text}`);
      else lines.push(listed ? `- ${text}` : text);
    } else {
      for (const row of child.getElementsByTagNameNS(WORD, 'tr')) {
        const cells = [...row.getElementsByTagNameNS(WORD, 'tc')].map((cell) =>
          [...cell.getElementsByTagNameNS(WORD, 'p')].map(paragraphText).join(' ').trim(),
        );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
    }
  }
  return lines;
}

/**
 * A Word file's text, as Markdown-ish lines, with its headers first: many resumes keep the name
 * and contact details there.
 */
export function wordText(bytes: Uint8Array): string {
  const parts = unzipSync(bytes, {
    filter: (file) => /^word\/(document|header\d*)\.xml$/.test(file.name),
  });
  const document = parts['word/document.xml'];
  if (!document) throw new Error('That isn’t a Word document inside.');
  const headers = Object.keys(parts)
    .filter((name) => name.startsWith('word/header'))
    .sort()
    .flatMap((name) => partLines(strFromU8(parts[name] as Uint8Array)));
  return [...headers, '', ...partLines(strFromU8(document))]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The rows of a CSV file as records by column name. Quoted fields can hold commas and lines. */
export function csvRecords(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // LinkedIn puts notes above some headers, such as the connections'. The header is the first
  // full row as wide as the widest of the first few.
  const width = Math.max(...rows.slice(0, 10).map((cells) => cells.length));
  const header = rows.findIndex(
    (cells) => cells.length === width && cells.every((cell) => cell.trim()),
  );
  if (header < 0) return [];
  const names = (rows[header] as string[]).map((name) => name.trim().replace(/^﻿/, ''));
  return rows
    .slice(header + 1)
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) =>
      Object.fromEntries(names.map((name, index) => [name, (cells[index] ?? '').trim()])),
    );
}

/** Columns that are private and do nothing for a resume, so they stay out of the summary. */
const PRIVATE = new Set([
  'Address',
  'Birth Date',
  'Maiden Name',
  'Zip Code',
  'Instant Messengers',
  'License Number',
  'Email Address',
  'First Name',
  'Last Name',
]);

const when = (record: Record<string, string>, from: string, to: string) => {
  const start = record[from] ?? '';
  const end = record[to] ?? '';
  return start || end ? ` (${start || '?'} – ${end || 'present'})` : '';
};

/** One record as a bullet: its filled columns, by name, private ones left out. */
const bullet = (record: Record<string, string>) =>
  `- ${Object.entries(record)
    .filter(([name, value]) => value && !PRIVATE.has(name))
    .map(([name, value]) => `${name}: ${value.replace(/\s*\n\s*/g, ' ')}`)
    .join(' · ')}`;

/** Each kept table's section of the summary, by how LinkedIn lays it out. */
const SECTIONS: Readonly<Record<string, (records: Record<string, string>[]) => string[]>> = {
  'Profile.csv': (records) =>
    records.flatMap((record) => [
      ...(['Headline', 'Summary', 'Industry', 'Geo Location', 'Websites'] as const)
        .filter((name) => record[name])
        .map((name) => `- **${name}:** ${record[name]}`),
    ]),
  'Positions.csv': (records) =>
    records.flatMap((record) => [
      `### ${record.Title || 'A role'}, ${record['Company Name'] || 'a company'}${when(record, 'Started On', 'Finished On')}`,
      ...(record.Location ? [`- **Location:** ${record.Location}`] : []),
      ...(record.Description ? [record.Description] : []),
      '',
    ]),
  'Education.csv': (records) =>
    records.flatMap((record) => [
      `### ${[record['Degree Name'], record['School Name']].filter(Boolean).join(', ') || 'A school'}${when(record, 'Start Date', 'End Date')}`,
      ...(['Notes', 'Activities'] as const)
        .filter((name) => record[name])
        .map((name) => `- **${name}:** ${record[name]}`),
      '',
    ]),
  'Skills.csv': (records) => [
    records
      .map((record) => record.Name)
      .filter(Boolean)
      .join(', '),
  ],
  'Recommendations_Received.csv': (records) =>
    records
      .filter((record) => record.Text && (record.Status ?? 'VISIBLE').toUpperCase() !== 'HIDDEN')
      // Who wrote it stays out: names of colleagues don't belong in the fact bank.
      .map(
        (record) =>
          `- From a colleague${record['Job Title'] ? ` (${record['Job Title']})` : ''}: ${record.Text}`,
      ),
};

/** A table's title in the summary, such as "Test scores". */
const titleOf = (name: string) => {
  const words = name.replace(/\.csv$/i, '').replace(/_/g, ' ');
  return words.charAt(0) + words.slice(1).toLowerCase();
};

/**
 * The parts of a LinkedIn data export the app keeps, read out of its ZIP: the profile's own
 * spreadsheets and the connections. Messages, invitations and everything else stay out.
 */
export function linkedInUpload(bytes: Uint8Array, today: string): LinkedInUpload {
  const wanted = new Map(LINKEDIN_TABLES.map((name) => [name.toLowerCase(), name]));
  const files = unzipSync(bytes, {
    filter: (file) => wanted.has((file.name.split('/').at(-1) ?? '').toLowerCase()),
  });
  const tables = Object.entries(files)
    .map(([path, data]) => ({
      name: wanted.get((path.split('/').at(-1) ?? '').toLowerCase()) ?? '',
      text: strFromU8(data),
    }))
    .filter((table) => table.name);
  if (tables.length === 0) throw new Error('That ZIP doesn’t hold LinkedIn data.');
  const sections = LINKEDIN_TABLES.filter((name) => name !== 'Connections.csv').flatMap((name) => {
    const table = tables.find((each) => each.name === name);
    const records = table ? csvRecords(table.text) : [];
    if (records.length === 0) return [];
    const lines = (SECTIONS[name] ?? ((all) => all.map(bullet)))(records);
    return [
      `## ${titleOf(name === 'Recommendations_Received.csv' ? 'Recommendations received' : name)}`,
      ...lines,
      '',
    ];
  });
  const connections = tables.some((table) => table.name === 'Connections.csv');
  const summary = [
    '# LinkedIn data',
    '',
    `From the user’s LinkedIn data export, added ${today}.${connections ? ' Their connections are in `linkedin/Connections.csv`, for finding people to message.' : ''}`,
    '',
    ...sections,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { tables, summary: `${summary.trim()}\n` };
}

/**
 * A file the user dropped, read for sending to the app: its bytes, and the text out of a PDF or
 * Word file, which Claude reads better, and on less of the user's plan, as text. Text files and
 * pictures go as they are, since Claude reads those itself.
 */
export async function readUpload(file: File, kind: FileKind): Promise<FileUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  let text: string | null = null;
  try {
    if (extension === 'pdf') text = await (await import('../jobs/pdf.ts')).pdfText(bytes);
    else if (extension === 'docx') text = wordText(bytes);
  } catch {
    // The app checks the file itself, and says if it isn't what its name says. Claude can
    // still read a PDF whose text wouldn't come out here.
    text = null;
  }
  return { name: file.name, kind, bytes, text: text?.trim() ? text : null };
}
