import { localDate } from '@factwright/core';
import type { JobsService } from '../jobs/service.ts';
import { findJob, findJobs, type JobQuery, jobDetails } from './lookup.ts';
import type { McpTool } from './mcp.ts';
import { type SavePostingDeps, savePosting } from './posting.ts';

export interface ToolDeps {
  jobs: JobsService;
  workspace: string;
  now?: () => Date;
  fetch?: SavePostingDeps['fetch'];
}

/** What Factwright's tools tell Claude about themselves when it connects. */
export const TOOLS_INSTRUCTIONS =
  'Factwright’s tools work on the user’s job hunt: the jobs on file, their status and notes, and saving postings. Use them instead of reading the tracker or fetching postings yourself.';

/** The tools that only read what's on file, so Claude may call them without asking. */
export const READ_ONLY_TOOLS = ['find_job', 'job_details'];

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
  const query: JobQuery = { company: textInput(input, 'company', true) ?? '' };
  const role = textInput(input, 'role', false);
  const link = textInput(input, 'link', false);
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
        'Checks whether the user has seen a job before, and how it went: the fit check, the job search, its folder and status. Call it before starting work on any job, and start the reply with what it found.',
      inputSchema: {
        type: 'object',
        properties: QUERY_PROPERTIES,
        required: ['company'],
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
        if (found.length === 0) return `Nothing on file for ${id ?? queryFrom(input).company}.`;
        const details = await Promise.all(
          found.map((job) => jobDetails(job, deps.workspace, today())),
        );
        return details.join('\n\n');
      },
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
