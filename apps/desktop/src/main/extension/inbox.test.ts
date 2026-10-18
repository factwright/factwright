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
import type { InboxAnswer, SavedJob } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobInbox, LISTENING } from './inbox.ts';

const NOW = Date.UTC(2026, 9, 17, 18, 0, 0);

const JOB: SavedJob = {
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  company: 'Harbor & Pine',
  role: 'Senior PM, Data',
  pay: '$165k–$190k',
  posting: 'About the role',
};

const ADDED: InboxAnswer = {
  ok: true,
  id: 'harbor-and-pine--senior-pm-data',
  already: false,
  posting: 'saved',
};

let root: string;
let folder: string;
let added: SavedJob[];
let add: (job: SavedJob) => InboxAnswer;
let inbox: JobInbox;
/** How many times a look told the app its jobs changed. */
let announced: number;
/** What the inbox's watcher calls when the folder changes, standing in for the system's. */
let changed: (() => void) | null;

/** A job's file name, as the helper names it: when it came, then a random part. */
const named = (at: number, random = '3f9c2a7b1e4d5c6a') => `${at}-${random}`;

/** Drops a job in the inbox, as the helper does. */
function drop(name: string, contents: unknown = { type: 'save', ...JOB }) {
  writeFileSync(
    join(folder, `${name}.json`),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
}

const answer = (name: string) =>
  JSON.parse(readFileSync(join(folder, `${name}.done`), 'utf8')) as InboxAnswer;

const files = () => readdirSync(folder).sort();

function open(extra: { now?: number; pid?: number } = {}) {
  inbox = new JobInbox({
    folder,
    add: (job) => add(job),
    added: () => {
      announced += 1;
    },
    watch: (_, onChange) => {
      changed = onChange;
      return { close: () => (changed = null) };
    },
    now: () => extra.now ?? NOW,
    pid: extra.pid ?? 4242,
  });
  inbox.start();
  return inbox;
}

beforeEach(() => {
  changed = null;
  announced = 0;
  root = mkdtempSync(join(tmpdir(), 'factwright-inbox-'));
  folder = join(root, 'inbox');
  added = [];
  add = (job) => {
    added.push(job);
    return ADDED;
  };
});

afterEach(() => {
  inbox?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('the inbox', () => {
  it('makes its folder, and marks it open with the app’s process ID until it stops', () => {
    open();
    expect(readFileSync(join(folder, LISTENING), 'utf8')).toBe('4242');
    inbox.stop();
    expect(existsSync(join(folder, LISTENING))).toBe(false);
  });

  it('leaves another copy’s marker when it stops', () => {
    open();
    writeFileSync(join(folder, LISTENING), '777');
    inbox.stop();
    expect(readFileSync(join(folder, LISTENING), 'utf8')).toBe('777');
  });

  it('adds the jobs waiting as it opens, in the order they came, and answers each', () => {
    mkdirSync(folder);
    drop(named(NOW - 2000, 'bbbbbbbbbbbbbbbb'), { type: 'save', ...JOB, role: 'Second' });
    drop(named(NOW - 5000, 'aaaaaaaaaaaaaaaa'), { type: 'save', ...JOB, role: 'First' });
    open();
    expect(added.map((job) => job.role)).toEqual(['First', 'Second']);
    // Once for both, so the window gets the new list once.
    expect(announced).toBe(1);
    expect(answer(named(NOW - 5000, 'aaaaaaaaaaaaaaaa'))).toEqual(ADDED);
    expect(files()).toEqual([
      LISTENING,
      `${named(NOW - 5000, 'aaaaaaaaaaaaaaaa')}.done`,
      `${named(NOW - 2000, 'bbbbbbbbbbbbbbbb')}.done`,
    ]);
  });

  it('adds a job that came while it was closed without an answer, as the helper stopped waiting', () => {
    mkdirSync(folder);
    drop(named(NOW - 3_600_000));
    open();
    expect(added).toEqual([JOB]);
    expect(files()).toEqual([LISTENING]);
  });

  it('adds a job dropped while it’s open, once the folder says it changed', async () => {
    open();
    drop(named(NOW));
    changed?.();
    changed?.();
    await vi.waitFor(() => expect(added).toEqual([JOB]));
    expect(files()).toEqual([LISTENING, `${named(NOW)}.done`]);
  });

  it('stops watching when it stops', () => {
    open();
    expect(changed).not.toBeNull();
    inbox.stop();
    expect(changed).toBeNull();
  });

  it('keeps nothing from a file that isn’t a job, and says so', () => {
    mkdirSync(folder);
    drop(named(NOW, '1111111111111111'), { type: 'save', ...JOB, cookies: 'session=1' });
    drop(named(NOW, '2222222222222222'), 'not JSON');
    drop(named(NOW, '3333333333333333'), { type: 'save', ...JOB, posting: 'x'.repeat(1_100_000) });
    open();
    expect(added).toEqual([]);
    expect(answer(named(NOW, '1111111111111111'))).toMatchObject({
      ok: false,
      reason: 'bad-message',
    });
    expect(files().filter((name) => name.endsWith('.json'))).toEqual([]);
  });

  it('leaves files that aren’t its own alone', () => {
    mkdirSync(folder);
    writeFileSync(join(folder, 'notes.txt'), 'mine');
    writeFileSync(join(folder, '../outside.json'), '{}');
    open();
    expect(files()).toEqual([LISTENING, 'notes.txt']);
    expect(existsSync(join(root, 'outside.json'))).toBe(true);
  });

  it('tries a job that couldn’t be added again, answering the helper once', () => {
    mkdirSync(folder);
    drop(named(NOW));
    let busy = true;
    add = (job) => {
      if (busy) throw new Error('database is locked');
      added.push(job);
      return ADDED;
    };
    open();
    expect(answer(named(NOW))).toMatchObject({ ok: false, reason: 'failed' });
    expect(files()).toContain(`${named(NOW)}.json`);
    rmSync(join(folder, `${named(NOW)}.done`));
    busy = false;
    inbox.take();
    expect(added).toEqual([JOB]);
    expect(files()).toEqual([LISTENING]);
  });

  it('cleans away half-written jobs and answers nobody took, once they’ve been left a minute', () => {
    mkdirSync(folder);
    const old = (NOW - 120_000) / 1000;
    for (const name of [`.${named(NOW)}.tmp`, `${named(NOW - 120_000)}.done`]) {
      writeFileSync(join(folder, name), '');
      utimesSync(join(folder, name), old, old);
    }
    const young = join(folder, `.${named(NOW, 'cccccccccccccccc')}.tmp`);
    writeFileSync(young, '');
    utimesSync(young, (NOW - 5000) / 1000, (NOW - 5000) / 1000);
    open();
    expect(files()).toEqual([`.${named(NOW, 'cccccccccccccccc')}.tmp`, LISTENING]);
  });

  it('leaves a file it can’t delete, and carries on with the rest, never stopping the app', () => {
    mkdirSync(folder);
    // A folder named like a job, which deleting as a file can't take away.
    mkdirSync(join(folder, `${named(NOW - 2000, '1111111111111111')}.json`));
    drop(named(NOW - 1000, '2222222222222222'));
    expect(() => open()).not.toThrow();
    expect(added).toEqual([JOB]);
    expect(answer(named(NOW - 2000, '1111111111111111'))).toMatchObject({ reason: 'bad-message' });
    // Left alone from then on: it isn't read, or answered, again.
    rmSync(join(folder, `${named(NOW - 2000, '1111111111111111')}.done`));
    inbox.take();
    expect(files()).toEqual([
      LISTENING,
      `${named(NOW - 2000, '1111111111111111')}.json`,
      `${named(NOW - 1000, '2222222222222222')}.done`,
    ]);
  });

  it('tells the app nothing changed when nothing was added', () => {
    mkdirSync(folder);
    drop(named(NOW), 'not JSON');
    open();
    expect(announced).toBe(0);
  });

  it('never takes jobs from an inbox that’s a link to somewhere else', () => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, `${named(NOW)}.json`), JSON.stringify({ type: 'save', ...JOB }));
    symlinkSync(elsewhere, folder);
    open();
    expect(added).toEqual([]);
    expect(readdirSync(elsewhere)).toEqual([`${named(NOW)}.json`]);
  });
});
