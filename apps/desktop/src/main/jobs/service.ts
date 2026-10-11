import { mkdirSync } from 'node:fs';
import {
  type Call,
  type CollectedJob,
  collectJobs,
  type Job,
  type JobDocKind,
  type JobDocs,
  type JobPay,
  localDate,
  parsePay,
  readRecords,
  type StatusChange,
} from '@factwright/core';
import type {
  AddJobResult,
  CallChanges,
  EditResult,
  JobChanges,
  JobList,
  NewCall,
  NewJob,
} from '../../shared/api.ts';
import type { EditContext, TrackedRow, Tracker } from './tracker.ts';
import { diskWorkspace, watchWorkspace } from './workspace.ts';

export interface JobsDeps {
  /** The workspace folder. */
  workspace: string;
  tracker: Tracker;
  /** Gets the new list after every change: an edit, or new work saved in the workspace. */
  onChange: (list: JobList) => void;
  /** The clock. Tests set it. */
  now?: () => Date;
}

const ADDED_BY_HAND = 'Added by hand';

/** Whether the user has tracked anything about a job, so it stays listed after its files go. */
function isTracked(row: TrackedRow, calls: number): boolean {
  const { manual, archived, status, appliedOn, nextAction, nextOn, notes } = row;
  return (
    manual || archived || calls > 0 || [status, appliedOn, nextAction, nextOn, notes].some(Boolean)
  );
}

/** The pay the user typed for a job they added by hand. */
function typedPay(row: TrackedRow): JobPay | null {
  if (!row.payText) return null;
  const range = parsePay(row.payText);
  return { text: row.payText, min: range?.min ?? null, max: range?.max ?? null, source: 'listed' };
}

/** A job as the app shows it: its tracker row, plus what the workspace says when it has files. */
function assemble(
  row: TrackedRow,
  found: CollectedJob | undefined,
  calls: Call[],
  statusLog: StatusChange[],
): Job {
  const tracking = {
    status: row.status,
    statusOn: row.statusOn,
    appliedOn: row.appliedOn,
    nextAction: row.nextAction,
    nextOn: row.nextOn,
    notes: row.notes,
    archived: row.archived,
    manual: row.manual,
    calls,
    statusLog,
  };
  if (found) {
    const { docs, ...job } = found;
    return {
      ...job,
      ...tracking,
      pay: job.pay ?? typedPay(row),
      source: row.manual ? ADDED_BY_HAND : job.source,
      docKinds: Object.keys(docs) as JobDocKind[],
    };
  }
  return {
    id: row.id,
    company: row.company,
    companyKey: row.companyKey,
    role: row.role,
    link: row.links[0]?.url ?? null,
    links: row.links,
    location: null,
    pay: typedPay(row),
    source: row.manual ? ADDED_BY_HAND : '',
    fit: null,
    search: null,
    folder: null,
    stage: 'new',
    firstSeen: row.firstSeen,
    lastActivity: row.firstSeen,
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    docKinds: [],
    ...tracking,
  };
}

/**
 * The user's jobs: what the skills saved in the workspace, joined with the tracker. Reads the
 * workspace again whenever it changes, and sends the new list after every change.
 */
export class JobsService {
  private readonly deps: JobsDeps;
  private found = new Map<string, CollectedJob>();
  private readAt: string | null = null;
  private stopWatching: (() => void) | undefined;

  constructor(deps: JobsDeps) {
    this.deps = deps;
  }

  private context(): EditContext {
    const now = this.deps.now?.() ?? new Date();
    return { today: localDate(now), now: now.toISOString() };
  }

  /** Reads the workspace, keeps each job it finds in the tracker, and returns the list. */
  read(): JobList {
    const { now } = this.context();
    const records = readRecords(diskWorkspace(this.deps.workspace));
    const jobs = collectJobs(records, this.deps.tracker.knownJobs());
    this.deps.tracker.saveCollected(jobs, now);
    this.found = new Map(jobs.map((job) => [job.id, job]));
    this.readAt = now;
    return this.list();
  }

  /** Every job, as of the last read. */
  list(): JobList {
    const { tracker } = this.deps;
    const calls = tracker.calls();
    const history = tracker.history();
    const jobs = tracker.rows().flatMap((row) => {
      const found = this.found.get(row.id);
      const jobCalls = calls.get(row.id) ?? [];
      if (!found && !isTracked(row, jobCalls.length)) return [];
      return [assemble(row, found, jobCalls, history.get(row.id) ?? [])];
    });
    return { jobs, readAt: this.readAt };
  }

  docs(jobId: string): JobDocs | null {
    return this.found.get(jobId)?.docs ?? null;
  }

  /** Watches the workspace, so new work by the skills shows up on its own. */
  watch(): void {
    mkdirSync(this.deps.workspace, { recursive: true });
    this.stopWatching?.();
    this.stopWatching = watchWorkspace(this.deps.workspace, () => this.deps.onChange(this.read()));
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  /** Passes on an edit's result, and the new list when it saved. */
  private saved<T extends EditResult | AddJobResult>(result: T): T {
    if (result.ok) this.deps.onChange(this.list());
    return result;
  }

  updateJob(jobId: string, changes: JobChanges): EditResult {
    return this.saved(this.deps.tracker.updateJob(jobId, changes, this.context()));
  }

  addJob(job: NewJob): AddJobResult {
    return this.saved(this.deps.tracker.addJob(job, this.context()));
  }

  addCall(jobId: string, call: NewCall): EditResult {
    return this.saved(this.deps.tracker.addCall(jobId, call, this.context()));
  }

  updateCall(callId: string, changes: CallChanges): EditResult {
    return this.saved(this.deps.tracker.updateCall(callId, changes, this.context()));
  }

  deleteCall(callId: string): EditResult {
    return this.saved(this.deps.tracker.deleteCall(callId));
  }

  redateStatusChange(changeId: string, at: string): EditResult {
    return this.saved(this.deps.tracker.redateChange(changeId, at, this.context().now));
  }

  undoStatusChange(changeId: string): EditResult {
    return this.saved(this.deps.tracker.undoChange(changeId, this.context().now));
  }
}
