import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleJob } from '../../renderer/jobs/sample-jobs.ts';
import type { RunsView, RunView } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import {
  AnalyzeNew,
  type AnalyzeNewDeps,
  type AnalyzeNewState,
  jobsToAnalyze,
  loadAnalyzeNew,
} from './analyze-new.ts';
import { settled } from './save.ts';

const TODAY = '2026-10-26';

/** A job saved from the browser on a day, not checked yet. */
const saved = (id: string, firstSeen = TODAY, extra: Partial<Job> = {}): Job =>
  sampleJob({
    id,
    company: id.split('--')[0] ?? id,
    role: 'Staff Engineer',
    links: [{ url: `https://jobs.example/${id}`, label: 'Posting' }],
    searches: [],
    source: 'Added by hand',
    manual: true,
    status: 'new',
    firstSeen,
    ...extra,
  });

const ON: AnalyzeNewState = { on: true, since: '2026-10-25', tried: [] };

describe('the jobs Claude analyzes on its own', () => {
  it('takes jobs saved since it was turned on, still new and not checked yet, oldest first', () => {
    const jobs = [
      saved('newest--a', '2026-10-26'),
      saved('older--b', '2026-10-25'),
      saved('before--c', '2026-10-24'),
    ];
    expect(jobsToAnalyze(jobs, ON, new Set()).map((job) => job.id)).toEqual([
      'older--b',
      'newest--a',
    ]);
  });

  it('leaves alone jobs that are checked, decided on, archived, with no link or role, tried, or taken', () => {
    const fit = { verdict: 'Good', score: 70, date: TODAY };
    const detail = {
      why: [],
      gaps: [],
      flags: [],
      pick: null,
      what: null,
      stage: null,
      apply: null,
      note: null,
      parts: {},
      partsWhy: {},
      tags: [],
      report: null,
    };
    const searched = {
      source: 'HN',
      date: TODAY,
      tier: 'good' as const,
      score: 70,
      detail,
      again: false,
    };
    const jobs = [
      saved('checked--a', TODAY, { fit }),
      saved('searched--b', TODAY, { search: searched }),
      saved('decided--c', TODAY, { status: 'apply' }),
      saved('worked--d', TODAY, { stage: 'review' }),
      saved('archived--e', TODAY, { archived: true }),
      saved('linkless--f', TODAY, { links: [] }),
      saved('roleless--g', TODAY, { role: '' }),
      saved('tried--h'),
      saved('taken--i'),
      saved('waiting--j'),
    ];
    const state = { ...ON, tried: ['tried--h'] };
    expect(jobsToAnalyze(jobs, state, new Set(['taken--i'])).map((job) => job.id)).toEqual([
      'waiting--j',
    ]);
  });
});

describe('Claude analyzing new jobs on its own', () => {
  let dataDir: string;
  let jobs: Job[];
  let runs: RunView[];
  let started: RunTask[];
  let free: boolean;
  let ready: boolean;

  const view = (): RunsView => ({ runs, atOnce: 3, setUp: true });
  const analyzing = (quietMs = 60_000, claims?: AnalyzeNewDeps['claims']) =>
    new AnalyzeNew({
      dataDir,
      jobs: () => jobs,
      runs: {
        view,
        startOwn: (task) => {
          if (!free) return null;
          started.push(task);
          // Its run holds its jobs while it goes, as Claude's runs do.
          const id = `run-${started.length}`;
          runs = [...runs, running(id, task)];
          return id;
        },
      },
      ready: () => ready,
      today: () => TODAY,
      quietMs,
      ...(claims && { claims }),
    });
  /** Lets the clock run on, and the timers with it. */
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  /** A run going on a task. */
  const running = (id: string, task: RunTask): RunView => ({
    id,
    task,
    phase: 'working',
    waits: null,
    screen: null,
    startedAt: 1,
    problem: null,
    analyzed: [],
  });
  /** Jobs with a fit check now, as a run analyzing them leaves them. */
  const analyzed = (...ids: string[]) => {
    jobs = jobs.map((job) =>
      ids.includes(job.id) ? { ...job, fit: { verdict: 'Good', score: 70, date: TODAY } } : job,
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    dataDir = mkdtempSync(join(tmpdir(), 'factwright-analyze-new-'));
    jobs = [];
    runs = [];
    started = [];
    free = true;
    ready = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('is on from the first day, and keeps that day, so jobs saved before are the user’s', async () => {
    const first = analyzing();
    await first.load();
    expect(first.isOn()).toBe(true);
    const kept = JSON.parse(readFileSync(join(dataDir, 'analyze-new.json'), 'utf8'));
    expect(kept).toEqual({ on: true, since: TODAY, tried: [] });
    // A file that won't read starts it on again, from today.
    writeFileSync(join(dataDir, 'analyze-new.json'), '{ not json');
    expect(await loadAnalyzeNew(dataDir, TODAY)).toEqual({ on: true, since: TODAY, tried: [] });
  });

  it('waits a minute after the newest job turns up, then takes up to 8 in one run', async () => {
    const claude = analyzing();
    await claude.load();
    jobs = Array.from({ length: 10 }, (_, at) => saved(`job${at}--staff`));
    claude.look();
    await wait(30_000);
    // Another job saved: the minute starts again, so they go together.
    jobs = [...jobs, saved('late--staff')];
    claude.look();
    await wait(40_000);
    expect(started).toEqual([]);
    await wait(30_000);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ skill: 'analyze-job', auto: true });
    expect(started[0] && 'jobIds' in started[0] && started[0].jobIds).toHaveLength(8);
    // The ones it took are its run's, and the rest wait for its next run, once it's done.
    claude.look();
    await wait(1000);
    expect(started).toHaveLength(1);
    // Done, with all eight analyzed.
    const first = started[0] && 'jobIds' in started[0] ? started[0].jobIds : [];
    runs = [];
    analyzed(...first);
    claude.ended({ id: 'run-1', task: started[0] ?? null }, 'ended', first);
    await wait(1000);
    expect(started).toHaveLength(2);
    expect(started[1] && 'jobIds' in started[1] && started[1].jobIds).toEqual([
      'job8--staff',
      'job9--staff',
      'late--staff',
    ]);
  });

  it('leaves a job another computer holds, and starts only on the jobs it holds', async () => {
    // Acme's claim is another computer's already, and as this one claims Initech, another's claim
    // on it gets to the server first.
    const elsewhere = new Set(['acme--staff']);
    const take = vi.fn(async (ids: readonly string[]) => {
      elsewhere.add('initech--staff');
      return ids.filter((id) => id !== 'initech--staff');
    });
    const claude = analyzing(0, {
      elsewhere: (id) => elsewhere.has(id),
      take,
      letGo: () => {},
    });
    await claude.load();
    jobs = [saved('acme--staff'), saved('globex--staff'), saved('initech--staff')];
    claude.look();
    await wait(1000);
    expect(take).toHaveBeenCalledWith(['globex--staff', 'initech--staff']);
    expect(started).toEqual([{ skill: 'analyze-job', jobIds: ['globex--staff'], auto: true }]);
  });

  it('tries again in half a minute when it holds none, as while sync isn’t working', async () => {
    let working = false;
    const take = vi.fn(async (ids: readonly string[]) => (working ? [...ids] : []));
    const claude = analyzing(0, { elsewhere: () => false, take, letGo: () => {} });
    await claude.load();
    jobs = [saved('acme--staff')];
    claude.look();
    await wait(1000);
    expect(take).toHaveBeenCalledTimes(1);
    expect(started).toEqual([]);
    // Sync works again, and says so: the next try waits out the half minute, and holds the job.
    working = true;
    claude.look();
    await wait(1000);
    expect(take).toHaveBeenCalledTimes(1);
    await wait(30_000);
    expect(take).toHaveBeenCalledTimes(2);
    expect(started).toEqual([{ skill: 'analyze-job', jobIds: ['acme--staff'], auto: true }]);
  });

  it('lets go of the jobs it held when Claude got busy as it claimed them', async () => {
    const letGo = vi.fn();
    const take = vi.fn(async (ids: readonly string[]) => {
      free = false;
      return [...ids];
    });
    const claude = analyzing(0, { elsewhere: () => false, take, letGo });
    await claude.load();
    jobs = [saved('acme--staff')];
    claude.look();
    await wait(1000);
    expect(started).toEqual([]);
    expect(letGo).toHaveBeenCalledWith(['acme--staff']);
  });

  it('starts nothing once stopped, as the app restarts to update', async () => {
    const claude = analyzing(0);
    await claude.load();
    jobs = [saved('acme--staff')];
    claude.stop();
    claude.look();
    claude.ended({ id: 'run-0', task: null }, 'stepped-aside', []);
    await wait(60_000);
    expect(started).toEqual([]);
  });

  it('starts nothing while Claude isn’t ready, isn’t free, or it’s turned off', async () => {
    writeFileSync(
      join(dataDir, 'analyze-new.json'),
      JSON.stringify({ on: true, since: '2026-10-20', tried: [] }),
    );
    const claude = analyzing(0);
    await claude.load();
    jobs = [saved('acme--staff', '2026-10-25')];
    ready = false;
    claude.look();
    await wait(1000);
    free = false;
    ready = true;
    claude.look();
    await wait(1000);
    expect(started).toEqual([]);
    // Claude's runs changing looks again.
    free = true;
    await claude.setOn(false);
    await wait(1000);
    expect(started).toEqual([]);
    await settled(join(dataDir, 'analyze-new.json'));
    expect(JSON.parse(readFileSync(join(dataDir, 'analyze-new.json'), 'utf8')).on).toBe(false);
    await claude.setOn(true);
    await wait(1000);
    // Turned on again, it takes jobs saved from that day on.
    expect(started).toEqual([]);
    jobs = [...jobs, saved('globex--staff', '2026-10-27')];
    claude.look();
    await wait(1000);
    expect(started).toEqual([{ skill: 'analyze-job', jobIds: ['globex--staff'], auto: true }]);
  });

  it('leaves a job a task holds, and the jobs a run left when it stepped aside wait for the next', async () => {
    const claude = analyzing(0);
    await claude.load();
    jobs = [saved('acme--staff'), saved('globex--staff')];
    runs = [running('run-0', { skill: 'focused-resume', jobId: 'acme--staff' })];
    claude.look();
    await wait(1000);
    expect(started).toEqual([{ skill: 'analyze-job', jobIds: ['globex--staff'], auto: true }]);
    // Its own run holds the job: no look takes it twice.
    claude.look();
    await wait(1000);
    expect(started).toHaveLength(1);
    // It stepped aside for the user, with nothing finished, and the user's task is done: the next
    // run takes both.
    runs = [];
    claude.ended({ id: 'run-1', task: started[0] ?? null }, 'stepped-aside', []);
    await wait(1000);
    expect(started.at(-1)).toEqual({
      skill: 'analyze-job',
      jobIds: ['acme--staff', 'globex--staff'],
      auto: true,
    });
  });

  it('leaves to the user the jobs a run ended without finishing, so none is tried over and over', async () => {
    const claude = analyzing(0);
    await claude.load();
    jobs = [saved('acme--staff'), saved('globex--staff')];
    claude.look();
    await wait(1000);
    expect(started).toHaveLength(1);
    // Done, with Acme analyzed and Globex not, as when its posting wouldn't load.
    runs = [];
    analyzed('acme--staff');
    claude.ended({ id: 'run-1', task: started[0] ?? null }, 'ended', ['acme--staff']);
    await wait(1000);
    expect(started).toHaveLength(1);
    await settled(join(dataDir, 'analyze-new.json'));
    const kept = JSON.parse(readFileSync(join(dataDir, 'analyze-new.json'), 'utf8'));
    expect(kept.tried).toEqual(['globex--staff']);
    // Once the user analyzes it, it leaves the list.
    analyzed('globex--staff');
    jobs = [...jobs, saved('initech--staff')];
    claude.look();
    await wait(1000);
    expect(started.at(-1)).toEqual({
      skill: 'analyze-job',
      jobIds: ['initech--staff'],
      auto: true,
    });
    await settled(join(dataDir, 'analyze-new.json'));
    expect(JSON.parse(readFileSync(join(dataDir, 'analyze-new.json'), 'utf8')).tried).toEqual([]);
  });
});
