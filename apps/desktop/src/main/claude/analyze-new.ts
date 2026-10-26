import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { effectiveStatus, isIsoDate, type Job } from '@factwright/core';
import type { RunPhase, RunsView } from '../../shared/api.ts';
import {
  ANALYZE_ON_ITS_OWN,
  ANALYZE_SKILL,
  type RunTask,
  taskJobs,
} from '../../shared/runs.ts';
import type { OwnEnd, RunHeard } from './runs.ts';
import { saveJson, settled } from './save.ts';

/** The file that holds whether Claude analyzes new jobs on its own, in the app's data folder. */
const FILE = 'analyze-new.json';

/**
 * How long Claude waits after the newest job turns up before it starts, so jobs saved one after
 * another go in one run.
 */
const QUIET_MS = 60_000;

/** How soon it looks again once something changed, so changes that come together look once. */
const LOOK_MS = 500;

/** The phases in which a run, or a task in line, holds its jobs. */
const HOLDS: readonly RunPhase[] = ['in-line', 'starting', 'working', 'needs-answer'];

/**
 * What the app keeps about Claude analyzing new jobs on its own: whether it does, since when, and
 * the jobs a run of its own took and didn't finish, which it doesn't take again.
 */
export interface AnalyzeNewState {
  on: boolean;
  /** The day it was turned on, as an ISO date. Jobs saved before then are the user's to start. */
  since: string;
  tried: string[];
}

/** Whether nothing has checked a job's fit yet: neither Analyze job nor a job search. */
export const notCheckedYet = (job: Job): boolean =>
  job.fit === null && !job.search?.tier && (job.search?.score ?? null) === null;

/**
 * The jobs Claude analyzes on its own, oldest first: saved since it was turned on, still in New and
 * not checked yet, with a link to read the posting from and a role to judge, not archived, none a
 * run of its own took and didn't finish, and none with a task going or waiting in line on it.
 */
export function jobsToAnalyze(
  jobs: readonly Job[],
  state: AnalyzeNewState,
  taken: ReadonlySet<string>,
): Job[] {
  return jobs
    .filter(
      (job) =>
        !job.archived &&
        effectiveStatus(job.status, job.stage) === 'new' &&
        notCheckedYet(job) &&
        job.links.length > 0 &&
        job.role.trim() !== '' &&
        (job.firstSeen ?? '') >= state.since &&
        !state.tried.includes(job.id) &&
        !taken.has(job.id),
    )
    .sort((a, b) => (a.firstSeen ?? '').localeCompare(b.firstSeen ?? '') || a.id.localeCompare(b.id));
}

/** The jobs a task holds now, going or waiting in line. */
const takenIn = (view: RunsView): Set<string> =>
  new Set(view.runs.filter((run) => HOLDS.includes(run.phase)).flatMap((run) => taskJobs(run.task)));

/** What was kept, or on from today, when nothing was, or it won't read. */
export async function loadAnalyzeNew(dataDir: string, today: string): Promise<AnalyzeNewState> {
  const fresh: AnalyzeNewState = { on: true, since: today, tried: [] };
  try {
    await settled(join(dataDir, FILE));
    const saved: unknown = JSON.parse(await readFile(join(dataDir, FILE), 'utf8'));
    if (typeof saved !== 'object' || saved === null) return fresh;
    const { on, since, tried } = saved as Record<string, unknown>;
    if (typeof on !== 'boolean' || !isIsoDate(since)) return fresh;
    const ids = Array.isArray(tried)
      ? tried.filter((id): id is string => typeof id === 'string')
      : [];
    return { on, since, tried: ids };
  } catch {
    return fresh;
  }
}

export interface AnalyzeNewDeps {
  /** The app's own data folder, which keeps whether it's on. */
  dataDir: string;
  jobs: () => readonly Job[];
  /** Claude's runs: which jobs they hold, and starting one of Claude's own, if it can start now. */
  runs: { view: () => RunsView; startOwn: (task: RunTask) => string | null };
  /**
   * Whether Claude may start a run of its own now: Claude Code is ready, and past its first
   * screens, and the window is open to show it.
   */
  ready: () => boolean;
  today: () => string;
  now?: () => number;
  /** How long it waits after the newest job turns up. Tests wait less. */
  quietMs?: number;
}

/**
 * Claude analyzing new jobs on its own, while it's free, several in one run, until the user turns
 * it off. Jobs saved together wait a moment, so they go in one run, and a run takes as many as it
 * can, the oldest first. It starts only when it can start at once, never in line, and it steps
 * aside for any task the user starts that would otherwise wait for it: the jobs it didn't finish
 * then wait for the next. A run that ends any other way leaves the jobs it didn't finish to the
 * user, so none is tried over and over.
 */
export class AnalyzeNew {
  private readonly deps: AnalyzeNewDeps;
  private state: AnalyzeNewState | null = null;
  /** When the app first saw each job it could take. */
  private readonly seen = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the timer is due, so a later look never puts it off. */
  private due = Number.POSITIVE_INFINITY;

  constructor(deps: AnalyzeNewDeps) {
    this.deps = deps;
  }

  /** Reads whether it's on, and keeps the day it was turned on, the first time. */
  async load(): Promise<void> {
    this.state = await loadAnalyzeNew(this.deps.dataDir, this.deps.today());
    await this.save();
  }

  /** Whether Claude analyzes new jobs on its own. */
  isOn(): boolean {
    return this.state?.on ?? true;
  }

  /**
   * Turns it on or off. Turned on again, it takes the jobs saved from then on, not the ones saved
   * while it was off, and tries again the ones it left before.
   */
  async setOn(on: boolean): Promise<boolean> {
    const was = this.state ?? { on: !on, since: this.deps.today(), tried: [] };
    if (was.on !== on) {
      this.state = on ? { on, since: this.deps.today(), tried: [] } : { ...was, on };
      await this.save();
    }
    this.look();
    return on;
  }

  /** Looks again in a moment whether to start, as when a job is saved, or a run ends. */
  look(): void {
    this.at(LOOK_MS);
  }

  /** Stops looking, as the app quits. */
  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.due = Number.POSITIVE_INFINITY;
  }

  /**
   * Hears a run of its own end. One that stepped aside for a task of the user's gives back the
   * jobs it didn't finish, for the next. Any other end leaves them to the user.
   */
  ended(run: RunHeard, end: OwnEnd, analyzed: readonly string[]): void {
    if (this.state && end === 'stepped-aside') {
      const back = taskJobs(run.task).filter((id) => !analyzed.includes(id));
      this.state = { ...this.state, tried: this.state.tried.filter((id) => !back.includes(id)) };
      void this.save();
    }
    this.look();
  }

  private at(ms: number): void {
    const when = this.now() + ms;
    if (this.timer !== undefined && this.due <= when) return;
    clearTimeout(this.timer);
    this.due = when;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.due = Number.POSITIVE_INFINITY;
      this.check();
    }, ms);
  }

  /** Starts a run on the jobs waiting, if it's time and Claude is free. */
  private check(): void {
    const state = this.state;
    if (!state?.on) return;
    const now = this.now();
    const jobs = this.deps.jobs();
    const waiting = jobsToAnalyze(jobs, state, takenIn(this.deps.runs.view()));
    for (const id of this.seen.keys()) {
      if (!waiting.some((job) => job.id === id)) this.seen.delete(id);
    }
    for (const job of waiting) if (!this.seen.has(job.id)) this.seen.set(job.id, now);
    if (waiting.length === 0) return;
    const newest = Math.max(...waiting.map((job) => this.seen.get(job.id) ?? now));
    const wait = newest + (this.deps.quietMs ?? QUIET_MS) - now;
    if (wait > 0) {
      this.at(wait);
      return;
    }
    // Not ready, or not free: Claude Code's status, or the runs, changing looks again.
    if (!this.deps.ready()) return;
    const picked = waiting.slice(0, ANALYZE_ON_ITS_OWN).map((job) => job.id);
    if (!this.deps.runs.startOwn({ skill: ANALYZE_SKILL, jobIds: picked, auto: true })) return;
    // Only jobs still waiting for Claude stay on the list of those it took, so it stays short.
    const left = state.tried.filter((id) => jobs.some((job) => job.id === id && notCheckedYet(job)));
    this.state = { ...state, tried: [...left, ...picked] };
    void this.save();
  }

  private save(): Promise<void> {
    return this.state
      ? saveJson(join(this.deps.dataDir, FILE), this.state).catch(() => {})
      : Promise.resolve();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
