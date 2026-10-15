import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Job, WORKSPACE_PATHS } from '@factwright/core';
import {
  FINDING_ID,
  FINDING_KINDS,
  RESUME_FILE,
  type Revision,
  type RevisionRequest,
  TEMPLATE_CHOICES,
} from '../../shared/revision.ts';

/** Where a job's folder keeps the previous versions of its resume, one folder for each revision. */
export const PREVIOUS_FOLDER = 'previous';

/** A previous version's folder: when it was revised, such as 2026-10-15-093012. */
const STAMP = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

/** A revision held for its run, with the job's folder and where its previous version is kept. */
export interface BoundRevision extends RevisionRequest {
  /** The job's folder under applications/. */
  folder: string;
  /** The previous version's folder, in the workspace. */
  previous: string;
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

/** A revision as revision.json keeps it, if it's in that shape: it's in the user's workspace. */
function readRevision(value: unknown, previous: string): Revision | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, resume, findings, template, before, files } = value as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof resume !== 'string' || !RESUME_FILE.test(resume)) return null;
  if (typeof before !== 'string' || before.length > 300) return null;
  if (template !== undefined && !(TEMPLATE_CHOICES as readonly unknown[]).includes(template)) {
    return null;
  }
  if (!Array.isArray(findings) || !Array.isArray(files)) return null;
  const picked = findings.flatMap((finding: unknown) => {
    if (typeof finding !== 'object' || finding === null) return [];
    const { id, kind, title } = finding as Record<string, unknown>;
    const valid =
      typeof id === 'string' &&
      FINDING_ID.test(id) &&
      (FINDING_KINDS as readonly unknown[]).includes(kind) &&
      typeof title === 'string' &&
      title.length <= 300;
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

/**
 * The revisions of jobs' resumes. Before a revision starts, the app keeps the resume's previous
 * version, its files and the data they're built from, in the job's folder, with what the user
 * picked and the X-ray's summary before, for the before-and-after. It holds the revision for the
 * run the window starts next, which reads its findings with revision_findings.
 */
export class Revisions {
  private readonly deps: RevisionsDeps;
  private readonly held = new Map<string, BoundRevision>();

  constructor(deps: RevisionsDeps) {
    this.deps = deps;
  }

  /** Keeps the resume's previous version, and holds the revision for its run. */
  async prepare(request: RevisionRequest): Promise<{ ok: true } | { ok: false; message: string }> {
    const job = this.deps.jobs().find((each) => each.id === request.jobId);
    if (!job?.folder) return { ok: false, message: 'That job isn’t on file anymore.' };
    if (!job.files.some((file) => file.name === request.resume)) {
      return { ok: false, message: 'That resume isn’t in the job’s folder anymore.' };
    }
    const now = this.deps.now?.() ?? new Date();
    const folder = join(this.deps.workspace, WORKSPACE_PATHS.jobs, job.folder);
    const previous = `${WORKSPACE_PATHS.jobs}/${job.folder}/${PREVIOUS_FOLDER}/${stampOf(now)}`;
    const kept = join(this.deps.workspace, ...previous.split('/'));
    const stem = stemOf(request.resume);
    const files = job.files.filter((file) => stemOf(file.name) === stem).map((file) => file.name);
    try {
      await mkdir(kept, { recursive: true });
      for (const file of files) await copyFile(join(folder, file), join(kept, file));
      // The data the files are built from, when the app built them.
      await copyFile(join(folder, 'resume.json'), join(kept, 'resume.json')).catch(() => {});
      const revision: Revision = {
        at: now.toISOString(),
        resume: request.resume,
        findings: request.findings.map(({ id, kind, title }) => ({ id, kind, title })),
        ...(request.template && { template: request.template }),
        before: request.before,
        previous,
        files: files.map((file) => `${previous}/${file}`),
      };
      await writeFile(join(kept, 'revision.json'), `${JSON.stringify(revision, null, 2)}\n`);
    } catch {
      return {
        ok: false,
        message: 'Couldn’t keep the resume’s previous version, so nothing changed.',
      };
    }
    this.held.set(job.id, { ...request, folder: job.folder, previous });
    return { ok: true };
  }

  /** The revision held for a run the window starts, when the run is for exactly it. */
  for(task: {
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
    return same ? held : null;
  }

  /** The newest revision of a job's resume, by its name without its format, or null. */
  async latest(jobId: string, resume: string): Promise<Revision | null> {
    const job = this.deps.jobs().find((each) => each.id === jobId);
    if (!job?.folder || !RESUME_FILE.test(resume)) return null;
    const where = `${WORKSPACE_PATHS.jobs}/${job.folder}/${PREVIOUS_FOLDER}`;
    let names: string[];
    try {
      names = await readdir(join(this.deps.workspace, ...where.split('/')));
    } catch {
      return null;
    }
    for (const name of names
      .filter((each) => STAMP.test(each))
      .sort()
      .reverse()) {
      const previous = `${where}/${name}`;
      const text = await readFile(
        join(this.deps.workspace, ...previous.split('/'), 'revision.json'),
        'utf8',
      ).catch(() => null);
      if (text === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const revision = readRevision(parsed, previous);
      if (revision && stemOf(revision.resume) === stemOf(resume)) return revision;
    }
    return null;
  }
}
