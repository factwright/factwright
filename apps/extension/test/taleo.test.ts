import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { taleoActs } from '../scripts/taleo-own-code.ts';
import { looksLikeApplication } from '../src/fill.ts';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';
import { partsOf } from '../src/several-pages.ts';

// Oracle Taleo Enterprise's application, a step at a time, each step its own page, for a made-up
// company, Bramblecote Logistics, with its own code acted out as scripts/taleo-own-code.ts has it.
// Its sign-in page follows live captures of October 2026. No source holds a whole step past
// sign-in: the steps' ids, classes and buttons are as public tools and Taleo's own stylesheets
// show them, and how they nest is a reconstruction, as is the list that posts its step on a change
// (some sites' do, other tools' notes say).
const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * A step of the application, with Taleo's own code on it, as it works: in the test's own window,
 * where a box you leave hears it, its commands never posting the page.
 */
const working = (name: string) => {
  const page = new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `taleo-${name}.html`), 'utf8'),
    'text/html',
  );
  document.title = page.title;
  document.body.replaceWith(document.importNode(page.body, true));
  taleoActs(document, false);
  return document;
};

/** Every step's address, as Taleo posts each to the same one. */
const HERE =
  'https://bramblecote.taleo.net/careersection/careersection/candidateacquisition/flow.jsf';

const run = (task: FormTask, doc: Document) => formPage(task, doc, HERE);

async function read(doc: Document): Promise<PageForm> {
  const answer = await run({ do: 'read' }, doc);
  if (answer.did !== 'read') throw new Error('It didn’t read the form.');
  return answer.form;
}

/** Each field as "kind: question (control), in section", to compare at a glance. */
const asked = (form: PageForm) =>
  form.fields.map(
    (field) => `${fieldKind(field)}: ${field.question} (${field.control}), in ${field.section}`,
  );

const filledOf = (answer: FormAnswer) => {
  if (answer.did !== 'fill') throw new Error('It didn’t fill the form.');
  return answer.filled;
};

/** An answer for the field that asks a question, the first that does. */
const to = (form: PageForm, question: string, answer: Omit<FieldAnswer, 'ref' | 'key'>) => {
  const field = form.fields.find((each) => each.question === question);
  if (!field) throw new Error(`No ${question}`);
  return { ref: field.ref, key: field.key, ...answer };
};

/** The commands the step's own code ran, each of which would post it, and its own sending. */
const posted = (doc: Document) => {
  const { taleoCommands, taleoSubmits } = doc.defaultView as unknown as {
    taleoCommands: string[];
    taleoSubmits: number;
  };
  return { commands: taleoCommands, submits: taleoSubmits };
};

const settle = () => new Promise((done) => setTimeout(done, 800));

describe('reading Taleo’s application', () => {
  it('reads a step by its own name, and leaves out a list Taleo keeps till the one before it is picked', async () => {
    const form = await read(working('personal'));
    expect(form.step).toBe('Personal Information');
    expect(asked(form)).toEqual([
      'first-name: First Name (text), in Personal Information',
      'last-name: Last Name (text), in Personal Information',
      'email: Email Address (text), in Personal Information',
      'street: Street Address (text), in Personal Information',
      'postal-code: Zip/Postal Code (text), in Personal Information',
      'country: Country (choice), in Personal Information',
      'phone: Cellular Phone (text), in Personal Information',
      'question: Preferred Phone (choice), in Personal Information',
      'question: Source Type (choice), in How did you hear about us?',
      'question: Send an email notification whenever a new position matching this profile is posted. (check), in Job Posting Notification',
    ]);
    expect(looksLikeApplication(form)).toBe(true);
  });

  it('reads each job’s and school’s part, and a date’s month and year by what they offer', async () => {
    const form = await read(working('experience'));
    expect(form.step).toBe('Work Experience');
    expect(asked(form)).toEqual([
      'current-company: Employer (text), in Work Experience 1',
      'current-title: Job Function (text), in Work Experience 1',
      'job-current: Current Job (check), in Work Experience 1',
      'job-start: Start Date Month (choice), in Work Experience 1',
      'job-start: Start Date Year (choice), in Work Experience 1',
      'job-end: End Date Month (choice), in Work Experience 1',
      'job-end: End Date Year (choice), in Work Experience 1',
      'job-summary: Responsibilities (long), in Work Experience 1',
      'school: Institution (text), in Education 1',
      'discipline: Program (text), in Education 1',
      'degree: Education Level (choice), in Education 1',
      'graduation: Graduation Date Month (choice), in Education 1',
      'graduation: Graduation Date Year (choice), in Education 1',
    ]);
    expect(partsOf(form, 'job')).toBe(1);
    expect(partsOf(form, 'school')).toBe(1);
    // Its Add posts the step, which would stop filling midway: it's never offered.
    expect(form.adders).toEqual([]);
  });

  it('reads its questions, its diversity questions and its signature', async () => {
    const questions = await read(working('questions'));
    expect(questions.step).toBe('Job Specific Questions');
    expect(asked(questions)).toEqual([
      'authorized: Are you legally authorized to work in the United States? (choice), in Job Specific Questions',
      'sponsorship: Will you now or in the future require sponsorship for an employment visa? (choice), in Job Specific Questions',
      'question: How many years of SQL experience do you have? (choice), in Job Specific Questions',
      'question: Which office would you prefer to work in? (choice), in Job Specific Questions',
    ]);
    const diversity = await read(working('diversity'));
    expect(asked(diversity)).toEqual([
      'gender: Gender (choice), in Diversity',
      'veteran: Veterans Invitation to Self Identify (choice), in Diversity',
      'race: Race (Please select the ethnic group(s) that apply to you) (choices), in Diversity',
    ]);
    const signature = await read(working('esignature'));
    expect(asked(signature)).toEqual([
      'consent: Full Name (text), in eSignature',
      'email: Email Address (text), in eSignature',
    ]);
  });

  it('never takes its sign-in page for an application', async () => {
    const form = await read(working('login'));
    expect(form.fields.map((field) => fieldKind(field))).toEqual(['never', 'never']);
    expect(looksLikeApplication(form)).toBe(false);
  });
});

describe('filling Taleo’s application', () => {
  it('fills a step, and a place a level at a time, as each list fills from Taleo’s server', async () => {
    const doc = working('personal');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'First Name', { text: 'Ana María', ifEmpty: true }),
            to(form, 'Last Name', { text: 'Ruiz', ifEmpty: true }),
            to(form, 'Email Address', { text: 'ana@example.com', ifEmpty: true }),
            to(form, 'Country', { pick: ['United States', 'USA'], ifEmpty: true }),
            to(form, 'Cellular Phone', { text: '(303) 555-0142', ifEmpty: true }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown, each.kept ?? false])).toEqual([
      [true, 'Ana María', false],
      [true, 'Ruiz', false],
      [true, 'ana@example.com', true],
      [true, 'United States', false],
      [true, '(303) 555-0142', false],
    ]);
    // The state's list shows once Taleo filled it, as the panel's next pass reads it.
    await settle();
    const states = await read(doc);
    expect(states.fields.map((field) => field.question)).toContain('State/Province');
    filledOf(
      await run(
        { do: 'fill', url: HERE, answers: [to(states, 'State/Province', { pick: ['Wyoming'] })] },
        doc,
      ),
    );
    await settle();
    const cities = await read(doc);
    const city = filledOf(
      await run(
        { do: 'fill', url: HERE, answers: [to(cities, 'City', { pick: ['Cheyenne'] })] },
        doc,
      ),
    );
    expect(city).toEqual([expect.objectContaining({ ok: true, shown: 'Cheyenne' })]);
    // Nothing posted the step, and nothing sent it.
    expect(posted(doc)).toEqual({ commands: [], submits: 0 });
  });

  it('fills a job’s and a school’s part, its month and year lists, and its program as typed', async () => {
    const doc = working('experience');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Employer', { text: 'Tidewater Analytics', ifEmpty: true }),
            to(form, 'Job Function', { text: 'Director of Product', ifEmpty: true }),
            to(form, 'Start Date Month', { pick: ['April', 'Apr', '04'], ifEmpty: true }),
            to(form, 'Start Date Year', { pick: ['2023'], ifEmpty: true }),
            to(form, 'Institution', { text: 'CU Boulder', ifEmpty: true }),
            to(form, 'Program', { text: 'Computer Science', ifEmpty: true }),
            to(form, 'Education Level', { pick: ["Bachelor's Degree", 'B.S.'], ifEmpty: true }),
            to(form, 'Graduation Date Year', { pick: ['2017'], ifEmpty: true }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Tidewater Analytics'],
      [true, 'Director of Product'],
      [true, 'April'],
      [true, '2023'],
      [true, 'CU Boulder'],
      [true, 'Computer Science'],
      [true, "Bachelor's Degree"],
      [true, '2017'],
    ]);
    expect(posted(doc)).toEqual({ commands: [], submits: 0 });
  });

  it('leaves a list that posts its step as it changes, and fills its questions’ radio buttons', async () => {
    const doc = working('questions');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Are you legally authorized to work in the United States?', {
              pick: ['Yes'],
            }),
            to(form, 'Will you now or in the future require sponsorship for an employment visa?', {
              pick: ['No'],
            }),
            to(form, 'Which office would you prefer to work in?', { pick: ['Denver'] }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown, each.why])).toEqual([
      [true, 'Yes', ''],
      [true, 'No', ''],
      [false, '', 'reloads'],
    ]);
    expect(posted(doc)).toEqual({ commands: [], submits: 0 });
  });
});
