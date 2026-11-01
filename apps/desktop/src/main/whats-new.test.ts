import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WhatsNewDue } from './whats-new.ts';

describe('whether what’s new is due', () => {
  let dataDir: string;
  let file: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'factwright-whats-new-'));
    file = join(dataDir, 'whats-new.json');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** A start on a version, with the profile used before it, or not. */
  async function open(version: string, { usedBefore = true } = {}) {
    const due = new WhatsNewDue({ file, version, usedBefore });
    await due.load();
    return due;
  }

  const keep = (seen: unknown) => writeFileSync(file, JSON.stringify({ seen }));
  const kept = () => JSON.parse(readFileSync(file, 'utf8')).seen;

  it('says nothing on a first install or in a new profile, and starts from that version', async () => {
    const first = await open('0.19.0', { usedBefore: false });
    expect(first.current()).toBeNull();
    expect(kept()).toBe('0.19.0');
    // It's the same version at the next open, when the profile counts as used.
    expect((await open('0.19.0')).current()).toBeNull();
  });

  it('has the next version due after a first install', async () => {
    await open('0.19.0', { usedBefore: false });
    expect((await open('0.20.0')).current()).toBe('0.20.0');
  });

  it('has it due in a profile used before there was anything kept, as after an update', async () => {
    expect((await open('0.19.0')).current()).toBe('0.19.0');
    // Only once it's been shown does it keep that.
    expect(existsSync(file)).toBe(false);
  });

  it('has it due until it’s seen, even if the window opens again', async () => {
    keep('0.18.1');
    const due = await open('0.19.0');
    expect(due.current()).toBe('0.19.0');
    expect((await open('0.19.0')).current()).toBe('0.19.0');
    await due.seen();
    expect(due.current()).toBeNull();
    expect(kept()).toBe('0.19.0');
    expect((await open('0.19.0')).current()).toBeNull();
  });

  it('has the newest due after an update that skipped versions', async () => {
    keep('0.17.0');
    const due = await open('0.19.0');
    expect(due.current()).toBe('0.19.0');
    await due.seen();
    expect(kept()).toBe('0.19.0');
  });

  it('counts versions by number', async () => {
    keep('0.9.3');
    expect((await open('0.10.0')).current()).toBe('0.10.0');
  });

  it('says nothing when nothing has changed', async () => {
    keep('0.19.0');
    expect((await open('0.19.0')).current()).toBeNull();
  });

  it('says nothing going down a version, and keeps the newest seen', async () => {
    keep('0.20.0');
    const down = await open('0.19.0');
    expect(down.current()).toBeNull();
    await down.seen();
    expect(kept()).toBe('0.20.0');
    // Coming forward again to a version already seen says nothing either.
    expect((await open('0.20.0')).current()).toBeNull();
    expect((await open('0.20.1')).current()).toBe('0.20.1');
  });

  it.each([
    ['isn’t JSON', 'not json'],
    ['holds nothing', 'null'],
    ['names no version', '{"seen":"soon"}'],
    ['names something that isn’t one', '{"seen":19}'],
  ])('reads as nothing kept when the file %s', async (_case, text) => {
    writeFileSync(file, text);
    expect((await open('0.19.0')).current()).toBe('0.19.0');
    writeFileSync(file, text);
    expect((await open('0.19.0', { usedBefore: false })).current()).toBeNull();
    expect(kept()).toBe('0.19.0');
  });

  it('opens all the same when a new profile’s version can’t be kept', async () => {
    const due = new WhatsNewDue({
      file: join(dataDir, 'no-such-folder', 'whats-new.json'),
      version: '0.19.0',
      usedBefore: false,
    });
    await due.load();
    expect(due.current()).toBeNull();
  });

  it('stays due, and says so, when it can’t keep that it’s been seen', async () => {
    const due = new WhatsNewDue({
      file: join(dataDir, 'no-such-folder', 'whats-new.json'),
      version: '0.19.0',
      usedBefore: true,
    });
    await due.load();
    await expect(due.seen()).rejects.toThrow();
    expect(due.current()).toBe('0.19.0');
  });

  it('has nothing to keep when nothing is due', async () => {
    keep('0.19.0');
    const due = await open('0.19.0');
    await due.seen();
    expect(kept()).toBe('0.19.0');
  });
});
