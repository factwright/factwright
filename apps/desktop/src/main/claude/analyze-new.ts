import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { effectiveStatus, isIsoDate, type Job } from '@factwright/core';
import type { RunPhase, RunsView } from '../../shared/api.ts';
import {
  ANALYZE_ON_ITS_OWN,
  ANALYZE_SKILL,
  type RunTask,
  startedOnItsOwn,
  taskJobs,
} from '../../shared/runs.ts';
import type { Claims } from '../sync/claims.ts';
import type { OwnEnd, RunHeard } from './runs.ts';
import { saveJson, settled } from './save.ts';

/** The file that holds whether Claude analyzes new jobs on its own, in the app's data folder. */
const FILE = 'analyze-new.json';

/**
 * How long Claude waits after the newest job turns up before it starts, so jobs saved one after
 * another go in one run.
 */
const QUIET_MS = 60_000;

/**
 * How long it waits to claim again after a try that started no run, as when sync isn't working, so
 * it never asks the server over and over.
 */
const AGAIN_MS = 30_000;

/** How soon it looks again once something changed, so changes that come together look once. */
const LOOK_MS = 500;

/** The phases in which a run, or a task in line, holds its jobs. */
const HOLDS: readonly RunPhase[] = ['in-line', 'starting', 'working', 'needs-answer'];

/**
 * What the app keeps about Claude analyzing new jobs on its own: whether it does, since when, and
 * the jobs a run of its own took and ended without finishing, which it doesn't take again.
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
    .sort(
      (a, b) => (a.firstSeen ?? '').localeCompare(b.firstSeen ?? '') || a.id.localeCompare(b.id),
    );
}

/** Whether a run of Claude's own is going, which takes the jobs saved since, one run at a time. */
const ownGoing = (view: RunsView): boolean =>
  view.runs.some((run) => HOLDS.includes(run.phase) && startedOnItsOwn(run.task));

/** The jobs a task holds now, going or waiting in line. */
const takenIn = (view: RunsView): Set<string> =>
  new Set(
    view.runs.filter((run) => HOLDS.includes(run.phase)).flatMap((run) => taskJobs(run.task)),
  );

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
  /**
   * Claude's runs: which jobs they hold, whether a run of Claude's own could start now, and
   * starting one, if it can start now.
   */
  runs: {
    view: () => RunsView;
    canStartOwn: (task: RunTask) => boolean;
    startOwn: (task: RunTask) => string | null;
  };
  /**
   * Whether Claude may start a run of its own now: Claude Code is ready, and past its first
   * screens, and the window is open to show it.
   */
  ready: () => boolean;
  today: () => string;
  /**
   * Claims on jobs through sync, so no two computers analyze one at once: a job another computer
   * holds waits, and a run starts only on the jobs this computer holds.
   */
  claims?: Pick<Claims, 'elsewhere' | 'take' | 'letGo'>;
  now?: () => number;
  /** How long it waits after the newest job turns up. Tests wait less. */
  quietMs?: number;
}

/**
 * Claude analyzing new jobs on its own, while it's free, several in one run, until the user turns
 * it off. Jobs saved together wait a moment, so they go in one run, and a run takes as many as it
 * can, the oldest first. With sync on, it first claims them, so another computer's run never
 * analyzes them too, and leaves any another computer holds. It starts only when it can start at
 * once, never in line. A run that ends, done, stopped, closed or failed, leaves the jobs it didn't
 * finish to the user, so none is tried over and over. One that steps aside for a task the user
 * starts, here or on another computer, or goes as the window closes or the app quits, leaves them
 * for the next.
 */
export class AnalyzeNew {
  private readonly deps: AnalyzeNewDeps;
  private state: AnalyzeNewState | null = null;
  /** When the app first saw each job it could take. */
  private readonly seen = new Map<string, number>();
  /** Whether it's claiming jobs through sync now, which no other look does meanwhile. */
  private claiming = false;
  /** When it may claim again, after a try that started no run. */
  private again = 0;
  /** Whether it stopped for good, as the app quits or restarts to update. */
  private stopped = false;
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

  /**
   * Looks again in a moment whether to start, as when a job is saved, a run ends, or sync brings in
   * changes from another device, or works again.
   */
  look(): void {
    this.at(LOOK_MS);
  }

  /** Stops looking for good, as the app quits or restarts to update, so no run starts meanwhile. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.due = Number.POSITIVE_INFINITY;
  }

  /**
   * Hears a run of its own end. One that ended leaves the jobs it didn't finish to the user. One
   * that stepped aside for a task of the user's leaves them for the next.
   */
  ended(run: RunHeard, end: OwnEnd, analyzed: readonly string[]): void {
    const state = this.state;
    if (state && end === 'ended') {
      const left = taskJobs(run.task).filter(
        (id) => !analyzed.includes(id) && !state.tried.includes(id),
      );
      if (left.length > 0) {
        this.state = { ...state, tried: [...state.tried, ...left] };
        void this.save();
      }
    }
    this.look();
  }

  private at(ms: number): void {
    if (this.stopped) return;
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

  /** The jobs waiting for a run of its own: none taken here, nor held by another computer. */
  private waiting(state: AnalyzeNewState, view: RunsView): Job[] {
    const { claims } = this.deps;
    return jobsToAnalyze(this.deps.jobs(), state, takenIn(view)).filter(
      (job) => !claims?.elsewhere(job.id),
    );
  }

  /**
   * Starts a run on the jobs waiting, if it's time and Claude is free, one run of its own at a
   * time, once it holds their claims.
   */
  private check(): void {
    const state = this.state;
    if (!state?.on || this.claiming) return;
    const now = this.now();
    const view = this.deps.runs.view();
    const { claims } = this.deps;
    const candidates = jobsToAnalyze(this.deps.jobs(), state, takenIn(view));
    // A job another computer holds keeps the time it turned up here, so one held only a moment
    // doesn't start its wait over.
    for (const id of this.seen.keys()) {
      if (!candidates.some((job) => job.id === id)) this.seen.delete(id);
    }
    for (const job of candidates) if (!this.seen.has(job.id)) this.seen.set(job.id, now);
    const waiting = candidates.filter((job) => !claims?.elsewhere(job.id));
    if (waiting.length === 0) return;
    const newest = Math.max(...waiting.map((job) => this.seen.get(job.id) ?? now));
    const wait = Math.max(newest + (this.deps.quietMs ?? QUIET_MS), this.again) - now;
    if (wait > 0) {
      this.at(wait);
      return;
    }
    const task: RunTask = {
      skill: ANALYZE_SKILL,
      jobIds: waiting.slice(0, ANALYZE_ON_ITS_OWN).map((job) => job.id),
      auto: true,
    };
    // Not ready, or not free: Claude Code's status, or the runs, changing looks again. Nothing is
    // claimed until a run could start, so another computer that's free takes the jobs. The jobs
    // it takes are its run's while it goes, so no look takes them twice.
    if (ownGoing(view) || !this.deps.ready() || !this.deps.runs.canStartOwn(task)) return;
    if (!claims) {
      this.start(taskJobs(task));
      return;
    }
    this.claiming = true;
    void claims
      .take(taskJobs(task))
      .then(
        (held) => this.claimed(held),
        () => this.claimed([]),
      )
      .finally(() => {
        this.claiming = false;
      });
  }

  /**
   * Starts a run on the jobs this computer holds the claims of, if they still wait and Claude is
   * still free. Any it doesn't start, it lets go of, and it claims nothing for a while after: the
   * next look, as sync works again or the runs change, tries again.
   */
  private claimed(held: readonly string[]): void {
    const state = this.state;
    const view = this.deps.runs.view();
    const still = state?.on && !this.stopped ? this.waiting(state, view).map((job) => job.id) : [];
    const jobIds = held.filter((id) => still.includes(id));
    const started = jobIds.length > 0 && !ownGoing(view) && this.deps.ready() && this.start(jobIds);
    this.deps.claims?.letGo(started ? held.filter((id) => !jobIds.includes(id)) : held);
    if (!started) this.again = this.now() + AGAIN_MS;
  }

  /** Starts a run of its own on the jobs, if it can start at once. */
  private start(jobIds: readonly string[]): boolean {
    const state = this.state;
    if (!state) return false;
    if (!this.deps.runs.startOwn({ skill: ANALYZE_SKILL, jobIds: [...jobIds], auto: true })) {
      return false;
    }
    // Only jobs still not checked stay on the list of those left to the user, so it stays short.
    const jobs = this.deps.jobs();
    const kept = state.tried.filter((id) =>
      jobs.some((job) => job.id === id && notCheckedYet(job)),
    );
    if (kept.length < state.tried.length) {
      this.state = { ...state, tried: kept };
      void this.save();
    }
    return true;
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
