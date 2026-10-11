import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  jobs = new JobsService({
    workspace: root,
    tracker,
    onChange: (list) => changes.push(list),
    now: () => new Date(2026, 9, 10, 9, 30),
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
    expect(jobs.updateJob('missing', { notes: 'x' })).toMatchObject({ ok: false });
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
    jobs.updateJob('acme-robotics--staff-engineer', { notes: 'Recruiter: Sam' });
    rmSync(join(root, 'applications'), { recursive: true });
    const list = jobs.read();
    expect(list.jobs.map((job) => [job.id, job.stage, job.notes])).toEqual([
      ['acme-robotics--staff-engineer', 'new', 'Recruiter: Sam'],
    ]);
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
