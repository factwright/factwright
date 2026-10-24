import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  ASK_ID,
  askedFile,
  CALL_ID,
  type CallDoc,
  type CollectedJob,
  collectJobs,
  type InboxAnswer,
  JOB_EXTRAS,
  type Job,
  type JobDocs,
  jobList,
  localDate,
  type PostingSaved,
  questionKey,
  readAllCallDocs,
  readJobExtras,
  readOutreach,
  readRecords,
  readSavedForm,
  type SavedForm,
  type SavedJob,
  savedFormFile,
  savedFormJson,
  savedPostingFile,
  savedPostingMarkdown,
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
  NewNote,
  NoteChanges,
  RecordedAnswers,
  ShotFor,
  ShotResult,
} from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { readShot, saveShot, shotFile } from './shots.ts';
import type { EditContext, Tracker } from './tracker.ts';
import { diskWorkspace, watchWorkspace } from './workspace.ts';

/**
 * Writes a file whole, or not at all: to a hidden file beside it first, which sync leaves alone,
 * then moved into place, so nothing reads half of it.
 */
function writeWhole(file: string, text: string): void {
  const draft = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(draft, text);
    renameSync(draft, file);
  } finally {
    rmSync(draft, { force: true });
  }
}

/**
 * A file's name, free in a folder: as it is, or with the number before its extension counted on,
 * as screenshots are numbered: "form-2026-10-12-1.png" is "form-2026-10-12-2.png" when that's
 * taken.
 */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const numbered = name.match(/^(.*)-(\d+)(\.[^.]+)$/);
  const extension = name.match(/\.[^.]+$/)?.[0] ?? '';
  const stem = numbered?.[1] ?? name.slice(0, name.length - extension.length);
  for (let n = Number(numbered?.[2] ?? 1) + 1; n < 1000; n++) {
    const next = `${stem}-${n}${extension}`;
    if (!existsSync(join(dir, next))) return next;
  }
  return name;
}

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
  /** Claude's prep sheets and thank-you notes for each job's calls, by the job's ID. */
  private callDocs = new Map<string, CallDoc[]>();
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
    const workspace = diskWorkspace(this.deps.workspace);
    const records = readRecords(workspace);
    const jobs = collectJobs(records, this.deps.tracker.knownJobs());
    this.deps.tracker.saveCollected(jobs, now);
    this.found = new Map(jobs.map((job) => [job.id, job]));
    this.callDocs = readAllCallDocs(workspace);
    this.readAt = now;
    return this.list();
  }

  /** Every job, as of the last read. */
  list(): JobList {
    const { tracker } = this.deps;
    const jobs = jobList(tracker.rows(), this.found, {
      calls: tracker.calls(),
      history: tracker.history(),
      notes: tracker.notes(),
      callDocs: this.callDocs,
    });
    return { jobs, readAt: this.readAt };
  }

  docs(jobId: string): JobDocs | null {
    return this.found.get(jobId)?.docs ?? null;
  }

  /**
   * Claude's answers to the user's questions about a job, the job's screenshots, the posting
   * the user saved, its application form's questions, Claude's prep sheets and thank-you notes
   * for its calls, and the messages Claude drafted for people at the company.
   */
  extras(jobId: string): Omit<JobExtras, 'versions'> {
    const workspace = diskWorkspace(this.deps.workspace);
    const outreach = readOutreach(workspace, this.found.get(jobId)?.outreach ?? []);
    return { ...readJobExtras(workspace, jobId), form: this.savedForm(jobId), outreach };
  }

  /**
   * A job, by its ID as of the last read: the one kept, for a job the user merged into another,
   * so a skill that names the merged one reaches it. Null for no such job.
   */
  job(jobId: string): Job | null {
    const id = this.deps.tracker.resolve(jobId) ?? jobId;
    return this.list().jobs.find((job) => job.id === id) ?? null;
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

  updateJobs(jobIds: readonly string[], changes: JobChanges): EditResult {
    return this.saved(this.deps.tracker.updateJobs(jobIds, changes, this.context()));
  }

  addJob(job: NewJob): AddJobResult {
    return this.saved(this.deps.tracker.addJob(job, this.context()));
  }

  /**
   * Adds a job the extension saved on this computer, from the inbox, as a save through sync
   * adds it: its row, as New, and its posting as the person saw it, kept with the job's extras in
   * `saved/<job ID>/posting.md`, where Claude's work later copies it into the job's folder. The
   * same job, by its link, is added once, and saving it again adds its posting if it has none. The
   * inbox sends the new list once it has added all it holds (sendList).
   */
  addSaved(job: SavedJob): InboxAnswer {
    const context = this.context();
    const added = this.deps.tracker.addSavedJob(
      { company: job.company, role: job.role, link: job.url, pay: job.pay },
      context,
    );
    if (!added.ok) return { ok: false, reason: 'failed', message: added.message };
    const posting = this.keepPosting(added.id, job, !added.already, context.today);
    return { ok: true, id: added.id, already: added.already, posting };
  }

  /** Sends the list as it is now, as after an edit: once the inbox has added what it holds. */
  sendList(): void {
    this.deps.onChange(this.list());
  }

  /**
   * Keeps a saved job's posting, and says what became of it. A job the job hunt had already keeps
   * the posting it has. A new job's replaces one left from an earlier job with its ID, since
   * deleted on another device.
   */
  private keepPosting(jobId: string, job: SavedJob, replace: boolean, today: string): PostingSaved {
    if (!job.posting) return 'none';
    const file = join(this.deps.workspace, ...savedPostingFile(jobId).split('/'));
    if (!replace && existsSync(file)) return 'kept';
    const text = savedPostingMarkdown({
      url: job.url,
      site: job.site,
      savedOn: today,
      text: job.posting,
    });
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeWhole(file, text);
      return 'saved';
    } catch {
      return 'failed';
    }
  }

  /**
   * Keeps the questions of a job's application form, as the extension read them in the user's
   * browser for their Claude to draft answers to: what each asks and how, in
   * `saved/<job ID>/form.json` beside the posting saved from the browser, and each question the
   * job's application questions don't have yet, as many times as the form asks it.
   */
  keepForm(jobId: string, form: SavedForm): EditResult {
    const job = this.job(jobId);
    if (!job) return { ok: false, message: 'That job isn’t in Factwright anymore.' };
    const file = join(this.deps.workspace, ...savedFormFile(job.id).split('/'));
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeWhole(file, savedFormJson(form));
    } catch {
      return { ok: false, message: 'Factwright couldn’t keep the form’s questions.' };
    }
    const count = (questions: readonly string[]) => {
      const counted = new Map<string, number>();
      for (const question of questions) {
        const key = questionKey(question);
        if (key) counted.set(key, (counted.get(key) ?? 0) + 1);
      }
      return counted;
    };
    const had = count(job.questions);
    const seen = new Map<string, number>();
    const added = form.questions
      .map((each) => each.question)
      .filter((question) => {
        const key = questionKey(question);
        const times = (seen.get(key) ?? 0) + 1;
        seen.set(key, times);
        return key !== '' && times > (had.get(key) ?? 0);
      });
    if (added.length === 0) return { ok: true };
    return this.updateJob(job.id, {
      questions: [...job.questions, ...added].slice(0, LIMITS.questions),
    });
  }

  /** The questions of a job's application form, as the extension read them, or null. */
  savedForm(jobId: string): SavedForm | null {
    try {
      const file = join(this.deps.workspace, ...savedFormFile(jobId).split('/'));
      return readSavedForm(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Merges another job into one, for a job the skills' work found twice, as the tracker merges
   * them, then moves what the app keeps for the other by its ID onto the one kept, and reads the
   * workspace again, so what the other was found by joins the one kept.
   */
  async mergeJobs(keepId: string, otherId: string): Promise<EditResult> {
    const result = this.deps.tracker.mergeJobs(keepId, otherId, this.context());
    if (!result.ok) return result;
    await this.moveExtras(otherId, keepId, new Map(result.asks));
    this.deps.onChange(this.read());
    return { ok: true };
  }

  /**
   * Moves what the app keeps for a job by its ID onto another: Claude's answers to the user's
   * questions, each under the ID its question has now, the user's screenshots, Claude's work for
   * each call, and the posting and the form's questions saved from the browser, unless the job
   * kept has its own, when they go in the trash. A file that won't move stays where it is.
   */
  private async moveExtras(from: string, to: string, asks: ReadonlyMap<string, string>) {
    const { workspace } = this.deps;
    const folder = (kind: keyof typeof JOB_EXTRAS, jobId: string) =>
      join(workspace, JOB_EXTRAS[kind], jobId);
    const names = (dir: string) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    };
    const move = (source: string, target: string) => {
      try {
        if (existsSync(target)) return;
        mkdirSync(dirname(target), { recursive: true });
        renameSync(source, target);
      } catch {
        // It stays with the merged job's ID, where nothing shows it, and nothing is lost.
      }
    };
    const askOf = (id: string) => asks.get(id) ?? id;
    for (const name of names(folder('asked', from))) {
      const id = name.match(/^(.+)\.md$/)?.[1];
      const target = id ? `${askOf(id)}.md` : name;
      move(join(folder('asked', from), name), join(folder('asked', to), target));
    }
    for (const name of names(folder('screenshots', from))) {
      const ask = name.match(/^ask-(.+)-(\d+)(\.[a-z]+)$/i);
      const renamed = ask ? `ask-${askOf(ask[1] ?? '')}-${ask[2]}${ask[3]}` : name;
      const target = freeName(folder('screenshots', to), renamed);
      move(join(folder('screenshots', from), name), join(folder('screenshots', to), target));
    }
    for (const call of names(folder('calls', from))) {
      move(join(folder('calls', from), call), join(folder('calls', to), call));
    }
    for (const file of [savedPostingFile, savedFormFile]) {
      const saved = join(workspace, ...file(from).split('/'));
      if (!existsSync(saved)) continue;
      const kept = join(workspace, ...file(to).split('/'));
      if (existsSync(kept)) await this.deps.trash?.(saved).catch(() => {});
      else move(saved, kept);
    }
    for (const kind of ['asked', 'screenshots', 'calls', 'saved'] as const) {
      try {
        rmdirSync(folder(kind, from));
      } catch {
        // Not empty, or not there.
      }
    }
  }

  addCall(jobId: string, call: NewCall): EditResult {
    return this.saved(this.deps.tracker.addCall(jobId, call, this.context()));
  }

  updateCall(callId: string, changes: CallChanges): EditResult {
    return this.saved(this.deps.tracker.updateCall(callId, changes, this.context()));
  }

  /** Deletes a call, and puts Claude's prep sheet and thank-you notes for it in the trash. */
  async deleteCall(callId: string): Promise<EditResult> {
    const jobId = [...this.deps.tracker.calls()].find(([, calls]) =>
      calls.some((call) => call.id === callId),
    )?.[0];
    const result = this.saved(this.deps.tracker.deleteCall(callId));
    if (!result.ok || !jobId || !CALL_ID.test(callId)) return result;
    const folder = join(this.deps.workspace, JOB_EXTRAS.calls, jobId, callId);
    const inside = resolve(folder).startsWith(resolve(this.deps.workspace, JOB_EXTRAS.calls) + sep);
    if (inside && existsSync(folder)) await this.deps.trash?.(folder).catch(() => {});
    return result;
  }

  redateStatusChange(changeId: string, at: string): EditResult {
    return this.saved(this.deps.tracker.redateChange(changeId, at, this.context().now));
  }

  undoStatusChange(changeId: string): EditResult {
    return this.saved(this.deps.tracker.undoChange(changeId, this.context().now));
  }

  addNote(jobId: string, note: NewNote): EditResult {
    return this.saved(this.deps.tracker.addNote(jobId, note, this.context()));
  }

  updateNote(noteId: string, changes: NoteChanges): EditResult {
    return this.saved(this.deps.tracker.updateNote(noteId, changes, this.context()));
  }

  deleteNote(noteId: string): EditResult {
    return this.saved(this.deps.tracker.deleteNote(noteId));
  }

  /** Keeps what the user actually sent for one of the application's questions. */
  recordAnswer(jobId: string, question: string, nth: number, text: string): EditResult {
    return this.saved(this.deps.tracker.recordAnswer(jobId, question, nth, text, this.context()));
  }

  /** Keeps what the user sent for several of the application's questions, as one change. */
  recordAnswers(
    jobId: string,
    answers: readonly { question: string; nth: number; text: string }[],
  ): RecordedAnswers {
    const result = this.deps.tracker.recordAnswers(jobId, answers, this.context());
    return result.ok && result.recorded === 0 ? result : this.saved(result);
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
