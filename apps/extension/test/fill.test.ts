import type { FieldReply, InboxAsk } from '@factwright/core';
import { describe, expect, it, vi } from 'vitest';
import {
  askedFields,
  draftable,
  fieldsToRead,
  fieldValue,
  fillAnswers,
  isCopyOnly,
  looksLikeApplication,
  newAnswers,
  placeNames,
  planFill,
  sentAnswers,
} from '../src/fill.ts';
import type { FieldValue, PageField, PageForm } from '../src/page/form.ts';
import { adderPart, partsOf } from '../src/several-pages.ts';

/** Factwright on this computer, as the extension asks it: what it was asked, and its answers. */
const computer = vi.hoisted(() => ({
  asked: [] as unknown[],
  answers: [] as unknown[],
}));
vi.mock('../src/computer.ts', () => ({
  askComputer: async (ask: unknown) => {
    computer.asked.push(ask);
    return computer.answers.shift();
  },
}));

let place = 0;
/** A field as the page function reads one, with only what a test sets. */
const field = (question: string, more: Partial<PageField> = {}): PageField => {
  const ref = more.ref ?? place++;
  return {
    ref,
    key: `INPUT|text|${ref}||${question}`,
    question,
    hint: '',
    section: '',
    control: 'text',
    type: 'text',
    autocomplete: '',
    name: '',
    options: [],
    required: false,
    limit: null,
    ...more,
  };
};

const form = (fields: PageField[]): PageForm => ({
  url: 'https://job-boards.greenhouse.io/harborpine/jobs/4567890',
  title: 'Job Application for Account Executive at Harbor & Pine',
  fields,
  submitted: false,
  step: '',
  adders: [],
});

const values = (fields: PageField[], texts: string[]): FieldValue[] =>
  fields.map((each, at) => ({ ref: each.ref, key: each.key, value: texts[at] ?? '' }));

describe('what Factwright puts in a form', () => {
  it('fills what it answered, and nothing it left for you', () => {
    const fields = [
      field('Email', { ref: 0 }),
      field('Resume/CV', { ref: 1, control: 'file', type: 'file' }),
      field('Gender', { ref: 2, control: 'combo' }),
      field('Why us?', { ref: 3, control: 'long' }),
      field('Pronouns', { ref: 4, control: 'combo' }),
    ];
    const replies: FieldReply[] = [
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
      { kind: 'resume', file: 'resume', source: 'job', from: 'Ana Ruiz - Resume.pdf' },
      { kind: 'gender', source: 'you', left: 'sensitive' },
      {
        kind: 'question',
        text: 'Gear that lasts.',
        source: 'sent',
        from: 'From your Acme application',
      },
      { kind: 'pronouns', pick: ['she/her'], exact: true, source: 'profile' },
    ];
    expect(
      fillAnswers(form(fields), replies, {
        resume: { name: 'Ana Ruiz - Resume.pdf', base64: 'JVBERi0=' },
      }),
    ).toEqual([
      { ref: 0, key: fields[0]?.key, text: 'ana@example.com' },
      {
        ref: 1,
        key: fields[1]?.key,
        file: { name: 'Ana Ruiz - Resume.pdf', base64: 'JVBERi0=', type: 'application/pdf' },
      },
      { ref: 3, key: fields[3]?.key, text: 'Gear that lasts.' },
      { ref: 4, key: fields[4]?.key, pick: ['she/her'], exact: true },
    ]);
  });

  it('names a place in full too, as a site’s own list of places may, and has it picked as one', () => {
    expect(placeNames(['Denver, CO', 'Denver', 'United States'])).toEqual([
      'Denver, CO',
      'Denver, Colorado',
      'Denver',
      'United States',
    ]);
    expect(placeNames(['Austin, tx, USA', 'Lyon, France'])).toEqual([
      'Austin, tx, USA',
      'Austin, Texas, USA',
      'Lyon, France',
    ]);
    const fields = [
      field('Location (City)', { ref: 0, control: 'combo' }),
      field('Current location', { ref: 1, control: 'combo' }),
      field('From where do you intend to work?', { ref: 2 }),
    ];
    const replies: FieldReply[] = [
      { kind: 'location', pick: ['Denver, CO', 'Denver', 'United States'], source: 'profile' },
      { kind: 'location', text: 'Denver, CO', source: 'profile' },
      { kind: 'location', text: 'Denver, CO', source: 'profile' },
    ];
    expect(fillAnswers(form(fields), replies, {})).toEqual([
      {
        ref: 0,
        key: fields[0]?.key,
        pick: ['Denver, CO', 'Denver, Colorado', 'Denver', 'United States'],
        place: true,
      },
      { ref: 1, key: fields[1]?.key, pick: ['Denver, CO', 'Denver, Colorado'], place: true },
      // A box to type in takes it as you'd type it.
      { ref: 2, key: fields[2]?.key, text: 'Denver, CO' },
    ]);
  });

  it('fills only what’s empty on a page of an application that runs over several, or once asked', () => {
    const fields = [field('Email', { ref: 0 }), field('Phone', { ref: 1 })];
    const replies: FieldReply[] = [
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
      { kind: 'phone', text: '(303) 555-0142', source: 'profile' },
    ];
    // Workday's My Information, which Workday may have filled in from your resume.
    const workday = { ...form(fields), step: 'My Information' };
    expect(fillAnswers(workday, replies, {}).map((answer) => answer.ifEmpty)).toEqual([true, true]);
    expect(fillAnswers(form(fields), replies, {}).map((answer) => answer.ifEmpty)).toEqual([
      undefined,
      undefined,
    ]);
    expect(fillAnswers(form(fields), replies, {}, true).every((answer) => answer.ifEmpty)).toBe(
      true,
    );
  });

  it('says the part for a job or school each answer is in, and which name the part', () => {
    const job = (question: string, n: number) =>
      field(question, { section: `My Experience › Work Experience ${n}` });
    const fields = [
      job('Job Title', 1),
      job('Company', 1),
      job('Company', 2),
      field('School or University', { section: 'Education 1' }),
      field('Email'),
    ];
    const replies: FieldReply[] = [
      { kind: 'current-title', text: 'Senior Product Manager', source: 'profile' },
      { kind: 'current-company', text: 'Tidewater Analytics', source: 'profile' },
      { kind: 'current-company', text: 'Fernway', source: 'profile' },
      { kind: 'school', text: 'CU Boulder', source: 'profile' },
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
    ];
    const workday = { ...form(fields), step: 'My Experience' };
    expect(
      fillAnswers(workday, replies, {}).map(({ part, names }) => [part, names ?? false]),
    ).toEqual([
      ['My Experience › Work Experience 1', false],
      ['My Experience › Work Experience 1', true],
      ['My Experience › Work Experience 2', true],
      ['Education 1', true],
      [undefined, false],
    ]);
  });

  it('leaves a file it couldn’t fetch for you', () => {
    const fields = [field('Resume', { ref: 0, control: 'file', type: 'file' })];
    expect(
      fillAnswers(form(fields), [{ kind: 'resume', file: 'resume', source: 'job' }], {}),
    ).toEqual([]);
  });
});

describe('what you sent', () => {
  it('is what’s in the form’s own questions, never what Profile fills, a file or a checkbox', () => {
    const fields = [
      field('Email', { ref: 0 }),
      field('Why do you want to join Harbor & Pine?', { ref: 1, control: 'long' }),
      field('Portfolio', { ref: 2, control: 'file', type: 'file' }),
      field('Anything else?', { ref: 3, control: 'long' }),
      field('I agree to the terms', { ref: 4, control: 'check' }),
      field('Gender', { ref: 5, control: 'combo' }),
    ];
    const replies: FieldReply[] = [
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'consent', source: 'you', left: 'consent' },
      { kind: 'gender', source: 'you', left: 'sensitive' },
    ];
    const typed = values(fields, [
      'ana@example.com',
      '  Gear that lasts.  ',
      'samples.pdf',
      '',
      'Checked',
      'Woman',
    ]);
    expect(sentAnswers(form(fields), replies, typed)).toEqual([
      { question: 'Why do you want to join Harbor & Pine?', text: 'Gear that lasts.' },
    ]);
  });

  it('reads only the form’s own questions and what Profile can keep, never a personal one', () => {
    const fields = [
      field('Email', { ref: 0 }),
      field('Why do you want to join Harbor & Pine?', { ref: 1, control: 'long' }),
      field('Social Security Number', { ref: 2 }),
      field('What is your age?', { ref: 3 }),
      field('Gender', { ref: 4, control: 'combo' }),
      field('Full name', { ref: 5 }),
    ];
    const replies: FieldReply[] = [
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'never', source: 'you', left: 'never' },
      { kind: 'personal', source: 'you', left: 'personal' },
      { kind: 'gender', source: 'you', left: 'sensitive' },
      { kind: 'full-name', text: 'Ana María Ruiz', source: 'profile' },
    ];
    expect(fieldsToRead(form(fields), replies).map((each) => each.ref)).toEqual([0, 1, 4]);
  });

  it('asks only within what the app takes', () => {
    const many = field('Time zone', {
      control: 'choice',
      type: 'x'.repeat(60),
      autocomplete: 'y'.repeat(300),
      options: Array.from({ length: 450 }, (_, at) => `Zone ${at}`),
    });
    const [asked] = askedFields(form([many]));
    expect([asked?.type.length, asked?.autocomplete.length, asked?.options.length]).toEqual([
      40, 200, 300,
    ]);
  });

  it('finds a field’s value by its key once the form’s fields have moved', () => {
    const asked = field('Why us?', { ref: 4 });
    expect(fieldValue(asked, [{ ref: 2, key: asked.key, value: 'Gear that lasts.' }])).toBe(
      'Gear that lasts.',
    );
    // Two fields with one key can't be told apart, so neither counts.
    expect(
      fieldValue(asked, [
        { ref: 1, key: asked.key, value: 'One' },
        { ref: 2, key: asked.key, value: 'Two' },
      ]),
    ).toBe('');
  });
});

describe('answers to keep', () => {
  it('offers what you typed that Profile didn’t have, each on its own', () => {
    const fields = [
      field('Phone', { ref: 0, type: 'tel' }),
      field('Preferred First Name', { ref: 1 }),
      field('Gender', { ref: 2, control: 'combo' }),
      field('Email', { ref: 3, type: 'email' }),
      field('Why us?', { ref: 4, control: 'long' }),
      field('Veteran Status', { ref: 5, control: 'combo' }),
    ];
    const replies: FieldReply[] = [
      { kind: 'phone', source: 'you', left: 'unset' },
      { kind: 'preferred-name', source: 'you', left: 'unset' },
      { kind: 'gender', source: 'you', left: 'sensitive' },
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'veteran', pick: ['I am not a protected veteran', 'No'], source: 'profile' },
    ];
    const typed = values(fields, [
      '(303) 555-0142',
      'Ana',
      'Female',
      'ana@example.com',
      'Gear that lasts.',
      'I am not a protected veteran',
    ]);
    expect(
      newAnswers(form(fields), replies, typed).map(({ kind, text, private: kept }) => [
        kind,
        text,
        kept,
      ]),
    ).toEqual([
      ['phone', '(303) 555-0142', false],
      ['preferred-name', 'Ana', false],
      ['gender', 'Female', true],
    ]);
  });
});

describe('where Factwright fills', () => {
  it('gives answers to copy on LinkedIn and Indeed, and fills anywhere else', () => {
    expect(isCopyOnly('https://www.linkedin.com/jobs/view/4012345678/')).toBe(true);
    expect(isCopyOnly('https://www.indeed.com/viewjob?jk=a1b2')).toBe(true);
    expect(isCopyOnly('https://job-boards.greenhouse.io/harborpine/jobs/4567890')).toBe(false);
    expect(isCopyOnly('not an address')).toBe(false);
  });

  it('offers to fill a page whose form looks like an application', () => {
    expect(looksLikeApplication(null)).toBe(false);
    expect(looksLikeApplication(form([field('Search'), field('Name')]))).toBe(false);
    expect(
      looksLikeApplication(
        form([field('Name'), field('Email', { type: 'email' }), field('Phone')]),
      ),
    ).toBe(true);
    expect(
      looksLikeApplication(
        form([field('First'), field('Last'), field('Resume', { control: 'file', type: 'file' })]),
      ),
    ).toBe(true);
  });

  it('offers to fill each page of an application that runs over several, but not its sign-in', () => {
    const page = (step: string, fields: PageField[]) => ({ ...form(fields), step });
    // Workday's Voluntary Disclosures: no file, no email, but a page of the application.
    expect(
      looksLikeApplication(page('Voluntary Disclosures', [field('Gender', { control: 'combo' })])),
    ).toBe(true);
    // Its Review has nothing to fill.
    expect(looksLikeApplication(page('Review', []))).toBe(false);
    // Making an account to apply with, or signing in: yours to do, with a password.
    const account = [
      field('Email Address', { type: 'email' }),
      field('Password', { type: 'password' }),
      field('Verify New Password', { type: 'password' }),
      field('I agree to the terms', { control: 'check', type: 'checkbox' }),
    ];
    expect(looksLikeApplication(form(account))).toBe(false);
    // An application that asks you to make a password along the way is still one.
    expect(
      looksLikeApplication(form([...account, field('Full name'), field('Phone', { type: 'tel' })])),
    ).toBe(true);
  });
});

describe('a form’s parts for each job and school', () => {
  /** One of Workday's Work Experience parts, as its fields read. */
  const job = (n: number) =>
    ['Job Title', 'Company', 'Location', 'From Month', 'From Year'].map((question) =>
      field(question, { section: `My Experience › Work Experience ${n}` }),
    );
  const school = (n: number) =>
    ['School or University', 'Degree', 'Field of Study'].map((question) =>
      field(question, { section: `My Experience › Education ${n}`, control: 'combo' }),
    );

  it('counts the parts a form has for jobs and schools', () => {
    const page = form([
      ...job(1),
      ...job(2),
      ...school(1),
      field('LinkedIn', { section: 'My Experience' }),
    ]);
    expect([partsOf(page, 'job'), partsOf(page, 'school')]).toEqual([2, 1]);
    expect(partsOf(form([field('Email')]), 'job')).toBe(0);
    // Greenhouse's names each job's part the same: one for each title it asks.
    const greenhouse = form(
      [0, 1, 2].flatMap((n) => [
        field('Company name', { section: 'Employment', name: `employment_company_${n}` }),
        field('Title', { section: 'Employment', name: `employment_title_${n}` }),
      ]),
    );
    expect(partsOf(greenhouse, 'job')).toBe(3);
  });

  it('knows which part a button that adds one adds to, by the part it’s in itself', () => {
    expect(adderPart({ section: 'My Experience › Work Experience', words: 'Add Another' })).toBe(
      'job',
    );
    expect(adderPart({ section: 'Education', words: 'Add' })).toBe('school');
    // Websites, inside My Experience, is neither.
    expect(adderPart({ section: 'My Experience › Websites', words: 'Add' })).toBeNull();
    expect(adderPart({ section: 'Languages', words: 'Add' })).toBeNull();
  });
});

describe('asking Factwright how to fill a form', () => {
  const plan = { ok: true, did: 'fill', job: null, replies: [], files: {} };
  const job = { company: 'Harbor & Pine', role: 'Account Executive' };

  it('says which part of the form each field is in', async () => {
    computer.asked = [];
    computer.answers = [plan];
    const fields = [field('Company', { section: 'Work Experience 1' })];
    expect(await planFill(form(fields), job)).toBe(plan);
    expect((computer.asked as InboxAsk[]).map((ask) => ask.ask === 'fill' && ask.fields)).toEqual([
      [expect.objectContaining({ question: 'Company', section: 'Work Experience 1' })],
    ]);
  });

  it('asks an app from before it took them again, without them', async () => {
    computer.asked = [];
    computer.answers = [{ ok: false, reason: 'bad-message', message: 'No.' }, plan];
    const fields = [field('Company', { section: 'Work Experience 1' })];
    expect(await planFill(form(fields), job)).toBe(plan);
    const [, again] = computer.asked as InboxAsk[];
    expect(again?.ask === 'fill' && again.fields[0]).not.toHaveProperty('section');
    expect(again?.ask === 'fill' && again.fields[0]?.question).toBe('Company');
  });

  it('gives up when the app can’t take it for another reason', async () => {
    computer.asked = [];
    const closed = { ok: false, reason: 'closed', message: 'Open Factwright.' };
    computer.answers = [closed];
    expect(await planFill(form([field('Company')]), job)).toBe(closed);
    expect(computer.asked).toHaveLength(1);
  });
});

describe('what your Claude can draft', () => {
  it('is each of the form’s own questions left for you, never a file, a box to tick, or one it said is yours', () => {
    const fields = [
      field('Why Harbor & Pine?', { ref: 0, control: 'long' }),
      field('Portfolio', { ref: 1, control: 'file', type: 'file' }),
      field('Willing to relocate', { ref: 2, control: 'check', type: 'checkbox' }),
      field('Tell us about HL7.', { ref: 3, control: 'long' }),
      field('Gender', { ref: 4, control: 'combo' }),
      field('Are you open to travel?', { ref: 5, control: 'choice', options: ['Yes', 'No'] }),
      field('Email', { ref: 6 }),
    ];
    const left = { kind: 'question', source: 'you', left: 'new' } as const;
    const replies: FieldReply[] = [
      left,
      left,
      left,
      { ...left, from: 'For you: the facts don’t say.' },
      { kind: 'gender', source: 'you', left: 'sensitive' },
      left,
      { kind: 'email', text: 'ana@example.com', source: 'profile' },
    ];
    expect(draftable(form(fields), replies, new Map()).map((each) => each.question)).toEqual([
      'Why Harbor & Pine?',
      'Are you open to travel?',
    ]);
    // One the panel filled already isn't.
    const filled = new Map([
      [fields[5]?.key ?? '', { ref: 5, ok: true, shown: 'No', why: '' as const }],
    ]);
    expect(draftable(form(fields), replies, filled).map((each) => each.question)).toEqual([
      'Why Harbor & Pine?',
    ]);
  });

  it('is never a box for part of a date, as a self-identification form’s date to sign it', () => {
    const fields = [
      'Date Month',
      'Date Day',
      'Date Year',
      'What year did you start coding?',
      'How many hours can you work per day',
    ].map((question, ref) => field(question, { ref, control: 'number' }));
    // In words, a question that ends in a part of a date is a question of the form's own.
    fields.push(field('What would you most like to learn this year', { ref: 5, control: 'long' }));
    const left = { kind: 'question', source: 'you', left: 'new' } as const;
    expect(
      draftable(
        form(fields),
        fields.map(() => left),
        new Map(),
      ).map((each) => each.question),
    ).toEqual([
      'What year did you start coding?',
      'How many hours can you work per day',
      'What would you most like to learn this year',
    ]);
  });
});
