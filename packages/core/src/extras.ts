import { ASK_ID } from './answers.ts';
import type { WorkspaceEntry, WorkspaceReader } from './records.ts';

/**
 * Where the app keeps what the user adds for a job, by the job's ID, apart from the job's own
 * folder, so adding something never makes one: Claude's answers to the user's questions about
 * the job, the user's screenshots, and the posting they saved from their browser.
 */
export const JOB_EXTRAS = {
  /** Claude's answer to each question: asked/<job ID>/<question ID>.md. */
  asked: 'asked',
  /** Screenshots: screenshots/<job ID>/<name>, or screenshots/<name> for one with no job. */
  screenshots: 'screenshots',
  /** The posting as the user saw it, saved with Save to Factwright: saved/<job ID>/posting.md. */
  saved: 'saved',
} as const;

/** Where the posting the user saved from their browser is kept. */
export const savedPostingFile = (jobId: string) => `${JOB_EXTRAS.saved}/${jobId}/posting.md`;

/** A posting the user saved from their browser, as save_posting keeps one in a job's folder. */
export interface SavedPosting {
  path: string;
  /** The page it was saved from. */
  source: string | null;
  /** When, as YYYY-MM-DD. */
  saved: string | null;
  /** The posting, without the lines on top. */
  text: string;
}

/**
 * A posting saved from the browser, as Markdown: the same lines on top as save_posting writes in
 * a job's folder, so whatever reads a posting reads this one too.
 */
export function savedPostingMarkdown(posting: {
  url: string;
  site: string;
  savedOn: string;
  text: string;
}): string {
  return [
    '# Job posting',
    '',
    `- **Source:** ${posting.url}`,
    `- **Saved:** ${posting.savedOn} from ${posting.site} in the user's browser, as the page showed it`,
    '',
    '---',
    '',
    posting.text.trim(),
    '',
  ].join('\n');
}

/** A saved posting's link, date and text, from its Markdown. */
export function readSavedPosting(path: string, markdown: string): SavedPosting {
  const field = (name: string) =>
    markdown.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null;
  const rule = markdown.search(/^---\s*$/m);
  const text = (rule >= 0 ? markdown.slice(rule).replace(/^---\s*/, '') : markdown).trim();
  return {
    path,
    source: field('Source'),
    saved: field('Saved')?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
    text,
  };
}

/** Where Claude's answer to one of the user's questions about a job is kept. */
export const askedFile = (jobId: string, askId: string) =>
  `${JOB_EXTRAS.asked}/${jobId}/${askId}.md`;

/** Where a job's screenshots are kept. */
export const shotsFolder = (jobId: string) => `${JOB_EXTRAS.screenshots}/${jobId}`;

/**
 * Claude's answer to one of the user's questions, as the app shows it under the question:
 * without the question and dates save_answer puts on top, and when it was answered.
 */
export function askAnswer(text: string): { body: string; answeredOn: string | null } {
  const lines = text.split(/\r?\n/);
  let at = 0;
  if (lines[at]?.startsWith('# ')) at++;
  while (lines[at]?.trim() === '') at++;
  const dated = lines[at]?.match(/^Asked \d{4}-\d{2}-\d{2}\. Answered (\d{4}-\d{2}-\d{2})\.$/);
  if (dated) at++;
  return { body: lines.slice(at).join('\n').trim(), answeredOn: dated?.[1] ?? null };
}

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

/**
 * What the user added for a job: Claude's answers to their questions, their screenshots, and the
 * posting they saved from their browser.
 */
export function readJobExtras(
  workspace: WorkspaceReader,
  jobId: string,
): { asked: Record<string, string>; shots: JobShot[]; posting: SavedPosting | null } {
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
  const saved = workspace.readText(savedPostingFile(jobId));
  const posting = saved ? readSavedPosting(savedPostingFile(jobId), saved) : null;
  return { asked, shots, posting: posting?.text ? posting : null };
}
