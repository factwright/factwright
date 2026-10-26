import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { icimsActs } from '../scripts/icims-own-code.ts';
import { looksLikeApplication } from '../src/fill.ts';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';
import { partsOf, partsOffers } from '../src/several-pages.ts';

// iCIMS's application, as its career portal shows each page in its own frame on the company's
// careers page, a page for each step, built from public captures of it from 2022 to October 2026
// for a made-up company, Bramblecrest Robotics, with its own code acted out as
// scripts/icims-own-code.ts has it. Its EEO page's markup was never captured: that page is a
// guess from what other tools' notes say of it.
const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * A page of the application, with iCIMS's own code on it, as it works: in the test's own window,
 * where a box you leave hears it.
 */
const working = (name: string) => {
  const page = new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `icims-${name}.html`), 'utf8'),
    'text/html',
  );
  document.title = page.title;
  document.body.replaceWith(document.importNode(page.body, true));
  icimsActs(document);
  return document;
};

/** The frame's address, at the company's portal on iCIMS. */
const HERE =
  'https://careers-bramblecrest.icims.com/jobs/4821/robotics-software-engineer/candidate?from=login&in_iframe=1';

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

/** An answer for the field that asks a question, the nth that does. */
const to = (
  form: PageForm,
  question: string,
  answer: Omit<FieldAnswer, 'ref' | 'key'>,
  nth = 0,
) => {
  const field = form.fields.filter((each) => each.question === question)[nth];
  if (!field) throw new Error(`No ${question}`);
  return { ref: field.ref, key: field.key, ...answer };
};

/** What a list keeps for the page's form: its select's options, and the one picked. */
const keptBy = (doc: Document, id: string) => {
  const select = doc.getElementById(id) as HTMLSelectElement;
  return {
    options: select.options.length,
    picked: select.selectedOptions[0]?.text ?? '',
    shows: doc.getElementById(`${id}_icimsDropdown`)?.textContent?.trim() ?? '',
  };
};

/** How often the form was sent, and its resume box sent it. */
const sent = (doc: Document) => {
  const { icimsSubmits, icimsResumePosts } = doc.defaultView as unknown as Record<string, number>;
  return { icimsSubmits, icimsResumePosts };
};

describe('reading iCIMS’s application', () => {
  it('reads its Candidate Profile as a step, its own dropdowns as their links, and each block by its legend', async () => {
    const form = await read(working('candidate'));
    expect(form.step).toBe('Candidate Profile');
    expect(asked(form)).toEqual([
      'resume: Please upload your resume (Max size: 5 MB) (file), in Resume',
      'question: Upload Resume at a later time. (check), in Resume',
      'never: Login (text), in Create a login',
      'never: Password (text), in Create a login',
      'never: Password (Re-enter) (text), in Create a login',
      'first-name: First Name (text), in Enter your information',
      'middle-name: Middle Name (text), in Enter your information',
      'last-name: Last Name (text), in Enter your information',
      'email: Email (text), in Enter your information',
      'question: Type (choice), in Contact Information',
      'phone: Number (text), in Contact Information',
      'street: Address (text), in Contact Information › Addresses (1)',
      'city: City (text), in Contact Information › Addresses (1)',
      'country: Country (combo), in Contact Information › Addresses (1)',
      'region: State/Province (combo), in Contact Information › Addresses (1)',
      'postal-code: Zip/Postal Code (text), in Contact Information › Addresses (1)',
      'school: School (combo), in Education › College Education (1)',
      'question: If your school was not listed, enter it here (text), in Education › College Education (1)',
      'degree: Degree (combo), in Education › College Education (1)',
      'discipline: Major (combo), in Education › College Education (1)',
      'graduation: Graduation Date Month (choice), in Education › College Education (1)',
      'graduation: Graduation Date Day (choice), in Education › College Education (1)',
      'graduation: Graduation Date Year (text), in Education › College Education (1)',
      'current-company: Employer (text), in Work Experience › Professional Experience (1)',
      'current-title: Title (text), in Work Experience › Professional Experience (1)',
      'job-start: Start Date Month (choice), in Work Experience › Professional Experience (1)',
      'job-start: Start Date Day (choice), in Work Experience › Professional Experience (1)',
      'job-start: Start Date Year (text), in Work Experience › Professional Experience (1)',
      'job-end: End Date Month (choice), in Work Experience › Professional Experience (1)',
      'job-end: End Date Day (choice), in Work Experience › Professional Experience (1)',
      'job-end: End Date Year (text), in Work Experience › Professional Experience (1)',
      'job-summary: Description (long), in Work Experience › Professional Experience (1)',
      'job-current: Is this your current employer? (choice), in Work Experience › Professional Experience (1)',
      'how-heard: How did you hear about us? (choice), in Additional Data',
      'authorized: Are you legally authorized to work in the United States? (combo), in Additional Data',
      'linkedin: LinkedIn Profile URL (text), in Additional Data',
    ]);
    // Its dropdown is its link: required as the link says, its list and its search box no fields.
    const country = form.fields.find((field) => field.question === 'Country');
    expect(country).toMatchObject({
      required: true,
      name: '-1_PersonProfileFields.AddressCountry_icimsDropdown',
    });
    // Its resume box sends the form, to read the resume into it: it's yours to choose.
    expect(form.fields[0]?.required).toBe(true);
    expect(form.adders).toEqual([
      { section: 'Education', words: 'Add More (College Education)' },
      { section: 'Work Experience', words: 'Add More (Professional Experience)' },
    ]);
    expect(partsOf(form, 'job')).toBe(1);
    expect(partsOf(form, 'school')).toBe(1);
    expect(looksLikeApplication(form)).toBe(true);
  });

  it('reads its questions, and its EEO page, each its own step', async () => {
    const questions = await read(working('questions'));
    expect(questions.step).toBe('Candidate Questions');
    expect(asked(questions)).toEqual([
      'authorized: Are you currently eligible to work in the United States? (choice), in Candidate Questions',
      'sponsorship: Do you now or in the future require visa sponsorship to work in the United States? (choice), in Candidate Questions',
      'pay: What are your salary expectations for this role? (text), in Candidate Questions',
      'question: Which of our robots have you worked with, and how? (long), in Candidate Questions',
    ]);
    expect(questions.fields[0]).toMatchObject({ required: true, options: ['Yes', 'No'] });
    const eeo = await read(working('eeo'));
    expect(eeo.step).toBe('EEO');
    expect(asked(eeo)).toEqual([
      'gender: Gender (choice), in EEO',
      'race: Race/Ethnicity (choice), in EEO',
      'veteran: Veteran Status (choice), in EEO',
      'personal: I do not wish to self-identify (check), in EEO',
    ]);
  });

  it('never takes its page that asks for your email first for an application', async () => {
    const form = await read(working('login'));
    expect(asked(form)).toEqual([
      'email: Email (text), in Enter Your Information',
      'consent: I agree (check), in Enter Your Information',
    ]);
    expect(looksLikeApplication(form)).toBe(false);
  });
});

describe('filling iCIMS’s application', () => {
  it('fills its boxes and dropdowns, searching a list the server pages, and leaves its resume box', async () => {
    const doc = working('candidate');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Please upload your resume (Max size: 5 MB)', {
              file: { name: 'Ana Ruiz - Resume.pdf', type: 'application/pdf', base64: 'JVBERi0=' },
            }),
            to(form, 'First Name', { text: 'Ana María', ifEmpty: true }),
            to(form, 'Last Name', { text: 'Ruiz', ifEmpty: true }),
            to(form, 'Email', { text: 'ana@example.com', ifEmpty: true }),
            to(form, 'Number', { text: '(303) 555-0142', ifEmpty: true }),
            to(form, 'City', { text: 'Cheyenne', ifEmpty: true }),
            // The last of its 30 countries, and its 40 states, which a page of 25 doesn't show.
            to(form, 'Country', { pick: ['United States', 'USA'], ifEmpty: true }),
            to(form, 'State/Province', { pick: ['Wyoming', 'WY'], ifEmpty: true }),
            to(form, 'School', { pick: ['CU Boulder', 'University of Colorado Boulder'] }),
            to(form, 'Graduation Date Month', { pick: ['May', '05'] }),
            to(form, 'Graduation Date Year', { text: '2017' }),
            to(form, 'How did you hear about us?', { pick: ['LinkedIn'] }),
            to(form, 'Are you legally authorized to work in the United States?', {
              pick: ['Yes'],
            }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown, each.why])).toEqual([
      // Choosing a file sends the form, which would load the page anew midway: it's yours.
      [false, '', 'reloads'],
      [true, 'Ana María', ''],
      [true, 'Ruiz', ''],
      [true, 'ana@example.com', ''],
      [true, '(303) 555-0142', ''],
      [true, 'Cheyenne', ''],
      [true, 'United States', ''],
      [true, 'Wyoming', ''],
      [true, 'University of Colorado Boulder', ''],
      [true, 'May', ''],
      [true, '2017', ''],
      [true, 'LinkedIn', ''],
      [true, 'Yes', ''],
    ]);
    // A list from the server keeps the one picked as its select's only option, as iCIMS sends it.
    expect(keptBy(doc, '-1_PersonProfileFields.AddressCountry')).toEqual({
      options: 1,
      picked: 'United States',
      shows: 'United States',
    });
    expect(keptBy(doc, '-1_PersonProfileFields.AddressState')).toMatchObject({
      picked: 'Wyoming',
      shows: 'Wyoming',
    });
    expect((doc.getElementById('rcf2504') as HTMLSelectElement).value).toBe('28511');
    expect(sent(doc)).toEqual({ icimsSubmits: 0, icimsResumePosts: 0 });
  });

  it('adds a block for each other job with its Add More, and numbers each by its legend', async () => {
    const doc = working('candidate');
    const form = await read(doc);
    const [offer] = partsOffers(form, { jobs: 3, schools: 1 });
    expect(offer?.label).toBe('Add 2 for your other jobs');
    if (!offer) throw new Error('No offer');
    expect(await run({ do: 'add', url: HERE, adder: offer.adder, times: offer.more }, doc)).toEqual(
      { did: 'add', added: 2 },
    );
    const now = await read(doc);
    expect(partsOf(now, 'job')).toBe(3);
    expect(
      now.fields
        .filter((field) => fieldKind(field) === 'current-company')
        .map((field) => field.section),
    ).toEqual([
      'Work Experience › Professional Experience (1)',
      'Work Experience › Professional Experience (2)',
      'Work Experience › Professional Experience (3)',
    ]);
    // Only the newest block offers to add another.
    expect(now.adders.map((adder) => adder.words)).toEqual([
      'Add More (College Education)',
      'Add More (Professional Experience)',
    ]);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(now, 'Employer', { text: 'Fernway' }, 2),
            to(now, 'Title', { text: 'Product Manager' }, 2),
            to(now, 'Start Date Month', { pick: ['June', 'Jun', '06'] }, 2),
            to(now, 'Start Date Year', { text: '2018' }, 2),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Fernway'],
      [true, 'Product Manager'],
      [true, 'Jun'],
      [true, '2018'],
    ]);
    expect(sent(doc)).toEqual({ icimsSubmits: 0, icimsResumePosts: 0 });
  });

  it('fills its questions’ selects and boxes, and never presses Submit or Finish Later', async () => {
    const doc = working('questions');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Are you currently eligible to work in the United States?', {
              pick: ['Yes'],
            }),
            to(
              form,
              'Do you now or in the future require visa sponsorship to work in the United States?',
              { pick: ['No'] },
            ),
            to(form, 'Which of our robots have you worked with, and how?', {
              text: 'None yet, but I have built two warehouse robots of my own.',
            }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => each.ok)).toEqual([true, true, true]);
    expect((doc.getElementById('Q2415') as HTMLSelectElement).value).toBe('No');
    expect(sent(doc)).toEqual({ icimsSubmits: 0, icimsResumePosts: 0 });
  });
});
