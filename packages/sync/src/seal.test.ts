import { describe, expect, it } from 'vitest';
import { sameBytes, utf8 } from './bytes.ts';
import { accountKeys, newAccountKey } from './keys.ts';
import { isFileId, isRecordId } from './protocol.ts';
import { fileId, openFile, openRecord, recordId, sealFile, sealRecord } from './seal.ts';

const keysFor = () => accountKeys(newAccountKey());

describe('record IDs', () => {
  it('name the same record the same way on every device, and reveal nothing', async () => {
    const accountKey = newAccountKey();
    const here = await accountKeys(accountKey);
    const there = await accountKeys(accountKey);
    const name = 'file:applications/acme-staff-engineer/posting.md';
    const id = await recordId(here, name);
    expect(isRecordId(id)).toBe(true);
    expect(await recordId(there, name)).toBe(id);
    expect(id).not.toContain('acme');
    expect(await recordId(here, 'file:applications/acme-staff-engineer/notes.md')).not.toBe(id);
    expect(await recordId(await keysFor(), name)).not.toBe(id);
  });
});

describe('records', () => {
  it('open for the same ID and version only', async () => {
    const keys = await keysFor();
    const id = await recordId(keys, 'row:jobs:acme');
    const data = await sealRecord(keys, id, 3, utf8('{"status":"applied"}'));
    expect(await openRecord(keys, id, 3, data)).toEqual(utf8('{"status":"applied"}'));
    // The server can't pass this version off as another, or as another record.
    expect(await openRecord(keys, id, 4, data)).toBeNull();
    const other = await recordId(keys, 'row:jobs:globex');
    expect(await openRecord(keys, other, 3, data)).toBeNull();
    expect(await openRecord(await keysFor(), id, 3, data)).toBeNull();
    expect(await openRecord(keys, id, 3, 'not data')).toBeNull();
  });
});

describe('files', () => {
  it('store the same contents under one ID', async () => {
    const keys = await keysFor();
    const first = await sealFile(keys, utf8('# Posting'));
    const second = await sealFile(keys, utf8('# Posting'));
    expect(isFileId(first.id)).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.data).not.toEqual(first.data);
    expect(await fileId(keys, utf8('# Posting'))).toBe(first.id);
    expect((await sealFile(keys, utf8('# Posting!'))).id).not.toBe(first.id);
  });

  it('open only under their own ID, with the contents that make it', async () => {
    const keys = await keysFor();
    const posting = await sealFile(keys, utf8('# Posting'));
    const notes = await sealFile(keys, utf8('# Notes'));
    expect(await openFile(keys, posting.id, posting.data)).toEqual(utf8('# Posting'));
    expect(await openFile(keys, notes.id, posting.data)).toBeNull();
    const changed = posting.data.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(await openFile(keys, posting.id, changed)).toBeNull();
    expect(await openFile(await keysFor(), posting.id, posting.data)).toBeNull();
  });

  it('handle a big file', async () => {
    const keys = await keysFor();
    const contents = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    const sealed = await sealFile(keys, contents);
    const opened = await openFile(keys, sealed.id, sealed.data);
    expect(opened && sameBytes(opened, contents)).toBe(true);
  });
});
