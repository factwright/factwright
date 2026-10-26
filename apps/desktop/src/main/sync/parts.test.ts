import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncClient, SyncError } from '@factwright/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tidyName, userAgent } from './device.ts';
import type { SyncEngine, SyncReport } from './engine.ts';
import {
  conflictCopyPath,
  listSyncFiles,
  readSyncFile,
  removeSyncFile,
  statSyncFile,
  writeSyncFile,
} from './files.ts';
import { rowHash } from './rows.ts';
import { SyncRunner } from './runner.ts';
import { Secrets } from './secrets.ts';
import { SyncState } from './state.ts';

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'factwright-sync-parts-'));
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

const keychain = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decryptString: (locked: Buffer) => locked.toString().split('').reverse().join(''),
});

describe('Secrets', () => {
  it('keeps each secret locked with the keychain, and forgets them', () => {
    const file = join(folder, 'sync', 'secrets.json');
    const secrets = new Secrets(file, keychain());
    secrets.set('session', 'token-123');
    secrets.set('accountKey', 'key-456');
    expect(readFileSync(file, 'utf8')).not.toContain('token-123');
    expect(new Secrets(file, keychain()).get('session')).toBe('token-123');
    secrets.delete('session');
    expect(secrets.get('session')).toBeNull();
    expect(secrets.get('accountKey')).toBe('key-456');
    secrets.clear();
    expect(existsSync(file)).toBe(false);
  });

  it('keeps nothing without a keychain', () => {
    const secrets = new Secrets(join(folder, 'secrets.json'), keychain(false));
    expect(secrets.available()).toBe(false);
    expect(() => secrets.set('session', 'token')).toThrow('keychain');
    expect(secrets.get('session')).toBeNull();
  });
});

describe('the computer’s name', () => {
  it('is tidied so a file name can hold it', () => {
    expect(tidyName('Sam’s MacBook Pro\n')).toBe('Sam’s MacBook Pro');
    expect(tidyName('DESKTOP: <work>?')).toBe('DESKTOP work');
    expect(tidyName('   ')).toBe('This computer');
  });

  it('goes to the server percent-encoded', () => {
    expect(userAgent('1.2.0', 'Sam’s Mac')).toBe('Factwright/1.2.0 (Sam%E2%80%99s%20Mac)');
  });
});

describe('SyncState', () => {
  it('keeps what each record last synced, and how far the pull got', () => {
    const state = new SyncState(join(folder, 'sync.db'));
    const item = {
      name: 'file:facts/skills.md',
      record: 'r'.repeat(43),
      version: 2,
      hash: 'h',
      base: null,
      size: 10,
      mtime: 1000,
      deleted: false,
    };
    state.save(item);
    state.save({ ...item, name: 'row:jobs:acme', base: '{}', size: null, mtime: null });
    expect(state.get('file:facts/skills.md')).toEqual(item);
    expect(state.all('file:').map((each) => each.name)).toEqual(['file:facts/skills.md']);
    expect(state.all('row:')).toHaveLength(1);
    state.setCursor(42);
    expect(state.cursor()).toBe(42);
    state.clear();
    expect(state.all()).toEqual([]);
    expect(state.cursor()).toBe(0);
    state.close();
  });
});

describe('workspace files', () => {
  const write = (path: string, text = 'x') => {
    mkdirSync(join(folder, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(folder, ...path.split('/')), text);
  };

  it('sync everything but hidden files, other tools’ files and links', () => {
    write('facts/skills.md');
    write('applications/acme/resume.pdf');
    write('.claude/settings.json');
    write('applications/acme/.DS_Store');
    write('applications/acme/~$resume.docx');
    write('applications/acme/draft.tmp');
    symlinkSync(join(folder, 'facts'), join(folder, 'linked'));
    const { files, skipped } = listSyncFiles(folder);
    expect(files.map((file) => file.path).sort()).toEqual([
      'applications/acme/resume.pdf',
      'facts/skills.md',
    ]);
    expect(skipped).toEqual([]);
  });

  // Windows can't make a file with this name in the first place.
  it.skipIf(process.platform === 'win32')('skip names another computer can’t hold', () => {
    write('facts/what?.md');
    expect(listSyncFiles(folder).skipped).toEqual([{ path: 'facts/what?.md', reason: 'name' }]);
  });

  it('write whole, with the other device’s time, and never outside the workspace', () => {
    const when = new Date('2026-10-01T12:00:00Z');
    const written = writeSyncFile(
      folder,
      'applications/acme/posting.md',
      new TextEncoder().encode('# Acme'),
      when,
    );
    expect(readSyncFile(folder, 'applications/acme/posting.md')).toEqual(
      new TextEncoder().encode('# Acme'),
    );
    expect(written.mtime).toBe(when.getTime());
    expect(statSyncFile(folder, 'applications/acme/posting.md')).toEqual(written);
    expect(() => writeSyncFile(folder, '../outside.md', new Uint8Array(), when)).toThrow('outside');
    expect(readSyncFile(folder, '../outside.md')).toBeNull();
    expect(listSyncFiles(folder).files.map((file) => file.path)).toEqual([
      'applications/acme/posting.md',
    ]);
  });

  it('remove the folders a deletion leaves empty, and no more', () => {
    write('applications/acme/notes/today.md');
    write('applications/other.md');
    removeSyncFile(folder, 'applications/acme/notes/today.md');
    expect(existsSync(join(folder, 'applications', 'acme'))).toBe(false);
    expect(statSync(join(folder, 'applications')).isDirectory()).toBe(true);
    expect(existsSync(folder)).toBe(true);
  });

  it('name a conflict copy by the computer and day, beside the file', () => {
    const when = new Date('2026-10-12T09:00:00');
    expect(conflictCopyPath(folder, 'facts/skills.md', 'Sam’s Mac', when)).toBe(
      'facts/skills (Sam’s Mac, Oct 12).md',
    );
    write('facts/skills (Sam’s Mac, Oct 12).md');
    expect(conflictCopyPath(folder, 'facts/skills.md', 'Sam’s Mac', when)).toBe(
      'facts/skills (Sam’s Mac, Oct 12 2).md',
    );
    expect(conflictCopyPath(folder, 'README', 'PC', when)).toBe('README (PC, Oct 12)');
  });
});

describe('rowHash', () => {
  it('is the same for the same values, whatever their order, and ignores when a job changed', () => {
    const job = { id: 'acme', status: 'applied', updated_at: 'Monday' };
    expect(rowHash('jobs', job)).toBe(
      rowHash('jobs', { updated_at: 'Tuesday', status: 'applied', id: 'acme' }),
    );
    expect(rowHash('jobs', job)).not.toBe(rowHash('jobs', { ...job, status: 'offer' }));
    expect(rowHash('calls', { id: 'c', notes: null })).not.toBe(
      rowHash('calls', { id: 'c', notes: '' }),
    );
  });
});

describe('SyncRunner', () => {
  it('syncs now when asked, after any round going, and says whether it got through', async () => {
    const report: SyncReport = {
      pulled: 0,
      pushed: 1,
      conflicts: 0,
      unreadable: 0,
      skipped: [],
      full: false,
    };
    let fails = false;
    const syncOnce = vi.fn(async () => {
      if (fails) throw new SyncError('offline', 'Can’t reach the server.');
      return report;
    });
    const state = new SyncState(join(folder, 'sync.db'));
    const runner = new SyncRunner({
      engine: { syncOnce } as unknown as SyncEngine,
      client: new SyncClient({ server: 'https://sync.example', token: () => null }),
      state,
      onReport: () => {},
      onActivity: () => {},
      onSignedOut: () => {},
      onSubscriptionNeeded: () => {},
    });
    try {
      // Asked twice at once, the second waits for the first round, then has a round of its own.
      expect(await Promise.all([runner.now(), runner.now()])).toEqual([true, true]);
      expect(syncOnce).toHaveBeenCalledTimes(2);
      expect(runner.working()).toBe(true);
      fails = true;
      expect(await runner.now()).toBe(false);
      expect(runner.working()).toBe(false);
      // An account out of space doesn't get through either.
      fails = false;
      report.full = true;
      expect(await runner.now()).toBe(false);
    } finally {
      await runner.stop();
      state.close();
    }
  });
});
