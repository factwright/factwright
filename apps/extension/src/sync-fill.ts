import {
  type AskedJob,
  answerForm,
  askedJob,
  blocksOnFile,
  FILE_LIMIT,
  FILE_PART_BYTES,
  type FieldReply,
  formJob,
  type InboxAsk,
  type InboxAskAnswer,
  isSyncedAnswer,
  type Job,
  jobPdfs,
  KINDS_FILE,
  type KindTarget,
  keptLength,
  kindTargetsIn,
  letterPlainText,
  localDate,
  NO_PRIVATE,
  type OfferedFile,
  type OnFile,
  onFileJob,
  PROFILE_FILES,
  type ProfileForForms,
  payAskFor,
  profileAnswer,
  profileForForms,
  type ResumeOnFile,
  readHistory,
  readLetterText,
  readSuggestedAnswers,
  resumeDetails,
  type SavedForm,
  SENT_STATUSES,
  type StoredRow,
  savedFormFile,
  savedFormJson,
  sentAnswersOf,
  sentBefore,
  trackedRow,
  uploadName,
  type WorkHistory,
  withFormQuestions,
  withProfileAnswers,
  withSentAnswers,
} from '@factwright/core';
import { readResume } from '@factwright/engine/schema';
import {
  type AccountKeys,
  type Bytes,
  type Change,
  conflictCopyPath,
  encodeRecord,
  type FileRecord,
  fileName,
  fromBase64Url,
  isSyncPath,
  openFile,
  type PushChange,
  type RowValues,
  recordId,
  rowName,
  type SyncClient,
  SyncError,
  sealFile,
  sealRecord,
  utf8,
} from '@factwright/sync';
import type { NotAsked } from './computer.ts';
import { type Made, rowChange } from './save.ts';
import {
  decoded,
  fileContents,
  notesDetails,
  notesPath,
  nothingSynced,
  openChange,
  pullSynced,
  readJobNotes,
  resumePaths,
  type Synced,
  type SyncedFile,
  syncedJobs,
} from './synced.ts';

/**
 * Filling a form from your job hunt through sync, in a browser where Factwright isn't: the
 * extension answers the panel's asks itself, as Factwright on your computer answers them, with the
 * app's own code from @factwright/core, from what sync holds. Your street, postal code and
 * equal-opportunity answers never sync, so they're left for you. A form's new questions are left
 * with the job, for your Claude in Factwright to draft, and Mark as applied records what you sent.
 * What it reads stays in memory, and each fill reads only what changed since, until it's forgotten
 * a few minutes after its last use.
 */

/** How long what fills read stays in memory after it's last used. */
export const KEEP_FOR_MS = 5 * 60 * 1000;

/** How many times a change to a job is made again, on another device's newer version of it. */
const TRIES = 5;

/** What fills read through sync, while it's kept. */
interface Read {
  synced: Synced;
  /** The job folders' job.md files it read, by their paths: those no job's row names. */
  notes: Map<string, string>;
  /** Every job, as the app lists them. */
  jobs: Job[];
  /** The jobs the app lists only from job searches' files, which a fill doesn't read. */
  others: Job[];
  profile: ProfileForForms;
  /** Each kind of job you want, with your target pay for it. */
  targets: KindTarget[];
  history: WorkHistory;
  /** Files' contents fetched, by their IDs, each once, or null for one the store hasn't. */
  contents: Map<string, Promise<Bytes | null>>;
}

export interface SyncFillDeps {
  client: SyncClient;
  keys: AccountKeys;
  /** What the records it saves say made them, such as "Factwright in Chrome". */
  device: string;
  /** The sync server as you know it, to name it when it can't be reached. */
  server: string;
  /** Forgets the extension's sign-in, once the server says it was signed out. */
  signedOut?: () => Promise<void>;
  /**
   * Whether the extension is still signed in with these keys: once it isn't, as after signing out
   * in setup, it forgets what it read, and answers nothing more.
   */
  signedIn?: () => Promise<boolean>;
  now?: () => Date;
  uuid?: () => string;
  /** Waits before trying again: a second, then two. */
  pause?: (ms: number) => Promise<void>;
}

/** A job's row, as a version of its record has it: the job's ID, the version and the row. */
interface CurrentJob {
  id: string;
  version: number;
  row: RowValues;
}

/** What answering an ask through sync comes to: what Factwright on a computer would answer. */
export type SyncAnswer = Extract<InboxAskAnswer, { ok: true }> | NotAsked;

const failed = (message: string): NotAsked => ({ ok: false, reason: 'failed', message });
const notFound = (message: string): NotAsked => ({ ok: false, reason: 'not-found', message });

/** A file's version, as an offer names it: from its contents' ID, so it pins those contents. */
export function versionOf(file: SyncedFile): string {
  const bytes = fromBase64Url(file.id) ?? new Uint8Array(8);
  return [...bytes.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Bytes as base64, as the page's own function takes a file to upload. */
export function toBase64(bytes: Bytes): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** Profile's answers.json, as one version of it in sync has it. */
interface Profile {
  /** The version of its record, or 0 for none yet. */
  version: number;
  /** Its contents' ID, or empty for none. */
  id: string;
  /** What it says, or null when it doesn't read as answers. */
  value: Record<string, unknown> | null;
}

/** Why Profile's answers were left as they are. */
const UNREAD =
  'Profile’s answers don’t read as they are in sync, so Factwright left them. Check Profile in Factwright on your computer.';
const GONE =
  'Profile isn’t in sync as it was when you filled the form, so Factwright saved nothing. Add it in Profile in Factwright on your computer.';

/** Profile's answers, from its file's text, or null when they aren't an object. */
function answersIn(text: string): Record<string, unknown> | null {
  const value = json(text);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Profile's answers as the app writes their file. */
const answersJson = (value: Record<string, unknown>) => `${JSON.stringify(value, null, 2)}\n`;

/** A JSON file's value, or null when it isn't there or doesn't parse. */
function json(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * What only Factwright on your computer keeps, as a reply says it through sync: your street and
 * postal code, which Profile keeps there alone.
 */
const privately = (reply: FieldReply): FieldReply =>
  (reply.kind === 'street' || reply.kind === 'postal-code') && reply.left === 'unset'
    ? { ...reply, left: 'private' }
    : reply;

/** A job's row, as the extension tells the panel of it. */
function askedRow(row: RowValues): AskedJob {
  const job = trackedRow(row as StoredRow);
  return {
    id: job.id,
    company: job.company,
    role: job.role,
    status: job.status ?? 'new',
    appliedOn: job.appliedOn,
  };
}

/**
 * The extension's own answers to the panel's asks, from your job hunt through sync. One is made
 * for each fill: it reads what sync holds when it's first asked, and keeps it in memory for the
 * rest of the fill, such as each part of an upload, until a few minutes after it's last used.
 */
export class SyncFill {
  private readonly deps: SyncFillDeps;
  private read: Promise<Read> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: SyncFillDeps) {
    this.deps = deps;
  }

  /** Forgets what it read. */
  forget(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.read = null;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private made(): Made {
    return { device: this.deps.device.slice(0, 200), at: this.now().toISOString() };
  }

  /** Keeps what it read for a few minutes more. */
  private keep(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.forget(), KEEP_FOR_MS);
  }

  /** What sync holds, as fills last read it, or as it reads it now, for the first. */
  private reading(): Promise<Read> {
    this.keep();
    return this.read ?? this.latest();
  }

  /**
   * What sync holds now: what fills read before, with only what's changed since read again, one
   * read after another.
   */
  private latest(): Promise<Read> {
    this.keep();
    const before = this.read;
    const read = (before ?? Promise.resolve(null))
      .catch(() => null)
      .then((last) => this.readAgain(last));
    this.read = read;
    read.catch(() => {
      if (this.read === read) this.read = null;
    });
    return read;
  }

  private async readAgain(last: Read | null): Promise<Read> {
    const { client, keys } = this.deps;
    const synced = last?.synced ?? nothingSynced();
    await pullSynced(client, keys, synced);
    // Contents are kept by their IDs: only what changed is fetched again, and what's gone goes.
    const current = new Set([...synced.files.values()].map((file) => file.id));
    const contents = last?.contents ?? new Map<string, Promise<Bytes | null>>();
    for (const id of contents.keys()) if (!current.has(id)) contents.delete(id);
    const read = { synced, contents } as Read;
    // Only the folders no job's row names are read by their job.md, as from an app before rows
    // named them.
    const [notes, answers, history, kinds] = await Promise.all([
      readJobNotes(synced, (path) => this.text(read, path)),
      this.text(read, PROFILE_FILES.answers),
      this.text(read, PROFILE_FILES.history),
      this.text(read, KINDS_FILE),
    ]);
    const { listed, others } = syncedJobs(synced, notes);
    return {
      ...read,
      notes,
      jobs: listed,
      others,
      profile: profileForForms(json(answers)),
      targets: kindTargetsIn(json(answers), json(kinds)),
      history: readHistory(json(history)),
    };
  }

  /**
   * A job, with what only its folder's job.md says, for one whose row named its folder, so its
   * job.md wasn't read for the list: where the job is, the kind of job its fit check judged it
   * as, and the pay to ask for there, as your Claude suggested it.
   */
  private async withNotes(read: Read, job: Job): Promise<Job> {
    const path = job.folder && notesPath(job.folder);
    if (!job.folder || !path || read.notes.has(path)) return job;
    const text = await this.text(read, path);
    return text ? { ...job, ...notesDetails(read.synced, job.folder, text) } : job;
  }

  /** A job by its ID, among all the jobs read. */
  private jobOf = (read: Read, id: string) =>
    read.jobs.find((job) => job.id === id) ?? read.others.find((job) => job.id === id) ?? null;

  /** A file's contents, fetched once. */
  private contents(read: Read, file: SyncedFile): Promise<Bytes | null> {
    const { client, keys } = this.deps;
    let contents = read.contents.get(file.id);
    if (!contents) {
      contents = fileContents(client, keys, file);
      read.contents.set(file.id, contents);
      contents.catch(() => read.contents.delete(file.id));
    }
    return contents;
  }

  /** A text file's contents, by its path, or null when it isn't there. */
  private async text(read: Read, path: string): Promise<string | null> {
    const file = read.synced.files.get(path);
    const contents = file ? await this.contents(read, file) : null;
    return contents ? decoded(contents) : null;
  }

  /** A resume.json that holds up, with a name on it, as the app takes one, or null. */
  private async resumeAt(read: Read, path: string, from: ResumeOnFile['from']) {
    const checked = readResume(json(await this.text(read, path)));
    return checked.ok && checked.resume.name.trim() ? resumeDetails(checked.resume, from) : null;
  }

  /** The job's own resume, or else your newest, as the app finds them, or null for none yet. */
  private async resume(read: Read, folder: string | null): Promise<ResumeOnFile | null> {
    const own = folder
      ? await this.resumeAt(read, `applications/${folder}/resume.json`, 'job')
      : null;
    if (own) return own;
    for (const path of resumePaths(read.synced)) {
      const newest = await this.resumeAt(read, path, 'newest');
      if (newest) return newest;
    }
    return null;
  }

  /**
   * The job's newest resume and cover letter PDFs, offered to upload as the app offers them: each
   * with a plain name, its size, its parts and its version. One the store doesn't have, or that's
   * empty or too big, isn't offered.
   */
  private async offers(read: Read, job: Job, you: string) {
    const kinds = ['resume', 'cover-letter'] as const;
    const files = kinds.map((kind) => {
      const [file] = jobPdfs(job, kind);
      const synced = file && read.synced.files.get(file.path);
      return file && synced && synced.size > 0 && synced.size <= FILE_LIMIT
        ? { kind, file, synced }
        : null;
    });
    const ids = files.flatMap((each) => (each ? [each.synced.id] : []));
    const missing = new Set(ids.length > 0 ? await this.deps.client.missingFiles(ids) : []);
    const [resume, letter] = files.map((each): OfferedFile | null =>
      each && !missing.has(each.synced.id)
        ? {
            name: uploadName(you, each.kind, each.file),
            size: each.synced.size,
            parts: Math.ceil(each.synced.size / FILE_PART_BYTES),
            version: versionOf(each.synced),
          }
        : null,
    );
    return { resume: resume ?? null, 'cover-letter': letter ?? null };
  }

  /** Answers for a form's fields, with the job it's for and the files there are to upload. */
  private async fill(ask: Extract<InboxAsk, { ask: 'fill' }>): Promise<SyncAnswer> {
    const read = await this.latest();
    // The app's own list first, then a job a job search turned up, by its row.
    const found =
      formJob(read.jobs, ask.url, ask.company, ask.role) ??
      formJob(read.others, ask.url, ask.company, ask.role);
    const job = found && (await this.withNotes(read, found));
    const folder = job?.folder ?? null;
    const [answers, letterJson, resume] = await Promise.all([
      folder ? this.text(read, `applications/${folder}/answers.md`) : null,
      folder ? this.text(read, `applications/${folder}/cover-letter.json`) : null,
      this.resume(read, folder),
    ]);
    // Your name for the upload's name, from Profile or else the resume.
    const you = read.profile.you.name || resume?.name || '';
    const files = job ? await this.offers(read, job, you) : { resume: null, 'cover-letter': null };
    const letter = readLetterText(letterJson);
    const { targetPay: _, ...profile } = read.profile;
    const onFile: OnFile = {
      ...profile,
      pay: payAskFor(job, read.targets),
      // Never synced: Profile keeps them on the computer Factwright's on.
      kept: NO_PRIVATE,
      resume,
      history: read.history,
      job: job ? onFileJob(job) : null,
      sent: sentBefore(read.jobs),
      suggested: readSuggestedAnswers(answers),
      files: {
        resume: files.resume?.name ?? null,
        coverLetter: files['cover-letter']?.name ?? null,
      },
      letterText: letter ? letterPlainText(letter) : null,
      today: localDate(this.now()),
    };
    return {
      ok: true,
      did: 'fill',
      job: job ? askedJob(job) : null,
      replies: answerForm(ask.fields, onFile).map(privately),
      files,
      // How many jobs and schools are on file, for a form's parts for each, as Workday's.
      blocks: blocksOnFile(onFile),
      // So a new answer saved later keeps what Factwright changes in Profile meanwhile.
      profile: read.synced.files.get(PROFILE_FILES.answers)?.id ?? '',
    };
  }

  /**
   * A part of a job's resume or cover letter, as base64, to upload: of the file it was offered,
   * by its version, or none, once that file has changed in sync.
   */
  private async file(ask: Extract<InboxAsk, { ask: 'file' }>): Promise<SyncAnswer> {
    const read = await this.reading();
    const job = this.jobOf(read, ask.job);
    if (!job) return notFound('That job isn’t in your job hunt anymore.');
    for (const file of jobPdfs(job, ask.file)) {
      const synced = read.synced.files.get(file.path);
      if (!synced || versionOf(synced) !== ask.version) continue;
      if (synced.size === 0 || synced.size > FILE_LIMIT)
        return failed('That file is too big to upload.');
      const contents = await this.contents(read, synced);
      if (!contents) return notFound('Sync doesn’t have that file anymore. Click Fill again.');
      const parts = Math.ceil(contents.length / FILE_PART_BYTES);
      if (ask.part >= parts) return notFound('That file has no such part.');
      const at = ask.part * FILE_PART_BYTES;
      const part = contents.subarray(at, at + FILE_PART_BYTES);
      return { ok: true, did: 'file', part: ask.part, parts, base64: toBase64(part) };
    }
    return notFound('That file changed since Factwright offered it. Click Fill again.');
  }

  /** A job's row, as its latest version has it, with the version. */
  private async currentJob(jobId: string): Promise<CurrentJob | null> {
    const { client, keys } = this.deps;
    const record = await recordId(keys, rowName('jobs', jobId));
    const [latest] = await client.versions(record);
    if (!latest || latest.deleted) return null;
    const change = await client.version(record, latest.version);
    return change ? this.jobIn(jobId, change) : null;
  }

  /** A job's row in a version of its record, opened, or null when it's deleted or doesn't open. */
  private async jobIn(id: string, change: Change): Promise<CurrentJob | null> {
    if (change.deleted) return null;
    const record = await openChange(this.deps.keys, change);
    return record?.kind === 'row' && record.table === 'jobs' && record.id === id && record.row
      ? { id, version: change.version, row: record.row }
      : null;
  }

  /**
   * The job an ID names now, as the app finds it: the job itself, or for one you merged into
   * another, the job kept, as its latest version says. Null once it's gone.
   */
  private async jobNow(jobId: string): Promise<CurrentJob | null> {
    let current = await this.currentJob(jobId);
    for (let hop = 0; hop < TRIES && current; hop++) {
      const into = trackedRow(current.row as StoredRow).mergedInto;
      if (!into) return current;
      current = await this.currentJob(into);
    }
    return null;
  }

  /**
   * Changes a job's row, as one change from its latest version, so whatever another device changed
   * stays: on another device's newer version, the change is made again on that one. `change` says
   * the row it becomes, or null for no change. Answers with the row, as it is now, or null once the
   * job's gone.
   */
  private async changeJob(
    job: CurrentJob,
    change: (row: RowValues) => RowValues | null,
  ): Promise<{ row: RowValues; changed: boolean } | null> {
    const { client, keys } = this.deps;
    let current: CurrentJob | null = job;
    for (let attempt = 0; attempt < TRIES && current; attempt++) {
      const row = change(current.row);
      if (!row) return { row: current.row, changed: false };
      const pushed = await rowChange(keys, 'jobs', job.id, row, this.made(), current.version);
      const [result] = (await client.push([pushed])).results;
      if (result?.ok) return { row, changed: true };
      if (result?.reason === 'full') throw new SyncError('full', 'full');
      if (result?.reason !== 'conflict') throw new Error('Sync turned the change away.');
      // The server has no version at all, as after a restore from a backup: it goes up as new.
      current = result.current
        ? await this.jobIn(job.id, result.current)
        : { ...current, version: 0 };
    }
    if (current) throw new Error('The job kept changing in sync. Try again.');
    return null;
  }

  /** A file's whole contents, locked, and up on the server, where it hasn't them already. */
  private async upload(text: string): Promise<{ id: string; size: number }> {
    const { client, keys } = this.deps;
    const contents = utf8(text);
    const sealed = await sealFile(keys, contents);
    if ((await client.missingFiles([sealed.id])).includes(sealed.id)) {
      await client.putFile(sealed.id, sealed.data);
    }
    return { id: sealed.id, size: contents.length };
  }

  /** A change to a file's record, made from a version of it: the file, as contents uploaded. */
  private async fileChange(
    record: string,
    path: string,
    file: { id: string; size: number },
    base: number,
  ): Promise<PushChange> {
    const made = this.made();
    const body: FileRecord = {
      kind: 'file',
      path,
      file: { id: file.id, size: file.size, modified: made.at },
      ...made,
    };
    return {
      record,
      base,
      data: await sealRecord(this.deps.keys, record, base + 1, encodeRecord(body)),
      file: file.id,
      deleted: false,
    };
  }

  /**
   * Keeps a file in the workspace through sync, as its whole contents: in place of what's there,
   * as the app writes it. The same contents there already are left as they are.
   */
  private async keepFile(path: string, text: string): Promise<void> {
    const { client, keys } = this.deps;
    const sealed = await this.upload(text);
    const record = await recordId(keys, fileName(path));
    const [latest] = await client.versions(record);
    let base = latest?.version ?? 0;
    let same = latest && !latest.deleted && latest.file === sealed.id;
    for (let attempt = 0; attempt < TRIES && !same; attempt++) {
      const change = await this.fileChange(record, path, sealed, base);
      const [result] = (await client.push([change])).results;
      if (result?.ok) return;
      if (result?.reason === 'full') throw new SyncError('full', 'full');
      if (result?.reason !== 'conflict') throw new Error('Sync turned the file away.');
      base = result.current?.version ?? 0;
      same = Boolean(
        result.current && !result.current.deleted && result.current.file === sealed.id,
      );
    }
    if (!same) throw new Error('The file kept changing in sync. Try again.');
  }

  /**
   * Leaves a form's own questions with the job, for your Claude in Factwright to draft, as the app
   * keeps them: the form as its saved/<job>/form.json, and its questions added to the job's.
   */
  private async leave(ask: Extract<InboxAsk, { ask: 'draft' }>): Promise<SyncAnswer> {
    const job = await this.jobNow(ask.job);
    if (!job) return notFound('That job isn’t in your job hunt anymore.');
    const form: SavedForm = {
      url: ask.url,
      read: this.now().toISOString(),
      from: 'browser',
      questions: ask.questions.map((each) => ({
        question: each.question,
        hint: each.hint,
        section: each.section ?? '',
        control: each.control,
        options: each.options,
        required: each.required,
        limit: each.limit,
      })),
    };
    await this.keepFile(savedFormFile(job.id), savedFormJson(form));
    const questions = form.questions.map((each) => each.question);
    const at = this.made().at;
    const changed = await this.changeJob(job, (row) => {
      const added = withFormQuestions(trackedRow(row as StoredRow).questions, questions);
      return added ? { ...row, questions: JSON.stringify(added), updated_at: at } : null;
    });
    return changed
      ? { ok: true, did: 'draft' }
      : notFound('That job isn’t in your job hunt anymore.');
  }

  /**
   * What you sent, once you've applied, as the app records it: each answer to the form's own
   * questions, kept with the job, and the job marked Applied, today, with a line in its history.
   */
  private async sent(ask: Extract<InboxAsk, { ask: 'sent' }>): Promise<SyncAnswer> {
    const answers = sentAnswersOf(ask.answers);
    const made = this.made();
    const today = localDate(this.now());
    let recorded = 0;
    let applied = false;
    const job = await this.jobNow(ask.job);
    const changed =
      job &&
      (await this.changeJob(job, (row) => {
        const job = trackedRow(row as StoredRow);
        const sent = withSentAnswers(job.sent, answers, { today, now: made.at });
        recorded = sent.recorded;
        applied = !(job.status && SENT_STATUSES.includes(job.status));
        if (recorded === 0 && !applied) return null;
        return {
          ...row,
          ...(recorded > 0 && { sent: JSON.stringify(sent.sent) }),
          ...(applied && {
            status: 'applied',
            status_on: today,
            applied_on: job.appliedOn || today,
          }),
          updated_at: made.at,
        };
      }));
    if (!job || !changed) return notFound('That job isn’t in your job hunt anymore.');
    if (changed.changed && applied) await this.logApplied(job.id, today, made);
    return { ok: true, did: 'sent', job: askedRow(changed.row), recorded };
  }

  /**
   * The job's history's line for applying, once its row says Applied, so a job another device
   * changed meanwhile isn't marked twice. It's tried again through a lost connection, and the job
   * stays Applied without it, as it would with the line lost.
   */
  private async logApplied(jobId: string, today: string, made: Made): Promise<void> {
    const { client, keys } = this.deps;
    const pause = this.deps.pause ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
    const id = (this.deps.uuid ?? (() => crypto.randomUUID()))();
    const line = { id, job_id: jobId, status: 'applied', at: today };
    const change = await rowChange(keys, 'status_log', id, line, made);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await client.push([change]);
        return;
      } catch (error) {
        if (!(error instanceof SyncError) || error.kind !== 'offline') return;
        if (attempt < 3) await pause(attempt * 1000);
      }
    }
  }

  /**
   * Profile's answers.json, as a version of its record has it, deleted or not, by what the record
   * itself says, never the server: null when it doesn't open as Profile's own, so no other file
   * can stand in for it.
   */
  private async profileIn(change: Change): Promise<Profile | null> {
    const record = await openChange(this.deps.keys, change);
    if (record?.kind !== 'file' || record.path !== PROFILE_FILES.answers) return null;
    const none = { version: change.version, id: '', value: {} };
    if (!record.file) return none;
    const contents = await fileContents(this.deps.client, this.deps.keys, record.file);
    return contents && { ...none, id: record.file.id, value: answersIn(decoded(contents)) };
  }

  /**
   * Profile's answers as a form was filled from them, by the version a fill through sync said, or
   * null when that version's gone from sync. `now` is Profile now.
   */
  private async profileThen(
    since: string | undefined,
    now: Profile,
  ): Promise<Record<string, unknown> | null> {
    if (since === undefined) return null;
    if (since === now.id) return now.value;
    if (since === '') return {};
    const { client, keys } = this.deps;
    const locked = await client.getFile(since);
    const contents = locked && (await openFile(keys, since, locked));
    return contents ? answersIn(decoded(contents)) : null;
  }

  /**
   * New answers to keep in Profile, each one you chose to save, as the app keeps them: in
   * about-me/answers.json, through sync. Never your street, postal code or equal-opportunity
   * answers, which Profile keeps on the computer Factwright's on alone. Where Factwright gave one
   * another answer since the form was filled, as `since` says, its answer stays, and the new ones
   * are kept in a copy of the file beside it, as sync keeps both copies of a file two devices
   * changed. Anything else Factwright changed in Profile meanwhile stays too.
   */
  private async remember(ask: Extract<InboxAsk, { ask: 'remember' }>): Promise<SyncAnswer> {
    const answers = ask.answers.flatMap(({ kind, text }) => {
      const value = text.trim();
      return isSyncedAnswer(kind) && value && value.length <= keptLength(kind)
        ? [{ kind, text: value }]
        : [];
    });
    if (answers.length === 0) return { ok: true, did: 'remember', saved: 0 };
    const { client, keys } = this.deps;
    const record = await recordId(keys, fileName(PROFILE_FILES.answers));
    const [latest] = await client.versions(record);
    const change = latest ? await client.version(record, latest.version) : null;
    let now: Profile | null = latest
      ? change && (await this.profileIn(change))
      : { version: 0, id: '', value: {} };
    const then = now && (await this.profileThen(ask.since, now));
    let clash: typeof answers = [];
    for (let attempt = 0; attempt < TRIES && now; attempt++) {
      const { value } = now;
      if (!value) return failed(UNREAD);
      // Gone from sync since the form was filled from it, as after a restore from an older
      // backup: nothing goes up in its place with less in it than Factwright keeps.
      if (!now.id && ask.since) return failed(GONE);
      // An answer Factwright gave it since the form was filled, unlike yours, stays.
      clash = answers.filter(({ kind, text }) => {
        const there = profileAnswer(value, kind);
        return (
          there !== '' && there !== text && (then === null || profileAnswer(then, kind) !== there)
        );
      });
      // Only what changes Profile goes up: one it has already needs nothing.
      const going = answers.filter(
        (each) => !clash.includes(each) && profileAnswer(value, each.kind) !== each.text,
      );
      if (going.length === 0) break;
      const file = await this.upload(answersJson(withProfileAnswers(value, going)));
      const [result] = (
        await client.push([await this.fileChange(record, PROFILE_FILES.answers, file, now.version)])
      ).results;
      if (result?.ok) break;
      if (result?.reason === 'full') throw new SyncError('full', 'full');
      if (result?.reason !== 'conflict') throw new Error('Sync turned the change away.');
      // Changed meanwhile: made again on the newer version, or as new on a restored server.
      now = result.current ? await this.profileIn(result.current) : { ...now, version: 0, id: '' };
      if (attempt === TRIES - 1) throw new Error('Profile kept changing in sync. Try again.');
    }
    if (!now) return failed('Factwright couldn’t read Profile through sync. Try again.');
    const saved = answers.length - clash.length;
    if (clash.length === 0) return { ok: true, did: 'remember', saved };
    const copy = await this.copyPath(PROFILE_FILES.answers);
    await this.keepFile(copy, answersJson(withProfileAnswers(then ?? now.value ?? {}, answers)));
    return { ok: true, did: 'remember', saved, copy };
  }

  /**
   * Where this browser keeps its copy of a file Factwright changed meanwhile, as sync names one:
   * such as "about-me/answers (Factwright in Chrome, Oct 24).json", which no file sync holds has.
   */
  private async copyPath(path: string): Promise<string> {
    const { synced } = await this.latest();
    return conflictCopyPath(path, this.deps.device, this.now(), (candidate) =>
      isSyncPath(candidate) ? !synced.files.has(candidate) : null,
    );
  }

  /** What went wrong, in words, by what the sync client says. */
  private async problem(error: unknown): Promise<NotAsked> {
    if (!(error instanceof SyncError)) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    if (error.kind === 'signed-out') {
      this.forget();
      await this.deps.signedOut?.();
      return failed('The extension was signed out. Set it up again to fill from your job hunt.');
    }
    if (error.kind === 'offline') return failed(`Couldn’t reach ${this.deps.server}. Try again.`);
    if (error.kind === 'slow-down') return failed('Sync is busy. Try again in a minute.');
    if (error.kind === 'full') return failed('Your sync account is full.');
    if (error.kind === 'subscription-needed') {
      return failed(
        'Sync is paused, so nothing was saved. Subscribe in Factwright on your computer, then try again.',
      );
    }
    return failed(error.message);
  }

  /** Answers one ask, as Factwright on your computer would, from what sync holds. */
  async ask(ask: InboxAsk): Promise<SyncAnswer> {
    if (this.deps.signedIn && !(await this.deps.signedIn())) {
      this.forget();
      return failed('The extension was signed out. Set it up again to fill from your job hunt.');
    }
    try {
      if (ask.ask === 'fill') return await this.fill(ask);
      if (ask.ask === 'file') return await this.file(ask);
      if (ask.ask === 'draft') return await this.leave(ask);
      if (ask.ask === 'sent') return await this.sent(ask);
      if (ask.ask === 'remember') return await this.remember(ask);
      // Your Claude drafting at once needs Factwright on your computer.
      return failed('That needs Factwright on your computer.');
    } catch (error) {
      return this.problem(error);
    }
  }
}
