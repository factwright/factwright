import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { SavedForm } from '@factwright/core';
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

/** What went in the trash, by each file's path in the workspace. */
const trashedHere = () => trashed.map((file) => relative(root, file).split(sep).join('/'));

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
      rmSync(file, { recursive: true });
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
      stage: 'review',
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

  it('keeps each job’s folder in its row, so it syncs, and follows the folder', () => {
    jobs.read();
    expect(tracker.syncRow('jobs', 'acme-robotics--staff-engineer')).toMatchObject({
      folder: '2026-10-07-acme-staff-engineer',
    });
    rmSync(join(root, ACME), { recursive: true });
    write(
      'applications/2026-10-09-acme-robotics-staff/job.md',
      '# Acme Robotics: Staff Engineer\n\n- **Date:** 2026-10-09',
    );
    jobs.read();
    expect(tracker.syncRow('jobs', 'acme-robotics--staff-engineer')).toMatchObject({
      folder: '2026-10-09-acme-robotics-staff',
    });
  });

  it('gives a job the messages Claude drafted for people at its company', () => {
    write('outreach/2026-10-08-acme-robotics.md', '# Who to message at Acme\n\nDana Lee first.\n');
    jobs.read();
    expect(jobs.extras('acme-robotics--staff-engineer').outreach).toEqual([
      {
        path: 'outreach/2026-10-08-acme-robotics.md',
        date: '2026-10-08',
        text: '# Who to message at Acme\n\nDana Lee first.',
      },
    ]);
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
    expect(trashedHere()).toEqual([
      `asked/${id}/${asked.askId}.md`,
      `screenshots/${id}/ask-${asked.askId}-1.png`,
    ]);
    expect(existsSync(join(root, 'asked', id, `${other.askId}.md`))).toBe(true);
    expect(jobs.list().jobs[0]?.asks.map((ask) => ask.id)).toEqual([other.askId]);
    expect(await jobs.removeAsk(id, '../../etc')).toMatchObject({ ok: false });
  });

  it('puts a deleted call’s prep sheet and thank-you notes in the trash with it', async () => {
    jobs.addCall(id, { kind: 'screen', onDate: '2026-10-14' });
    jobs.addCall(id, { kind: 'panel', onDate: '2026-10-20' });
    const [first, second] = jobs.list().jobs[0]?.calls ?? [];
    if (!first || !second) throw new Error('No calls');
    write(`calls/${id}/${first.id}/prep.md`, '# Prep');
    write(`calls/${id}/${first.id}/thank-you.md`, '## Dana Lee');
    write(`calls/${id}/${second.id}/prep.md`, '# Prep');
    expect(await jobs.deleteCall(first.id)).toEqual({ ok: true });
    expect(trashedHere()).toEqual([`calls/${id}/${first.id}`]);
    expect(existsSync(join(root, 'calls', id, second.id, 'prep.md'))).toBe(true);
    expect(jobs.list().jobs[0]?.calls.map((call) => call.id)).toEqual([second.id]);
    // A call that's gone already has nothing left to trash.
    expect(await jobs.deleteCall('no-such-call')).toEqual({ ok: true });
    expect(trashed).toHaveLength(1);
  });
});

describe('a job the extension saved on this computer', () => {
  const job = {
    url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
    site: 'jobs.lever.co',
    company: 'Harbor & Pine',
    role: 'Senior PM, Data',
    pay: '$165k–$190k',
    posting: 'About the role\n\nLead the data platform’s roadmap.',
  };
  const id = 'harbor-and-pine--senior-pm-data';
  const posting = () => join(root, 'saved', id, 'posting.md');

  it('adds it as New, with its posting kept as save_posting keeps one, and sends the list', () => {
    jobs.read();
    expect(jobs.addSaved(job)).toEqual({ ok: true, id, already: false, posting: 'saved' });
    jobs.sendList();
    expect(readFileSync(posting(), 'utf8')).toBe(
      [
        '# Job posting',
        '',
        `- **Source:** ${job.url}`,
        "- **Saved:** 2026-10-10 from jobs.lever.co in the user's browser, as the page showed it",
        '',
        '---',
        '',
        job.posting,
        '',
      ].join('\n'),
    );
    const added = changes.at(-1)?.jobs.find((each) => each.id === id);
    expect(added).toMatchObject({ company: 'Harbor & Pine', status: 'new', manual: true });
  });

  it('adds the same job once, keeping the posting it has, or adding one it lacks', () => {
    expect(jobs.addSaved({ ...job, posting: '' })).toMatchObject({
      already: false,
      posting: 'none',
    });
    expect(existsSync(posting())).toBe(false);
    expect(jobs.addSaved(job)).toEqual({ ok: true, id, already: true, posting: 'saved' });
    expect(jobs.addSaved({ ...job, posting: 'Another posting' })).toEqual({
      ok: true,
      id,
      already: true,
      posting: 'kept',
    });
    expect(readFileSync(posting(), 'utf8')).toContain('Lead the data platform’s roadmap.');
  });

  it('replaces a posting left from an earlier job with its ID', () => {
    write(`saved/${id}/posting.md`, 'An old posting');
    expect(jobs.addSaved(job)).toMatchObject({ already: false, posting: 'saved' });
    expect(readFileSync(posting(), 'utf8')).toContain('Lead the data platform’s roadmap.');
  });

  it('says when its posting couldn’t be kept, with the job in', () => {
    // A file where the job's folder of saved extras would go.
    write('saved', 'not a folder');
    expect(jobs.addSaved(job)).toEqual({ ok: true, id, already: false, posting: 'failed' });
    expect(tracker.rows().some((each) => each.id === id)).toBe(true);
  });

  it('adds the link and posting to the same role found by its company’s board alone', () => {
    tracker.addSavedJob(
      {
        company: 'Harbor & Pine',
        role: 'Senior PM, Data',
        link: 'https://jobs.lever.co/harborpine',
        pay: '',
      },
      { today: '2026-10-09', now: '2026-10-09T18:00:00.000Z' },
    );
    expect(jobs.addSaved(job)).toEqual({
      ok: true,
      id,
      already: true,
      joined: true,
      posting: 'saved',
    });
    expect(readFileSync(posting(), 'utf8')).toContain('Lead the data platform’s roadmap.');
    expect(tracker.rows().map((each) => each.id)).toEqual([id]);
  });
});

describe('a form’s questions, for your Claude to draft', () => {
  const id = 'acme-robotics--staff-engineer';
  const asked = (question: string, more: Partial<SavedForm['questions'][number]> = {}) => ({
    question,
    hint: '',
    section: '',
    control: 'long' as const,
    options: [],
    required: false,
    limit: null,
    ...more,
  });
  const form: SavedForm = {
    url: 'https://jobs.lever.co/acme/1/apply',
    read: '2026-10-10T16:30:00.000Z',
    from: 'browser',
    questions: [
      asked('Why Acme?', { limit: 500 }),
      asked('If yes, please explain'),
      asked('Are you open to travel?', { control: 'choice', options: ['Yes', 'No'] }),
      asked('If yes, please explain'),
    ],
  };

  beforeEach(() => {
    jobs.read();
  });

  it('keeps them with the job, beside its saved posting, and reads them back', () => {
    expect(jobs.keepForm(id, form)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(root, 'saved', id, 'form.json'), 'utf8'))).toEqual(form);
    expect(jobs.savedForm(id)).toEqual(form);
    expect(jobs.savedForm('missing')).toBeNull();
    // The job's panel reads them with what else is on file for it.
    expect(jobs.extras(id).form).toEqual(form);
    expect(jobs.extras('missing').form).toBeNull();
  });

  it('adds each to the job’s application questions it doesn’t have, as many times as the form asks it', () => {
    jobs.updateJob(id, { questions: ['1. Why Acme? *', 'If yes, please explain'] });
    jobs.keepForm(id, form);
    expect(jobs.job(id)?.questions).toEqual([
      '1. Why Acme? *',
      'If yes, please explain',
      'Are you open to travel?',
      'If yes, please explain',
    ]);
    // Asked again, nothing's added twice.
    jobs.keepForm(id, form);
    expect(jobs.job(id)?.questions).toHaveLength(4);
  });

  it('is only for a job that’s there, and says when it couldn’t keep them', () => {
    expect(jobs.keepForm('missing', form)).toMatchObject({ ok: false });
    write('saved', 'not a folder');
    expect(jobs.keepForm(id, form)).toEqual({
      ok: false,
      message: 'Factwright couldn’t keep the form’s questions.',
    });
  });
});

describe('merging a job found twice', () => {
  const kept = 'acme-robotics--staff-engineer';
  const twice = 'acme--staff-software-engineer-tools';
  beforeEach(() => {
    // A later search found the same job under a shorter name and another title.
    write(
      'searches/2026-10-12-linkedin/jobs.json',
      JSON.stringify({
        meta: { source: 'LinkedIn Oct 12', checked: '2026-10-12' },
        jobs: [{ company: 'Acme', role: 'Staff Software Engineer, Tools', tier: 'good' }],
      }),
    );
    jobs.read();
  });

  it('moves the other’s status and extras to the job kept, and files its finds there', async () => {
    expect(jobs.list().jobs.map((job) => job.id)).toEqual([kept, twice]);
    jobs.updateJob(twice, { status: 'passed' });
    const ask = jobs.addAsk(twice, 'What should I expect?');
    jobs.addAsk(kept, 'What should I expect?');
    const askId = ask.ok ? ask.askId : '';
    write(`asked/${twice}/${askId}.md`, 'Expect a panel.');
    write(`screenshots/${twice}/ask-${askId}-1.png`, 'png');
    write(`screenshots/${twice}/form-2026-10-10-1.png`, 'png');
    write(`screenshots/${kept}/form-2026-10-10-1.png`, 'png');
    write(`calls/${twice}/c-1/prep.md`, '# Prep');
    write(`saved/${twice}/posting.md`, '# Job posting');
    write(`saved/${twice}/form.json`, '{"questions": []}');

    expect(await jobs.mergeJobs(kept, twice)).toEqual({ ok: true });
    const [job, ...rest] = changes.at(-1)?.jobs ?? [];
    expect(rest).toEqual([]);
    expect(job).toMatchObject({
      id: kept,
      status: 'passed',
      searches: [{ folder: '2026-10-12-linkedin' }],
      search: { source: 'LinkedIn Oct 12', again: true },
    });
    const renamed = `${askId}-2`;
    expect(job?.asks.map((each) => each.id)).toEqual([askId, renamed]);
    expect(readFileSync(join(root, `asked/${kept}/${renamed}.md`), 'utf8')).toBe('Expect a panel.');
    for (const file of [
      `screenshots/${kept}/ask-${renamed}-1.png`,
      `screenshots/${kept}/form-2026-10-10-1.png`,
      `screenshots/${kept}/form-2026-10-10-2.png`,
      `calls/${kept}/c-1/prep.md`,
      `saved/${kept}/posting.md`,
      `saved/${kept}/form.json`,
    ]) {
      expect(existsSync(join(root, file))).toBe(true);
    }
    for (const folder of ['asked', 'screenshots', 'calls', 'saved']) {
      expect(existsSync(join(root, folder, twice))).toBe(false);
    }
  });

  it('puts the other’s saved posting in the trash when the job kept has one', async () => {
    write(`saved/${twice}/posting.md`, '# Job posting, again');
    write(`saved/${kept}/posting.md`, '# Job posting');
    await jobs.mergeJobs(kept, twice);
    expect(trashedHere()).toEqual([`saved/${twice}/posting.md`]);
    expect(readFileSync(join(root, `saved/${kept}/posting.md`), 'utf8')).toBe('# Job posting');
  });

  it('says why not when it can’t merge them', async () => {
    expect(await jobs.mergeJobs(kept, 'missing')).toMatchObject({ ok: false });
  });
});
