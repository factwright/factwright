import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK_ID,
  askedFile,
  type CollectedJob,
  collectJobs,
  type JobDocs,
  jobList,
  localDate,
  readJobExtras,
  readRecords,
} from '@factwright/core';
import type {
  AddJobResult,
  AskResult,
  CallChanges,
  EditResult,
  JobChanges,
  JobExtras,
  JobList,
  NewCall,
  NewJob,
  ShotFor,
  ShotResult,
} from '../../shared/api.ts';
import { readShot, saveShot, shotFile } from './shots.ts';
import type { EditContext, Tracker } from './tracker.ts';
import { diskWorkspace, watchWorkspace } from './workspace.ts';

export interface JobsDeps {
  /** The workspace folder. */
  workspace: string;
  tracker: Tracker;
  /** Gets the new list after every change: an edit, or new work saved in the workspace. */
  onChange: (list: JobList) => void;
  /** The clock. Tests set it. */
  now?: () => Date;
  /** Moves a file to the trash, such as the answer to a question the user removed. */
  trash?: (file: string) => Promise<void>;
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

  /** The user's local time of day, as HHMMSS, to tell apart screenshots pasted the same day. */
  private time(): string {
    const now = this.deps.now?.() ?? new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((part) => String(part).padStart(2, '0'))
      .join('');
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
    const jobs = jobList(tracker.rows(), this.found, tracker.calls(), tracker.history());
    return { jobs, readAt: this.readAt };
  }

  docs(jobId: string): JobDocs | null {
    return this.found.get(jobId)?.docs ?? null;
  }

  /** Claude's answers to the user's questions about a job, and the job's screenshots. */
  extras(jobId: string): JobExtras {
    return readJobExtras(diskWorkspace(this.deps.workspace), jobId);
  }

  /** Whether the tracker has a job, by its ID. */
  has(jobId: string): boolean {
    return this.deps.tracker.rows().some((row) => row.id === jobId);
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
  private saved<T extends EditResult | AddJobResult | AskResult>(result: T): T {
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

  /** Keeps what the user actually sent for one of the application's questions. */
  recordAnswer(jobId: string, question: string, nth: number, text: string): EditResult {
    return this.saved(this.deps.tracker.recordAnswer(jobId, question, nth, text, this.context()));
  }

  /** Keeps a question the user asked Claude about a job. */
  addAsk(jobId: string, question: string): AskResult {
    return this.saved(this.deps.tracker.addAsk(jobId, question, this.context()));
  }

  /** Forgets a question the user asked about a job, and puts its answer and screenshots in the trash. */
  async removeAsk(jobId: string, askId: string): Promise<EditResult> {
    if (!ASK_ID.test(askId)) return { ok: false, message: 'That question isn’t on file.' };
    const result = this.saved(this.deps.tracker.removeAsk(jobId, askId, this.context()));
    if (!result.ok) return result;
    const files = [
      join(this.deps.workspace, ...askedFile(jobId, askId).split('/')),
      ...this.extras(jobId)
        .shots.filter((shot) => shot.ask === askId)
        .flatMap((shot) => shotFile(this.deps.workspace, shot.path) ?? []),
    ];
    for (const file of files.filter((each) => existsSync(each))) {
      await this.deps.trash?.(file).catch(() => {});
    }
    return result;
  }

  /** Saves a screenshot the user added for a job, or pasted into Claude's panel outside one. */
  addShot(jobId: string | null, upload: unknown, purpose: ShotFor): Promise<ShotResult> {
    if (jobId !== null && !this.has(jobId)) {
      return Promise.resolve({ ok: false, message: 'That job isn’t in your tracker anymore.' });
    }
    return saveShot(this.deps.workspace, jobId, upload, purpose, {
      today: this.context().today,
      time: this.time(),
    });
  }

  /** Puts a screenshot in the trash. */
  async removeShot(path: unknown): Promise<EditResult> {
    const file = shotFile(this.deps.workspace, path);
    if (!file) return { ok: false, message: 'That screenshot isn’t in your workspace.' };
    if (existsSync(file)) await this.deps.trash?.(file);
    return { ok: true };
  }

  /** A screenshot's bytes, to show it in the window. */
  shot(path: unknown): Promise<Uint8Array | null> {
    return readShot(this.deps.workspace, path);
  }

  /** Where a screenshot is on this computer, for Claude to read it from a paste. */
  shotOnDisk(path: unknown): string | null {
    return shotFile(this.deps.workspace, path);
  }
}
