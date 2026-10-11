import { localDate } from '@factwright/core';
import type { JobsService } from '../jobs/service.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import { findJob, findJobs, type JobQuery, jobDetails } from './lookup.ts';
import type { McpTool } from './mcp.ts';
import { readPage, type SavePostingDeps, savePosting } from './posting.ts';
import { buildResume } from './resume.ts';

export interface ToolDeps {
  jobs: JobsService;
  workspace: string;
  printer: ResumePrinter;
  now?: () => Date;
  fetch?: SavePostingDeps['fetch'];
}

/** What Factwright's tools tell Claude about themselves when it connects. */
export const TOOLS_INSTRUCTIONS =
  'Factwright’s tools work on the user’s job hunt: the jobs on file with their status, notes and calls, reading web pages, saving postings word for word, and building resumes. Use them to read the tracker and the web, and to make resume files.';

/** The tools that never reach past this computer, so Claude may call them without asking. */
export const LOCAL_TOOLS = ['find_job', 'job_details', 'build_resume'];

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
      name: 'read_page',
      description:
        'Reads a public web page as plain text: a job posting, a careers page, a company’s about or team page. Postings on Greenhouse, Lever, Ashby and Gem are read from the applicant system itself. Read a posting this way before saving it with save_posting. The user OKs each page, so read only what the task needs.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The page’s https link.' } },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (input) =>
        readPage(textInput(input, 'url', true) ?? '', {
          ...(deps.fetch && { fetch: deps.fetch }),
          ...(deps.now && { now: deps.now }),
        }),
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
        'Saves a job posting word for word as posting.md in the job’s folder, read straight from the applicant system (Greenhouse, Lever, Ashby, Gem) or the page. Use it for every posting with a link, so the posting survives the link going dead. A posting already saved in the folder is kept. If it says the page needs a sign-in, ask the user to paste the posting.',
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
      // It fetches the link from the internet, and saving twice keeps the first.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) =>
        savePosting(textInput(input, 'url', true) ?? '', textInput(input, 'folder', true) ?? '', {
          workspace: deps.workspace,
          ...(deps.fetch && { fetch: deps.fetch }),
          ...(deps.now && { now: deps.now }),
        }),
    },
  ];
}
