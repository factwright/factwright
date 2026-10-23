import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResumeOnFile } from '@factwright/core';
import { type Resume, readResume } from '@factwright/engine';
import type { Contact } from '../../shared/about.ts';

/**
 * What the resumes Factwright made for you say of you, for what Profile leaves blank: a job's own
 * resume, or else your newest, from a job's folder or your base resumes. Profile itself changes
 * only when you choose to fill it in from them.
 */

/** A resume.json, or null when it isn't there or doesn't hold up. */
async function readOne(path: string): Promise<Resume | null> {
  try {
    const read = readResume(JSON.parse(await readFile(path, 'utf8')));
    return read.ok && read.resume.name.trim() ? read.resume : null;
  } catch {
    return null;
  }
}

/** Every resume Factwright made in a workspace, as paths: the jobs' own, and the base ones. */
async function resumePaths(workspace: string): Promise<string[]> {
  const listed = async (folder: string) => {
    try {
      return await readdir(folder, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const jobs = (await listed(join(workspace, 'applications')))
    .filter((each) => each.isDirectory())
    .map((each) => join(workspace, 'applications', each.name, 'resume.json'));
  const bases = (await listed(join(workspace, 'base')))
    .filter((each) => each.isFile() && each.name.endsWith('.json'))
    .map((each) => join(workspace, 'base', each.name));
  return [...jobs, ...bases];
}

/** The resume Factwright made for you most lately, or null before it's made any. */
export async function newestResume(workspace: string): Promise<Resume | null> {
  const dated = await Promise.all(
    (await resumePaths(workspace)).map(async (path) => {
      try {
        return { path, at: (await stat(path)).mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const newestFirst = dated
    .filter((each): each is { path: string; at: number } => each !== null)
    .sort((a, b) => b.at - a.at);
  for (const { path } of newestFirst) {
    const resume = await readOne(path);
    if (resume) return resume;
  }
  return null;
}

/** A job's own resume.json, or null when it has none yet, or one that doesn't hold up. */
export const jobResume = (workspace: string, folder: string) =>
  readOne(join(workspace, 'applications', folder, 'resume.json'));

/** What a resume says of you, as the form filler takes it. */
export function resumeDetails(resume: Resume, from: ResumeOnFile['from']): ResumeOnFile {
  const contact = resume.contact ?? {};
  const now = resume.experience.find((each) =>
    /^(present|current|now|today)$/i.test(each.end.trim()),
  );
  return {
    from,
    name: resume.name.trim(),
    email: contact.email?.trim() ?? '',
    phone: contact.phone?.trim() ?? '',
    location: contact.location?.trim() ?? '',
    linkedin: contact.linkedin?.trim() ?? '',
    website: contact.website?.trim() ?? '',
    company: now?.company ?? '',
    title: now?.title ?? '',
    since: now?.start ?? '',
    positions: resume.experience.map((each) => ({
      company: each.company,
      title: each.title,
      location: each.location ?? '',
      start: each.start,
      end: each.end,
    })),
    education: (resume.education ?? []).map((each) => ({
      school: each.school,
      degree: each.degree,
      start: each.start ?? '',
      end: each.end ?? '',
    })),
    skills: resume.skills ?? [],
    sections: resume.extra_sections ?? [],
    summary: resume.summary,
  };
}

/**
 * What a form asks of you that the resumes say: the job's own resume when it has one, or else
 * your newest, or null when Factwright hasn't made one yet.
 */
export async function resumeOnFile(
  workspace: string,
  folder: string | null,
): Promise<ResumeOnFile | null> {
  const own = folder ? await jobResume(workspace, folder) : null;
  if (own) return resumeDetails(own, 'job');
  const newest = await newestResume(workspace);
  return newest ? resumeDetails(newest, 'newest') : null;
}

/** Your contact details as your newest resume shows them, to fill Profile's blanks with. */
export async function contactFromResume(workspace: string): Promise<Contact | null> {
  const newest = await newestResume(workspace);
  if (!newest) return null;
  const details = resumeDetails(newest, 'newest');
  return {
    name: details.name,
    email: details.email,
    phone: details.phone,
    location: details.location,
    linkedin: details.linkedin,
    website: details.website,
  };
}
