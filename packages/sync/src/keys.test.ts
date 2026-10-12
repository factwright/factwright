import { describe, expect, it } from 'vitest';
import { randomBytes, utf8 } from './bytes.ts';
import {
  accountKeys,
  linkId,
  lock,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
  openLink,
  openWithRecoveryKey,
  readLinkCode,
  readRecoveryKey,
  unlock,
} from './keys.ts';

describe('the account key', () => {
  it('makes the same keys, with the same ID, on every device', async () => {
    const accountKey = newAccountKey();
    const here = await accountKeys(accountKey);
    const there = await accountKeys(accountKey.slice());
    expect(here.id).toBe(there.id);
    expect(here.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await accountKeys(newAccountKey())).id).not.toBe(here.id);
  });

  it('keeps every key it makes unreadable', async () => {
    const keys = await accountKeys(newAccountKey());
    for (const key of [keys.records, keys.files, keys.recordIds, keys.fileIds]) {
      expect(key.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    }
  });

  it('is only ever 32 bytes', async () => {
    await expect(accountKeys(randomBytes(16))).rejects.toThrow('32 bytes');
  });
});

describe('locking', () => {
  it('opens what it locked, for the same purpose only', async () => {
    const { records } = await accountKeys(newAccountKey());
    const locked = await lock(records, utf8('Recruiter: Sam'), utf8('notes'));
    expect(await unlock(records, locked, utf8('notes'))).toEqual(utf8('Recruiter: Sam'));
    expect(await unlock(records, locked, utf8('posting'))).toBeNull();
  });

  it('locks the same thing differently each time', async () => {
    const { records } = await accountKeys(newAccountKey());
    const first = await lock(records, utf8('same'), utf8('notes'));
    const second = await lock(records, utf8('same'), utf8('notes'));
    expect(first).not.toEqual(second);
  });

  it('refuses a changed byte, a wrong key, or a cut-short value', async () => {
    const { records } = await accountKeys(newAccountKey());
    const locked = await lock(records, utf8('Recruiter: Sam'), utf8('notes'));
    for (let at = 0; at < locked.length; at++) {
      const changed = locked.slice();
      changed[at] = (changed[at] ?? 0) ^ 1;
      expect(await unlock(records, changed, utf8('notes'))).toBeNull();
    }
    const other = await accountKeys(newAccountKey());
    expect(await unlock(other.records, locked, utf8('notes'))).toBeNull();
    expect(await unlock(records, locked.subarray(0, 20), utf8('notes'))).toBeNull();
  });
});

describe('the recovery key', () => {
  it('opens the account key the server keeps, and nothing else does', async () => {
    const accountKey = newAccountKey();
    const recovery = newRecoveryKey();
    const locked = await lockWithRecoveryKey(accountKey, recovery.bytes);
    expect(await openWithRecoveryKey(locked, recovery.bytes)).toEqual(accountKey);
    expect(await openWithRecoveryKey(locked, newRecoveryKey().bytes)).toBeNull();
    expect(await openWithRecoveryKey('not locked', recovery.bytes)).toBeNull();
  });

  it('is read back from what a person typed', async () => {
    const recovery = newRecoveryKey();
    expect(recovery.text).toHaveLength(39);
    expect(readRecoveryKey(` ${recovery.text.toLowerCase()} `)).toEqual(recovery.bytes);
    expect(readRecoveryKey('not a key')).toBeNull();
  });
});

describe('link codes', () => {
  it('keep the link under an ID the code can’t be worked out from', async () => {
    const code = newLinkCode();
    const id = await linkId(code.bytes);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await linkId(code.bytes)).toBe(id);
    expect(await linkId(newLinkCode().bytes)).not.toBe(id);
    expect(code.text.replaceAll('-', '')).not.toContain(id);
  });

  it('hand the account key to the device with the code', async () => {
    const accountKey = newAccountKey();
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    expect(link.id).toBe(await linkId(code.bytes));
    const typed = readLinkCode(code.text);
    expect(typed).not.toBeNull();
    expect(await openLink(link.data, typed ?? new Uint8Array())).toEqual(accountKey);
    expect(await openLink(link.data, newLinkCode().bytes)).toBeNull();
  });

  it('can’t stand in for the recovery key, or the other way around', async () => {
    const accountKey = newAccountKey();
    const secret = randomBytes(20);
    const link = await lockForLink(accountKey, secret);
    const recovery = await lockWithRecoveryKey(accountKey, secret);
    expect(await openWithRecoveryKey(link.data, secret)).toBeNull();
    expect(await openLink(recovery, secret)).toBeNull();
  });
});
