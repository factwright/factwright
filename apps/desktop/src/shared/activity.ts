/**
 * One thing Claude does in a run, as Claude Code's hooks tell it: a tool call, by its ID, with a
 * few words of what it's on, such as the file it reads, whether it's still going, and which of
 * Claude's helpers made it, if one did.
 */
export interface RunStep {
  id: string;
  /** The tool, as Claude Code names it, such as Read or mcp__factwright__build_resume. */
  tool: string;
  /**
   * What it's on, when that says something: a file's path in the workspace, a page's host, a web
   * search's words, a skill's name, or what Claude asked of a helper.
   */
  detail: string | null;
  state: 'running' | 'done' | 'failed';
  /**
   * The helper that made it, one of the subagents Claude hands part of its task to, by Claude
   * Code's ID for it. Absent for the run's own Claude.
   */
  helper?: string;
}

/**
 * How a turn of Claude's ended: what Claude said last, such as a question it stopped to ask, or
 * the error that ended it, such as a rate limit, as Claude Code names it, with its message.
 */
export interface TurnEnd {
  said: string | null;
  error: { kind: string; message: string | null } | null;
}

/** Where an item on Claude's to-do list stands. */
export type TodoState = 'pending' | 'in_progress' | 'completed';

/** One item on the to-do list Claude keeps in Claude Code, in Claude's own words. */
export interface TodoItem {
  /** What it is, such as "Read the posting". */
  text: string;
  /** What Claude says while it's on it, such as "Reading the posting", when it said. */
  doing: string | null;
  state: TodoState;
}

/** A helper at work on a run's task: one of the subagents Claude hands part of it to. */
export interface RunHelper {
  /** Claude Code's ID for it, which its steps carry, or until that's known, its start's. */
  id: string;
  /** What Claude asked of it, in Claude's few words, such as "Fact-check the resume". */
  what: string | null;
}

/**
 * Where Claude is on its to-do list: the item it's on, or else the next one to do, by its place
 * on the list, counting from 1, and how many items the list has.
 */
export interface TodoAt {
  at: number;
  of: number;
  item: TodoItem;
}

/**
 * Where a run's task stands beyond its steps: where Claude is on its to-do list, however long the
 * list, and its helpers at work.
 */
export interface RunProgress {
  /** Null without a list of two or more, or once every item on it is done. */
  todo: TodoAt | null;
  helpers: RunHelper[];
}

/**
 * The kinds of step the working strip draws, each a small picture of its own: reading, searching,
 * writing, checking facts, building a PDF, helpers at work side by side, and thinking between
 * steps.
 */
export type StepKind =
  | 'reading'
  | 'searching'
  | 'writing'
  | 'checking'
  | 'building'
  | 'helpers'
  | 'thinking';

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
  requested_changes: words('Reading the changes you asked for', 'Read the changes you asked for'),
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
  correct_fact: words('Correcting a fact', 'Corrected a fact'),
  save_about_you: words('Saving what you told Claude', 'Saved what you told Claude'),
  save_work_history: words('Saving your work history', 'Saved your work history'),
  log_check: words('Logging the check', 'Logged the check'),
};

/** What each of Factwright's tools is, as the working strip draws it. */
const TOOL_KINDS: Readonly<Record<string, StepKind>> = {
  find_job: 'searching',
  search_focus: 'reading',
  job_details: 'reading',
  revision_findings: 'reading',
  requested_changes: 'reading',
  read_posting: 'reading',
  read_page: 'reading',
  build_resume: 'building',
  build_cover_letter: 'building',
  build_projects_page: 'building',
  save_call_prep: 'writing',
  save_thank_you: 'writing',
  list_templates: 'reading',
  read_template: 'reading',
  save_template: 'writing',
  save_posting: 'writing',
  job_board: 'reading',
  hn_jobs: 'reading',
  about_you: 'reading',
  past_answers: 'reading',
  save_answer: 'writing',
  save_fact: 'checking',
  save_gap: 'checking',
  verify_fact: 'checking',
  correct_fact: 'checking',
  save_about_you: 'writing',
  save_work_history: 'writing',
  log_check: 'writing',
};

/**
 * Factwright's skills, by name. For each: what it teaches Claude to do, for "Reading how to tailor
 * a resume". For a skill whose helpers always do the same job, such as checking a resume's facts:
 * that job, for one helper and for several, and the picture of one helper at it.
 */
const SKILLS: Readonly<
  Record<string, { how: string; helpers?: { one: string; many: string; kind?: StepKind } }>
> = {
  'add-facts': { how: 'add to your fact bank' },
  'analyze-job': {
    how: 'analyze a job',
    helpers: { one: 'analyzing a job', many: 'analyzing jobs' },
  },
  'answer-questions': { how: 'answer an application’s questions' },
  ask: { how: 'answer a question about a job' },
  'cover-letter': {
    how: 'write a cover letter',
    helpers: { one: 'checking the facts', many: 'checking the facts', kind: 'checking' },
  },
  'fit-check': { how: 'check a job’s fit' },
  'focused-resume': {
    how: 'tailor a resume',
    helpers: { one: 'checking the facts', many: 'checking the facts', kind: 'checking' },
  },
  'get-started': { how: 'get to know you' },
  'interview-prep': { how: 'prepare for a call' },
  'job-search': {
    how: 'search for jobs',
    helpers: { one: 'going through the jobs', many: 'going through the jobs' },
  },
  'make-template': { how: 'make a template' },
  'projects-page': {
    how: 'write a Projects page',
    helpers: { one: 'checking the facts', many: 'checking the facts', kind: 'checking' },
  },
  'revise-resume': {
    how: 'revise a resume',
    helpers: { one: 'checking the facts', many: 'checking the facts', kind: 'checking' },
  },
  'salary-check': { how: 'check what a job pays' },
  'thank-you': { how: 'write thank-you notes' },
  'unmask-job': { how: 'find who’s hiring' },
  'who-to-message': { how: 'find who to message' },
  'work-history': { how: 'fill in your work history' },
};

/** Factwright's skills go by the plugin's name, such as "factwright:focused-resume". */
const skillName = (name: string) => name.replace(/^factwright:/, '');

/** The tool that starts a helper: Agent, or Task, as Claude Code named it before. */
export const HELPER_TOOLS = ['Agent', 'Task'];

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

const SEARCHES = ['Glob', 'Grep', 'LS'];

/**
 * A step in the window's words, such as "Reading your fact bank", or null for one that says
 * nothing worth showing, such as Claude ticking off an item on its to-do list, which the strip
 * shows as "Step 3 of 7", or asking the user, which the app does in a dialog of its own. Making
 * the list says so, as does starting a helper, with what Claude asked of it, and reading one of
 * Factwright's skills, by what it's how to do.
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
  if (SEARCHES.includes(tool)) {
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
  if (HELPER_TOOLS.includes(tool)) {
    return detail
      ? words(`Starting a helper for “${detail}”`, `Started a helper for “${detail}”`)
      : words('Starting a helper', 'Started a helper');
  }
  // A new list says how many steps it has. TodoWrite sends the whole list each time, so an
  // update, as an item starts or ends, has no detail.
  if (tool === 'TodoWrite') return detail ? words(`Planning ${detail}`, `Planned ${detail}`) : null;
  if (tool === 'TaskCreate') return words('Planning the steps', 'Planned the steps');
  if (tool === 'Skill' && detail) {
    const how = SKILLS[skillName(detail)]?.how;
    return how
      ? words(`Reading how to ${how}`, `Read how to ${how}`)
      : words(`Reading the “${detail}” skill`, `Read the “${detail}” skill`);
  }
  return null;
}

/**
 * What a step is, as the working strip draws it: reading, searching, writing, checking facts,
 * building a PDF, or starting a helper. Null for one it doesn't draw, such as Claude keeping its
 * to-do list.
 */
export function stepKind({ tool }: Pick<RunStep, 'tool'>): StepKind | null {
  if (tool.startsWith('mcp__factwright__')) {
    return TOOL_KINDS[tool.slice('mcp__factwright__'.length)] ?? null;
  }
  if (READS.includes(tool) || tool === 'WebFetch' || tool === 'Skill') return 'reading';
  if (WRITES.includes(tool)) return 'writing';
  if (SEARCHES.includes(tool) || tool === 'WebSearch') return 'searching';
  if (HELPER_TOOLS.includes(tool)) return 'helpers';
  return null;
}

/**
 * Where Claude is on its to-do list. Null for a list of fewer than two, or once every item is
 * done.
 */
export function todoAt(todos: readonly TodoItem[]): TodoAt | null {
  if (todos.length < 2) return null;
  const on = todos.findIndex(({ state }) => state === 'in_progress');
  const at = on >= 0 ? on : todos.findIndex(({ state }) => state === 'pending');
  const item = todos[at];
  return item ? { at: at + 1, of: todos.length, item } : null;
}

/**
 * Where Claude is on its to-do list, as the working strip says it, such as "Step 3 of 7: Tailoring
 * the summary": the item it's on, in the words it says while it's on it, or else the next one to
 * do, in its own.
 */
export function todoWords(where: TodoAt | null): string | null {
  if (!where) return null;
  const { at, of, item } = where;
  const words = item.state === 'in_progress' ? (item.doing ?? item.text) : item.text;
  return `Step ${at} of ${of}: ${words}`;
}

/**
 * A run's helpers at work, in a few words: what its skill's helpers always do, such as "4 helpers
 * analyzing jobs", or else what Claude asked of a helper alone, or else that they're at work. Null
 * with none at work.
 */
export function helpersWords(helpers: readonly RunHelper[], skill: string | null): string | null {
  const known = skill ? SKILLS[skillName(skill)]?.helpers : undefined;
  if (helpers.length > 1) return `${helpers.length} helpers ${known?.many ?? 'at work'}`;
  const [helper] = helpers;
  if (!helper) return null;
  if (known) return `A helper is ${known.one}`;
  return helper.what ? `A helper is on “${helper.what}”` : 'A helper is at work';
}

/** How the working strip draws a helper alone at work, where the run's skill says what it does. */
export const helperKind = (skill: string | null): StepKind | null =>
  (skill ? SKILLS[skillName(skill)]?.helpers?.kind : undefined) ?? null;
