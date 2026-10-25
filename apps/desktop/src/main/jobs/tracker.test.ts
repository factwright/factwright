import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type CollectedJob, jobIdFor, newJobRows, normalizeUrl, shortCode } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trackerAsOf } from './testing.ts';
import { type EditContext, Tracker } from './tracker.ts';

const TODAY = '2026-10-10';
const NOW = '2026-10-10T18:00:00.000Z';
const AT: EditContext = { today: TODAY, now: NOW };

function collected(id: string, extra: Partial<CollectedJob> = {}): CollectedJob {
  return {
    id,
    company: 'Acme Robotics',
    companyKey: 'acme-robotics',
    role: 'Staff Engineer',
    link: null,
    links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
    location: null,
    pay: null,
    source: 'Fit check',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    suggestedAsk: null,
    folder: null,
    stage: 'review',
    firstSeen: '2026-10-07',
    lastActivity: '2026-10-07',
    summary: null,
    events: [],
    docs: {},
    outreach: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    letters: [],
    projectPages: [],
    ...extra,
  };
}

let tracker: Tracker;

beforeEach(() => {
  tracker = new Tracker(':memory:');
  tracker.saveCollected([collected('acme--staff')], NOW);
});

afterEach(() => tracker.close());

const row = (id = 'acme--staff') => tracker.rows().find((each) => each.id === id);
const history = (id = 'acme--staff') =>
  (tracker.history().get(id) ?? []).map((change) => [change.status, change.at]);

describe('saveCollected', () => {
  it('keeps each job’s name, links and first sighting', () => {
    expect(tracker.knownJobs()).toEqual([
      {
        id: 'acme--staff',
        company: 'Acme Robotics',
        companyKey: 'acme-robotics',
        role: 'Staff Engineer',
        links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
        mergedInto: null,
      },
    ]);
    expect(row()).toMatchObject({ manual: false, firstSeen: '2026-10-07', status: null });
  });

  it('follows new names and links, keeps the earliest sighting, and never blanks the role', () => {
    tracker.updateJob('acme--staff', { earlierNotes: 'Ask about on-call' }, AT);
    tracker.saveCollected(
      [
        collected('acme--staff', {
          company: 'Acme Robotics, Inc.',
          role: '',
          links: [],
          firstSeen: '2026-10-09',
        }),
      ],
      NOW,
    );
    expect(row()).toMatchObject({
      company: 'Acme Robotics, Inc.',
      role: 'Staff Engineer',
      links: [],
      firstSeen: '2026-10-07',
      earlierNotes: 'Ask about on-call',
    });
    tracker.saveCollected([collected('acme--staff', { firstSeen: '2026-10-01' })], NOW);
    expect(row()?.firstSeen).toBe('2026-10-01');
  });
});

describe('saveFolders', () => {
  const FIRST = '2026-10-07-acme-robotics-staff-engineer';
  const LATER = '2026-10-09-acme-robotics-staff-engineer';

  it('keeps each job’s folder in its row, follows it to another, and has none once it’s gone', () => {
    expect(row()?.folder).toBeNull();
    tracker.saveFolders([collected('acme--staff', { folder: FIRST })], new Set([FIRST]));
    expect(row()?.folder).toBe(FIRST);
    expect(tracker.syncRow('jobs', 'acme--staff')).toMatchObject({ folder: FIRST });
    tracker.saveFolders([collected('acme--staff', { folder: LATER })], new Set([FIRST, LATER]));
    expect(row()?.folder).toBe(LATER);
    // The folder's another job's now, or the job's files are gone.
    tracker.saveFolders([], new Set([LATER]));
    expect(row()?.folder).toBeNull();
  });

  it('gives a job the skills haven’t found a folder for none, and one merged into another none', () => {
    tracker.addJob({ company: 'Fernway', role: 'Project Manager' }, AT);
    tracker.saveCollected([collected('acme--staff-2', { folder: LATER })], NOW);
    tracker.saveFolders(
      [collected('acme--staff', { folder: FIRST }), collected('acme--staff-2', { folder: LATER })],
      new Set([FIRST, LATER]),
    );
    tracker.mergeJobs('acme--staff', 'acme--staff-2', AT);
    // Merged, the job kept has both folders, and its newest is its folder.
    tracker.saveFolders([collected('acme--staff', { folder: LATER })], new Set([FIRST, LATER]));
    expect(row()?.folder).toBe(LATER);
    expect(row('acme--staff-2')?.folder).toBeNull();
    expect(row('fernway--project-manager')?.folder).toBeNull();
  });

  it('leaves a folder another computer named, which this one doesn’t have', () => {
    const synced = tracker.syncRow('jobs', 'acme--staff') ?? {};
    tracker.applySyncRow('jobs', 'acme--staff', { ...synced, folder: LATER });
    // It may be on its way here, or never sync here: this computer can't tell it's wrong.
    tracker.saveFolders([collected('acme--staff', { folder: FIRST })], new Set([FIRST]));
    expect(row()?.folder).toBe(LATER);
    tracker.saveFolders([], new Set([FIRST]));
    expect(row()?.folder).toBe(LATER);
    // Once it's had it, this computer goes by what it finds.
    tracker.saveFolders([collected('acme--staff', { folder: FIRST })], new Set([FIRST, LATER]));
    expect(row()?.folder).toBe(FIRST);
  });
});

describe('updateJob', () => {
  it('dates a new status today, logs it, and sets the applied date', () => {
    expect(tracker.updateJob('acme--staff', { status: 'applied' }, AT)).toEqual({ ok: true });
    expect(row()).toMatchObject({ status: 'applied', statusOn: TODAY, appliedOn: TODAY });
    expect(history()).toEqual([['applied', TODAY]]);
  });

  it('backdates a status, and keeps an applied date the user gave', () => {
    tracker.updateJob(
      'acme--staff',
      { status: 'applied', statusOn: '2026-10-08', appliedOn: '2026-10-06' },
      AT,
    );
    expect(row()).toMatchObject({ statusOn: '2026-10-08', appliedOn: '2026-10-06' });
    expect(history()).toEqual([['applied', '2026-10-08']]);
  });

  it('saves the other fields, and clearing the status logs nothing', () => {
    tracker.updateJob('acme--staff', { status: 'passed' }, AT);
    tracker.updateJob(
      'acme--staff',
      {
        status: null,
        nextAction: 'Follow up',
        nextOn: '2026-10-14',
        earlierNotes: 'Recruiter: Sam',
        questions: ['Why Acme?', 'Notice period?'],
        archived: true,
      },
      AT,
    );
    expect(row()).toMatchObject({
      status: null,
      statusOn: null,
      nextAction: 'Follow up',
      nextOn: '2026-10-14',
      earlierNotes: 'Recruiter: Sam',
      questions: ['Why Acme?', 'Notice period?'],
      archived: true,
    });
    expect(history()).toEqual([['passed', TODAY]]);
  });

  it('puts a job under a kind of job, and back to what the search or fit check found', () => {
    tracker.updateJob('acme--staff', { kind: 'project-manager' }, AT);
    expect(row()?.kind).toBe('project-manager');
    tracker.updateJob('acme--staff', { kind: null }, AT);
    expect(row()?.kind).toBeNull();
    expect(history()).toEqual([]);
  });

  it('keeps the pay the user asks for at a job, and goes back to none', () => {
    tracker.updateJob('acme--staff', { payAsk: '$185,000' }, AT);
    expect(row()?.payAsk).toBe('$185,000');
    expect(tracker.syncRow('jobs', 'acme--staff')?.pay_ask).toBe('$185,000');
    tracker.updateJob('acme--staff', { payAsk: null }, AT);
    expect(row()?.payAsk).toBeNull();
    expect(history()).toEqual([]);
  });

  it('logs nothing when the status stays the same', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    expect(history()).toHaveLength(1);
  });

  it('corrects when the current status started', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { statusOn: '2026-10-03' }, AT);
    expect(row()).toMatchObject({ statusOn: '2026-10-03', appliedOn: '2026-10-03' });
    expect(history()).toEqual([['applied', '2026-10-03']]);
  });

  it('refuses to date a status that comes from the skills', () => {
    const result = tracker.updateJob('acme--staff', { statusOn: '2026-10-03' }, AT);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Claude’s work') });
  });

  it('says so when the job is gone', () => {
    expect(tracker.updateJob('gone', { earlierNotes: 'x' }, AT)).toMatchObject({ ok: false });
  });

  it('keeps the day a job set aside comes back, and changes or clears it', () => {
    tracker.updateJob('acme--staff', { status: 'later', backOn: '2026-11-02' }, AT);
    expect(row()).toMatchObject({ status: 'later', statusOn: TODAY, backOn: '2026-11-02' });
    tracker.updateJob('acme--staff', { backOn: '2026-11-09' }, AT);
    expect(row()?.backOn).toBe('2026-11-09');
    tracker.updateJob('acme--staff', { backOn: null }, AT);
    expect(row()?.backOn).toBeNull();
    expect(history()).toEqual([['later', TODAY]]);
  });

  it('keeps why the user passed, and a new pass replaces it', () => {
    tracker.updateJob('acme--staff', { status: 'passed', passReason: 'pay' }, AT);
    expect(row()).toMatchObject({ status: 'passed', passReason: 'pay' });
    // The reason can come a moment after passing, from the chips that follow.
    tracker.updateJob('acme--staff', { passReason: 'location' }, AT);
    expect(row()?.passReason).toBe('location');
    tracker.updateJob('acme--staff', { status: 'review' }, AT);
    tracker.updateJob('acme--staff', { status: 'passed' }, AT);
    expect(row()).toMatchObject({ status: 'passed', passReason: null });
  });

  it('keeps a set-aside job’s day when it moves on, so undoing the move brings both back', () => {
    tracker.updateJob('acme--staff', { status: 'later', backOn: '2026-11-02' }, AT);
    tracker.updateJob('acme--staff', { status: 'apply' }, AT);
    expect(row()).toMatchObject({ status: 'apply', backOn: '2026-11-02' });
    const [, moved] = tracker.history().get('acme--staff') ?? [];
    tracker.undoChange(moved?.id ?? '', NOW);
    expect(row()).toMatchObject({ status: 'later', backOn: '2026-11-02' });
    // Setting it aside again starts over: no day, unless one is given.
    tracker.updateJob('acme--staff', { status: 'review' }, AT);
    tracker.updateJob('acme--staff', { status: 'later' }, AT);
    expect(row()?.backOn).toBeNull();
  });

  it('reads the statuses Claude’s work used to set as To review, and undoes them', () => {
    const old = (status: string, at: string) =>
      tracker.applySyncRow('status_log', `old-${status}`, {
        id: `old-${status}`,
        job_id: 'acme--staff',
        status,
        at,
      });
    old('checked', '2026-10-01');
    old('resume', '2026-10-02');
    // As an earlier version left them: a status Claude's work set, and its history.
    tracker.applySyncRow('jobs', 'acme--staff', {
      ...tracker.syncRow('jobs', 'acme--staff'),
      status: 'resume',
      status_on: '2026-10-02',
    });
    expect(row()).toMatchObject({ status: 'review', statusOn: '2026-10-02' });
    expect(history()).toEqual([
      ['review', '2026-10-01'],
      ['review', '2026-10-02'],
    ]);
    tracker.undoChange('old-resume', NOW);
    expect(row()).toMatchObject({ status: 'review', statusOn: '2026-10-01' });
    expect(tracker.syncRow('jobs', 'acme--staff')?.status).toBe('checked');
  });
});

describe('updateJobs', () => {
  beforeEach(() => {
    tracker.saveCollected(
      [collected('globex--staff', { company: 'Globex', companyKey: 'globex' })],
      NOW,
    );
  });

  it('makes the same change to each job, logging each, in one go', () => {
    const moved = tracker.updateJobs(['acme--staff', 'globex--staff'], { status: 'passed' }, AT);
    expect(moved).toEqual({ ok: true });
    for (const id of ['acme--staff', 'globex--staff']) {
      expect(row(id)).toMatchObject({ status: 'passed', statusOn: TODAY });
      expect(history(id)).toEqual([['passed', TODAY]]);
    }
    tracker.updateJobs(['acme--staff', 'globex--staff'], { passReason: 'level' }, AT);
    expect([row('acme--staff')?.passReason, row('globex--staff')?.passReason]).toEqual([
      'level',
      'level',
    ]);
  });

  it('passes over jobs that are gone, and logs nothing for one already there', () => {
    tracker.updateJob('acme--staff', { status: 'review' }, AT);
    tracker.updateJobs(['acme--staff', 'gone', 'globex--staff'], { status: 'review' }, AT);
    expect(history('acme--staff')).toHaveLength(1);
    expect(row('globex--staff')?.status).toBe('review');
    expect(tracker.updateJobs(['gone'], { status: 'review' }, AT)).toMatchObject({ ok: false });
  });
});

describe('addJob', () => {
  it('adds a job by hand with an ID from its company and role', () => {
    const first = tracker.addJob(
      {
        company: 'Harbor & Pine',
        role: 'Senior Engineer, Payments',
        link: 'https://harborpine.example/jobs/42',
        pay: '$155k–$185k',
        status: 'applied',
        notes: '  Referred by a friend  ',
      },
      AT,
    );
    expect(first).toEqual({ ok: true, jobId: 'harbor-and-pine--senior-engineer-payments' });
    expect(row('harbor-and-pine--senior-engineer-payments')).toMatchObject({
      manual: true,
      links: [{ url: 'https://harborpine.example/jobs/42', label: 'Posting' }],
      payText: '$155k–$185k',
      firstSeen: TODAY,
      status: 'applied',
      appliedOn: TODAY,
      earlierNotes: null,
    });
    expect(history('harbor-and-pine--senior-engineer-payments')).toEqual([['applied', TODAY]]);
    // What the user typed about it becomes its first note, dated today.
    expect(tracker.notes().get('harbor-and-pine--senior-engineer-payments')).toEqual([
      { id: expect.any(String), on: TODAY, text: 'Referred by a friend', at: NOW },
    ]);
    const second = tracker.addJob(
      { company: 'Harbor & Pine', role: 'Senior Engineer, Payments' },
      AT,
    );
    expect(second).toEqual({ ok: true, jobId: 'harbor-and-pine--senior-engineer-payments-2' });
  });

  it('adds a job under the kind of job the user picked', () => {
    const added = tracker.addJob({ company: 'Fernway', kind: 'project-manager' }, AT);
    expect(added).toEqual({ ok: true, jobId: 'fernway--general' });
    expect(row('fernway--general')?.kind).toBe('project-manager');
    tracker.addJob({ company: 'Tidewater' }, AT);
    expect(row('tidewater--general')?.kind).toBeNull();
  });

  it('names a job whose company has no Latin letters by its link, as the extension does', () => {
    const link = 'https://example.jp/jobs/1?utm_source=x';
    const added = tracker.addJob({ company: '株式会社', role: 'エンジニア', link }, AT);
    expect(added).toEqual({
      ok: true,
      jobId: jobIdFor('株式会社', 'エンジニア', shortCode(normalizeUrl(link))),
    });
    expect(tracker.addJob({ company: '株式会社' }, AT)).toEqual({
      ok: true,
      jobId: 'job--general',
    });
  });

  it('needs a company, and a link that starts with http', () => {
    expect(tracker.addJob({ company: '  ' }, AT)).toMatchObject({ ok: false });
    expect(tracker.addJob({ company: 'Acme', link: 'javascript:alert(1)' }, AT)).toMatchObject({
      ok: false,
    });
  });
});

describe('addSavedJob', () => {
  const lever = 'https://jobs.lever.co/harborpine/4f1c2b7e';
  const saved = (extra: Partial<{ company: string; role: string; link: string }> = {}) =>
    tracker.addSavedJob(
      { company: 'Harbor & Pine', role: 'Senior PM, Data', link: lever, pay: '$165k', ...extra },
      AT,
    );

  it('adds a job saved on this computer as New, as a save through sync does', () => {
    expect(saved()).toEqual({ ok: true, id: 'harbor-and-pine--senior-pm-data', already: false });
    const rows = newJobRows({
      id: 'harbor-and-pine--senior-pm-data',
      company: 'Harbor & Pine',
      role: 'Senior PM, Data',
      link: lever,
      pay: '$165k',
      status: 'new',
      today: TODAY,
      now: NOW,
      statusId: 'any',
    });
    expect(tracker.syncRow('jobs', 'harbor-and-pine--senior-pm-data')).toEqual(rows.job);
    expect(history('harbor-and-pine--senior-pm-data')).toEqual([['new', TODAY]]);
  });

  it('adds the same job, by its link, once', () => {
    saved();
    expect(saved()).toEqual({ ok: true, id: 'harbor-and-pine--senior-pm-data', already: true });
    // The same link written another way is the same job.
    expect(saved({ link: `${lever}?utm_source=linkedin` })).toMatchObject({ already: true });
    expect(tracker.rows()).toHaveLength(2);
  });

  it('gives another job with the same company and title the next ID', () => {
    saved();
    expect(saved({ link: 'https://jobs.lever.co/harborpine/9d2e' })).toEqual({
      ok: true,
      id: 'harbor-and-pine--senior-pm-data-2',
      already: false,
    });
    expect(saved({ link: 'https://jobs.lever.co/harborpine/9d2e' })).toMatchObject({
      id: 'harbor-and-pine--senior-pm-data-2',
      already: true,
    });
  });

  it('finds a job the app knew by its whole ID, from before IDs were cut short', () => {
    const company = 'A'.repeat(70);
    tracker.saveCollected(
      [
        collected(`${'a'.repeat(70)}--staff-engineer`, {
          company,
          companyKey: 'a'.repeat(70),
          links: [{ url: lever, label: 'Posting' }],
        }),
      ],
      NOW,
    );
    expect(saved({ company, role: 'Staff Engineer' })).toEqual({
      ok: true,
      id: `${'a'.repeat(70)}--staff-engineer`,
      already: true,
    });
  });

  it('gives a company with no Latin letters an ID from its link', () => {
    const added = saved({ company: '株式会社', role: 'エンジニア' });
    expect(added).toEqual({
      ok: true,
      id: jobIdFor('株式会社', 'エンジニア', shortCode(normalizeUrl(lever))),
      already: false,
    });
  });

  it('finds the posting saved from its own page in a save from its application', () => {
    saved();
    expect(saved({ link: `${lever}/apply`, role: 'Senior Product Manager, Data' })).toEqual({
      ok: true,
      id: 'harbor-and-pine--senior-pm-data',
      already: true,
    });
    const ashby = 'https://jobs.ashbyhq.com/harborpine/8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80';
    saved({ role: 'Data Engineer', link: ashby });
    expect(saved({ role: 'Data Engineer', link: `${ashby}/application` })).toMatchObject({
      id: 'harbor-and-pine--data-engineer',
      already: true,
    });
    const workable = 'https://apply.workable.com/j/1B6E0A1710';
    saved({ role: 'Analytics Engineer', link: workable });
    expect(
      saved({
        role: 'Analytics Engineer',
        link: 'https://apply.workable.com/harborpine/j/1B6E0A1710/apply/',
      }),
    ).toMatchObject({ id: 'harbor-and-pine--analytics-engineer', already: true });
    expect(tracker.rows()).toHaveLength(4);
  });

  it('adds the link to the same role found with no posting of its own, as Seeq’s was', () => {
    // A Hacker News search found it, with its company's whole board and the post.
    const found = 'seeq--ai-software-engineer-staff-principal';
    const board = [
      { url: 'https://apply.workable.com/seeq', label: 'Board' },
      { url: 'https://news.ycombinator.com/item?id=45678901', label: 'HN post' },
    ];
    tracker.saveCollected(
      [
        collected(found, {
          company: 'Seeq',
          companyKey: 'seeq',
          role: 'AI Software Engineer, Staff/Principal',
          links: board,
        }),
      ],
      NOW,
    );
    const posting = 'https://apply.workable.com/seeq/j/1B6E0A1710/';
    expect(
      saved({ company: 'Seeq', role: 'AI Software Engineer - Staff/Principal', link: posting }),
    ).toEqual({ ok: true, id: found, already: true, joined: true });
    expect(row(found)?.links).toEqual([...board, { url: posting, label: 'Posting' }]);
    expect(tracker.syncRow('jobs', found)?.updated_at).toBe(NOW);
    expect(row(`${found}-2`)).toBeUndefined();
    // Its application is that posting now.
    expect(
      saved({ company: 'Seeq', role: 'AI Software Engineer', link: `${posting}apply/` }),
    ).toEqual({ ok: true, id: found, already: true });
  });

  it('tells two roles saved from one careers page apart, and finds each again', () => {
    const careers = 'https://harborpine.example/careers';
    expect(saved({ role: 'Data Analyst', link: careers })).toEqual({
      ok: true,
      id: 'harbor-and-pine--data-analyst',
      already: false,
    });
    expect(saved({ role: 'Product Designer', link: `${careers}#designer` })).toEqual({
      ok: true,
      id: 'harbor-and-pine--product-designer',
      already: false,
    });
    expect(saved({ role: 'Data Analyst', link: careers })).toEqual({
      ok: true,
      id: 'harbor-and-pine--data-analyst',
      already: true,
    });
    expect(row('harbor-and-pine--data-analyst')?.links).toEqual([
      { url: careers, label: 'Posting' },
    ]);
  });

  it('makes another posting of the same role a job of its own', () => {
    tracker.saveCollected(
      [
        collected('fernway--data-analyst', {
          company: 'Fernway',
          companyKey: 'fernway',
          role: 'Data Analyst',
          links: [{ url: 'https://www.linkedin.com/jobs/view/4012345678/', label: 'Posting' }],
        }),
      ],
      NOW,
    );
    expect(
      saved({
        company: 'Fernway',
        role: 'Data Analyst',
        link: 'https://job-boards.greenhouse.io/fernway/jobs/4012345',
      }),
    ).toEqual({ ok: true, id: 'fernway--data-analyst-2', already: false });
  });
});

describe('mergeJobs', () => {
  const LATER: EditContext = { today: '2026-10-14', now: '2026-10-14T18:00:00.000Z' };
  // The ID a save from the browser gives the job.
  const other = 'acme--staff-software-engineer';
  beforeEach(() => {
    tracker.saveCollected(
      [
        collected(other, {
          company: 'Acme',
          companyKey: 'acme',
          role: 'Staff Software Engineer',
          links: [{ url: 'https://www.linkedin.com/jobs/view/4012345678', label: 'Posting' }],
          firstSeen: '2026-10-05',
        }),
      ],
      NOW,
    );
  });

  it('moves the other’s history, calls, notes and links to the job kept, and hides it', () => {
    tracker.updateJob(other, { status: 'passed', passReason: 'pay' }, LATER);
    tracker.addCall(other, { kind: 'other', onDate: '2026-10-20' }, AT);
    tracker.addNote(other, { text: 'Recruiter: Sam' }, AT);
    tracker.updateJob('acme--staff', { status: 'review' }, AT);
    expect(tracker.mergeJobs('acme--staff', other, AT)).toEqual({ ok: true, asks: [] });
    expect(row()).toMatchObject({
      // The later decision.
      status: 'passed',
      statusOn: '2026-10-14',
      passReason: 'pay',
      firstSeen: '2026-10-05',
      links: [
        { url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' },
        { url: 'https://www.linkedin.com/jobs/view/4012345678', label: 'Posting' },
      ],
    });
    expect(history()).toEqual([
      ['review', TODAY],
      ['passed', '2026-10-14'],
    ]);
    expect(tracker.calls().get('acme--staff')).toHaveLength(1);
    expect(
      tracker
        .notes()
        .get('acme--staff')
        ?.map((note) => note.text),
    ).toEqual(['Recruiter: Sam']);
    expect(row(other)?.mergedInto).toBe('acme--staff');
    expect(tracker.knownJobs().find((job) => job.id === other)?.mergedInto).toBe('acme--staff');
    expect(tracker.resolve(other)).toBe('acme--staff');
    expect(tracker.resolve('missing')).toBeNull();
  });

  it('keeps the job kept’s decision when it’s later, or made the same day over New', () => {
    tracker.updateJob(other, { status: 'new' }, AT);
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.mergeJobs(other, 'acme--staff', AT);
    expect(row(other)).toMatchObject({ status: 'applied', appliedOn: TODAY });
  });

  it('keeps the pay to ask for the job kept has, or else the other’s', () => {
    tracker.updateJob(other, { payAsk: '$180,000' }, AT);
    tracker.mergeJobs('acme--staff', other, AT);
    expect(row()?.payAsk).toBe('$180,000');
    tracker.updateJob('acme--staff', { payAsk: '$190,000' }, AT);
    const third = 'acme--staff-3';
    tracker.saveCollected([collected(third)], NOW);
    tracker.updateJob(third, { payAsk: '$170,000' }, AT);
    tracker.mergeJobs('acme--staff', third, AT);
    expect(row()?.payAsk).toBe('$190,000');
  });

  it('keeps an archived job archived when its decision stands', () => {
    tracker.updateJob(other, { status: 'passed', archived: true }, AT);
    tracker.mergeJobs('acme--staff', other, AT);
    expect(row()).toMatchObject({ status: 'passed', archived: true });
  });

  it('keeps each question and answer once, giving a question asked of both a new ID', () => {
    for (const id of ['acme--staff', other]) {
      tracker.addAsk(id, 'What should I expect?', AT);
      tracker.recordAnswer(id, 'Why Acme?', 0, `Sent for ${id}`, AT);
      tracker.updateJob(id, { questions: ['Why Acme?', `Only ${id}?`] }, AT);
    }
    expect(tracker.mergeJobs('acme--staff', other, AT)).toEqual({
      ok: true,
      asks: [['2026-10-10-what-should-i-expect', '2026-10-10-what-should-i-expect-2']],
    });
    expect(row()).toMatchObject({
      questions: ['Why Acme?', 'Only acme--staff?', `Only ${other}?`],
      sent: [expect.objectContaining({ text: 'Sent for acme--staff' })],
      asks: [
        expect.objectContaining({ id: '2026-10-10-what-should-i-expect' }),
        expect.objectContaining({ id: '2026-10-10-what-should-i-expect-2' }),
      ],
    });
  });

  it('merges only two jobs still listed', () => {
    expect(tracker.mergeJobs('acme--staff', 'acme--staff', AT)).toMatchObject({ ok: false });
    expect(tracker.mergeJobs('acme--staff', 'missing', AT)).toMatchObject({ ok: false });
    tracker.mergeJobs('acme--staff', other, AT);
    expect(tracker.mergeJobs(other, 'acme--staff', AT)).toMatchObject({ ok: false });
  });

  it('points jobs merged into the other at the job kept', () => {
    tracker.saveCollected([collected('acme--staff-3', { role: 'Staff Engineer III' })], NOW);
    tracker.mergeJobs(other, 'acme--staff-3', AT);
    tracker.mergeJobs('acme--staff', other, AT);
    expect(row('acme--staff-3')?.mergedInto).toBe('acme--staff');
  });

  it('finds the job kept when a save from the browser names the merged one', () => {
    tracker.mergeJobs('acme--staff', other, AT);
    expect(
      tracker.addSavedJob(
        {
          company: 'Acme',
          role: 'Staff Software Engineer',
          link: 'https://www.linkedin.com/jobs/view/4012345678/',
          pay: '',
        },
        AT,
      ),
    ).toEqual({ ok: true, id: 'acme--staff', already: true });
  });
});

describe('a job another device adds through sync', () => {
  const added = () =>
    newJobRows({
      id: 'northwind--staff-engineer',
      company: 'Northwind',
      role: 'Staff Engineer',
      link: 'https://www.linkedin.com/jobs/view/4012345678/',
      pay: '',
      status: 'new',
      today: TODAY,
      now: NOW,
      statusId: 'status-1',
    });

  it('is the row the app keeps, so taking it leaves nothing to send back', () => {
    const rows = added();
    tracker.applySyncRow('jobs', 'northwind--staff-engineer', rows.job);
    tracker.applySyncRow('status_log', 'status-1', rows.status);
    expect(tracker.syncRow('jobs', 'northwind--staff-engineer')).toEqual(rows.job);
    expect(tracker.syncRow('status_log', 'status-1')).toEqual(rows.status);
    expect(row('northwind--staff-engineer')).toMatchObject({ status: 'new', manual: true });
    expect(history('northwind--staff-engineer')).toEqual([['new', TODAY]]);
  });

  it('has every column the tracker keeps, so a column added later can’t go missing', () => {
    tracker.addJob({ company: 'Fernway', role: 'Project Manager' }, AT);
    const kept = tracker.syncRow('jobs', 'fernway--project-manager') ?? {};
    expect(Object.keys(added().job).sort()).toEqual(Object.keys(kept).sort());
  });
});

describe('calls', () => {
  it('moves the job forward when a call is booked', () => {
    tracker.updateJob('acme--staff', { status: 'applied', statusOn: '2026-10-01' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-13', atTime: '10:30' }, AT);
    expect(row()).toMatchObject({ status: 'screen', statusOn: TODAY });
    expect(tracker.calls().get('acme--staff')).toEqual([
      {
        id: expect.any(String),
        kind: 'screen',
        onDate: '2026-10-13',
        atTime: '10:30',
        minutes: null,
        mode: null,
        place: null,
        people: [],
        state: 'scheduled',
        outcome: null,
        notes: null,
        debrief: null,
      },
    ]);
  });

  it('keeps who a call is with, how long it is, how and where it happens, and how it went', () => {
    tracker.addCall(
      'acme--staff',
      {
        kind: 'panel',
        onDate: '2026-10-20',
        atTime: '14:00',
        minutes: 60,
        mode: 'video',
        place: 'https://meet.example/abc',
        people: [
          { name: 'Dana Lee', role: 'Hiring manager' },
          { name: 'Sam Ortiz', role: null },
        ],
        notes: 'System design',
      },
      AT,
    );
    const id = tracker.calls().get('acme--staff')?.[0]?.id ?? '';
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      minutes: 60,
      mode: 'video',
      place: 'https://meet.example/abc',
      people: [
        { name: 'Dana Lee', role: 'Hiring manager' },
        { name: 'Sam Ortiz', role: null },
      ],
      notes: 'System design',
      debrief: null,
    });
    tracker.updateCall(
      id,
      {
        minutes: 90,
        mode: 'onsite',
        place: '1 Main St',
        people: [{ name: 'Dana Lee', role: 'Hiring manager' }],
        debrief: 'They asked about on-call.\nDana liked the migration story.',
      },
      AT,
    );
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      minutes: 90,
      mode: 'onsite',
      place: '1 Main St',
      people: [{ name: 'Dana Lee', role: 'Hiring manager' }],
      debrief: 'They asked about on-call.\nDana liked the migration story.',
      state: 'scheduled',
    });
  });

  it('marks a call done once the user writes how it went, from its day on', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-14' }, AT);
    const id = tracker.calls().get('acme--staff')?.[0]?.id ?? '';
    // Before its day, words about it are notes ahead of it.
    tracker.updateCall(id, { debrief: 'They’ll ask about on-call.' }, AT);
    expect(tracker.calls().get('acme--staff')?.[0]?.state).toBe('scheduled');
    const later: EditContext = { today: '2026-10-14', now: '2026-10-14T18:00:00.000Z' };
    tracker.updateCall(id, { debrief: 'Went well.' }, later);
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      state: 'done',
      debrief: 'Went well.',
    });
  });

  it('marks a booked call done once the user says how it went', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-13' }, AT);
    const id = tracker.calls().get('acme--staff')?.[0]?.id ?? '';
    tracker.updateCall(id, { outcome: 'waiting' }, AT);
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      state: 'done',
      outcome: 'waiting',
    });
    // Clearing it, or naming a state at the same time, leaves the state as the user set it.
    tracker.updateCall(id, { state: 'scheduled', outcome: 'advanced' }, AT);
    tracker.updateCall(id, { outcome: null }, AT);
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      state: 'scheduled',
      outcome: null,
    });
  });

  it('dates the move on the call’s own day when it’s logged afterward', () => {
    tracker.addCall('acme--staff', { kind: 'technical', onDate: '2026-10-08' }, AT);
    expect(row()).toMatchObject({ status: 'interview', statusOn: '2026-10-08' });
    expect(tracker.calls().get('acme--staff')?.[0]?.state).toBe('done');
  });

  it('never moves a job back, or out of a settled outcome', () => {
    tracker.updateJob('acme--staff', { status: 'offer' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: TODAY }, AT);
    expect(row()?.status).toBe('offer');
    tracker.updateJob('acme--staff', { status: 'rejected' }, AT);
    tracker.addCall('acme--staff', { kind: 'offer', onDate: TODAY }, AT);
    expect(row()?.status).toBe('rejected');
    tracker.updateJob('acme--staff', { status: 'role-closed' }, AT);
    tracker.addCall('acme--staff', { kind: 'final', onDate: '2026-10-01' }, AT);
    expect(row()?.status).toBe('role-closed');
  });

  it('moves a job set aside, or passed on, forward when a call is booked', () => {
    tracker.updateJob('acme--staff', { status: 'later' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-14' }, AT);
    expect(row()?.status).toBe('screen');
  });

  it('leaves the status alone for other kinds of calls', () => {
    tracker.addCall('acme--staff', { kind: 'other', onDate: TODAY }, AT);
    expect(row()?.status).toBeNull();
    expect(tracker.calls().get('acme--staff')).toHaveLength(1);
  });

  it('closes the job when a call’s outcome is "rejected", and deletes calls', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: TODAY }, AT);
    const [call] = tracker.calls().get('acme--staff') ?? [];
    const id = call?.id ?? '';
    tracker.updateCall(id, { state: 'done', outcome: 'rejected', notes: 'Wanted Rust' }, AT);
    expect(row()).toMatchObject({ status: 'rejected', statusOn: TODAY });
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      state: 'done',
      outcome: 'rejected',
      notes: 'Wanted Rust',
    });
    expect(history().map(([status]) => status)).toEqual(['screen', 'rejected']);
    tracker.deleteCall(id);
    expect(tracker.calls().get('acme--staff')).toBeUndefined();
    expect(tracker.updateCall(id, { state: 'done' }, AT)).toMatchObject({ ok: false });
  });
});

describe('history', () => {
  it('corrects when a change happened, and the dates that follow from it', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    const [change] = tracker.history().get('acme--staff') ?? [];
    tracker.redateChange(change?.id ?? '', '2026-10-02', NOW);
    expect(row()).toMatchObject({ statusOn: '2026-10-02', appliedOn: '2026-10-02' });
  });

  it('undoes the latest change, putting the job back where it was', () => {
    tracker.updateJob('acme--staff', { status: 'applied', statusOn: '2026-10-05' }, AT);
    tracker.updateJob('acme--staff', { status: 'ghosted' }, AT);
    const changes = tracker.history().get('acme--staff') ?? [];
    tracker.undoChange(changes[1]?.id ?? '', NOW);
    expect(row()).toMatchObject({ status: 'applied', statusOn: '2026-10-05' });
    tracker.undoChange(changes[0]?.id ?? '', NOW);
    expect(row()).toMatchObject({ status: null, statusOn: null, appliedOn: null });
    expect(tracker.undoChange('gone', NOW)).toMatchObject({ ok: false });
  });

  it('orders changes on the same day by when they were made', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { status: 'screen' }, AT);
    const changes = tracker.history().get('acme--staff') ?? [];
    tracker.undoChange(changes[1]?.id ?? '', NOW);
    expect(row()?.status).toBe('applied');
  });
});

describe('the database file', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'factwright-tracker-'));
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('keeps what the user tracked between openings', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'Kept' }, AT);
    first.close();
    const second = new Tracker(file);
    expect(second.rows()[0]?.earlierNotes).toBe('Kept');
    expect(second.gainedColumns().size).toBe(0);
    second.close();
  });

  it('adds application questions to a tracker from before them, keeping the rest', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'Kept' }, AT);
    first.close();
    // Back to the first version: no questions yet, nor anything since.
    trackerAsOf(file, 1);
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ earlierNotes: 'Kept', questions: [] });
    second.updateJob('acme--staff', { questions: ['Why Acme?'] }, AT);
    expect(second.rows()[0]?.questions).toEqual(['Why Acme?']);
    second.close();
  });

  it('adds answers sent and questions for Claude to a tracker from before them', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { questions: ['Why Acme?'] }, AT);
    first.close();
    trackerAsOf(file, 2);
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ questions: ['Why Acme?'], sent: [], asks: [] });
    second.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys, mostly.', AT);
    expect(second.rows()[0]?.sent).toEqual([
      { question: 'Why Acme?', nth: 0, text: 'Deploys, mostly.', on: TODAY, at: NOW },
    ]);
    // Sync fills the columns it gained from what other devices sent before, and reads every
    // change again for a table it made, such as notes.
    expect(second.gainedColumns()).toEqual(
      new Map([
        [
          'jobs',
          ['sent', 'asks', 'back_on', 'pass_reason', 'kind', 'merged_into', 'folder', 'pay_ask'],
        ],
        ['calls', ['minutes', 'mode', 'place', 'people', 'debrief']],
      ]),
    );
    expect(second.gainedTables()).toEqual(['notes']);
    second.close();
  });

  it('adds kinds of job to a tracker from before them, for sync to fill', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { status: 'applied' }, AT);
    first.close();
    trackerAsOf(file, 5);
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ status: 'applied', kind: null });
    expect(second.gainedColumns()).toEqual(
      new Map([
        ['jobs', ['kind', 'merged_into', 'folder', 'pay_ask']],
        ['calls', ['minutes', 'mode', 'place', 'people', 'debrief']],
      ]),
    );
    second.updateJob('acme--staff', { kind: 'developer' }, AT);
    expect(second.rows()[0]?.kind).toBe('developer');
    second.close();
  });

  it('adds dated notes to a tracker from before them, keeping the earlier notes', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'From the old box' }, AT);
    first.close();
    trackerAsOf(file, 3);
    const second = new Tracker(file);
    expect(second.notes()).toEqual(new Map());
    expect(second.addNote('acme--staff', { text: 'Screen went well' }, AT)).toEqual({ ok: true });
    expect(second.rows()[0]?.earlierNotes).toBe('From the old box');
    expect(
      second
        .notes()
        .get('acme--staff')
        ?.map((note) => note.text),
    ).toEqual(['Screen went well']);
    expect(second.gainedColumns()).toEqual(
      new Map([
        ['jobs', ['back_on', 'pass_reason', 'kind', 'merged_into', 'folder', 'pay_ask']],
        ['calls', ['minutes', 'mode', 'place', 'people', 'debrief']],
      ]),
    );
    expect(second.gainedTables()).toEqual(['notes']);
    second.close();
    // A tracker that's up to date, or new, made nothing.
    const third = new Tracker(file);
    expect(third.gainedTables()).toEqual([]);
    third.close();
    expect(new Tracker(':memory:').gainedTables()).toEqual([]);
  });

  it('adds the day a job comes back and why it was passed to a tracker from before them', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { status: 'passed', earlierNotes: 'Kept' }, AT);
    first.close();
    trackerAsOf(file, 4);
    const before = new DatabaseSync(file);
    expect(before.prepare('SELECT status, notes FROM jobs').get()).toEqual({
      status: 'passed',
      notes: 'Kept',
    });
    before.close();
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ status: 'passed', passReason: null, backOn: null });
    expect(second.gainedColumns()).toEqual(
      new Map([
        ['jobs', ['back_on', 'pass_reason', 'kind', 'merged_into', 'folder', 'pay_ask']],
        ['calls', ['minutes', 'mode', 'place', 'people', 'debrief']],
      ]),
    );
    second.updateJob('acme--staff', { passReason: 'company' }, AT);
    expect(second.rows()[0]?.passReason).toBe('company');
    second.close();
  });
});

describe('notes', () => {
  const texts = () =>
    (tracker.notes().get('acme--staff') ?? []).map((note) => [note.on, note.text]);

  it('keeps each note dated today, or on the day given, oldest first', () => {
    tracker.addNote('acme--staff', { text: '  Screen with Sam: they want Go.  ' }, AT);
    tracker.addNote('acme--staff', { text: 'Applied through a referral', on: '2026-10-02' }, AT);
    tracker.addNote('acme--staff', { text: 'Asked about the band' }, AT);
    expect(texts()).toEqual([
      ['2026-10-02', 'Applied through a referral'],
      [TODAY, 'Screen with Sam: they want Go.'],
      [TODAY, 'Asked about the band'],
    ]);
  });

  it('changes a note’s words or day, and deletes one', () => {
    tracker.addNote('acme--staff', { text: 'Fist draft' }, AT);
    const [note] = tracker.notes().get('acme--staff') ?? [];
    const later = { today: TODAY, now: '2026-10-10T19:00:00.000Z' };
    expect(tracker.updateNote(note?.id ?? '', { text: 'First draft' }, later)).toEqual({
      ok: true,
    });
    expect(tracker.updateNote(note?.id ?? '', { on: '2026-10-08' }, later)).toEqual({ ok: true });
    expect(texts()).toEqual([['2026-10-08', 'First draft']]);
    // When it was written stays, and the row says when it last changed, for sync.
    expect(tracker.notes().get('acme--staff')?.[0]?.at).toBe(NOW);
    expect(tracker.syncRow('notes', note?.id ?? '')).toMatchObject({ updated_at: later.now });
    expect(tracker.deleteNote(note?.id ?? '')).toEqual({ ok: true });
    expect(texts()).toEqual([]);
  });

  it('refuses a blank note, and one for a job or note that’s gone', () => {
    expect(tracker.addNote('acme--staff', { text: '   ' }, AT)).toMatchObject({ ok: false });
    expect(tracker.addNote('gone', { text: 'Hi' }, AT)).toMatchObject({ ok: false });
    expect(tracker.updateNote('gone', { text: 'Hi' }, AT)).toMatchObject({ ok: false });
    tracker.addNote('acme--staff', { text: 'Keep me' }, AT);
    const [note] = tracker.notes().get('acme--staff') ?? [];
    expect(tracker.updateNote(note?.id ?? '', { text: ' ' }, AT)).toMatchObject({ ok: false });
    expect(texts()).toEqual([[TODAY, 'Keep me']]);
  });
});

describe('answers the user sent', () => {
  it('keeps each one, and replaces it in place when it changes', () => {
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    tracker.recordAnswer('acme--staff', 'Start date?', 0, 'Two weeks', AT);
    tracker.recordAnswer('acme--staff', '1. Why Acme? *', 0, 'Deploys, mostly.', {
      today: '2026-10-11',
      now: '2026-10-11T09:00:00.000Z',
    });
    expect(row()?.sent).toEqual([
      {
        question: '1. Why Acme? *',
        nth: 0,
        text: 'Deploys, mostly.',
        on: '2026-10-11',
        at: '2026-10-11T09:00:00.000Z',
      },
      { question: 'Start date?', nth: 0, text: 'Two weeks', on: TODAY, at: NOW },
    ]);
    // The second time a form asks a question, it keeps its own answer.
    tracker.recordAnswer('acme--staff', 'Start date?', 1, 'Monday', AT);
    expect(row()?.sent.map((answer) => [answer.text, answer.nth])).toEqual([
      ['Deploys, mostly.', 0],
      ['Two weeks', 0],
      ['Monday', 1],
    ]);
  });

  it('forgets one when its text is cleared', () => {
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, '  ', AT);
    expect(row()?.sent).toEqual([]);
  });

  it('keeps several at once, as one change, as a form’s answers are', () => {
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    expect(
      tracker.recordAnswers(
        'acme--staff',
        [
          { question: 'Why Acme?', nth: 0, text: 'Deploys, mostly.' },
          { question: 'If yes, please explain', nth: 0, text: 'First.' },
          { question: 'If yes, please explain', nth: 1, text: 'Second.' },
          { question: '???', nth: 0, text: 'No words to keep it by.' },
          { question: 'Anything else?', nth: 0, text: ' ' },
        ],
        AT,
      ),
    ).toEqual({ ok: true, recorded: 3 });
    expect(row()?.sent.map((answer) => [answer.question, answer.nth, answer.text])).toEqual([
      ['Why Acme?', 0, 'Deploys, mostly.'],
      ['If yes, please explain', 0, 'First.'],
      ['If yes, please explain', 1, 'Second.'],
    ]);
    expect(tracker.recordAnswers('nope', [], AT)).toMatchObject({ ok: false });
  });

  it('says so when the job is gone, or the question has no words', () => {
    expect(tracker.recordAnswer('nope', 'Why?', 0, 'Because.', AT)).toMatchObject({ ok: false });
    expect(tracker.recordAnswer('acme--staff', '???', 0, 'Because.', AT)).toMatchObject({
      ok: false,
    });
  });
});

describe('questions for Claude', () => {
  it('keeps each question under an ID for its answer, unique on the same day', () => {
    const question = '  I have a 15 minute recruiter call. What should I expect?  ';
    expect(tracker.addAsk('acme--staff', question, AT)).toEqual({
      ok: true,
      askId: '2026-10-10-i-have-a-15-minute-recruiter',
    });
    expect(tracker.addAsk('acme--staff', question, AT)).toEqual({
      ok: true,
      askId: '2026-10-10-i-have-a-15-minute-recruiter-2',
    });
    expect(row()?.asks).toEqual([
      {
        id: '2026-10-10-i-have-a-15-minute-recruiter',
        question: 'I have a 15 minute recruiter call. What should I expect?',
        on: TODAY,
      },
      {
        id: '2026-10-10-i-have-a-15-minute-recruiter-2',
        question: 'I have a 15 minute recruiter call. What should I expect?',
        on: TODAY,
      },
    ]);
  });

  it('forgets a question, and needs one to keep', () => {
    tracker.addAsk('acme--staff', 'What’s their stack?', AT);
    tracker.removeAsk('acme--staff', '2026-10-10-what-s-their-stack', AT);
    expect(row()?.asks).toEqual([]);
    expect(tracker.addAsk('acme--staff', '   ', AT)).toEqual({
      ok: false,
      message: 'Type your question first.',
    });
    expect(tracker.addAsk('nope', 'Why?', AT)).toMatchObject({ ok: false });
  });
});

describe('sync', () => {
  it('lists every row of the tables that sync, as stored', () => {
    tracker.updateJob('acme--staff', { status: 'applied', earlierNotes: 'Sent' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    const rows = tracker.syncRows();
    expect(rows.map((each) => each.table)).toEqual(['jobs', 'status_log', 'status_log', 'calls']);
    expect(rows[0]).toMatchObject({
      id: 'acme--staff',
      row: { company: 'Acme Robotics', status: 'screen', notes: 'Sent', archived: 0 },
    });
    expect(tracker.syncRow('jobs', 'acme--staff')).toEqual(rows[0]?.row);
    expect(tracker.syncRow('jobs', 'nobody')).toBeNull();
  });

  it('puts rows as another device left them, jobs before their calls', () => {
    tracker.updateJob('acme--staff', { status: 'applied', earlierNotes: 'Sent' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    tracker.addNote('acme--staff', { text: 'Screen went well' }, AT);
    const other = new Tracker(':memory:');
    for (const { table, id, row } of tracker.syncRows()) other.applySyncRow(table, id, row);
    expect(other.rows()).toEqual(tracker.rows());
    expect(other.calls()).toEqual(tracker.calls());
    expect(other.history()).toEqual(tracker.history());
    expect(other.notes()).toEqual(tracker.notes());
    other.close();
  });

  it('writes only the columns this version knows, and keeps those a row lacks', () => {
    tracker.updateJob('acme--staff', { questions: ['Why Acme?'], earlierNotes: 'Before' }, AT);
    const stored = tracker.syncRow('jobs', 'acme--staff') ?? {};
    const { questions: _, ...fromOlderApp } = stored;
    tracker.applySyncRow('jobs', 'acme--staff', {
      ...fromOlderApp,
      notes: 'After',
      salary_band: 'From a newer app',
    });
    expect(row()).toMatchObject({ earlierNotes: 'After', questions: ['Why Acme?'] });
  });

  it('removes a row, and a job’s calls and history go with it', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    const [call] = tracker.calls().get('acme--staff') ?? [];
    tracker.applySyncRow('calls', call?.id ?? '', null);
    expect(tracker.calls().get('acme--staff')).toBeUndefined();
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    tracker.applySyncRow('jobs', 'acme--staff', null);
    expect(tracker.rows()).toEqual([]);
    expect(tracker.syncRows()).toEqual([]);
  });

  it('refuses a call for a job it doesn’t have yet', () => {
    expect(() =>
      tracker.applySyncRow('calls', 'call-1', {
        id: 'call-1',
        job_id: 'nobody',
        kind: 'screen',
        on_date: '2026-10-12',
        state: 'scheduled',
        created_at: NOW,
      }),
    ).toThrow();
  });
});
