import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.ts';
import {
  decodeRecord,
  encodeRecord,
  type FileRecord,
  isSyncPath,
  nameOf,
  type RowRecord,
} from './record.ts';

const FILE_ID = 'A'.repeat(43);
const made = { device: 'Sam’s MacBook Pro', at: '2026-10-12T09:30:00.000Z' };

const file: FileRecord = {
  kind: 'file',
  path: 'applications/acme-staff-engineer/posting.md',
  file: { id: FILE_ID, size: 1200, modified: '2026-10-12T09:29:00.000Z' },
  ...made,
};

const row: RowRecord = {
  kind: 'row',
  table: 'jobs',
  id: 'acme--staff-engineer',
  row: { status: 'applied', notes: 'Recruiter: Sam', archived: 0, next_on: null },
  ...made,
};

describe('paths that sync', () => {
  it('are relative, inside the workspace, and fine on Mac and Windows', () => {
    expect(isSyncPath('applications/acme/posting.md')).toBe(true);
    expect(isSyncPath('facts/Résumé notes.md')).toBe(true);
    for (const path of [
      '',
      '/etc/passwd',
      '../outside.md',
      'applications/../../outside.md',
      'applications//posting.md',
      'applications/./posting.md',
      'applications\\posting.md',
      'C:/Windows/notes.md',
      'notes?.md',
      'notes.md.',
      'notes ',
      'con',
      'aux.md',
      'folder/LPT1.txt',
      'line\nbreak.md',
      `${'a/'.repeat(300)}b.md`,
    ]) {
      expect(isSyncPath(path), path).toBe(false);
    }
  });
});

describe('records', () => {
  it('come back as they were', () => {
    expect(decodeRecord(encodeRecord(file))).toEqual(file);
    expect(decodeRecord(encodeRecord(row))).toEqual(row);
    expect(decodeRecord(encodeRecord({ ...file, file: null }))).toEqual({ ...file, file: null });
    expect(decodeRecord(encodeRecord({ ...row, row: null }))).toEqual({ ...row, row: null });
  });

  it('are named by what they are', () => {
    expect(nameOf(file)).toBe('file:applications/acme-staff-engineer/posting.md');
    expect(nameOf(row)).toBe('row:jobs:acme--staff-engineer');
  });

  it('are refused when anything is off', () => {
    const bad = [
      'not json',
      '[]',
      JSON.stringify({ ...file, kind: 'folder' }),
      JSON.stringify({ ...file, path: '../outside.md' }),
      JSON.stringify({ ...file, file: { ...file.file, id: 'short' } }),
      JSON.stringify({ ...file, file: { ...file.file, size: -1 } }),
      JSON.stringify({ ...file, device: 7 }),
      JSON.stringify({ ...row, table: 'jobs; DROP TABLE jobs' }),
      JSON.stringify({ ...row, id: '' }),
      JSON.stringify({ ...row, row: { 'status = 1, notes': 'x' } }),
      JSON.stringify({ ...row, row: { status: { nested: true } } }),
      JSON.stringify({ ...row, row: [1, 2] }),
    ];
    for (const text of bad) expect(decodeRecord(utf8(text)), text).toBeNull();
    expect(decodeRecord(Uint8Array.of(0xff))).toBeNull();
  });
});
