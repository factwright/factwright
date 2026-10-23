import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { JOB_DOCS, type Job, type JobFile, resumeSent, WORKSPACE_PATHS } from '@factwright/core';
import type { EditResult } from '../../shared/api.ts';
import {
  type ChangeKind,
  type ChangesRequest,
  DOC_KINDS,
  type DocKind,
  type DocVersion,
  MAX_CHANGES,
  VERSION_WHYS,
  type VersionWhy,
} from '../../shared/versions.ts';
import { PREVIOUS_FOLDER, STAMP, stampOf } from './revisions.ts';

/** What the app writes beside an earlier version: when and why it was put aside. */
const VERSION_FILE = 'version.json';

/** What the X-ray's revisions write beside the resume they put aside. */
const REVISION_FILE = 'revision.json';

/** The most of a version's notes the app reads. */
const MAX_NOTE_BYTES = 20_000;

/** Each kind's files in a job, and the data in its folder they're built from. */
const KINDS: Readonly<Record<DocKind, { files: (job: Job) => JobFile[]; data: string }>> = {
  resume: { files: (job) => job.files, data: 'resume.json' },
  letter: { files: (job) => job.letters, data: JOB_DOCS.letter },
  projects: { files: (job) => job.projectPages, data: JOB_DOCS.projects },
};

/** A request for changes held for the run that makes them, with where it's for. */
export interface BoundChanges extends ChangesRequest {
  /** When it was asked, as an ISO time. */
  at: string;
  /** The job's folder under applications/. */
  folder: string;
  /** Where the version before the changes is kept, in the workspace. */
  previous: string | null;
}

export interface VersionsDeps {
  workspace: string;
  /** The jobs on file, to find each job's folder and its files. */
  jobs: () => readonly Job[];
  /** Moves an earlier version's folder to the Trash. */
  trash: (path: string) => Promise<void>;
  now?: () => Date;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Whether two sets of files are the same files: the same names, sizes and times, to the second. */
function sameFiles(a: readonly JobFile[], b: readonly JobFile[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const second = (time: string) => Math.floor(Date.parse(time) / 1000);
  return a.every((file) =>
    b.some(
      (other) =>
        other.name === file.name &&
        other.size === file.size &&
        second(other.modified) === second(file.modified),
    ),
  );
}

/** A version's notes as the app or a revision wrote them, if they're in a shape it takes. */
function readNotes(
  text: string | null,
  revised: boolean,
): { kind: DocKind; at: string; why: VersionWhy; changes: string | null } | null {
  if (text === null || text.length > MAX_NOTE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, kind, why, changes } = value as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  // A revision's notes are the X-ray's, which only revise resumes.
  if (revised) return { kind: 'resume', at, why: 'revision', changes: null };
  if (!(DOC_KINDS as readonly unknown[]).includes(kind)) return null;
  if (!(VERSION_WHYS as readonly unknown[]).includes(why)) return null;
  const asked = typeof changes === 'string' && changes.length <= MAX_CHANGES ? changes : null;
  return { kind: kind as DocKind, at, why: why as VersionWhy, changes: asked };
}

/**
 * The versions of what a job's folder holds for the user to send. Before a run makes a new one,
 * or changes one, the app keeps the current version in a folder of its own under previous/: its
 * files, as they were, and the data they were built from, so it can be the job's again. One the
 * user applied with stays as sent.
 */
export class Versions {
  private readonly deps: VersionsDeps;
  /** Requests for changes waiting for their run, by job and kind: one each. */
  private readonly held = new Map<string, BoundChanges>();

  constructor(deps: VersionsDeps) {
    this.deps = deps;
  }

  private path(relative: string): string {
    return join(this.deps.workspace, ...relative.split('/'));
  }

  private job(jobId: string): Job | undefined {
    return this.deps.jobs().find((each) => each.id === jobId);
  }

  /** Why a job's document can't be changed now, or null: one the user applied with stays as sent. */
  private lockOf(job: Job, kind: DocKind): string | null {
    if (kind === 'projects' || !resumeSent(job)) return null;
    return kind === 'resume'
      ? 'You applied with this resume, so it stays as you sent it.'
      : 'You applied with this cover letter, so it stays as you sent it.';
  }

  /** A new folder for an earlier version, of its own even when another was kept that second. */
  private async freeFolder(under: string, stamp: string): Promise<string> {
    await mkdir(this.path(under), { recursive: true });
    for (let n = 1; n < 100; n++) {
      const folder = `${under}/${n === 1 ? stamp : `${stamp}-${n}`}`;
      try {
        await mkdir(this.path(folder));
        return folder;
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('No free folder for the earlier version.');
  }

  /** Every earlier version kept in a job's folder, as the folders hold them. */
  private async read(job: Job): Promise<DocVersion[]> {
    if (!job.folder) return [];
    const where = `${WORKSPACE_PATHS.jobs}/${job.folder}/${PREVIOUS_FOLDER}`;
    const names = await readdir(this.path(where)).catch(() => [] as string[]);
    const versions: DocVersion[] = [];
    for (const name of names.filter((each) => STAMP.test(each))) {
      const folder = `${where}/${name}`;
      const note = (file: string) =>
        readFile(this.path(`${folder}/${file}`), 'utf8').catch(() => null);
      const kept =
        readNotes(await note(VERSION_FILE), false) ?? readNotes(await note(REVISION_FILE), true);
      if (!kept) continue;
      const entries = await readdir(this.path(folder)).catch(() => [] as string[]);
      const files: JobFile[] = [];
      for (const entry of entries.sort()) {
        const format = entry.match(/\.(pdf|docx)$/i)?.[1]?.toLowerCase();
        if (format !== 'pdf' && format !== 'docx') continue;
        const stats = await stat(this.path(`${folder}/${entry}`)).catch(() => null);
        if (!stats?.isFile()) continue;
        const { size, mtime } = stats;
        files.push({
          path: `${folder}/${entry}`,
          name: entry,
          format,
          size,
          modified: mtime.toISOString(),
        });
      }
      if (files.length === 0) continue;
      const usable = await exists(this.path(`${folder}/${KINDS[kept.kind].data}`));
      versions.push({ folder, ...kept, files, usable });
    }
    return versions;
  }

  /**
   * A job's earlier versions, newest first, by when each was built. One kept for a run that
   * hasn't made its new version yet is the same as the job's, so it doesn't show.
   */
  async list(jobId: string): Promise<DocVersion[]> {
    const job = this.job(jobId);
    if (!job) return [];
    const built = (version: DocVersion) =>
      Math.max(...version.files.map((file) => Date.parse(file.modified)));
    return (await this.read(job))
      .filter((version) => !sameFiles(version.files, KINDS[version.kind].files(job)))
      .sort((a, b) => built(b) - built(a) || Date.parse(b.at) - Date.parse(a.at));
  }

  /**
   * Keeps the current version of a job's resume, cover letter or Projects page, before a run
   * makes a new one or changes it. Asked again before a run made a new one, it keeps the same
   * version once. Nothing to keep for one that isn't there yet.
   */
  async keep(
    jobId: string,
    kind: DocKind,
    why: 'new' | 'changes',
    changes?: string,
  ): Promise<{ ok: true; folder: string | null } | { ok: false; message: string }> {
    const job = this.job(jobId);
    if (!job?.folder) return { ok: false, message: 'That job isn’t on file anymore.' };
    const locked = this.lockOf(job, kind);
    if (locked) return { ok: false, message: locked };
    const where = `${WORKSPACE_PATHS.jobs}/${job.folder}`;
    const { data } = KINDS[kind];
    const files = KINDS[kind].files(job);
    const hasData = await exists(this.path(`${where}/${data}`));
    if (files.length === 0) return { ok: true, folder: null };
    const now = (this.deps.now?.() ?? new Date()).toISOString();
    const notes = `${JSON.stringify({ at: now, kind, why, ...(changes && { changes }) }, null, 2)}\n`;
    const same = (await this.read(job)).find(
      (version) => version.kind === kind && sameFiles(version.files, files),
    );
    if (same) {
      // A revision's folder stays the X-ray's, for its before-and-after.
      if (same.why !== 'revision')
        await writeFile(this.path(`${same.folder}/${VERSION_FILE}`), notes);
      return { ok: true, folder: same.folder };
    }
    let folder: string | null = null;
    try {
      folder = await this.freeFolder(
        `${where}/${PREVIOUS_FOLDER}`,
        stampOf(this.deps.now?.() ?? new Date()),
      );
      for (const file of files) {
        const to = this.path(`${folder}/${file.name}`);
        await copyFile(this.path(file.path), to);
        // As it was built, so it shows when it was made, and tells apart from what replaces it.
        const { atime, mtime } = await stat(this.path(file.path));
        await utimes(to, atime, mtime);
      }
      if (hasData) await copyFile(this.path(`${where}/${data}`), this.path(`${folder}/${data}`));
      await writeFile(this.path(`${folder}/${VERSION_FILE}`), notes);
    } catch {
      if (folder) await rm(this.path(folder), { recursive: true, force: true }).catch(() => {});
      return { ok: false, message: 'Couldn’t keep the current version, so nothing changed.' };
    }
    return { ok: true, folder };
  }

  /**
   * Makes an earlier version the job's again: the current one is put aside as an earlier version,
   * and the one picked takes its place, with its own name and the data it was built from.
   */
  async use(jobId: string, folder: string): Promise<EditResult> {
    const job = this.job(jobId);
    if (!job?.folder) return { ok: false, message: 'That job isn’t on file anymore.' };
    const version = (await this.read(job)).find((each) => each.folder === folder);
    if (!version) return { ok: false, message: 'That version isn’t in the job’s folder anymore.' };
    if (!version.usable) {
      return {
        ok: false,
        message: 'That version was kept without what it was built from, so it can only be opened.',
      };
    }
    const locked = this.lockOf(job, version.kind);
    if (locked) return { ok: false, message: locked };
    const where = `${WORKSPACE_PATHS.jobs}/${job.folder}`;
    const { data } = KINDS[version.kind];
    const current = KINDS[version.kind].files(job);
    const moved: [string, string][] = [];
    const move = async (from: string, to: string) => {
      await rename(this.path(from), this.path(to));
      moved.push([from, to]);
    };
    let aside: string | null = null;
    try {
      if (current.length > 0) {
        aside = await this.freeFolder(
          `${where}/${PREVIOUS_FOLDER}`,
          stampOf(this.deps.now?.() ?? new Date()),
        );
        for (const file of current) await move(file.path, `${aside}/${file.name}`);
        if (await exists(this.path(`${where}/${data}`)))
          await move(`${where}/${data}`, `${aside}/${data}`);
        const at = (this.deps.now?.() ?? new Date()).toISOString();
        await writeFile(
          this.path(`${aside}/${VERSION_FILE}`),
          `${JSON.stringify({ at, kind: version.kind, why: 'swapped' }, null, 2)}\n`,
        );
      }
      for (const file of version.files) await move(file.path, `${where}/${file.name}`);
      await move(`${folder}/${data}`, `${where}/${data}`);
    } catch {
      // Everything goes back where it was, the last move first.
      for (const [from, to] of moved.reverse()) {
        await rename(this.path(to), this.path(from)).catch(() => {});
      }
      if (aside) await rm(this.path(aside), { recursive: true, force: true }).catch(() => {});
      return { ok: false, message: 'Couldn’t switch to that version, so nothing changed.' };
    }
    // What's left of its folder is its notes.
    await rm(this.path(folder), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }

  /** Moves an earlier version to the Trash, with its files and its notes. */
  async remove(jobId: string, folder: string): Promise<EditResult> {
    const job = this.job(jobId);
    if (!job) return { ok: false, message: 'That job isn’t on file anymore.' };
    const version = (await this.read(job)).find((each) => each.folder === folder);
    if (!version) return { ok: false, message: 'That version isn’t in the job’s folder anymore.' };
    try {
      await this.deps.trash(this.path(folder));
    } catch {
      return { ok: false, message: 'Couldn’t move that version to the Trash.' };
    }
    return { ok: true };
  }

  /**
   * Keeps the current version, then holds what the user asked to change for the run the window
   * starts next, which reads it with requested_changes.
   */
  async prepareChanges(
    request: ChangesRequest,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const job = this.job(request.jobId);
    if (!job?.folder) return { ok: false, message: 'That job isn’t on file anymore.' };
    if (KINDS[request.kind].files(job).length === 0) {
      return {
        ok: false,
        message:
          request.kind === 'resume'
            ? 'There’s no resume for this job yet to change.'
            : 'There’s no cover letter for this job yet to change.',
      };
    }
    const kept = await this.keep(request.jobId, request.kind, 'changes', request.changes);
    if (!kept.ok) return kept;
    this.held.set(`${request.jobId}/${request.kind}`, {
      ...request,
      at: (this.deps.now?.() ?? new Date()).toISOString(),
      folder: job.folder,
      previous: kept.folder,
    });
    return { ok: true };
  }

  /** The changes held for a run the window starts, which only that run gets. Null for none. */
  claimChanges(jobId: string, kind: ChangeKind): BoundChanges | null {
    const key = `${jobId}/${kind}`;
    const held = this.held.get(key) ?? null;
    this.held.delete(key);
    return held;
  }

  /** Holds changes again when their run didn't start, so starting it again finds them. */
  releaseChanges(changes: BoundChanges): void {
    const key = `${changes.jobId}/${changes.kind}`;
    if (!this.held.has(key)) this.held.set(key, changes);
  }
}
