import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASK_WITHOUT_COPY, editedPath, KEPT_RUNS, keepBefore, RunChanges } from './run-changes.ts';

let dataDir: string;
let workspace: string;
let folder: string;
let trashed: string[];
let clock: number;

/** The record of what tasks changed, and one run's tasks in it, as the tests drive them. */
const changes = () => {
  const store = new RunChanges({
    workspace,
    folder,
    trash: async (path) => {
      trashed.push(path);
      rmSync(path, { force: true });
    },
    now: () => new Date(clock++),
  });
  return {
    ...store.forRun(),
    undo: (id: string, path: string, anyway?: boolean) => store.undo(id, path, anyway),
    see: (id: string, path: string) => store.see(id, path),
    changes: (id: string) => store.changes(id),
    /** Another run's tasks, side by side with this one's. */
    forRun: () => store.forRun(),
  };
};

const at = (path: string) => join(workspace, ...path.split('/'));
const write = (path: string, text: string) => {
  mkdirSync(join(at(path), '..'), { recursive: true });
  writeFileSync(at(path), text);
};
const read = (path: string) => readFileSync(at(path), 'utf8');

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-run-changes-'));
  workspace = join(dataDir, 'workspace');
  folder = join(dataDir, 'undo');
  mkdirSync(workspace);
  trashed = [];
  clock = Date.UTC(2026, 9, 25, 14, 3, 11, 123);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('what a task changed', () => {
  it('lists each file a task changed or made, with its lines, and leaves out what ended as it was', () => {
    write('applications/acme/job.md', '# Acme: Staff Engineer\n- **Date:** 2026-10-25\n');
    write('guide/preferences.md', 'One\nTwo\n');
    const run = changes();
    const { id } = run.begin();
    run.keep(at('applications/acme/job.md'));
    write(
      'applications/acme/job.md',
      '# Acme: Staff Engineer\n- **Date:** 2026-10-26\n- **Role:** Staff\n',
    );
    run.keep('applications/acme/notes.md');
    write('applications/acme/notes.md', 'A\nB\nC\n');
    // Changed, then changed back: nothing to show.
    run.keep('guide/preferences.md');
    write('guide/preferences.md', 'Changed\n');
    write('guide/preferences.md', 'One\nTwo\n');
    expect(run.settle()).toEqual({
      id,
      files: [
        {
          path: 'applications/acme/job.md',
          change: 'changed',
          lines: { added: 2, removed: 1 },
          canUndo: true,
          undone: false,
        },
        {
          path: 'applications/acme/notes.md',
          change: 'new',
          lines: { added: 3, removed: 0 },
          canUndo: true,
          undone: false,
        },
      ],
      pages: [],
      morePages: 0,
    });
    expect(id).toBe(`20261025-140311-123-${id.slice(-6)}`);
  });

  it('keeps the copy from before the task first changed a file, however often it changes after', () => {
    write('facts/acme.md', 'Before\n');
    const run = changes();
    const { id } = run.begin();
    run.keep('facts/acme.md');
    write('facts/acme.md', 'First change\n');
    run.keep('facts/acme.md');
    write('facts/acme.md', 'Second change\n');
    run.settle();
    expect(run.see(id, 'facts/acme.md')).toEqual({ before: 'Before\n', after: 'Second change\n' });
  });

  it('shows a new file with nothing before it, and a file that isn’t text with no lines or view', () => {
    write('applications/acme/Resume.pdf', '%PDF-1.7\u0000old');
    const run = changes();
    const { id } = run.begin();
    run.keep('applications/acme/Resume.pdf');
    writeFileSync(at('applications/acme/Resume.pdf'), Buffer.from([0x25, 0x50, 0, 1, 2]));
    run.keep('applications/acme/apply.md');
    write('applications/acme/apply.md', '# How to apply\n');
    const { files } = run.settle() ?? { files: [] };
    expect(files.find((each) => each.path.endsWith('.pdf'))).toMatchObject({
      change: 'changed',
      lines: null,
      canUndo: true,
    });
    expect(run.see(id, 'applications/acme/Resume.pdf')).toBeNull();
    expect(run.see(id, 'applications/acme/apply.md')).toEqual({
      before: null,
      after: '# How to apply\n',
    });
  });

  it('notes the pages a task read, once each, in order', () => {
    const run = changes();
    run.begin();
    run.read('https://acme.com/careers');
    run.read('https://jobs.lever.co/acme/1');
    run.read('https://acme.com/careers');
    expect(run.settle()?.pages).toEqual([
      'https://acme.com/careers',
      'https://jobs.lever.co/acme/1',
    ]);
  });

  it('starts each task with nothing changed, and keeps nothing before the first', () => {
    write('notes.md', 'x');
    const run = changes();
    run.keep('notes.md');
    expect(run.settle()).toBeNull();
    const first = run.begin();
    run.keep('notes.md');
    write('notes.md', 'y');
    expect(run.settle()?.files).toHaveLength(1);
    const second = run.begin();
    expect(second).toEqual({ id: second.id, files: [], pages: [], morePages: 0 });
    expect(second.id).not.toBe(first.id);
    expect(run.settle()?.files).toEqual([]);
    // The first task's list is still there, by its ID.
    expect(run.changes(first.id)?.files).toHaveLength(1);
  });

  it('leaves alone a file outside the workspace, one reached through a link, and a folder', () => {
    const outside = join(dataDir, 'outside.md');
    writeFileSync(outside, 'mine');
    symlinkSync(outside, at('linked.md'));
    mkdirSync(at('folder'));
    const run = changes();
    run.begin();
    for (const path of [outside, '../outside.md', 'linked.md', 'folder', join(folder, 'x')]) {
      run.keep(path);
    }
    writeFileSync(outside, 'changed');
    expect(run.settle()?.files).toEqual([]);
  });

  it('keeps its copies outside the workspace, for the newest tasks only', () => {
    const run = changes();
    const ids = Array.from({ length: KEPT_RUNS + 3 }, (_, i) => {
      const { id } = run.begin();
      run.keep(`notes-${i}.md`);
      return id;
    });
    const kept = readdirSync(folder).sort();
    expect(kept).toEqual(ids.slice(-KEPT_RUNS));
    expect(readdirSync(workspace)).toEqual([]);
  });

  it('leaves no record of a task that changed and read nothing, so it takes no other’s place', () => {
    const run = changes();
    const empty = run.begin();
    const next = run.begin();
    expect(readdirSync(folder)).toEqual([next.id]);
    expect(run.changes(empty.id)).toBeNull();
  });

  it('counts the pages past what it keeps', () => {
    const run = changes();
    run.begin();
    for (let i = 0; i < 205; i++) run.read(`https://site${i}.example/`);
    const settled = run.settle();
    expect(settled?.pages).toHaveLength(200);
    expect(settled?.morePages).toBe(5);
  });

  it('says what became of each file, so Claude Code asks first when no copy could be kept', () => {
    write('job.md', 'job');
    write('big.pdf', 'x'.repeat(26_000_000));
    const outside = join(dataDir, 'outside.md');
    writeFileSync(outside, 'mine');
    symlinkSync(at('job.md'), at('linked.md'));
    const run = changes();
    run.begin();
    expect(run.keep('job.md')).toBe('kept');
    expect(run.keep('job.md')).toBe('kept');
    expect(run.keep('applications/new/notes.md')).toBe('new');
    expect(run.keep('big.pdf')).toBe('no-copy');
    expect(run.keep('linked.md')).toBe('no-copy');
    symlinkSync(dataDir, at('elsewhere'));
    expect(run.keep('elsewhere/new.md')).toBe('no-copy');
    expect(run.keep(outside)).toBe('ignored');
    const pre = (file_path: string) => ({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path, content: '' },
    });
    expect(keepBefore(run, pre(at('job.md')))).toBeNull();
    expect(keepBefore(run, pre(at('big.pdf')))).toEqual(ASK_WITHOUT_COPY);
    expect(keepBefore(run, { hook_event_name: 'PreToolUse', tool_name: 'Read' })).toBeNull();
    // A recorder that fails asks first too.
    const broken = {
      keep: () => {
        throw new Error('disk full');
      },
    };
    expect(keepBefore(broken, pre(at('job.md')))).toEqual(ASK_WITHOUT_COPY);
  });

  it('lists a file it couldn’t copy, with no Undo, and never takes it for a new one', async () => {
    write('guide/voice.md', 'mine');
    const run = changes();
    const { id } = run.begin();
    // Its folder of copies is gone, as on a disk that filled up.
    rmSync(join(folder, id), { recursive: true });
    expect(run.keep('guide/voice.md')).toBe('no-copy');
    write('guide/voice.md', 'changed');
    expect(run.settle()?.files).toEqual([
      { path: 'guide/voice.md', change: 'changed', lines: null, canUndo: false, undone: false },
    ]);
    expect(await run.undo(id, 'guide/voice.md')).toMatchObject({ ok: false, reason: 'failed' });
    expect(read('guide/voice.md')).toBe('changed');
    expect(trashed).toEqual([]);
  });

  it('hears the file each of Claude Code’s edits is about to change, and nothing else', () => {
    const pre = (tool_name: string, tool_input: unknown) => ({
      hook_event_name: 'PreToolUse',
      tool_name,
      tool_input,
    });
    expect(editedPath(pre('Edit', { file_path: '/w/job.md', old_string: 'a' }))).toBe('/w/job.md');
    expect(editedPath(pre('Write', { file_path: '/w/new.md', content: '' }))).toBe('/w/new.md');
    expect(editedPath(pre('MultiEdit', { file_path: '/w/a.md', edits: [] }))).toBe('/w/a.md');
    expect(editedPath(pre('NotebookEdit', { notebook_path: '/w/n.ipynb' }))).toBe('/w/n.ipynb');
    expect(editedPath(pre('Read', { file_path: '/w/job.md' }))).toBeNull();
    expect(editedPath(pre('mcp__factwright__build_resume', { folder: 'x' }))).toBeNull();
    expect(
      editedPath({ ...pre('Edit', { file_path: '/w/a' }), hook_event_name: 'PostToolUse' }),
    ).toBeNull();
    expect(editedPath(pre('Edit', { file_path: 3 }))).toBeNull();
    expect(editedPath(pre('constructor', {}))).toBeNull();
  });
});

describe('undo', () => {
  it('puts a changed file back as it was before the task, and says it’s undone', async () => {
    write('guide/rules.md', 'Rule one\n');
    const run = changes();
    const { id } = run.begin();
    run.keep('guide/rules.md');
    write('guide/rules.md', 'Rule one\nRule two\n');
    run.settle();
    const undone = await run.undo(id, 'guide/rules.md');
    expect(read('guide/rules.md')).toBe('Rule one\n');
    expect(undone).toEqual({
      ok: true,
      changes: {
        id,
        files: [
          {
            path: 'guide/rules.md',
            change: 'changed',
            lines: { added: 1, removed: 0 },
            canUndo: false,
            undone: true,
          },
        ],
        pages: [],
        morePages: 0,
      },
    });
    // Undone twice, it stays as it is.
    expect(await run.undo(id, 'guide/rules.md')).toMatchObject({ ok: true });
    expect(read('guide/rules.md')).toBe('Rule one\n');
  });

  it('lists a file the task changes again after an Undo, with Undo again, from the same copy', async () => {
    write('job.md', 'before');
    const run = changes();
    const { id } = run.begin();
    run.keep('job.md');
    write('job.md', 'first try');
    run.settle();
    await run.undo(id, 'job.md');
    expect(read('job.md')).toBe('before');
    // The user replies, and Claude tries again in the same task.
    run.keep('job.md');
    write('job.md', 'second try');
    expect(run.settle()?.files).toEqual([
      {
        path: 'job.md',
        change: 'changed',
        lines: { added: 1, removed: 1 },
        canUndo: true,
        undone: false,
      },
    ]);
    expect(await run.undo(id, 'job.md')).toMatchObject({ ok: true });
    expect(read('job.md')).toBe('before');
  });

  it('moves a file the task made to the trash', async () => {
    const run = changes();
    const { id } = run.begin();
    run.keep('applications/acme/resume.json');
    write('applications/acme/resume.json', '{}\n');
    run.settle();
    expect(await run.undo(id, 'applications/acme/resume.json')).toMatchObject({ ok: true });
    expect(trashed).toEqual([at('applications/acme/resume.json')]);
    expect(existsSync(at('applications/acme/resume.json'))).toBe(false);
  });

  it('asks first when the file changed again since the task, then puts it back anyway', async () => {
    write('base/startup-ic.json', 'before');
    const run = changes();
    const { id } = run.begin();
    run.keep('base/startup-ic.json');
    write('base/startup-ic.json', 'by Claude');
    run.settle();
    write('base/startup-ic.json', 'by the user, after');
    expect(await run.undo(id, 'base/startup-ic.json')).toMatchObject({
      ok: false,
      reason: 'since',
    });
    expect(read('base/startup-ic.json')).toBe('by the user, after');
    expect(await run.undo(id, 'base/startup-ic.json', true)).toMatchObject({ ok: true });
    expect(read('base/startup-ic.json')).toBe('before');
  });

  it('counts the task’s own later turns as its changes, not as changes since', async () => {
    write('job.md', 'one');
    const run = changes();
    const { id } = run.begin();
    run.keep('job.md');
    write('job.md', 'two');
    run.settle();
    // The user replies, and Claude changes it again in the same task.
    run.keep('job.md');
    write('job.md', 'three');
    run.settle();
    expect(await run.undo(id, 'job.md')).toMatchObject({ ok: true });
    expect(read('job.md')).toBe('one');
  });

  it('puts back a file that’s gone, its folder too', async () => {
    write('applications/acme/notes.md', 'notes');
    const run = changes();
    const { id } = run.begin();
    run.keep('applications/acme/notes.md');
    rmSync(at('applications'), { recursive: true });
    expect(run.settle()?.files).toMatchObject([
      { change: 'gone', lines: { added: 0, removed: 1 } },
    ]);
    expect(await run.undo(id, 'applications/acme/notes.md')).toMatchObject({ ok: true });
    expect(read('applications/acme/notes.md')).toBe('notes');
  });

  it('never writes through a link put in the file’s place', async () => {
    write('job.md', 'before');
    const outside = join(dataDir, 'outside.md');
    writeFileSync(outside, 'mine');
    const run = changes();
    const { id } = run.begin();
    run.keep('job.md');
    rmSync(at('job.md'));
    symlinkSync(outside, at('job.md'));
    run.settle();
    expect(await run.undo(id, 'job.md', true)).toMatchObject({ ok: false, reason: 'failed' });
    expect(readFileSync(outside, 'utf8')).toBe('mine');
  });

  it('touches only files in the task’s own record', async () => {
    write('facts/acme.md', 'facts');
    const run = changes();
    const { id } = run.begin();
    run.settle();
    for (const [task, path] of [
      [id, 'facts/acme.md'],
      [id, '../outside.md'],
      ['not-an-id', 'facts/acme.md'],
      ['../undo', 'facts/acme.md'],
    ] as const) {
      expect(await run.undo(task, path, true)).toMatchObject({ ok: false, reason: 'failed' });
    }
    expect(read('facts/acme.md')).toBe('facts');
    expect(run.see('not-an-id', 'facts/acme.md')).toBeNull();
  });

  it('undoes an earlier task’s change, from its copy, after the app opens again', async () => {
    write('guide/writing.md', 'old');
    const first = changes();
    const { id } = first.begin();
    first.keep('guide/writing.md');
    write('guide/writing.md', 'new');
    first.settle();
    const reopened = changes();
    expect(reopened.changes(id)?.files).toHaveLength(1);
    expect(await reopened.undo(id, 'guide/writing.md')).toMatchObject({ ok: true });
    expect(read('guide/writing.md')).toBe('old');
  });
});
