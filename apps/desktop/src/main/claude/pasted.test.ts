import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPasted, KEPT_MS, keepPasted, PASTED_FOLDER, pastedIn, replyIn } from './pasted.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-pasted-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const NOW = new Date('2026-11-06T15:20:00.000Z');
const POSTING = 'About the job\r\n\r\nLead our PMO.\r\n- 10 years\r\n- PMP\tpreferred\u0000\u0007';

describe('keeping long text for Claude', () => {
  it('keeps it whole in a hidden folder of the workspace, lines and all, and says where', async () => {
    const path = await keepPasted(workspace, POSTING, NOW);
    expect(path).toMatch(/^\.pasted\/2026-11-06-152000-[0-9a-f]{6}\.md$/);
    const text = readFileSync(join(workspace, ...(path ?? '').split('/')), 'utf8');
    expect(text).toBe('About the job\n\nLead our PMO.\n- 10 years\n- PMP\tpreferred');
  });

  it('gives each its own file, even in the same second', async () => {
    const first = await keepPasted(workspace, 'one', NOW);
    const second = await keepPasted(workspace, 'two', NOW);
    expect(first).not.toBe(second);
    expect(readdirSync(join(workspace, PASTED_FOLDER))).toHaveLength(2);
  });

  it('takes away what it kept more than a week ago, and nothing else', async () => {
    const folder = join(workspace, PASTED_FOLDER);
    mkdirSync(folder);
    const old = join(folder, '2026-10-30-090000-aaaaaa.md');
    const recent = join(folder, '2026-11-01-090000-bbbbbb.md');
    const other = join(folder, 'notes.md');
    for (const file of [old, recent, other]) writeFileSync(file, 'text');
    const ago = (ms: number) => (NOW.getTime() - ms) / 1000;
    utimesSync(old, ago(KEPT_MS + 60_000), ago(KEPT_MS + 60_000));
    utimesSync(recent, ago(KEPT_MS - 60_000), ago(KEPT_MS - 60_000));
    utimesSync(other, ago(KEPT_MS * 4), ago(KEPT_MS * 4));
    await keepPasted(workspace, 'new', NOW);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('takes away what it kept more than a week ago as the app starts', async () => {
    await clearPasted(workspace, NOW.getTime());
    expect(existsSync(join(workspace, PASTED_FOLDER))).toBe(false);
    const path = (await keepPasted(workspace, 'a reply')) ?? '';
    const file = join(workspace, ...path.split('/'));
    await clearPasted(workspace, Date.now() + KEPT_MS - 60_000);
    expect(existsSync(file)).toBe(true);
    await clearPasted(workspace, Date.now() + KEPT_MS + 60_000);
    expect(existsSync(file)).toBe(false);
  });

  it('keeps nothing when its folder is a link, which could lead anywhere', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'factwright-pasted-elsewhere-'));
    try {
      symlinkSync(elsewhere, join(workspace, PASTED_FOLDER), 'junction');
      await expect(keepPasted(workspace, POSTING, NOW)).resolves.toBeNull();
      expect(readdirSync(elsewhere)).toEqual([]);
      // Nor does clearing out old text follow it.
      const theirs = join(elsewhere, '2026-10-01-090000-cccccc.md');
      writeFileSync(theirs, 'text');
      utimesSync(theirs, 0, 0);
      await clearPasted(workspace, NOW.getTime());
      expect(existsSync(theirs)).toBe(true);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('keeps nothing when its folder can’t be made', async () => {
    writeFileSync(join(workspace, PASTED_FOLDER), 'a file in its place');
    await expect(keepPasted(workspace, POSTING, NOW)).resolves.toBeNull();
  });

  it('says where for Claude, in words a terminal takes as typed', () => {
    const path = '.pasted/2026-11-06-152000-a1b2c3.md';
    for (const words of [replyIn(path), pastedIn(path)]) {
      expect(words).toContain(path);
      // Plain text on one line: no key a terminal reads as anything but text.
      expect(words).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(replyIn(path)).toMatch(/^My reply is long/);
  });
});
