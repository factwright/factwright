import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Job, resumeSent, WORKSPACE_PATHS } from '@factwright/core';
import { outputName } from '@factwright/engine';
import {
  FINDING_ID,
  FINDING_KINDS,
  MAX_FINDINGS,
  MAX_SUMMARY,
  MAX_TITLE,
  RESUME_FILE,
  type Revision,
  type RevisionRequest,
  type RevisionState,
  TEMPLATE_CHOICES,
} from '../../shared/revision.ts';

/** Where a job's folder keeps the previous versions of its resume, one folder for each revision. */
export const PREVIOUS_FOLDER = 'previous';

/**
 * A previous version's folder: when it was revised, such as 2026-10-15-093012, with "-2" and so
 * on for another in the same second.
 */
const STAMP = /^\d{4}-\d{2}-\d{2}-\d{6}(?:-[1-9][0-9]?)?$/;

/** The most files a previous version keeps: the resume's PDF and Word file. */
const MAX_KEPT = 4;

/** The most of a job's resume data the app reads, to tell which file it builds. */
const MAX_DATA_BYTES = 2_000_000;

/** A revision held for its run, with the job's folder and where its previous version is kept. */
export interface BoundRevision extends RevisionRequest {
  /** When it was sent, as an ISO time. */
  at: string;
  /** The job's folder under applications/. */
  folder: string;
  /** The previous version's folder, in the workspace. */
  previous: string;
  /** The previous version's resume files there, in the workspace. */
  files: string[];
}

export interface RevisionsDeps {
  workspace: string;
  /** The jobs on file, to find the job's folder and its resume's files. */
  jobs: () => readonly Job[];
  now?: () => Date;
}

/** A resume's file name without its format, which its PDF and Word file share. */
const stemOf = (name: string) => name.replace(/\.(?:pdf|docx)$/i, '');

/** A time as a previous version's folder: 2026-10-15-093012, in the computer's own time. */
function stampOf(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/** An ISO time exactly as the app writes one, such as 2026-10-15T14:30:12.000Z. */
const isTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;

/**
 * A revision as revision.json keeps it, if it's in the shape the app writes. It's in the user's
 * workspace, which sync and Claude's runs can change, so anything else is null.
 */
function readRevision(value: unknown, previous: string): Revision | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, resume, findings, template, before, files } = value as Record<string, unknown>;
  if (!isTime(at)) return null;
  if (typeof resume !== 'string' || !RESUME_FILE.test(resume)) return null;
  if (typeof before !== 'string' || before.length > MAX_SUMMARY) return null;
  if (template !== undefined && !(TEMPLATE_CHOICES as readonly unknown[]).includes(template)) {
    return null;
  }
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) return null;
  if (!Array.isArray(files) || files.length > MAX_KEPT) return null;
  const picked = findings.flatMap((finding: unknown) => {
    if (typeof finding !== 'object' || finding === null) return [];
    const { id, kind, title } = finding as Record<string, unknown>;
    const valid =
      typeof id === 'string' &&
      FINDING_ID.test(id) &&
      (FINDING_KINDS as readonly unknown[]).includes(kind) &&
      typeof title === 'string' &&
      title.length <= MAX_TITLE;
    return valid ? [{ id, kind, title } as Revision['findings'][number]] : [];
  });
  // Only the previous version's own files, in its own folder.
  const kept = files.filter(
    (file): file is string =>
      typeof file === 'string' &&
      file.startsWith(`${previous}/`) &&
      RESUME_FILE.test(file.slice(previous.length + 1)),
  );
  return {
    at,
    resume,
    findings: picked,
    ...(template !== undefined && { template: template as Revision['template'] }),
    before,
    previous,
    files: kept,
  };
}

/** The error a file system call gave, by its code, such as EEXIST. */
const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;

/**
 * The revisions of jobs' resumes. Before a revision starts, the app keeps the resume's previous
 * version in the job's folder: its files and the data they're built from. It holds the revision
 * for the run the window starts next, which reads its findings with revision_findings, and once
 * that run starts, it writes what the user picked and the X-ray's summary before beside the
 * previous version, for the before-and-after.
 */
export class Revisions {
  private readonly deps: RevisionsDeps;
  /** Revisions kept and waiting for their run, by job: at most one each. */
  private readonly held = new Map<string, BoundRevision>();

  constructor(deps: RevisionsDeps) {
    this.deps = deps;
  }

  private path(relative: string): string {
    return join(this.deps.workspace, ...relative.split('/'));
  }

  /**
   * Why a job's resume can't be revised, or null when it can: it went out with an application,
   * or the job's resume data doesn't build it, so there's nothing to revise it from.
   */
  private async lockOf(job: Job | undefined, resume: string): Promise<string | null> {
    if (!job?.folder) return 'That job isn’t on file anymore.';
    if (!RESUME_FILE.test(resume) || !job.files.some((file) => file.name === resume)) {
      return 'That resume isn’t in the job’s folder anymore.';
    }
    if (resumeSent(job)) return 'You applied with this resume, so it stays as you sent it.';
    const data = this.path(`${WORKSPACE_PATHS.jobs}/${job.folder}/resume.json`);
    const built =
      'This resume wasn’t built from the job’s resume data, so it can’t be revised in place. Build a tailored resume, then X-ray that one.';
    let parsed: unknown;
    try {
      const text = await readFile(data, 'utf8');
      if (text.length > MAX_DATA_BYTES) return built;
      parsed = JSON.parse(text);
    } catch {
      return built;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return built;
    const { name, output_name } = parsed as Record<string, unknown>;
    // Without its own name, the revision gives it this file's.
    if (typeof output_name !== 'string' || !output_name.trim()) return null;
    const builds = outputName(
      { name: typeof name === 'string' ? name : '', output_name },
      new Date(),
    );
    return builds === stemOf(resume)
      ? null
      : `The job’s resume data builds ${builds} now, not this file. X-ray that one to revise it.`;
  }

  /** Where a job's resume stands for its X-ray: its last revision, and whether it can have one. */
  async state(jobId: string, resume: string): Promise<RevisionState> {
    const job = this.deps.jobs().find((each) => each.id === jobId);
    const [last, locked] = await Promise.all([
      this.latest(jobId, resume),
      this.lockOf(job, resume),
    ]);
    return { last, locked };
  }

  /** A new folder for a previous version, of its own even when another was kept that second. */
  private async newFolder(under: string, stamp: string): Promise<string> {
    await mkdir(this.path(under), { recursive: true });
    for (let n = 1; n < 100; n++) {
      const folder = `${under}/${n === 1 ? stamp : `${stamp}-${n}`}`;
      try {
        await mkdir(this.path(folder));
        return folder;
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error;
      }
    }
    throw new Error('No free folder for the previous version.');
  }

  /** Keeps the resume's previous version, and holds the revision for its run. */
  async prepare(request: RevisionRequest): Promise<{ ok: true } | { ok: false; message: string }> {
    const job = this.deps.jobs().find((each) => each.id === request.jobId);
    const locked = await this.lockOf(job, request.resume);
    if (locked || !job?.folder)
      return { ok: false, message: locked ?? 'That job isn’t on file anymore.' };
    // A revision kept for a run that never started is replaced, with its copies.
    const waiting = this.held.get(job.id);
    if (waiting) {
      this.held.delete(job.id);
      await rm(this.path(waiting.previous), { recursive: true, force: true }).catch(() => {});
    }
    const now = this.deps.now?.() ?? new Date();
    const folder = `${WORKSPACE_PATHS.jobs}/${job.folder}`;
    const stem = stemOf(request.resume);
    const names = job.files.filter((file) => stemOf(file.name) === stem).map((file) => file.name);
    let previous: string | null = null;
    try {
      previous = await this.newFolder(`${folder}/${PREVIOUS_FOLDER}`, stampOf(now));
      for (const name of names) {
        await copyFile(this.path(`${folder}/${name}`), this.path(`${previous}/${name}`));
      }
      await copyFile(this.path(`${folder}/resume.json`), this.path(`${previous}/resume.json`));
    } catch {
      if (previous) await rm(this.path(previous), { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        message: 'Couldn’t keep the resume’s previous version, so nothing changed.',
      };
    }
    const kept = previous;
    this.held.set(job.id, {
      ...request,
      at: now.toISOString(),
      folder: job.folder,
      previous: kept,
      files: names.map((name) => `${kept}/${name}`),
    });
    return { ok: true };
  }

  /**
   * The revision held for a run the window starts, when the run is for exactly it, which only
   * that run gets: it's no longer held. Null for any other.
   */
  claim(task: {
    jobId: string;
    resume: string;
    findings: readonly string[];
    template?: string;
  }): BoundRevision | null {
    const held = this.held.get(task.jobId);
    if (!held || held.resume !== task.resume || held.template !== task.template) return null;
    const ids = held.findings.map((finding) => finding.id);
    const same =
      ids.length === task.findings.length && ids.every((id, at) => id === task.findings[at]);
    if (!same) return null;
    this.held.delete(task.jobId);
    return held;
  }

  /** Holds a revision again when its run didn't start, so starting it again finds it. */
  release(revision: BoundRevision): void {
    if (!this.held.has(revision.jobId)) this.held.set(revision.jobId, revision);
  }

  /** Writes what was picked beside the previous version, once the revision's run has started. */
  async record(revision: BoundRevision): Promise<void> {
    const kept: Revision = {
      at: revision.at,
      resume: revision.resume,
      findings: revision.findings.map(({ id, kind, title }) => ({ id, kind, title })),
      ...(revision.template && { template: revision.template }),
      before: revision.before,
      previous: revision.previous,
      files: revision.files,
    };
    await writeFile(
      this.path(`${revision.previous}/revision.json`),
      `${JSON.stringify(kept, null, 2)}\n`,
    );
  }

  /** The newest revision of a job's resume, by its name without its format, or null. */
  async latest(jobId: string, resume: string): Promise<Revision | null> {
    const job = this.deps.jobs().find((each) => each.id === jobId);
    if (!job?.folder || !RESUME_FILE.test(resume)) return null;
    const where = `${WORKSPACE_PATHS.jobs}/${job.folder}/${PREVIOUS_FOLDER}`;
    let names: string[];
    try {
      names = await readdir(this.path(where));
    } catch {
      return null;
    }
    let newest: Revision | null = null;
    for (const name of names.filter((each) => STAMP.test(each))) {
      const previous = `${where}/${name}`;
      const text = await readFile(this.path(`${previous}/revision.json`), 'utf8').catch(() => null);
      if (text === null || text.length > MAX_DATA_BYTES) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const revision = readRevision(parsed, previous);
      if (!revision || stemOf(revision.resume) !== stemOf(resume)) continue;
      // By when it was sent, not the folder's name, which is in the computer's own time.
      if (!newest || Date.parse(revision.at) > Date.parse(newest.at)) newest = revision;
    }
    return newest;
  }
}
