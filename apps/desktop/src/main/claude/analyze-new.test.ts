import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleJob } from '../../renderer/jobs/sample-jobs.ts';
import type { RunsView, RunView } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { AnalyzeNew, type AnalyzeNewState, jobsToAnalyze, loadAnalyzeNew } from './analyze-new.ts';
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
  const analyzing = (quietMs = 60_000) =>
    new AnalyzeNew({
      dataDir,
      jobs: () => jobs,
      runs: {
        view,
        startOwn: (task) => {
          if (!free) return null;
          started.push(task);
          return `run-${started.length}`;
        },
      },
      ready: () => ready,
      today: () => TODAY,
      quietMs,
    });
  /** Lets the clock run on, and the timers with it. */
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

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
    // The ones it took aren't taken again, and the rest wait for its next run.
    claude.look();
    await wait(1000);
    expect(started).toHaveLength(2);
    expect(started[1] && 'jobIds' in started[1] && started[1].jobIds).toEqual([
      'job8--staff',
      'job9--staff',
      'late--staff',
    ]);
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

  it('leaves a job a task holds, and gives back the jobs a run left when it stepped aside', async () => {
    const claude = analyzing(0);
    await claude.load();
    jobs = [saved('acme--staff'), saved('globex--staff')];
    runs = [
      {
        id: 'run-1',
        task: { skill: 'focused-resume', jobId: 'acme--staff' },
        phase: 'working',
        waits: null,
        screen: null,
        startedAt: 1,
        problem: null,
        analyzed: [],
      },
    ];
    claude.look();
    await wait(1000);
    expect(started).toEqual([{ skill: 'analyze-job', jobIds: ['globex--staff'], auto: true }]);
    // It stepped aside for the user, with nothing finished: the job waits for its next run.
    runs = [];
    claude.ended({ id: 'run-2', task: started[0] ?? null }, 'stepped-aside', []);
    await wait(1000);
    expect(started.at(-1)).toEqual({
      skill: 'analyze-job',
      jobIds: ['acme--staff', 'globex--staff'],
      auto: true,
    });
    // Any other end leaves the jobs it didn't finish to the user.
    claude.ended({ id: 'run-3', task: started.at(-1) ?? null }, 'ended', ['acme--staff']);
    await wait(1000);
    expect(started).toHaveLength(2);
    await settled(join(dataDir, 'analyze-new.json'));
    const kept = JSON.parse(readFileSync(join(dataDir, 'analyze-new.json'), 'utf8'));
    expect(kept.tried).toEqual(['acme--staff', 'globex--staff']);
  });
});
