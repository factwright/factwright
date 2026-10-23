import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCoverLetterFile, isProjectsPageFile, type Job, type JobFile } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Versions } from './versions.ts';

const FOLDER = '2026-10-07-acme-robotics-staff-engineer';
const ID = 'acme-robotics--staff-engineer';
const PDF = 'AlexRiveraResume10072026_Acme.pdf';
const WORD = 'AlexRiveraResume10072026_Acme.docx';
const LETTER = 'AlexRiveraCoverLetter10072026_Acme.pdf';

let workspace: string;
let folder: string;
let now: Date;
let applied: string | null;
let trashed: string[];

/** A file in the job's folder as the app lists it. */
function fileOf(name: string): JobFile {
  const { size, mtime } = statSync(join(folder, name));
  return {
    path: `applications/${FOLDER}/${name}`,
    name,
    format: name.endsWith('.pdf') ? 'pdf' : 'docx',
    size,
    modified: mtime.toISOString(),
  };
}

/** The job as the app reads it from its folder now. */
function job(): Job {
  const built = readdirSync(folder)
    .filter((name) => /\.(pdf|docx)$/.test(name))
    .sort()
    .map(fileOf);
  const letters = built.filter((file) => isCoverLetterFile(file.name));
  const projectPages = built.filter((file) => isProjectsPageFile(file.name));
  return {
    id: ID,
    folder: FOLDER,
    files: built.filter((file) => !letters.includes(file) && !projectPages.includes(file)),
    letters,
    projectPages,
    status: applied ? 'applied' : 'apply',
    appliedOn: applied,
  } as unknown as Job;
}

const versions = () =>
  new Versions({
    workspace,
    jobs: () => [job()],
    now: () => now,
    trash: async (path) => {
      trashed.push(path);
      rmSync(path, { recursive: true });
    },
  });

/** Writes a file in the job's folder, built at a time some minutes past 9:00 on Oct 7. */
function build(name: string, text: string, minute: number) {
  const path = join(folder, name);
  writeFileSync(path, text);
  const at = new Date(2026, 9, 7, 9, minute);
  utimesSync(path, at, at);
}

const text = (path: string) => readFileSync(join(workspace, ...path.split('/')), 'utf8');

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-versions-'));
  folder = join(workspace, 'applications', FOLDER);
  mkdirSync(folder, { recursive: true });
  build(PDF, 'first pdf', 0);
  build(WORD, 'first word', 0);
  writeFileSync(join(folder, 'resume.json'), '{"version":1}');
  now = new Date(2026, 9, 15, 9, 30, 12);
  applied = null;
  trashed = [];
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Versions', () => {
  it('keeps the current resume, as it was built, before a new one', async () => {
    const kept = await versions().keep(ID, 'resume', 'new');
    expect(kept).toEqual({ ok: true, folder: `applications/${FOLDER}/previous/2026-10-15-093012` });
    const previous = join(folder, 'previous', '2026-10-15-093012');
    expect(readdirSync(previous).sort()).toEqual([WORD, PDF, 'resume.json', 'version.json']);
    expect(readFileSync(join(previous, PDF), 'utf8')).toBe('first pdf');
    expect(statSync(join(previous, PDF)).mtime).toEqual(statSync(join(folder, PDF)).mtime);
    expect(JSON.parse(readFileSync(join(previous, 'version.json'), 'utf8'))).toEqual({
      at: now.toISOString(),
      kind: 'resume',
      why: 'new',
    });
    // Until the run builds the new one, it's the same as the job's, so it doesn't show.
    expect(await versions().list(ID)).toEqual([]);
    build(PDF, 'second pdf', 30);
    build(WORD, 'second word', 30);
    const [earlier] = await versions().list(ID);
    expect(earlier).toMatchObject({
      folder: `applications/${FOLDER}/previous/2026-10-15-093012`,
      kind: 'resume',
      why: 'new',
      changes: null,
      usable: true,
    });
    expect(earlier?.files.map((each) => each.name)).toEqual([WORD, PDF]);
  });

  it('keeps one version when asked again before a new one is built', async () => {
    await versions().keep(ID, 'resume', 'new');
    now = new Date(2026, 9, 15, 9, 31, 0);
    const again = await versions().keep(ID, 'resume', 'changes', 'Shorter');
    expect(again).toEqual({
      ok: true,
      folder: `applications/${FOLDER}/previous/2026-10-15-093012`,
    });
    expect(readdirSync(join(folder, 'previous'))).toEqual(['2026-10-15-093012']);
    build(PDF, 'second pdf', 30);
    const [earlier] = await versions().list(ID);
    expect(earlier).toMatchObject({ why: 'changes', changes: 'Shorter' });
  });

  it('keeps nothing for a kind the job doesn’t have yet', async () => {
    expect(await versions().keep(ID, 'letter', 'new')).toEqual({ ok: true, folder: null });
    expect(existsSync(join(folder, 'previous'))).toBe(false);
  });

  it('keeps a resume or letter the user applied with as sent', async () => {
    applied = '2026-10-12';
    expect(await versions().keep(ID, 'resume', 'new')).toEqual({
      ok: false,
      message: 'You applied with this resume, so it stays as you sent it.',
    });
    // A Projects page may have been made since, for an interview, so it can have another.
    build('AlexRiveraProjects10072026_Acme.pdf', 'page', 0);
    expect((await versions().keep(ID, 'projects', 'new')).ok).toBe(true);
  });

  it('lists earlier versions newest first, each kind with its own, and an X-ray’s revisions', async () => {
    const at = (
      name: string,
      files: Record<string, number>,
      notes: object,
      file = 'version.json',
    ) => {
      const where = join(folder, 'previous', name);
      mkdirSync(where, { recursive: true });
      for (const [each, minute] of Object.entries(files)) {
        writeFileSync(join(where, each), each);
        const time = new Date(2026, 9, 6, 9, minute);
        utimesSync(join(where, each), time, time);
      }
      writeFileSync(join(where, file), JSON.stringify(notes));
    };
    build(LETTER, 'letter', 0);
    at(
      '2026-10-06-090000',
      { [PDF]: 1 },
      { at: '2026-10-06T14:00:00.000Z', kind: 'resume', why: 'new' },
    );
    at(
      '2026-10-06-100000',
      { [LETTER]: 5 },
      { at: '2026-10-06T15:00:00.000Z', kind: 'letter', why: 'changes', changes: 'Shorter' },
    );
    at(
      '2026-10-06-110000',
      { [PDF]: 9 },
      { at: '2026-10-06T16:00:00.000Z', resume: PDF },
      'revision.json',
    );
    // Not one the app wrote, or with nothing in it to show.
    at('2026-10-06-120000', { [PDF]: 2 }, { kind: 'resume' });
    mkdirSync(join(folder, 'previous', 'notes'), { recursive: true });
    const listed = await versions().list(ID);
    expect(listed.map((each) => [each.kind, each.why, each.changes])).toEqual([
      ['resume', 'revision', null],
      ['letter', 'changes', 'Shorter'],
      ['resume', 'new', null],
    ]);
    // Kept without what it was built from, it can be opened but not used again.
    expect(listed.map((each) => each.usable)).toEqual([false, false, false]);
  });

  it('uses an earlier version again, putting the current one aside', async () => {
    await versions().keep(ID, 'resume', 'new');
    build(PDF, 'second pdf', 30);
    build(WORD, 'second word', 30);
    writeFileSync(join(folder, 'resume.json'), '{"version":2}');
    now = new Date(2026, 9, 15, 10, 0, 0);
    const [first] = await versions().list(ID);
    expect(await versions().use(ID, first?.folder ?? '')).toEqual({ ok: true });
    expect(readFileSync(join(folder, PDF), 'utf8')).toBe('first pdf');
    expect(readFileSync(join(folder, WORD), 'utf8')).toBe('first word');
    expect(readFileSync(join(folder, 'resume.json'), 'utf8')).toBe('{"version":1}');
    const [second] = await versions().list(ID);
    expect(second).toMatchObject({
      folder: `applications/${FOLDER}/previous/2026-10-15-100000`,
      why: 'swapped',
      usable: true,
    });
    expect(text(`${second?.folder}/${PDF}`)).toBe('second pdf');
    expect(text(`${second?.folder}/resume.json`)).toBe('{"version":2}');
    // The folder it came from is gone.
    expect(readdirSync(join(folder, 'previous'))).toEqual(['2026-10-15-100000']);
  });

  it('keeps the version the user applied with, and refuses folders that aren’t the job’s', async () => {
    await versions().keep(ID, 'resume', 'new');
    build(PDF, 'second pdf', 30);
    const [first] = await versions().list(ID);
    applied = '2026-10-12';
    expect(await versions().use(ID, first?.folder ?? '')).toEqual({
      ok: false,
      message: 'You applied with this resume, so it stays as you sent it.',
    });
    expect(readFileSync(join(folder, PDF), 'utf8')).toBe('second pdf');
    for (const other of [
      'applications/other/previous/2026-10-15-093012',
      `applications/${FOLDER}`,
      '../..',
    ]) {
      expect(await versions().use(ID, other)).toEqual({
        ok: false,
        message: 'That version isn’t in the job’s folder anymore.',
      });
      expect(await versions().remove(ID, other)).toEqual({
        ok: false,
        message: 'That version isn’t in the job’s folder anymore.',
      });
    }
    expect(trashed).toEqual([]);
  });

  it('moves an earlier version to the Trash', async () => {
    await versions().keep(ID, 'resume', 'new');
    build(PDF, 'second pdf', 30);
    const [first] = await versions().list(ID);
    expect(await versions().remove(ID, first?.folder ?? '')).toEqual({ ok: true });
    expect(trashed).toEqual([join(folder, 'previous', '2026-10-15-093012')]);
    expect(await versions().list(ID)).toEqual([]);
  });

  it('holds the user’s changes for one run, keeping the version before them', async () => {
    const store = versions();
    expect(await store.prepareChanges({ jobId: ID, kind: 'letter', changes: 'Shorter' })).toEqual({
      ok: false,
      message: 'There’s no cover letter for this job yet to change.',
    });
    expect(await store.prepareChanges({ jobId: ID, kind: 'resume', changes: 'Shorter' })).toEqual({
      ok: true,
    });
    const held = store.claimChanges(ID, 'resume');
    expect(held).toEqual({
      jobId: ID,
      kind: 'resume',
      changes: 'Shorter',
      at: now.toISOString(),
      folder: FOLDER,
      previous: `applications/${FOLDER}/previous/2026-10-15-093012`,
    });
    // Only one run gets them, unless it didn't start.
    expect(store.claimChanges(ID, 'resume')).toBeNull();
    if (held) store.releaseChanges(held);
    expect(store.claimChanges(ID, 'resume')).toEqual(held);
  });

  it('says so when it can’t keep the current version, and leaves nothing half kept', async () => {
    const store = new Versions({
      workspace,
      jobs: () => [
        {
          ...job(),
          files: [
            ...job().files,
            { ...fileOf(PDF), name: 'missing.pdf', path: `applications/${FOLDER}/missing.pdf` },
          ],
        },
      ],
      now: () => now,
      trash: vi.fn(),
    });
    expect(await store.keep(ID, 'resume', 'new')).toEqual({
      ok: false,
      message: 'Couldn’t keep the current version, so nothing changed.',
    });
    expect(readdirSync(join(folder, 'previous'))).toEqual([]);
  });
});
