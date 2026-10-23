import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AskedField,
  companyKey,
  FILE_PART_BYTES,
  type InboxAsk,
  type InboxAskAnswer,
  type Job,
  type KeptPrivate,
  NO_APPLICATIONS,
  NO_PRIVATE,
} from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleJob } from '../../renderer/jobs/sample-jobs.ts';
import { type AboutYou, NO_ANSWERS } from '../../shared/about.ts';
import { answerAsk, type FillDeps } from './fill.ts';

const FOLDER = '2026-10-20-harbor-pine-account-executive';
const POSTING = 'https://job-boards.greenhouse.io/harborpine/jobs/4567890';

/** A field as the extension reads one, with only what a test sets. */
const field = (question: string, more: Partial<AskedField> = {}): AskedField => ({
  question,
  hint: '',
  control: 'text',
  type: 'text',
  autocomplete: '',
  name: '',
  options: [],
  required: false,
  limit: null,
  ...more,
});

const ABOUT: AboutYou = {
  ...NO_ANSWERS,
  you: {
    name: 'Ana María Ruiz',
    email: 'ana@example.com',
    phone: '(303) 555-0142',
    location: 'Denver, CO',
    linkedin: 'https://www.linkedin.com/in/anaruiz',
    website: '',
  },
  applications: { ...NO_APPLICATIONS, countries: ['United States'], sponsorship: 'no' },
};

let workspace: string;
let jobs: Job[];
let about: AboutYou;
let kept: KeptPrivate;
let deps: FillDeps & {
  jobs: { recordAnswers: ReturnType<typeof vi.fn>; updateJob: ReturnType<typeof vi.fn> };
};
/** The resume's PDF, a little over one part. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(FILE_PART_BYTES + 1000, 7)]);

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-fill-'));
  const folder = join(workspace, 'applications', FOLDER);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'resume.json'),
    JSON.stringify({
      name: 'Ana María Ruiz',
      headline: 'Product manager',
      summary: 'Ships data products.',
      layout: 'classic',
      output_name: 'AnaRuizResume10202026_HarborPine',
      experience: [
        {
          title: 'Senior Product Manager',
          company: 'Tidewater Analytics',
          start: '2021',
          end: 'Present',
        },
        { title: 'Product Manager', company: 'Fernway', start: '2018', end: '2021' },
      ],
    }),
  );
  writeFileSync(join(folder, 'AnaRuizResume10202026_HarborPine.pdf'), PDF);
  jobs = [
    sampleJob({
      id: 'harbor-pine--account-executive',
      company: 'Harbor & Pine',
      companyKey: companyKey('Harbor & Pine'),
      role: 'Account Executive',
      links: [{ url: POSTING, label: 'Greenhouse' }],
      folder: FOLDER,
      files: [
        {
          path: `applications/${FOLDER}/AnaRuizResume10202026_HarborPine.pdf`,
          name: 'AnaRuizResume10202026_HarborPine.pdf',
          format: 'pdf',
          size: PDF.length,
          modified: '2026-10-20T16:00:00.000Z',
        },
      ],
    }),
    sampleJob({
      id: 'lumen--product-manager',
      company: 'Lumen Health',
      companyKey: companyKey('Lumen Health'),
      role: 'Product Manager',
      links: [{ url: 'https://www.linkedin.com/jobs/view/4012345678/', label: 'LinkedIn' }],
      status: 'applied',
      appliedOn: '2026-10-12',
      sent: [
        {
          question: 'What’s the biggest product bet you’ve made?',
          nth: 0,
          text: 'Moving our analytics to streaming.',
          on: '2026-10-12',
          at: '2026-10-12T16:00:00.000Z',
        },
      ],
    }),
  ];
  about = ABOUT;
  kept = NO_PRIVATE;
  deps = {
    jobs: {
      list: () => ({ jobs }),
      job: (id) => jobs.find((job) => job.id === id) ?? null,
      docs: (id) =>
        id === 'harbor-pine--account-executive'
          ? {
              answers: '# Answers\n\n## Why do you want to join Harbor & Pine?\n\nGear that lasts.',
            }
          : null,
      recordAnswers: vi.fn((_: string, answers: readonly unknown[]) => ({
        ok: true as const,
        recorded: answers.length,
      })),
      updateJob: vi.fn(() => ({ ok: true as const })),
    },
    about: {
      answers: () => about,
      saveAnswers: (changes) => {
        about = { ...about, ...changes } as AboutYou;
        return about;
      },
    },
    kept: {
      read: () => kept,
      save: (changes) => {
        kept = { ...kept, ...changes };
        return kept;
      },
    },
    workspace,
    now: () => new Date('2026-10-23T15:00:00Z'),
  };
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const fill = (fields: AskedField[], url = POSTING, company = '', role = '') =>
  answerAsk({ ask: 'fill', url, title: 'Job Application', company, role, fields }, deps);

type Filled = Extract<InboxAskAnswer, { did: 'fill' }>;

describe('answering a form to fill', () => {
  it('finds the job by its posting, and answers each field from what’s on file', async () => {
    const answer = (await fill([
      field('Email', { type: 'email', autocomplete: 'email' }),
      field('Resume/CV', { control: 'file', type: 'file' }),
      field('Current company'),
      field('What’s the biggest product bet you’ve made?', { control: 'long' }),
      field('Why do you want to join Harbor & Pine?', { control: 'long' }),
      field('How did you hear about us?'),
      field('Gender', { control: 'combo', name: 'gender' }),
    ])) as Filled;
    expect(answer.ok).toBe(true);
    expect(answer.job).toEqual({
      id: 'harbor-pine--account-executive',
      company: 'Harbor & Pine',
      role: 'Account Executive',
      status: 'new',
      appliedOn: null,
    });
    expect(
      answer.replies.map((reply) => [reply.source, reply.text ?? reply.file ?? reply.left]),
    ).toEqual([
      ['profile', 'ana@example.com'],
      ['job', 'resume'],
      ['resume', 'Tidewater Analytics'],
      ['sent', 'Moving our analytics to streaming.'],
      ['claude', 'Gear that lasts.'],
      ['job', 'Company website'],
      ['you', 'sensitive'],
    ]);
    expect(answer.files).toEqual({
      resume: {
        name: 'Ana María Ruiz - Resume.pdf',
        size: PDF.length,
        parts: 2,
        version: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
      'cover-letter': null,
    });
  });

  it('asks where the job is when a question names no country', async () => {
    const question = field('Are you authorized to work in the country for which you applied?', {
      control: 'choice',
      options: ['Yes', 'No'],
    });
    jobs[0] = { ...(jobs[0] as Job), location: 'Denver, CO' };
    expect(((await fill([question])) as Filled).replies[0]?.pick).toEqual(['Yes']);
    jobs[0] = { ...(jobs[0] as Job), location: 'London, UK' };
    expect(((await fill([question])) as Filled).replies[0]).toMatchObject({ left: 'unset' });
  });

  it('finds the job at the company with the page’s title, when the form isn’t its posting', async () => {
    const answer = (await fill(
      [field('Email', { type: 'email' })],
      'https://harborpine.example/careers/apply/91',
      'Harbor & Pine',
      'Account Executive',
    )) as Filled;
    expect(answer.job?.id).toBe('harbor-pine--account-executive');
  });

  it('still fills from Profile for a job that isn’t saved, with nothing to upload', async () => {
    const answer = (await fill(
      [field('Email', { type: 'email' }), field('Resume', { control: 'file', type: 'file' })],
      'https://jobs.lever.co/elsewhere/1a2b3c4d/apply',
      'Elsewhere',
      'Designer',
    )) as Filled;
    expect(answer.job).toBeNull();
    expect(answer.replies[0]?.text).toBe('ana@example.com');
    expect(answer.replies[1]).toMatchObject({ source: 'you', left: 'unset' });
    expect(answer.files).toEqual({ resume: null, 'cover-letter': null });
  });
});

describe('a part of a file', () => {
  /** The resume's version, as the job's form offers it. */
  const offered = async () =>
    ((await fill([field('Resume', { control: 'file', type: 'file' })])) as Filled).files.resume
      ?.version ?? '';
  const part = (n: number, version: string, job = 'harbor-pine--account-executive') =>
    answerAsk({ ask: 'file', job, file: 'resume', version, part: n }, deps);
  const pdf = () => join(workspace, 'applications', FOLDER, 'AnaRuizResume10202026_HarborPine.pdf');

  it('hands over the job’s resume in parts, as base64', async () => {
    const version = await offered();
    const first = (await part(0, version)) as Extract<InboxAskAnswer, { did: 'file' }>;
    const second = (await part(1, version)) as Extract<InboxAskAnswer, { did: 'file' }>;
    expect([first.parts, second.parts]).toEqual([2, 2]);
    expect(
      Buffer.concat([Buffer.from(first.base64, 'base64'), Buffer.from(second.base64, 'base64')]),
    ).toEqual(PDF);
    expect(await part(2, version)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('hands over only the file it offered, never one that changed since', async () => {
    const version = await offered();
    expect(await part(0, version)).toMatchObject({ ok: true });
    writeFileSync(pdf(), Buffer.concat([PDF, Buffer.from('more')]));
    expect(await part(1, version)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('is never a file outside the workspace, through a link or not, or of a job that isn’t there', async () => {
    const version = await offered();
    expect(await part(0, version, 'nobody--nothing')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    const outside = join(workspace, '..', `${FOLDER}-outside.pdf`);
    writeFileSync(outside, PDF);
    try {
      rmSync(pdf());
      symlinkSync(outside, pdf());
      expect(await offered()).toBe('');
      expect(await part(0, version)).toMatchObject({ ok: false, reason: 'not-found' });
    } finally {
      rmSync(outside, { force: true });
    }
    jobs[0] = {
      ...(jobs[0] as Job),
      files: [{ ...(jobs[0]?.files[0] as Job['files'][0]), path: '../tracker.db' }],
    };
    expect(await part(0, version)).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('what was sent', () => {
  const sent = (
    answers: { question: string; text: string }[],
    job = 'harbor-pine--account-executive',
  ) => answerAsk({ ask: 'sent', job, url: POSTING, answers } as InboxAsk, deps);

  it('records each answer to the form’s own questions at once, and marks the job applied', async () => {
    const answer = await sent([
      { question: 'Why do you want to join Harbor & Pine?', text: 'Gear that lasts.' },
      { question: 'If yes, please explain', text: 'First.' },
      { question: 'If yes, please explain', text: 'Second.' },
      { question: 'Gender', text: 'Woman' },
      { question: 'Date of birth', text: '1990-01-01' },
      { question: 'Sexual orientation', text: 'Bisexual' },
      { question: 'Do you acknowledge our applicant privacy notice?', text: 'Yes' },
      { question: 'Street address', text: '1420 Larimer St' },
      { question: 'Anything else?', text: '  ' },
    ]);
    expect(answer).toMatchObject({ ok: true, did: 'sent', recorded: 3 });
    expect(deps.jobs.recordAnswers.mock.calls).toEqual([
      [
        'harbor-pine--account-executive',
        [
          { question: 'Why do you want to join Harbor & Pine?', nth: 0, text: 'Gear that lasts.' },
          { question: 'If yes, please explain', nth: 0, text: 'First.' },
          { question: 'If yes, please explain', nth: 1, text: 'Second.' },
        ],
      ],
    ]);
    expect(deps.jobs.updateJob).toHaveBeenCalledWith('harbor-pine--account-executive', {
      status: 'applied',
    });
  });

  it('leaves a job you applied to as it is', async () => {
    await sent([{ question: 'Why?', text: 'Because.' }], 'lumen--product-manager');
    expect(deps.jobs.updateJob).not.toHaveBeenCalled();
  });
});

describe('answers to keep', () => {
  it('keeps each where Profile keeps it, and the private ones on this computer alone', async () => {
    const answer = await answerAsk(
      {
        ask: 'remember',
        answers: [
          { kind: 'phone', text: '(720) 555-0199' },
          { kind: 'pronouns', text: 'she/her' },
          { kind: 'street', text: '1420 Larimer St' },
          { kind: 'gender', text: 'Female' },
          { kind: 'gender', text: 'I use another term' },
          { kind: 'full-name', text: 'Someone Else' },
        ],
      },
      deps,
    );
    expect(answer).toEqual({ ok: true, did: 'remember', saved: 4 });
    expect(about.you).toMatchObject({ phone: '(720) 555-0199', name: 'Ana María Ruiz' });
    expect(about.applications.pronouns).toBe('she/her');
    expect(kept.street).toBe('1420 Larimer St');
    expect(kept.equalOpportunity.gender).toBe('woman');
  });
});
