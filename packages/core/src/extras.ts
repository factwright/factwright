import { ASK_ID } from './answers.ts';
import type { WorkspaceEntry, WorkspaceReader } from './records.ts';

/**
 * Where the app keeps what the user adds from a job's panel, by the job's ID, apart from the
 * job's own folder, so adding something never makes one: Claude's answers to the user's
 * questions about the job, and the user's screenshots.
 */
export const JOB_EXTRAS = {
  /** Claude's answer to each question: asked/<job ID>/<question ID>.md. */
  asked: 'asked',
  /** Screenshots: screenshots/<job ID>/<name>, or screenshots/<name> for one with no job. */
  screenshots: 'screenshots',
} as const;

/** Where Claude's answer to one of the user's questions about a job is kept. */
export const askedFile = (jobId: string, askId: string) =>
  `${JOB_EXTRAS.asked}/${jobId}/${askId}.md`;

/** Where a job's screenshots are kept. */
export const shotsFolder = (jobId: string) => `${JOB_EXTRAS.screenshots}/${jobId}`;

/** What a screenshot was added with, from the start of its name. */
export type ShotKind = 'form' | 'ask' | 'pasted' | 'other';

/** A screenshot the user added for a job. */
export interface JobShot {
  /** Where it is in the workspace, such as "screenshots/acme--staff/form-2026-10-12-1.png". */
  path: string;
  name: string;
  kind: ShotKind;
  /** For one added with a question, that question's ID. */
  ask: string | null;
  size: number;
  modified: string;
}

/** The image types a screenshot can be. Claude reads them all. */
export const SHOT_TYPES = /\.(png|jpe?g|webp|gif)$/i;

/** What a screenshot's name says it was added with: "form-…", "ask-<question ID>-…" or "pasted-…". */
function shotOf(name: string): Pick<JobShot, 'kind' | 'ask'> {
  if (name.startsWith('form-')) return { kind: 'form', ask: null };
  if (name.startsWith('pasted-')) return { kind: 'pasted', ask: null };
  const ask = name.match(/^ask-(.+)-\d+\.[a-z]+$/i)?.[1];
  return ask && ASK_ID.test(ask) ? { kind: 'ask', ask } : { kind: 'other', ask: null };
}

const byName = (a: WorkspaceEntry, b: WorkspaceEntry) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** What the user added for a job: Claude's answers to their questions, and their screenshots. */
export function readJobExtras(
  workspace: WorkspaceReader,
  jobId: string,
): { asked: Record<string, string>; shots: JobShot[] } {
  const asked: Record<string, string> = {};
  const folder = `${JOB_EXTRAS.asked}/${jobId}`;
  for (const entry of workspace.list(folder).sort(byName)) {
    const id = entry.name.match(/^(.+)\.md$/)?.[1];
    if (entry.folder || !id || !ASK_ID.test(id)) continue;
    const answer = workspace.readText(`${folder}/${entry.name}`);
    if (answer) asked[id] = answer;
  }
  const shots = workspace
    .list(shotsFolder(jobId))
    .sort(byName)
    .flatMap((entry): JobShot[] => {
      if (entry.folder || !SHOT_TYPES.test(entry.name)) return [];
      const { name, size, modified } = entry;
      return [{ path: `${shotsFolder(jobId)}/${name}`, name, ...shotOf(name), size, modified }];
    });
  return { asked, shots };
}
