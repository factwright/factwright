import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  answerForm,
  applicationAnswers,
  askedJob,
  blocksOnFile,
  FILE_LIMIT,
  FILE_PART_BYTES,
  formJob,
  type InboxAsk,
  type InboxAskAnswer,
  isEqualOpportunity,
  isRemembered,
  type Job,
  type JobFile,
  jobPdfs,
  type KeptPrivate,
  letterPlainText,
  localDate,
  type OfferedFile,
  type OnFile,
  onFileJob,
  readEqualOpportunity,
  readLetterText,
  readSuggestedAnswers,
  type SavedForm,
  SENT_STATUSES,
  sentAnswersOf,
  sentBefore,
  uploadName,
  type WorkHistory,
} from '@factwright/core';
import type { AboutYou, AnswerChanges } from '../../shared/about.ts';
import type { EditResult, JobChanges, RecordedAnswers } from '../../shared/api.ts';
import type { RunRequestAnswer } from '../../shared/runs.ts';
import { resumeOnFile } from '../about/from-resume.ts';

/**
 * What Factwright answers the extension with as it fills an application form on this
 * computer: the job a form is for, with an answer for each of its fields from what's on file, the
 * job's resume and cover letter in parts to upload, what you sent once you've applied, and new
 * answers you chose to keep in Profile. The helper passes each ask on only while the app is open,
 * and the app checks each one before it gets here (@factwright/core's readInboxAsk).
 */

export interface FillDeps {
  jobs: {
    list(): { jobs: Job[] };
    job(jobId: string): Job | null;
    docs(jobId: string): { answers?: string; letter?: string } | null;
    /** Keeps what was sent for each of a job's questions at once, as one change. */
    recordAnswers(
      jobId: string,
      answers: readonly { question: string; nth: number; text: string }[],
    ): RecordedAnswers;
    updateJob(jobId: string, changes: JobChanges): EditResult;
    /** Keeps the questions of a job's application form with it, for its Claude to draft. */
    keepForm(jobId: string, form: SavedForm): EditResult;
    /** The questions of a job's application form, as kept, or null. */
    savedForm(jobId: string): SavedForm | null;
  };
  about: {
    answers(): AboutYou;
    saveAnswers(changes: AnswerChanges): AboutYou;
    /** Profile's work history and education. */
    history(): WorkHistory;
  };
  kept: { read(): KeptPrivate; save(changes: Partial<KeptPrivate>): KeptPrivate };
  /** The open profile's workspace, where the jobs' folders are. */
  workspace: string;
  /**
   * Your Claude, drafting a job's form's questions in the window: starting it there, as its Run
   * buttons do, and how it's going.
   */
  drafts: {
    start(jobId: string): Promise<RunRequestAnswer | 'closed'>;
    state(jobId: string): { drafting: boolean; waiting: boolean };
  };
  now?: () => Date;
}

const failed = (message: string): InboxAskAnswer => ({ ok: false, reason: 'failed', message });
const notFound = (message: string): InboxAskAnswer => ({ ok: false, reason: 'not-found', message });

/** Whether a path is inside a folder, and not the folder itself. */
function isInside(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside !== '' && !isAbsolute(inside) && !inside.split(/[\\/]/).includes('..');
}

/** A file's version: of where it is in the workspace, its size and when it last changed. */
const versionOf = (file: JobFile, stats: { size: number; mtimeMs: number }) =>
  createHash('sha256')
    .update(`${file.path}\n${stats.size}\n${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);

/** A job's file, opened to read, with its size and the version it's offered by. */
interface Opened {
  handle: FileHandle;
  size: number;
  version: string;
}

/**
 * Opens one of a job's files, while it's inside the workspace, where it is once links are
 * followed too, so a link can't lead out of it, with its version, so each part of an upload is of
 * the same file as it was offered.
 */
async function openInside(workspace: string, file: JobFile): Promise<Opened | null> {
  const root = resolve(workspace);
  const path = resolve(root, ...file.path.split('/'));
  if (!isInside(root, path)) return null;
  let handle: FileHandle | null = null;
  try {
    const real = await realpath(path);
    if (!isInside(await realpath(root), real)) return null;
    handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Not a file.');
    return { handle, size: stats.size, version: versionOf(file, stats) };
  } catch {
    await handle?.close();
    return null;
  }
}

/** An offer of one of a job's files: its plain name, its size, its parts and its version. */
async function offer(
  deps: FillDeps,
  job: Job,
  kind: 'resume' | 'cover-letter',
  you: string,
): Promise<OfferedFile | null> {
  const [file] = jobPdfs(job, kind);
  const opened = file ? await openInside(deps.workspace, file) : null;
  if (!file || !opened) return null;
  await opened.handle.close();
  const { size, version } = opened;
  if (size === 0 || size > FILE_LIMIT) return null;
  return {
    name: uploadName(you, kind, file),
    size,
    parts: Math.ceil(size / FILE_PART_BYTES),
    version,
  };
}

/** Answers for a form's fields, with the job it's for and the files there are to upload. */
async function fill(
  ask: Extract<InboxAsk, { ask: 'fill' }>,
  deps: FillDeps,
): Promise<InboxAskAnswer> {
  const { jobs } = deps.jobs.list();
  const job = formJob(jobs, ask.url, ask.company, ask.role);
  const about = deps.about.answers();
  const docs = job ? deps.jobs.docs(job.id) : null;
  const letter = readLetterText(docs?.letter);
  // Your name for the upload's name, from Profile or else the resume.
  const resume = await resumeOnFile(deps.workspace, job?.folder ?? null);
  const you = about.you.name || resume?.name || '';
  const [cv, coverLetter] = job
    ? await Promise.all([offer(deps, job, 'resume', you), offer(deps, job, 'cover-letter', you)])
    : [null, null];
  const onFile: OnFile = {
    you: about.you,
    applications: about.applications,
    kept: deps.kept.read(),
    authorization: about.authorization,
    start: about.start,
    relocate: about.relocate,
    targetPay: about.targetPay,
    resume,
    history: deps.about.history(),
    job: job ? onFileJob(job) : null,
    sent: sentBefore(jobs),
    suggested: readSuggestedAnswers(docs?.answers),
    files: { resume: cv?.name ?? null, coverLetter: coverLetter?.name ?? null },
    letterText: letter ? letterPlainText(letter) : null,
    today: localDate(deps.now?.() ?? new Date()),
  };
  return {
    ok: true,
    did: 'fill',
    job: job ? askedJob(job) : null,
    replies: answerForm(ask.fields, onFile),
    files: { resume: cv, 'cover-letter': coverLetter },
    blocks: blocksOnFile(onFile),
  };
}

/**
 * A part of a job's resume or cover letter, as base64, for the extension to upload: of the file
 * it was offered, by its version, or none, once that file has changed or gone.
 */
async function filePart(
  ask: Extract<InboxAsk, { ask: 'file' }>,
  deps: FillDeps,
): Promise<InboxAskAnswer> {
  const job = deps.jobs.job(ask.job);
  if (!job) return notFound('That job isn’t in Factwright anymore.');
  for (const file of jobPdfs(job, ask.file)) {
    const opened = await openInside(deps.workspace, file);
    if (!opened) continue;
    const { handle, size, version } = opened;
    try {
      if (version !== ask.version) continue;
      if (size === 0 || size > FILE_LIMIT) return failed('That file is too big to upload.');
      const parts = Math.ceil(size / FILE_PART_BYTES);
      if (ask.part >= parts) return notFound('That file has no such part.');
      const at = ask.part * FILE_PART_BYTES;
      const part = Buffer.alloc(Math.min(FILE_PART_BYTES, size - at));
      const { bytesRead } = await handle.read(part, 0, part.length, at);
      if (bytesRead !== part.length) return failed('Factwright couldn’t read that file.');
      // Written to as it was read, it's changed.
      if (versionOf(file, await handle.stat()) !== version) break;
      return { ok: true, did: 'file', part: ask.part, parts, base64: part.toString('base64') };
    } catch {
      return failed('Factwright couldn’t read that file.');
    } finally {
      await handle.close();
    }
  }
  return notFound('That file changed since Factwright offered it. Click Fill again.');
}

/**
 * What you sent, once you've applied: each answer to the form's own questions, recorded as sent
 * for its job, all at once, and the job marked Applied, which keeps its resume and cover letter
 * as they went out. Only the form's own questions, whatever the extension sent: never what
 * Profile answers, an equal-opportunity or personal answer, agreeing to something, or what's
 * never filled.
 */
function sent(ask: Extract<InboxAsk, { ask: 'sent' }>, deps: FillDeps): InboxAskAnswer {
  const job = deps.jobs.job(ask.job);
  if (!job) return notFound('That job isn’t in Factwright anymore.');
  const answers = sentAnswersOf(ask.answers);
  const kept = answers.length > 0 ? deps.jobs.recordAnswers(job.id, answers) : null;
  if (kept && !kept.ok) return failed(kept.message);
  const recorded = kept?.recorded ?? 0;
  const applied = job.status && SENT_STATUSES.includes(job.status);
  if (!applied) {
    const result = deps.jobs.updateJob(job.id, { status: 'applied' });
    if (!result.ok) return failed(result.message);
  }
  const now = deps.jobs.job(job.id) ?? job;
  return { ok: true, did: 'sent', job: askedJob(now), recorded };
}

/**
 * New answers to keep in Profile, each one you chose to save on the panel: your contact details
 * and links, where you live, and the answers forms ask that Profile keeps for applications. Your
 * street, postal code and equal-opportunity answers are kept on this computer alone.
 */
function remember(ask: Extract<InboxAsk, { ask: 'remember' }>, deps: FillDeps): InboxAskAnswer {
  const about = deps.about.answers();
  const you = { ...about.you };
  const applications = { ...about.applications };
  const kept = deps.kept.read();
  const equal = { ...kept.equalOpportunity };
  const privately: Partial<KeptPrivate> = {};
  let start: string | undefined;
  let saved = 0;
  for (const { kind, text } of ask.answers) {
    const value = text.trim();
    if (!value || !isRemembered(kind) || value.length > 200) continue;
    saved += 1;
    if (kind === 'email' || kind === 'phone' || kind === 'linkedin' || kind === 'website') {
      you[kind] = value;
    } else if (kind === 'location') {
      you.location = value;
    } else if (kind === 'preferred-name') {
      applications.preferredName = value;
    } else if (
      kind === 'pronouns' ||
      kind === 'city' ||
      kind === 'region' ||
      kind === 'country' ||
      kind === 'github'
    ) {
      applications[kind] = value;
    } else if (kind === 'how-heard') {
      applications.howHeard = value;
    } else if (kind === 'start-date') {
      start = value;
    } else if (kind === 'street') {
      privately.street = value;
    } else if (kind === 'postal-code') {
      privately.postalCode = value;
    } else if (isEqualOpportunity(kind)) {
      const answer = readEqualOpportunity(kind, value);
      if (answer) (equal as Record<string, string>)[kind] = answer;
      else saved -= 1;
    }
  }
  deps.about.saveAnswers({ you, applications, ...(start !== undefined && { start }) });
  deps.kept.save({ ...privately, equalOpportunity: equal });
  return { ok: true, did: 'remember', saved };
}

/** Why your Claude couldn't start on a form's questions, in words, by what the window said. */
const NOT_STARTED: Record<Exclude<RunRequestAnswer, 'started'> | 'closed', string> = {
  busy: 'Your Claude is busy with something else in Factwright. Try again once it’s done.',
  'not-ready': 'Claude Code isn’t ready in Factwright. Its sidebar says what to do.',
  closed: 'Open Factwright’s window, then try again.',
};

/**
 * Has your Claude draft answers to a form's own questions that nothing on file answers, in
 * Factwright's window, as its Run buttons do. The questions are kept with the job first, with
 * what each asks and how, where the run reads them in job_details. The extension asks how it's
 * going, and fills the drafts in once they're saved.
 */
async function draft(
  ask: Extract<InboxAsk, { ask: 'draft' }>,
  deps: FillDeps,
): Promise<InboxAskAnswer> {
  const job = deps.jobs.job(ask.job);
  if (!job) return notFound('That job isn’t in Factwright anymore.');
  const kept = deps.jobs.keepForm(job.id, {
    url: ask.url,
    read: (deps.now?.() ?? new Date()).toISOString(),
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
  });
  if (!kept.ok) return failed(kept.message);
  const started = await deps.drafts.start(job.id);
  if (started === 'started') return { ok: true, did: 'draft' };
  const message = NOT_STARTED[started];
  return started === 'busy' ? { ok: false, reason: 'busy', message } : failed(message);
}

/**
 * How your Claude's drafts of a job's form's questions are coming along: whether it's still at
 * them, whether it's waiting on you in Factwright, and how many of the form's questions have one.
 */
function drafts(ask: Extract<InboxAsk, { ask: 'drafts' }>, deps: FillDeps): InboxAskAnswer {
  const job = deps.jobs.job(ask.job);
  if (!job) return notFound('That job isn’t in Factwright anymore.');
  const asked = deps.jobs.savedForm(job.id)?.questions.map((each) => each.question) ?? [];
  const suggested = readSuggestedAnswers(deps.jobs.docs(job.id)?.answers);
  // The form's questions come first, each with its draft, if it has one.
  const drafted = applicationAnswers(asked, suggested, [])
    .slice(0, asked.length)
    .filter((each) => each.suggested !== null).length;
  return { ok: true, did: 'drafts', ...deps.drafts.state(job.id), drafted };
}

/** Answers one ask from the extension. Nothing in it can stop the app: a failure says so. */
export async function answerAsk(ask: InboxAsk, deps: FillDeps): Promise<InboxAskAnswer> {
  try {
    if (ask.ask === 'fill') return await fill(ask, deps);
    if (ask.ask === 'file') return await filePart(ask, deps);
    if (ask.ask === 'sent') return sent(ask, deps);
    if (ask.ask === 'draft') return await draft(ask, deps);
    if (ask.ask === 'drafts') return drafts(ask, deps);
    return remember(ask, deps);
  } catch {
    return failed('Factwright couldn’t do that just now. Try again.');
  }
}
