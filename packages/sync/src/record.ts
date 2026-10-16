import { type Bytes, fromUtf8, utf8 } from './bytes.ts';
import { isFileId } from './protocol.ts';

/** A value in a tracked row, as SQLite keeps it. */
export type RowValue = string | number | null;

export type RowValues = Record<string, RowValue>;

/** Who made a change and when, for conflict copies and history. */
interface Made {
  /** The device's name, such as "Steve's MacBook Pro". */
  device: string;
  /** When, as an ISO time. */
  at: string;
}

/** A file in the workspace. Its contents are stored apart, under their own ID. */
export interface FileRecord extends Made {
  kind: 'file';
  /** Where it is in the workspace, with "/" between folders. */
  path: string;
  /** The contents' ID, size and when they last changed, or null once the file is deleted. */
  file: { id: string; size: number; modified: string } | null;
}

/** A row in the tracker, such as a job's status and notes, or a call. */
export interface RowRecord extends Made {
  kind: 'row';
  table: string;
  id: string;
  /** Its columns, or null once the row is deleted. */
  row: RowValues | null;
}

/** What one version of a record says, before it's locked and after it's opened. */
export type SyncRecord = FileRecord | RowRecord;

/** A record's name, which its ID is made from. */
export const fileName = (path: string) => `file:${path}`;
export const rowName = (table: string, id: string) => `row:${table}:${id}`;
export const nameOf = (record: SyncRecord) =>
  record.kind === 'file' ? fileName(record.path) : rowName(record.table, record.id);

const MAX_PATH = 512;
/** The longest name a folder or file can have, in UTF-8 bytes: Mac, Windows and Linux all stop at 255. */
const MAX_NAME_BYTES = 255;
const nameBytes = (part: string) => new TextEncoder().encode(part).length;
const MAX_TEXT = 200_000;
/** Names Windows keeps for devices, which no file there can have, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** Characters Windows doesn't allow in names, and control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds.
const UNSAFE = /[<>:"|?*\\\u0000-\u001f]/;

/**
 * Whether a path can be synced: relative, "/" between folders, and a name every computer can
 * hold. It never climbs out of the workspace, and works on both Mac and Windows.
 */
export function isSyncPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH || UNSAFE.test(path)) return false;
  return path
    .split('/')
    .every(
      (part) =>
        part.length > 0 &&
        nameBytes(part) <= MAX_NAME_BYTES &&
        part !== '.' &&
        part !== '..' &&
        !part.endsWith('.') &&
        !part.endsWith(' ') &&
        !RESERVED.test(part),
    );
}

const TABLE = /^[a-z][a-z_]{0,39}$/;
const COLUMN = /^[a-z][a-z0-9_]{0,63}$/;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

function isRowValues(value: unknown): value is RowValues {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([column, cell]) =>
      COLUMN.test(column) &&
      (cell === null ||
        isText(cell, MAX_TEXT) ||
        (typeof cell === 'number' && Number.isFinite(cell))),
  );
}

function isFileRef(value: unknown): value is FileRecord['file'] {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.id === 'string' &&
    isFileId(file.id) &&
    typeof file.size === 'number' &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    isText(file.modified, 40)
  );
}

export const encodeRecord = (record: SyncRecord): Bytes => utf8(JSON.stringify(record));

/**
 * What a record says, or null when it isn't a record this version understands. Records come
 * from the user's own devices, but each one is still checked before anything acts on it.
 */
export function decodeRecord(bytes: Bytes): SyncRecord | null {
  const text = fromUtf8(bytes);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isText(record.device, 200) || !isText(record.at, 40)) return null;
  const made = { device: record.device, at: record.at };
  if (record.kind === 'file') {
    if (!isText(record.path, MAX_PATH) || !isSyncPath(record.path)) return null;
    if (!isFileRef(record.file)) return null;
    return { kind: 'file', path: record.path, file: record.file, ...made };
  }
  if (record.kind === 'row') {
    if (!isText(record.table, 40) || !TABLE.test(record.table)) return null;
    if (!isText(record.id, 300) || record.id.length === 0) return null;
    if (record.row !== null && !isRowValues(record.row)) return null;
    return { kind: 'row', table: record.table, id: record.id, row: record.row, ...made };
  }
  return null;
}
