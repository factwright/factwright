import { localDate } from '@factwright/core';
import type { JobsService } from '../jobs/service.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import { findJob, findJobs, type JobQuery, jobDetails } from './lookup.ts';
import type { McpTool } from './mcp.ts';
import { type FetchDeps, ReadCache, readLink, savePosting } from './posting.ts';
import { buildResume } from './resume.ts';
import { hnJobs, jobBoard } from './search.ts';

export interface ToolDeps {
  jobs: JobsService;
  workspace: string;
  printer: ResumePrinter;
  now?: () => Date;
  fetch?: FetchDeps['fetch'];
  /** What was read, for saving it later. Tests pass their own. */
  cache?: ReadCache;
}

const SEARCH_FOLDER = {
  type: 'string',
  description: 'The job search’s folder name under searches/, such as 2026-11-hn-whos-hiring.',
};

/** What Factwright's tools tell Claude about themselves when it connects. */
export const TOOLS_INSTRUCTIONS =
  'Factwright’s tools work on the user’s job hunt: the jobs on file with their status, notes and calls, reading postings and web pages and saving postings word for word, reading whole job boards and Hacker News’s hiring thread, and building resumes. Use them to read the tracker and the web, and to make resume files.';

/** The tools that never reach past this computer, so Claude may call them without asking. */
export const LOCAL_TOOLS = ['find_job', 'job_details', 'build_resume'];

/**
 * The tools that reach only fixed public job APIs: the applicant systems' postings and boards,
 * and Hacker News's. They send nothing but a board's name, a posting's ID or a month, never to
 * a site a link names, so Claude may call them without asking too. save_posting otherwise saves
 * only what was read already.
 */
export const PUBLIC_API_TOOLS = ['read_posting', 'save_posting', 'job_board', 'hn_jobs'];

/**
 * The tool that reads any public page. The user OKs each page unless they've chosen otherwise,
 * since a job post could steer Claude to send the user's details to a site in a link.
 */
export const WEB_TOOLS = ['read_page'];

/** Tools that only read, and don't reach past this computer. */
const READS = { readOnlyHint: true, openWorldHint: false };

const MAX_TEXT = 2000;

/** A text input, trimmed, or an error naming the field. */
function textInput(
  input: Record<string, unknown>,
  field: string,
  required: boolean,
): string | undefined {
  const value = input[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`Give the ${field}.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new Error(`The ${field} should be text of ${MAX_TEXT} characters or fewer.`);
  }
  return value.trim();
}

function queryFrom(input: Record<string, unknown>): JobQuery {
  const company = textInput(input, 'company', false);
  const role = textInput(input, 'role', false);
  const link = textInput(input, 'link', false);
  if (!company && !link) throw new Error('Give the company, or a link to the posting.');
  const query: JobQuery = { company: company ?? '' };
  if (role) query.role = role;
  if (link) query.link = link;
  return query;
}

const QUERY_PROPERTIES = {
  company: { type: 'string', description: 'The company’s name, as the posting gives it.' },
  role: { type: 'string', description: 'The role’s title, if known.' },
  link: { type: 'string', description: 'A link to the posting, if there is one.' },
};

/** The tools Factwright gives each Claude Code run, in place of a shell. */
export function factwrightTools(deps: ToolDeps): McpTool[] {
  const today = () => localDate(deps.now?.() ?? new Date());
  const reading = {
    cache: deps.cache ?? new ReadCache(),
    ...(deps.fetch && { fetch: deps.fetch }),
    ...(deps.now && { now: deps.now }),
  };
  return [
    {
      name: 'find_job',
      description:
        'Checks whether the user has seen a job before, and how it went: the fit check, the job search, its folder and status. Give the company, or just the posting’s link when that’s all you have. Call it before starting work on any job, and start the reply with what it found.',
      inputSchema: {
        type: 'object',
        properties: QUERY_PROPERTIES,
        additionalProperties: false,
      },
      annotations: READS,
      run: async (input) => findJob(deps.jobs.list().jobs, queryFrom(input), today()),
    },
    {
      name: 'job_details',
      description:
        'Everything on file for a job: its status and dates, the user’s notes, calls and interviews, history, links, and the files in its folder. Give the job’s id from find_job, or its company (and role).',
      inputSchema: {
        type: 'object',
        properties: {
          job: {
            type: 'string',
            description: 'The job’s id, such as acme-robotics--staff-engineer.',
          },
          ...QUERY_PROPERTIES,
        },
        additionalProperties: false,
      },
      annotations: READS,
      run: async (input) => {
        const { jobs } = deps.jobs.list();
        const id = textInput(input, 'job', false);
        const found = id
          ? jobs.filter((job) => job.id === id)
          : findJobs(jobs, queryFrom(input)).slice(0, 3);
        if (found.length === 0) {
          const query = id ? null : queryFrom(input);
          return `Nothing on file for ${id ?? (query?.company || query?.link)}.`;
        }
        const details = await Promise.all(
          found.map((job) => jobDetails(job, deps.workspace, today())),
        );
        return details.join('\n\n');
      },
    },
    {
      name: 'read_posting',
      description:
        'Reads a job posting on Greenhouse, Lever, Ashby or Gem straight from the applicant system’s public feed, without asking the user. Then save it with save_posting. For a posting anywhere else, use read_page.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The posting’s https link.' } },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (input) =>
        readLink(textInput(input, 'url', true) ?? '', { ...reading, feedsOnly: true }),
    },
    {
      name: 'read_page',
      description:
        'Reads any public web page as plain text: a posting on another site, a careers page, a company’s about or team page. The user may have to OK each page, so read only what the task needs, and use read_posting for postings on Greenhouse, Lever, Ashby or Gem. A posting read this way can then be saved with save_posting, without asking again.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The page’s https link.' } },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (input) =>
        readLink(textInput(input, 'url', true) ?? '', { ...reading, feedsOnly: false }),
    },
    {
      name: 'build_resume',
      description:
        'Builds the resume in a job’s folder from its resume.json: a PDF, a Word file or both, named after its output_name. Says how many pages it runs to, how full the last one is, which lines run short, and what breaks the user’s rules in guide/lint.json. Build again after each change. A job the user applied to keeps the files that were sent.',
      inputSchema: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description:
              'The job’s folder name under applications/, such as 2026-10-11-acme-staff-engineer.',
          },
          format: {
            type: 'string',
            enum: ['pdf', 'docx', 'both'],
            description: 'Which files to build. Without it, resume.json’s format, or a PDF.',
          },
        },
        required: ['folder'],
        additionalProperties: false,
      },
      // It writes only the job's resume files, from what's on this computer.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) =>
        buildResume(textInput(input, 'folder', true) ?? '', textInput(input, 'format', false), {
          workspace: deps.workspace,
          printer: deps.printer,
          jobs: () => deps.jobs.list().jobs,
          ...(deps.now && { now: deps.now }),
        }),
    },
    {
      name: 'save_posting',
      description:
        'Saves a job posting word for word as posting.md in the job’s folder, so it survives the link going dead: what read_page or read_posting read from that link in this run, or a posting on Greenhouse, Lever, Ashby or Gem read from its feed. It reaches no other site. Use it for every posting with a link. A posting already saved in the folder is kept. If it says the page needs a sign-in, ask the user to paste the posting.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The posting’s https link.' },
          folder: {
            type: 'string',
            description:
              'The job’s folder name under applications/, such as 2026-10-11-acme-staff-engineer.',
          },
        },
        required: ['url', 'folder'],
        additionalProperties: false,
      },
      // It writes what was read, or reads a public feed, and saving twice keeps the first.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) =>
        savePosting(textInput(input, 'url', true) ?? '', textInput(input, 'folder', true) ?? '', {
          ...reading,
          workspace: deps.workspace,
        }),
    },
    {
      name: 'job_board',
      description:
        'Reads every open job on a company’s board on Greenhouse, Lever, Ashby or Gem, and saves them word for word as one file in a job search’s folder. Lists each job with where, pay, when it was posted, its link, and the line it starts on in the file. Give a link to the board, or to any posting on it: for a posting, it also says whether it’s still open. Use it to see all a company is hiring for, and to check that a job is still open.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'A link to the company’s board or one of its postings, such as https://jobs.ashbyhq.com/acme.',
          },
          folder: SEARCH_FOLDER,
        },
        required: ['url', 'folder'],
        additionalProperties: false,
      },
      // It reads a public API and saves what it read, replacing the last copy.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) =>
        jobBoard(textInput(input, 'url', true) ?? '', textInput(input, 'folder', true) ?? '', {
          workspace: deps.workspace,
          ...(deps.fetch && { fetch: deps.fetch }),
          ...(deps.now && { now: deps.now }),
        }),
    },
    {
      name: 'hn_jobs',
      description:
        'Reads every job post in Hacker News’s monthly “Ask HN: Who is hiring?” thread and saves them word for word as hn-thread.md in a job search’s folder. Lists each post’s first line (by the thread’s rules: company, role and place), its HN id, and the line it starts on in the file. Without a month, it reads the newest thread. Saving again brings in posts added since.',
      inputSchema: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'The thread’s month as YYYY-MM, such as 2026-11. Without it, the newest.',
          },
          folder: SEARCH_FOLDER,
        },
        required: ['folder'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) =>
        hnJobs(textInput(input, 'month', false), textInput(input, 'folder', true) ?? '', {
          workspace: deps.workspace,
          ...(deps.fetch && { fetch: deps.fetch }),
          ...(deps.now && { now: deps.now }),
        }),
    },
  ];
}
