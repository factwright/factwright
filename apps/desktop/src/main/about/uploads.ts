import { createHash } from 'node:crypto';
import { LIMITS } from '@factwright/sync';
import { FILE_KINDS, type FileKind } from '../../shared/about.ts';
import { type FileUpload, LINKEDIN_TABLES, type LinkedInUpload } from '../../shared/profile.ts';

/** What a shared file's first bytes must be, by its extension, so a file is what its name says. */
const SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  pdf: (b) => ascii(b, 0, 5) === '%PDF-',
  // A Word file is a ZIP.
  docx: (b) => ascii(b, 0, 4) === 'PK\x03\x04',
  png: (b) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => ascii(b, 0, 4) === 'GIF8',
  webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  txt: isUtf8,
  md: isUtf8,
};

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The extensions each kind of file takes. Claude reads all of them: PDFs and pictures too. */
export const EXTENSIONS: Readonly<Record<FileKind, readonly string[]>> = {
  resume: ['pdf', 'docx', 'txt', 'md'],
  'linkedin-profile': ['pdf'],
  'linkedin-data': [],
  screenshot: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  document: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
};

/** Files people often have that Claude can't read, and what to do instead. */
const UNREADABLE: Readonly<Record<string, string>> = {
  doc: 'That’s an older Word file. Save it as a .docx or a PDF, then add that.',
  pages: 'That’s a Pages file. In Pages, choose File → Export To → PDF, then add the PDF.',
  heic: 'That’s an iPhone photo format. Save it as a JPEG or PNG, then add that.',
  rtf: 'Save it as a .docx or a PDF, then add that.',
  zip: 'To add your LinkedIn data, use the LinkedIn section.',
};

/** The most text read out of one file. A long resume is a few thousand words. */
const MAX_TEXT = 1_000_000;

/** A checked upload, ready to keep. */
export interface CheckedUpload {
  name: string;
  kind: FileKind;
  extension: string;
  bytes: Uint8Array;
  text: string | null;
}

const extensionOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * An upload from the window, checked: a name, a kind, a type that kind takes, the size sync
 * allows, and bytes that are what the name says. Otherwise, why not, in plain words.
 */
export function checkUpload(value: unknown): CheckedUpload | { problem: string } {
  const refused = { problem: 'That file couldn’t be added.' };
  if (typeof value !== 'object' || value === null) return refused;
  const { name, kind, bytes, text } = value as Partial<Record<keyof FileUpload, unknown>>;
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return refused;
  if (!(FILE_KINDS as readonly unknown[]).includes(kind) || kind === 'linkedin-data')
    return refused;
  if (!(bytes instanceof Uint8Array)) return refused;
  if (text !== null && (typeof text !== 'string' || text.length > MAX_TEXT)) return refused;
  const extension = extensionOf(name);
  const unreadable = UNREADABLE[extension];
  if (unreadable) return { problem: unreadable };
  const allowed = EXTENSIONS[kind as FileKind];
  if (!allowed.includes(extension)) {
    return {
      problem: `${name} isn’t a type this takes. It takes ${allowed.map((each) => `.${each}`).join(', ')}.`,
    };
  }
  if (bytes.length === 0) return { problem: `${name} is empty.` };
  if (bytes.length > LIMITS.fileBytes) {
    return { problem: `${name} is bigger than 25 MB, which is more than sync can carry.` };
  }
  if (!SIGNATURES[extension]?.(bytes)) {
    return {
      problem: `${name} doesn’t look like a .${extension} file inside. Try saving it again.`,
    };
  }
  return { name, kind: kind as FileKind, extension, bytes, text: text as string | null };
}

/** The most a kept spreadsheet may hold: a big network's connections run to a few megabytes. */
const MAX_TABLE = 20_000_000;

/** A LinkedIn upload, checked: only the known spreadsheets, as text, and a summary. */
export function checkLinkedIn(value: unknown): LinkedInUpload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tables, summary } = value as Partial<Record<keyof LinkedInUpload, unknown>>;
  if (typeof summary !== 'string' || summary.length > MAX_TEXT || !Array.isArray(tables))
    return null;
  const kept: LinkedInUpload['tables'] = [];
  for (const table of tables) {
    if (typeof table !== 'object' || table === null) return null;
    const { name, text } = table as Record<string, unknown>;
    if (!(LINKEDIN_TABLES as readonly unknown[]).includes(name)) return null;
    if (typeof text !== 'string' || text.length > MAX_TABLE) return null;
    kept.push({ name: name as string, text });
  }
  return { tables: kept, summary };
}

/** A name for a shared file in the workspace: the date, then its own name, plainly spelled. */
export function keptName(name: string, extension: string, today: string): string {
  const stem = name
    .slice(0, name.length - extension.length - 1)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${today}-${stem || 'file'}.${extension}`;
}

/** A file's fingerprint, to keep each file once however often it's added. */
export const fingerprint = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
