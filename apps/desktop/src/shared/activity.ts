/**
 * One thing Claude does in a run, as Claude Code's hooks tell it: a tool call, by its ID, with a
 * few words of what it's on, such as the file it reads, and whether it's still going.
 */
export interface RunStep {
  id: string;
  /** The tool, as Claude Code names it, such as Read or mcp__factwright__build_resume. */
  tool: string;
  /**
   * What it's on, when that says something: a file's path in the workspace, a page's host, or a
   * web search's words.
   */
  detail: string | null;
  state: 'running' | 'done' | 'failed';
}

/**
 * How a turn of Claude's ended: what Claude said last, such as a question it stopped to ask, or
 * the error that ended it, such as a rate limit, as Claude Code names it, with its message.
 */
export interface TurnEnd {
  said: string | null;
  error: { kind: string; message: string | null } | null;
}

/** What a step is, in the window's words: while it runs, and once it's done. */
export interface StepWords {
  doing: string;
  did: string;
}

const words = (doing: string, did: string): StepWords => ({ doing, did });

/** Factwright's own tools, by name. Those that say nothing worth showing aren't here. */
const TOOLS: Readonly<Record<string, StepWords>> = {
  find_job: words('Checking your list of jobs', 'Checked your list of jobs'),
  search_focus: words('Reading this search’s focus', 'Read this search’s focus'),
  job_details: words('Reading what’s on file for the job', 'Read what’s on file for the job'),
  revision_findings: words('Reading what the ATS X-ray found', 'Read what the ATS X-ray found'),
  read_posting: words('Reading the posting', 'Read the posting'),
  build_resume: words('Building the resume', 'Built the resume'),
  build_cover_letter: words('Building the cover letter', 'Built the cover letter'),
  build_projects_page: words('Building the Projects page', 'Built the Projects page'),
  save_call_prep: words('Saving the prep sheet', 'Saved the prep sheet'),
  save_thank_you: words('Saving the thank-you notes', 'Saved the thank-you notes'),
  list_templates: words('Looking at your templates', 'Looked at your templates'),
  read_template: words('Reading a template', 'Read a template'),
  save_template: words('Saving the template', 'Saved the template'),
  save_posting: words('Saving the posting', 'Saved the posting'),
  job_board: words('Reading a job board', 'Read a job board'),
  hn_jobs: words('Reading Hacker News’s hiring thread', 'Read Hacker News’s hiring thread'),
  about_you: words('Reading about you', 'Read about you'),
  past_answers: words('Looking at answers you gave before', 'Looked at answers you gave before'),
  save_answer: words('Saving the answer', 'Saved the answer'),
  save_fact: words('Saving a fact for you to verify', 'Saved a fact for you to verify'),
  save_gap: words('Noting something you don’t have', 'Noted something you don’t have'),
  verify_fact: words('Updating a fact', 'Updated a fact'),
  save_about_you: words('Saving what you told Claude', 'Saved what you told Claude'),
};

/** A job's files, by name, as reading them and writing them. */
const JOB_FILES: Readonly<Record<string, readonly [StepWords, StepWords]>> = {
  'posting.md': [
    words('Reading the posting', 'Read the posting'),
    words('Saving the posting', 'Saved the posting'),
  ],
  'job.md': [
    words('Reading the job’s notes', 'Read the job’s notes'),
    words('Writing the job’s notes', 'Wrote the job’s notes'),
  ],
  'fit-check.md': [
    words('Reading the fit check', 'Read the fit check'),
    words('Writing the fit check', 'Wrote the fit check'),
  ],
  'unmask.md': [
    words('Reading the employer check', 'Read the employer check'),
    words('Writing the employer check', 'Wrote the employer check'),
  ],
  'notes.md': [
    words('Reading the resume’s notes', 'Read the resume’s notes'),
    words('Writing the resume’s notes', 'Wrote the resume’s notes'),
  ],
  'answers.md': [
    words('Reading your answers', 'Read your answers'),
    words('Writing your answers', 'Wrote your answers'),
  ],
  'prep.md': [
    words('Reading the prep sheet', 'Read the prep sheet'),
    words('Writing the prep sheet', 'Wrote the prep sheet'),
  ],
  'apply.md': [
    words('Reading how to apply', 'Read how to apply'),
    words('Noting how to apply', 'Noted how to apply'),
  ],
  'resume.json': [
    words('Reading the resume', 'Read the resume'),
    words('Writing the resume', 'Wrote the resume'),
  ],
  'cover-letter.json': [
    words('Reading the cover letter', 'Read the cover letter'),
    words('Writing the cover letter', 'Wrote the cover letter'),
  ],
  'projects-page.json': [
    words('Reading the Projects page', 'Read the Projects page'),
    words('Writing the Projects page', 'Wrote the Projects page'),
  ],
};

/** The workspace's folders, by their first part, as reading in them and writing in them. */
const FOLDERS: Readonly<Record<string, readonly [StepWords, StepWords]>> = {
  facts: [
    words('Reading your fact bank', 'Read your fact bank'),
    words('Updating your fact bank', 'Updated your fact bank'),
  ],
  base: [
    words('Reading your starting resumes', 'Read your starting resumes'),
    words('Updating your starting resumes', 'Updated your starting resumes'),
  ],
  guide: [
    words('Reading your writing guide', 'Read your writing guide'),
    words('Updating your writing guide', 'Updated your writing guide'),
  ],
  'about-me': [
    words('Reading about you', 'Read about you'),
    words('Saving what you told Claude', 'Saved what you told Claude'),
  ],
  templates: [
    words('Reading a template', 'Read a template'),
    words('Saving a template', 'Saved a template'),
  ],
  searches: [
    words('Reading the job searches', 'Read the job searches'),
    words('Saving the jobs it found', 'Saved the jobs it found'),
  ],
  outreach: [
    words('Reading your messages', 'Read your messages'),
    words('Drafting a message for you to send', 'Drafted a message for you to send'),
  ],
  asked: [
    words('Reading your questions', 'Read your questions'),
    words('Saving the answer', 'Saved the answer'),
  ],
  calls: [
    words('Reading about the call', 'Read about the call'),
    words('Writing for the call', 'Wrote for the call'),
  ],
  saved: [
    words('Reading the posting you saved', 'Read the posting you saved'),
    words('Saving the posting', 'Saved the posting'),
  ],
};

const READS = ['Read', 'NotebookRead'];
const WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/** What reading or writing a file is, by where it is in the workspace. */
function fileWords(path: string | null, writing: boolean): StepWords {
  const parts = (path ?? '').split('/').filter(Boolean);
  const name = parts.at(-1) ?? 'a file';
  const known = parts[0] === 'applications' ? JOB_FILES[name] : FOLDERS[parts[0] ?? ''];
  if (known) return known[writing ? 1 : 0];
  return writing
    ? words(`Writing ${name}`, `Wrote ${name}`)
    : words(`Reading ${name}`, `Read ${name}`);
}

/**
 * A step in the window's words, such as "Reading your fact bank", or null for one that says
 * nothing worth showing, such as Claude keeping its to-do list, or asking the user, which the
 * app does in a dialog of its own.
 */
export function stepWords({ tool, detail }: Pick<RunStep, 'tool' | 'detail'>): StepWords | null {
  if (tool.startsWith('mcp__factwright__')) {
    const name = tool.slice('mcp__factwright__'.length);
    if (name === 'read_page') {
      return detail
        ? words(`Reading ${detail}`, `Read ${detail}`)
        : words('Reading a page', 'Read a page');
    }
    return TOOLS[name] ?? null;
  }
  if (READS.includes(tool)) return fileWords(detail, false);
  if (WRITES.includes(tool)) return fileWords(detail, true);
  if (tool === 'Glob' || tool === 'Grep' || tool === 'LS') {
    return words('Looking through your workspace', 'Looked through your workspace');
  }
  if (tool === 'WebSearch') {
    return detail
      ? words(`Searching the web for “${detail}”`, `Searched the web for “${detail}”`)
      : words('Searching the web', 'Searched the web');
  }
  if (tool === 'WebFetch') {
    return detail
      ? words(`Reading ${detail}`, `Read ${detail}`)
      : words('Reading a page', 'Read a page');
  }
  return null;
}
