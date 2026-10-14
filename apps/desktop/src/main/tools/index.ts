import { localDate } from '@factwright/core';
import { hasKinds, kindsOf } from '../../shared/kinds.ts';
import type { AboutStore } from '../about/store.ts';
import type { JobsService } from '../jobs/service.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import type { TemplateLibrary } from '../resume/templates.ts';
import { aboutYouChanges, aboutYouText, SAVABLE_ANSWERS } from './about.ts';
import { MAX_ANSWER, pastAnswers, saveAnswer } from './answers.ts';
import { findJob, findJobs, type JobQuery, jobDetails } from './lookup.ts';
import type { McpTool } from './mcp.ts';
import { type FetchDeps, ReadCache, readLink, savePosting } from './posting.ts';
import { buildResume } from './resume.ts';
import { hnJobs, jobBoard } from './search.ts';
import { listTemplates, readTemplateFile, saveTemplate } from './templates.ts';

export interface ToolDeps {
  jobs: JobsService;
  /** What the user told Factwright about themselves, which save_about_you adds to. */
  about: Pick<AboutStore, 'answers' | 'saveAnswers'>;
  workspace: string;
  printer: ResumePrinter;
  /** The resume templates, built in and the user's own. */
  templates: TemplateLibrary;
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
  'Factwright’s tools work on the user’s job hunt: the jobs on file with everything saved for each, their status, notes and calls, what the user sent on applications and asked about a job, what they told Factwright about themselves, reading postings and web pages and saving postings word for word, reading whole job boards and Hacker News’s hiring thread, building resumes, and the resume templates. Use them to read the tracker and the web, and to save answers, templates and resume files.';

/** The tools that never reach past this computer, so Claude may call them without asking. */
export const LOCAL_TOOLS = [
  'find_job',
  'job_details',
  'build_resume',
  'about_you',
  'past_answers',
  'save_answer',
  'list_templates',
  'read_template',
];

/**
 * The tools that change what the user told Factwright about themselves. They stay on this
 * computer, but like the user's facts, Claude asks before using them unless the user chose
 * otherwise, or started a run to get to know them.
 */
export const PROFILE_TOOLS = ['save_about_you'];

/**
 * The tool that adds to the user's templates. It stays on this computer, but a template is
 * something the user picks, so Claude asks before saving one, unless the user chose otherwise or
 * started a run to make one.
 */
export const TEMPLATE_TOOLS = ['save_template'];

/** The tools that read the templates, which a run started to make one needs. */
export const TEMPLATE_READS = ['list_templates', 'read_template'];

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
  // The user's kinds of job, when they want more than one, so each job says which it's under.
  const kinds = () => {
    const answers = deps.about.answers();
    return hasKinds(answers) ? kindsOf(answers) : [];
  };
  const reading = {
    cache: deps.cache ?? new ReadCache(),
    ...(deps.fetch && { fetch: deps.fetch }),
    ...(deps.now && { now: deps.now }),
  };
  return [
    {
      name: 'find_job',
      description:
        'Checks whether the user has seen a job before, and how it went: the fit check, the job search, its folder and status, with why they passed on it if they did. It also says why the user passed on jobs before, when they gave a reason more than once. Give the company, or just the posting’s link when that’s all you have. Call it before starting work on any job, and start the reply with what it found.',
      inputSchema: {
        type: 'object',
        properties: QUERY_PROPERTIES,
        additionalProperties: false,
      },
      annotations: READS,
      run: async (input) => findJob(deps.jobs.list().jobs, queryFrom(input), today(), kinds()),
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
          found.map((job) => jobDetails(job, deps.workspace, today(), kinds())),
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
        'Builds a resume from its data: a job’s folder’s resume.json, or a starting resume in base/. Makes a PDF, a Word file or both beside it, named after its output_name. Says how many pages it runs to, how full the last one is, which lines run short, and what breaks the user’s rules in guide/lint.json. Build again after each change. A job the user applied to keeps the files that were sent.',
      inputSchema: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description:
              'The job’s folder name under applications/, such as 2026-10-11-acme-staff-engineer, or base/<name> for the starting resume in base/<name>.json, or base/<kind>/<name> for one of a kind of job’s in base/<kind>/<name>.json.',
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
      // It writes only resume files, beside their data, from what's on this computer.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) =>
        buildResume(textInput(input, 'folder', true) ?? '', textInput(input, 'format', false), {
          workspace: deps.workspace,
          printer: deps.printer,
          templates: deps.templates,
          jobs: () => deps.jobs.list().jobs,
          ...(deps.now && { now: deps.now }),
        }),
    },
    {
      name: 'list_templates',
      description:
        'Lists the resume templates the user can pick, built in and their own, each with its ID, which a resume’s layout names, what it looks like, and whether it shows the strengths list (competencies).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READS,
      run: async () => listTemplates(deps.templates),
    },
    {
      name: 'read_template',
      description:
        'A resume template’s file, as JSON: its look in a sentence, the fonts it carries, its section titles, its look in Word, its styles, and its markup in Mustache’s syntax. Read one to start a template of the user’s own from it, or to change one of theirs.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The template’s ID, such as classic.' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: READS,
      run: async (input) => readTemplateFile(deps.templates, textInput(input, 'id', true) ?? ''),
    },
    {
      name: 'save_template',
      description:
        'Saves a resume template in the user’s templates, once it passes the checks, and prints a preview PDF to read: the made-up resume the app’s gallery shows, or one of the user’s. Give the whole template each time, as read_template shows one. It never replaces one of the user’s templates unless replace is true: use that only for a template you saved in this run, or one the user asked you to change. A run started to make a template can replace only the ones it saved.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Its ID, from its name, such as navy-sidebar: lowercase letters, digits and hyphens.',
          },
          template: {
            type: 'object',
            description:
              'The template, as its file holds it: factwright, version, name, look, fonts, titles, word, css, body and parts.',
          },
          replace: {
            type: 'boolean',
            description: 'Whether to replace the user’s template with this ID. False unless asked.',
          },
          resume: {
            type: 'string',
            description:
              'A resume to preview it with: a job’s folder name, or base/<name>. Without it, the made-up one.',
          },
        },
        required: ['id', 'template'],
        additionalProperties: false,
      },
      // It writes only the template's own file and its preview, from what's on this computer.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input, call) =>
        saveTemplate(
          {
            id: textInput(input, 'id', true) ?? '',
            template: input.template,
            replace: input.replace === true,
            resume: textInput(input, 'resume', false),
          },
          { workspace: deps.workspace, printer: deps.printer, templates: deps.templates },
          call,
        ),
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
    {
      name: 'about_you',
      description:
        'What the user told Factwright about themselves, when they started and in Profile since: their contact details, the roles, places and companies they want, pay, work authorization, when they can start, must-haves and deal-breakers. Check it before asking the user anything an application or a recruiter asks.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READS,
      run: async () => aboutYouText(deps.about.answers()),
    },
    {
      name: 'past_answers',
      description:
        'What the user actually sent on their applications, in their own words, newest first: the questions and their answers as they submitted them, which may differ from what Claude suggested. Use it to reuse what they said before and to sound like them. Give a question’s words to narrow it, and a job’s id to leave that job out.',
      inputSchema: {
        type: 'object',
        properties: {
          about: { type: 'string', description: 'A question’s words, such as “why this company”.' },
          job: { type: 'string', description: 'A job’s id to leave out, such as the one at hand.' },
        },
        additionalProperties: false,
      },
      annotations: READS,
      run: async (input) =>
        pastAnswers(
          deps.jobs.list().jobs,
          textInput(input, 'about', false),
          textInput(input, 'job', false),
        ),
    },
    {
      name: 'save_answer',
      description:
        'Saves your answer to one of the user’s questions about a job, which job_details lists under the user’s questions with their ids. The app shows it with the question, for the user to come back to. Give the answer as Markdown, with links to sources. Answering again replaces it.',
      inputSchema: {
        type: 'object',
        properties: {
          job: {
            type: 'string',
            description: 'The job’s id, such as acme-robotics--staff-engineer.',
          },
          question: {
            type: 'string',
            description: 'The question’s id, such as 2026-10-12-what-should-i-expect-from.',
          },
          answer: { type: 'string', description: 'The answer, as Markdown.' },
        },
        required: ['job', 'question', 'answer'],
        additionalProperties: false,
      },
      // It writes only the answer's own file, from what's on this computer.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => {
        const id = textInput(input, 'job', true) ?? '';
        const job = deps.jobs.list().jobs.find((each) => each.id === id);
        if (!job) throw new Error(`Nothing on file for ${id}.`);
        const answer = input.answer;
        if (typeof answer !== 'string' || answer.length > MAX_ANSWER) {
          throw new Error(`Give the answer as text of ${MAX_ANSWER} characters or fewer.`);
        }
        return saveAnswer(
          job,
          textInput(input, 'question', true) ?? '',
          answer,
          deps.workspace,
          today(),
        );
      },
    },
    {
      name: 'save_about_you',
      description:
        'Saves something the user told you that applications and recruiters ask for, so nobody asks again: their work authorization, when they can start (with any notice period), whether they’d relocate, their target or lowest base pay, or a contact detail. Save only what they said, in their words, and only what holds for every job, never one job’s pay. When they want more than one kind of job, pay is each kind’s own: name the kind it’s for.',
      inputSchema: {
        type: 'object',
        properties: {
          authorization: {
            type: 'string',
            description:
              'Whether they can work where the jobs are, such as “US citizen, no sponsorship needed”.',
          },
          start: {
            type: 'string',
            description: 'When they can start, such as “two weeks’ notice”.',
          },
          relocate: {
            type: 'string',
            enum: ['no', 'maybe', 'yes'],
            description: 'Whether they’d move for a job: no, maybe (for the right one) or yes.',
          },
          targetPay: {
            type: 'string',
            description: 'The base pay they’re aiming for, such as “$180,000”.',
          },
          minPay: { type: 'string', description: 'The least base pay they’d take.' },
          kind: {
            type: 'string',
            description:
              'Which kind of job the pay is for, by its id from about_you, such as project-manager, when they want more than one. Without it, the first kind.',
          },
          email: { type: 'string' },
          phone: { type: 'string' },
          location: { type: 'string', description: 'Where they live, such as “Denver, CO”.' },
          linkedin: { type: 'string', description: 'Their LinkedIn profile’s link.' },
          website: { type: 'string' },
        },
        additionalProperties: false,
      },
      // It changes the user's profile on this computer, which they OK unless they chose otherwise.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => {
        const current = deps.about.answers();
        const read = aboutYouChanges(input, current);
        if (!read) {
          const ids = hasKinds(current) ? kindsOf(current).map((kind) => kind.id) : [];
          throw new Error(
            [
              `Give one or more of ${SAVABLE_ANSWERS.join(', ')}, as short text. relocate is no, maybe or yes.`,
              ids.length > 0
                ? `With pay, give kind too, the kind of job it’s for: ${ids.join(', ')}.`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
        }
        deps.about.saveAnswers(read.changes);
        return `Saved to the user’s profile: ${read.saved.join('; ')}.`;
      },
    },
  ];
}
