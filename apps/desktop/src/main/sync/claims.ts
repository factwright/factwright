import { randomUUID } from 'node:crypto';
import { rowName } from '@factwright/sync';
import type { RunPhase, RunsView } from '../../shared/api.ts';
import { startedOnItsOwn, taskJobs } from '../../shared/runs.ts';
import { type Claim, readClaim, type Tracker } from '../jobs/tracker.ts';
import type { SyncState } from './state.ts';

/** How long a claim holds unless the computer that made it renews it. */
export const CLAIM_LAPSE_MS = 10 * 60_000;

/**
 * How often a computer renews the claims its runs hold: well inside how long they hold, so one
 * that misses a renewal, or whose clock is a few minutes off, keeps them.
 */
export const CLAIM_RENEW_MS = 3 * 60_000;

/** The phases in which a run holds its jobs: it's starting, working, or waits on the user. */
const WORKING: readonly RunPhase[] = ['starting', 'working', 'needs-answer'];

/** Where sync's notes keep this computer's ID, which its claims name it by. */
const CLAIMANT = 'claimant';

/** Whether a claim still holds, by this computer's clock. */
export const holdsAt = (claim: Claim, now: number): boolean => Date.parse(claim.until) > now;

const iso = (ms: number) => new Date(ms).toISOString();

/** What claims need of sync on this computer. */
export interface ClaimsSync {
  /** Whether sync is set up here. Without it, this is the only computer, and nothing is claimed. */
  on(): boolean;
  /** Whether sync is working now: its last round got through. */
  working(): boolean;
  /** This computer, as its claims name it. */
  device(): string;
  /** Whether a job reached the server: sent from here, or brought from another device. */
  reached(job: string): boolean;
  /** The claim on a job the server had when this computer last synced it, or null for none. */
  server(job: string): Claim | null;
  /** Syncs now, and answers whether the round got through. */
  now(): Promise<boolean>;
  /** Syncs soon. */
  request(): void;
}

/**
 * What sync's notes on this computer say for claims: this computer's ID, made the first time it's
 * asked for, which jobs reached the server, and the claim the server had on each.
 */
export function claimNotes(
  state: Pick<SyncState, 'get' | 'meta' | 'setMeta'>,
): Pick<ClaimsSync, 'device' | 'reached' | 'server'> {
  return {
    device: () => {
      const known = state.meta(CLAIMANT);
      if (known) return known;
      const made = randomUUID();
      state.setMeta(CLAIMANT, made);
      return made;
    },
    reached: (job) => state.get(rowName('jobs', job)) !== null,
    server: (job) => {
      const synced = state.get(rowName('claims', job));
      if (!synced?.base || synced.deleted) return null;
      return readClaim({ ...(JSON.parse(synced.base) as Record<string, unknown>), id: job });
    },
  };
}

export interface ClaimsDeps {
  tracker: Pick<Tracker, 'claim' | 'claims' | 'setClaim' | 'dropClaim'>;
  sync: ClaimsSync;
  /** Makes a run of Claude's own step aside, as when another computer took its job. */
  stepAside: (runId: string) => void;
  now?: () => number;
}

/**
 * Claims on jobs, kept through sync, so no two computers analyze a job at once. A run of Claude's
 * own starts on a job only once this computer holds its claim: the server took it, ahead of any
 * other computer's, which then leaves the job. A task the user starts claims its jobs too, never
 * waiting for it, and takes the claim from another computer's run of Claude's own, which steps
 * aside, as one does for a task the user starts on the same computer. Each claim holds while its
 * run works, renewed every few minutes, and goes when the run ends. One a computer stops renewing,
 * as it sleeps, goes offline or quits, lapses on its own. Without sync, this is the only computer,
 * and nothing is claimed.
 */
export class Claims {
  private readonly deps: ClaimsDeps;
  /** The runs here with work going, as they last were: each one's jobs, and whose task it is. */
  private runs: { id: string; own: boolean; jobs: readonly string[] }[] = [];
  /** Jobs claimed for a run of Claude's own that hasn't started yet. */
  private readonly starting = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(deps: ClaimsDeps) {
    this.deps = deps;
  }

  /**
   * Whether another computer's claim on a job holds now, so a run of Claude's own here leaves the
   * job to it.
   */
  elsewhere(job: string): boolean {
    const { sync, tracker } = this.deps;
    if (!sync.on()) return false;
    const claim = tracker.claim(job);
    return claim !== null && claim.device !== sync.device() && holdsAt(claim, this.now());
  }

  /**
   * Claims jobs for a run of Claude's own, through sync, and answers with the ones this computer
   * holds: each one whose claim the server took from it, ahead of any other computer's, and each
   * one that never reached the server, which no other computer can have, and whose claim goes up
   * with it. The rest wait: one another computer holds, and while sync isn't working, one that
   * reached the server, which another computer may be claiming. Without sync, every one is this
   * computer's.
   */
  async take(jobs: readonly string[]): Promise<string[]> {
    const { sync, tracker } = this.deps;
    if (!sync.on()) return [...jobs];
    const me = sync.device();
    const working = sync.working();
    const free = jobs.filter((job) => !this.elsewhere(job) && (working || !sync.reached(job)));
    if (free.length === 0) return [];
    const until = iso(this.now() + CLAIM_LAPSE_MS);
    for (const job of free) {
      tracker.setClaim({ job, device: me, until, own: true });
      this.starting.add(job);
    }
    if (working) await sync.now();
    const now = this.now();
    const held = free.filter((job) => {
      if (tracker.claim(job)?.device !== me) return false;
      const server = sync.server(job);
      return server ? server.device === me && holdsAt(server, now) : !sync.reached(job);
    });
    this.letGo(free.filter((job) => !held.includes(job)));
    return held;
  }

  /** Lets go of jobs claimed for a run of Claude's own that didn't start after all. */
  letGo(jobs: readonly string[]): void {
    for (const job of jobs) this.starting.delete(job);
    this.settle();
  }

  /**
   * Hears the runs here, as they change: each one with work going holds its jobs' claims, and the
   * claims of those that ended or stepped aside go.
   */
  heard(view: RunsView): void {
    this.runs = view.runs
      .filter((run) => WORKING.includes(run.phase))
      .map((run) => ({ id: run.id, own: startedOnItsOwn(run.task), jobs: taskJobs(run.task) }));
    for (const run of this.runs) {
      if (run.own) for (const job of run.jobs) this.starting.delete(job);
    }
    this.settle();
  }

  /**
   * Hears sync bring in changes from other devices. A run of Claude's own whose job another
   * computer now holds steps aside: a task the user started there took it, or this computer slept
   * past its claim and another took the job over.
   */
  synced(): void {
    if (this.stopped || !this.deps.sync.on()) return;
    const losing = this.runs.filter(
      (run) => run.own && run.jobs.some((job) => this.elsewhere(job)),
    );
    for (const run of losing) this.deps.stepAside(run.id);
    this.settle();
  }

  /** Stops renewing, as the app quits. Its claims lapse on their own. */
  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Claims the jobs the runs here are on, for as long as they work, and lets go of the rest. A
   * claim of another computer's that holds stays, unless it's for a run of Claude's own and a
   * task the user started here is on the job: that task takes it. With sync off, this computer's
   * claims go, as no other computer will see them.
   */
  private settle(): void {
    const { sync, tracker } = this.deps;
    if (this.stopped) return;
    const me = sync.device();
    if (!sync.on()) {
      this.renewing(false);
      for (const claim of tracker.claims()) if (claim.device === me) tracker.dropClaim(claim.job);
      return;
    }
    const now = this.now();
    // Each job a run here is on, or a run of Claude's own is about to be, and whether only runs
    // of Claude's own are on it.
    const wanted = new Map<string, boolean>();
    for (const job of this.starting) wanted.set(job, true);
    for (const run of this.runs) {
      for (const job of run.jobs) wanted.set(job, (wanted.get(job) ?? true) && run.own);
    }
    let changed = false;
    for (const [job, own] of wanted) {
      const claim = tracker.claim(job);
      // This computer's, holding past the next renewal.
      if (claim?.device === me && claim.own === own && holdsAt(claim, now + CLAIM_RENEW_MS)) {
        continue;
      }
      if (claim && claim.device !== me && holdsAt(claim, now) && (own || !claim.own)) continue;
      tracker.setClaim({ job, device: me, until: iso(now + CLAIM_LAPSE_MS), own });
      changed = true;
    }
    for (const claim of tracker.claims()) {
      if (claim.device !== me || wanted.has(claim.job)) continue;
      this.release(claim.job);
      changed = true;
    }
    if (changed) sync.request();
    this.renewing(wanted.size > 0);
  }

  /**
   * Lets go of this computer's claim on a job. When the server has it, it goes there too. Any
   * other is put back as the server has it, so a claim that never got there takes nothing from
   * another computer.
   */
  private release(job: string): void {
    const server = this.deps.sync.server(job);
    if (server && server.device !== this.deps.sync.device()) this.deps.tracker.setClaim(server);
    else this.deps.tracker.dropClaim(job);
  }

  /** Renews this computer's claims every few minutes while a run here holds any. */
  private renewing(on: boolean): void {
    if (on && this.timer === undefined) {
      this.timer = setInterval(() => this.renew(), CLAIM_RENEW_MS);
    } else if (!on && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Renews the claims this computer holds, so they hold while its runs work. */
  private renew(): void {
    const { sync, tracker } = this.deps;
    if (this.stopped || !sync.on()) return;
    const me = sync.device();
    const until = iso(this.now() + CLAIM_LAPSE_MS);
    let renewed = false;
    for (const claim of tracker.claims()) {
      if (claim.device !== me) continue;
      tracker.setClaim({ ...claim, until });
      renewed = true;
    }
    if (renewed) sync.request();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
