import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobDetails } from '../tools/lookup.ts';
import { FetchRefused } from '../tools/safe-fetch.ts';
import { getFormQuestions } from './form-feed.ts';
import { JobsService } from './service.ts';
import { Tracker } from './tracker.ts';

const NOW = new Date(2026, 9, 23, 9, 30);
const POSTING = 'https://job-boards.greenhouse.io/harborpine/jobs/4012345';
const API = 'https://boards-api.greenhouse.io/v1/boards/harborpine/jobs/4012345?questions=true';

/**
 * What Greenhouse's job API answers with questions=true for a made-up company's job: two
 * questions of the form's own among the fields every form has, and its compliance questions.
 */
const ANSWER = {
  id: 4012345,
  title: 'Account Executive',
  company_name: 'Harbor & Pine Outfitters',
  questions: [
    {
      label: 'First Name',
      required: true,
      description: null,
      fields: [{ name: 'first_name', type: 'input_text', values: [] }],
    },
    {
      label: 'Resume/CV',
      required: true,
      description: null,
      fields: [
        { name: 'resume', type: 'input_file', values: [] },
        { name: 'resume_text', type: 'textarea', values: [] },
      ],
    },
    {
      label: 'Why do you want to join Harbor & Pine?',
      required: true,
      description: '<p>Up to 1,000 characters.</p>',
      fields: [{ name: 'question_1102', type: 'textarea', values: [] }],
    },
    {
      label: 'Have you sold outdoor gear before?',
      required: false,
      description: null,
      fields: [
        {
          name: 'question_1104',
          type: 'multi_value_single_select',
          values: [
            { label: 'Yes', value: 1 },
            { label: 'No', value: 0 },
          ],
        },
      ],
    },
  ],
  compliance: [
    {
      type: 'eeoc',
      questions: [
        {
          label: 'Gender',
          required: false,
          fields: [{ name: 'gender', type: 'multi_value_single_select', values: [] }],
        },
      ],
    },
  ],
};

/** Only the fields every form has, as a form with no questions of its own answers. */
const PLAIN = { ...ANSWER, questions: ANSWER.questions.slice(0, 2) };

let root: string;
let tracker: Tracker;
let jobs: JobsService;
/** The addresses fetched, in order. */
let fetched: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-form-feed-'));
  tracker = new Tracker(':memory:');
  jobs = new JobsService({
    workspace: root,
    tracker,
    onChange: () => {},
    now: () => NOW,
  });
  jobs.read();
  fetched = [];
});

afterEach(() => {
  jobs.stop();
  tracker.close();
  rmSync(root, { recursive: true, force: true });
});

/** Adds the made-up company's job by hand, with its posting's link, and gives its ID. */
function addJob(link: string): string {
  const added = jobs.addJob({
    company: 'Harbor & Pine Outfitters',
    role: 'Account Executive',
    link,
  });
  if (!added.ok) throw new Error(added.message);
  return added.jobId;
}

/**
 * Greenhouse's job API, answering each address it has an answer for, and 404 for the rest, as
 * fetchPublic says it. An answer that's an error is thrown.
 */
const greenhouse =
  (answers: Record<string, unknown>) =>
  async (url: string): Promise<unknown> => {
    fetched.push(url);
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error('boards-api.greenhouse.io answered 404');
    return answer;
  };

const formFile = (jobId: string) => join(root, 'saved', jobId, 'form.json');

/** What getFormQuestions works with: the jobs, Greenhouse as the test has it, and the clock. */
const using = (fetch: (url: string) => Promise<unknown>) => ({ jobs, fetch, now: () => NOW });

describe('getFormQuestions', () => {
  it('gets the form’s own questions from Greenhouse, and keeps them with the job for its Claude', async () => {
    const id = addJob(POSTING);
    expect(await getFormQuestions(id, using(greenhouse({ [API]: ANSWER })))).toEqual({
      ok: true,
      questions: 2,
    });
    expect(fetched).toEqual([API]);
    expect(JSON.parse(readFileSync(formFile(id), 'utf8'))).toEqual({
      url: POSTING,
      read: NOW.toISOString(),
      from: 'greenhouse',
      questions: [
        {
          question: 'Why do you want to join Harbor & Pine?',
          hint: 'Up to 1,000 characters.',
          section: '',
          control: 'long',
          options: [],
          required: true,
          limit: 1000,
        },
        {
          question: 'Have you sold outdoor gear before?',
          hint: '',
          section: '',
          control: 'choice',
          options: ['Yes', 'No'],
          required: false,
          limit: null,
        },
      ],
    });
    // Among the job's application questions, where its Claude's run reads how the form asks
    // each one.
    const job = jobs.job(id);
    if (!job) throw new Error('The job went missing.');
    expect(job.questions).toEqual([
      'Why do you want to join Harbor & Pine?',
      'Have you sold outdoor gear before?',
    ]);
    const details = await jobDetails(job, root, '2026-10-23');
    expect(details).toContain(
      [
        `Factwright got 2 of them from the form on Greenhouse on ${NOW.toISOString().slice(0, 10)} (${POSTING}), before the user opened it: each says how the form takes its answer.`,
        '1. Why do you want to join Harbor & Pine?',
        '   On the form: a box for paragraphs, required, up to 1,000 characters. It says: “Up to 1,000 characters.”',
        '   What the user sent: not recorded.',
        '2. Have you sold outdoor gear before?',
        '   On the form: one of its options.',
        '   Its options, word for word: “Yes” · “No”',
      ].join('\n'),
    );
  });

  it('asks each board a careers page may be on, until one has the job', async () => {
    const id = addJob('https://careers.harborpine.example/jobs?gh_jid=4012345');
    const second =
      'https://boards-api.greenhouse.io/v1/boards/careersharborpine/jobs/4012345?questions=true';
    const got = await getFormQuestions(id, using(greenhouse({ [second]: ANSWER })));
    expect(got).toEqual({ ok: true, questions: 2 });
    expect(fetched).toEqual([
      'https://boards-api.greenhouse.io/v1/boards/careers/jobs/4012345?questions=true',
      second,
    ]);
  });

  it('keeps nothing for a form with no questions of its own', async () => {
    const id = addJob(POSTING);
    expect(await getFormQuestions(id, using(greenhouse({ [API]: PLAIN })))).toEqual({
      ok: true,
      questions: 0,
    });
    expect(existsSync(formFile(id))).toBe(false);
    expect(jobs.job(id)?.questions).toEqual([]);
  });

  it('says why not, and keeps nothing, when there’s nothing to get', async () => {
    const fetch = greenhouse({ [API]: ANSWER });
    expect(await getFormQuestions('missing', using(fetch))).toEqual({
      ok: false,
      message: 'That job isn’t in Factwright anymore.',
    });
    // Lever shows its form's questions only on the form, so nothing is asked.
    const lever = addJob('https://jobs.lever.co/harborpine/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d');
    expect(await getFormQuestions(lever, using(fetch))).toEqual({
      ok: false,
      message:
        'Only a form on Greenhouse lists its questions before it’s open. Paste them instead, or fill in the form from your browser.',
    });
    expect(fetched).toEqual([]);
    // Greenhouse no longer lists the job.
    const closed = addJob('https://job-boards.greenhouse.io/harborpine/jobs/4099999');
    expect(await getFormQuestions(closed, using(fetch))).toEqual({
      ok: false,
      message:
        'Greenhouse doesn’t list this job anymore, so it may have closed. Paste its questions instead.',
    });
    expect(existsSync(join(root, 'saved'))).toBe(false);
  });

  it('says so when Greenhouse is out of reach, or answers in a way it doesn’t read', async () => {
    const id = addJob(POSTING);
    const slow = greenhouse({ [API]: new Error('the site took too long to answer') });
    expect(await getFormQuestions(id, using(slow))).toEqual({
      ok: false,
      message:
        'Factwright couldn’t reach Greenhouse (the site took too long to answer). Try again in a moment.',
    });
    // Refused, as an answer in Brotli is, it stops there.
    const embedded = addJob('https://careers.harborpine.example/jobs?gh_jid=4012345');
    fetched = [];
    const brotli = new FetchRefused('That site sent the page compressed with Brotli.');
    const refused = greenhouse({
      'https://boards-api.greenhouse.io/v1/boards/careers/jobs/4012345?questions=true': brotli,
    });
    expect(await getFormQuestions(embedded, using(refused))).toEqual({
      ok: false,
      message:
        'Greenhouse answered in a way Factwright doesn’t read, so it left it alone. Paste the questions instead.',
    });
    expect(fetched).toHaveLength(1);
    expect(existsSync(join(root, 'saved'))).toBe(false);
  });
});
