import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobList } from '../../shared/api.ts';
import { JobsService } from './service.ts';
import { Tracker } from './tracker.ts';

const ACME = 'applications/2026-10-07-acme-staff-engineer';

let root: string;
let tracker: Tracker;
let changes: JobList[];
let jobs: JobsService;
let trashed: string[];

function write(path: string, text: string) {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-jobs-'));
  write(
    `${ACME}/job.md`,
    '# Acme Robotics: Staff Engineer\n\n- **Date:** 2026-10-07\n- **Pay:** $185k–$215k',
  );
  write(`${ACME}/posting.md`, 'Build the tools our engineers use.');
  write(`${ACME}/resume.pdf`, 'pdf');
  tracker = new Tracker(':memory:');
  changes = [];
  trashed = [];
  jobs = new JobsService({
    workspace: root,
    tracker,
    onChange: (list) => changes.push(list),
    now: () => new Date(2026, 9, 10, 9, 30),
    trash: async (file) => {
      trashed.push(file);
      rmSync(file);
    },
  });
});

afterEach(() => {
  jobs.stop();
  tracker.close();
  rmSync(root, { recursive: true, force: true });
});

describe('JobsService', () => {
  it('reads the workspace into jobs, joined with the tracker', () => {
    const list = jobs.read();
    expect(list.readAt).toBe(new Date(2026, 9, 10, 9, 30).toISOString());
    expect(list.jobs).toHaveLength(1);
    expect(list.jobs[0]).toMatchObject({
      id: 'acme-robotics--staff-engineer',
      company: 'Acme Robotics',
      stage: 'resume',
      pay: { min: 185_000, max: 215_000, source: 'listed' },
      folder: '2026-10-07-acme-staff-engineer',
      docKinds: ['posting', 'job'],
      status: null,
      manual: false,
      calls: [],
      statusLog: [],
    });
    expect(list.jobs[0]).not.toHaveProperty('docs');
    expect(jobs.docs('acme-robotics--staff-engineer')?.posting).toBe(
      'Build the tools our engineers use.',
    );
    expect(jobs.docs('missing')).toBeNull();
  });

  it('saves edits with the user’s date, and sends the new list', () => {
    jobs.read();
    expect(jobs.updateJob('acme-robotics--staff-engineer', { status: 'applied' })).toEqual({
      ok: true,
    });
    expect(changes.at(-1)?.jobs[0]).toMatchObject({
      status: 'applied',
      statusOn: '2026-10-10',
      appliedOn: '2026-10-10',
      statusLog: [{ status: 'applied', at: '2026-10-10' }],
    });
    jobs.addCall('acme-robotics--staff-engineer', { kind: 'screen', onDate: '2026-10-13' });
    expect(changes.at(-1)?.jobs[0]).toMatchObject({
      status: 'screen',
      calls: [{ kind: 'screen' }],
    });
  });

  it('sends nothing when an edit fails', () => {
    jobs.read();
    expect(jobs.updateJob('missing', { earlierNotes: 'x' })).toMatchObject({ ok: false });
    expect(changes).toEqual([]);
  });

  it('lists jobs added by hand', () => {
    jobs.read();
    const added = jobs.addJob({ company: 'Harbor & Pine', pay: '$155k–$185k' });
    expect(added).toEqual({ ok: true, jobId: 'harbor-and-pine--general' });
    expect(changes.at(-1)?.jobs.find((job) => job.manual)).toMatchObject({
      company: 'Harbor & Pine',
      source: 'Added by hand',
      stage: 'new',
      pay: { text: '$155k–$185k', min: 155_000, max: 185_000, source: 'listed' },
      firstSeen: '2026-10-10',
    });
  });

  it('keeps a tracked job listed after its files go, and drops one that wasn’t tracked', () => {
    write('applications/tidewater/job.md', '# Tidewater Analytics: Senior Backend Engineer');
    jobs.read();
    jobs.updateJob('acme-robotics--staff-engineer', { earlierNotes: 'Recruiter: Sam' });
    jobs.addNote('acme-robotics--staff-engineer', { text: 'Screen went well' });
    rmSync(join(root, 'applications'), { recursive: true });
    const list = jobs.read();
    expect(
      list.jobs.map((job) => [job.id, job.stage, job.earlierNotes, job.notes.map((n) => n.text)]),
    ).toEqual([['acme-robotics--staff-engineer', 'new', 'Recruiter: Sam', ['Screen went well']]]);
  });

  it('keeps a job’s ID when its role is renamed', () => {
    jobs.read();
    write(`${ACME}/job.md`, '# Acme Robotics: Staff Engineer, Developer Tools');
    // Read fresh, this role would make the ID "acme-robotics--staff-engineer-developer-tools".
    expect(jobs.read().jobs.map((job) => [job.id, job.role])).toEqual([
      ['acme-robotics--staff-engineer', 'Staff Engineer, Developer Tools'],
    ]);
  });

  it('reads again when the workspace changes', async () => {
    jobs.read();
    jobs.watch();
    // macOS starts watching a moment after watch() returns, so write until it's listening. Each
    // try waits out the watcher's quiet time.
    await vi.waitFor(
      () => {
        write('applications/tidewater/job.md', '# Tidewater Analytics: Senior Backend Engineer');
        expect(changes.at(-1)?.jobs).toHaveLength(2);
      },
      { timeout: 5000, interval: 500 },
    );
  });
});

/** A small picture's bytes, which are what a .png name says. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]);

describe('screenshots and questions for Claude', () => {
  const id = 'acme-robotics--staff-engineer';

  beforeEach(() => {
    jobs.read();
  });

  it('keeps a job’s screenshots in a folder of its own, named for what they came with', async () => {
    expect(await jobs.addShot(id, { name: 'image.png', bytes: PNG }, { kind: 'form' })).toEqual({
      ok: true,
      path: `screenshots/${id}/form-2026-10-10-1.png`,
    });
    expect(await jobs.addShot(id, { name: 'Shot.PNG', bytes: PNG }, { kind: 'form' })).toEqual({
      ok: true,
      path: `screenshots/${id}/form-2026-10-10-2.png`,
    });
    const asked = jobs.addAsk(id, 'What should I expect?');
    if (!asked.ok) throw new Error(asked.message);
    expect(
      await jobs.addShot(id, { name: 'email.png', bytes: PNG }, { kind: 'ask', ask: asked.askId }),
    ).toEqual({ ok: true, path: `screenshots/${id}/ask-${asked.askId}-1.png` });
    expect(await jobs.addShot(null, { name: 'image.png', bytes: PNG }, { kind: 'pasted' })).toEqual(
      {
        ok: true,
        path: 'screenshots/pasted-2026-10-10-093000-1.png',
      },
    );
    expect(readFileSync(join(root, 'screenshots', id, 'form-2026-10-10-1.png'))).toEqual(
      Buffer.from(PNG),
    );
    expect(jobs.extras(id).shots.map((shot) => [shot.kind, shot.ask])).toEqual([
      ['ask', asked.askId],
      ['form', null],
      ['form', null],
    ]);
    expect(await jobs.shot(`screenshots/${id}/form-2026-10-10-1.png`)).toEqual(PNG);
  });

  it('refuses what isn’t a picture, or a job it doesn’t have, and paths outside its folder', async () => {
    expect(
      await jobs.addShot(
        id,
        { name: 'notes.png', bytes: new TextEncoder().encode('hello') },
        {
          kind: 'form',
        },
      ),
    ).toMatchObject({
      ok: false,
      message: 'notes.png doesn’t look like a .png file inside. Try saving it again.',
    });
    expect(
      await jobs.addShot(id, { name: 'resume.pdf', bytes: PNG }, { kind: 'form' }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await jobs.addShot('nope--job', { name: 'a.png', bytes: PNG }, { kind: 'form' }),
    ).toEqual({
      ok: false,
      message: 'That job isn’t in your tracker anymore.',
    });
    for (const path of [`${ACME}/resume.pdf`, '../outside.png', 'screenshots/../tracker.png']) {
      expect(await jobs.shot(path)).toBeNull();
      expect(await jobs.removeShot(path)).toMatchObject({ ok: false });
    }
    expect(trashed).toEqual([]);
  });

  it('puts a removed question’s answer and screenshots in the trash, and only those', async () => {
    const asked = jobs.addAsk(id, 'What should I expect?');
    const other = jobs.addAsk(id, 'What’s their stack?');
    if (!asked.ok || !other.ok) throw new Error('Not asked');
    write(`asked/${id}/${asked.askId}.md`, '# What should I expect?\n\nA short screen.');
    write(`asked/${id}/${other.askId}.md`, '# What’s their stack?\n\nGo.');
    await jobs.addShot(id, { name: 'a.png', bytes: PNG }, { kind: 'ask', ask: asked.askId });
    await jobs.addShot(id, { name: 'b.png', bytes: PNG }, { kind: 'form' });
    expect(await jobs.removeAsk(id, asked.askId)).toEqual({ ok: true });
    expect(trashed.map((file) => file.slice(root.length + 1))).toEqual([
      `asked/${id}/${asked.askId}.md`,
      `screenshots/${id}/ask-${asked.askId}-1.png`,
    ]);
    expect(existsSync(join(root, 'asked', id, `${other.askId}.md`))).toBe(true);
    expect(jobs.list().jobs[0]?.asks.map((ask) => ask.id)).toEqual([other.askId]);
    expect(await jobs.removeAsk(id, '../../etc')).toMatchObject({ ok: false });
  });
});
