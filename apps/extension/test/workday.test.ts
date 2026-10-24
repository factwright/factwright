import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { workdayActs } from '../scripts/sites-own-code.ts';
import { looksLikeApplication, partsOf } from '../src/fill.ts';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';

// Workday's application, a page at a time, built from Workday's markup as public sources show it
// in 2025 and 2026, for a made-up company, Larkspur Energy: its data-automation-id and
// data-fkit-id attributes, its ids, and how its controls are put together. No page was saved
// from a real application for these, as that takes an account. Workday's own code, which the
// pages don't have, is acted out as scripts/sites-own-code.ts has it.
const FIXTURES = join(import.meta.dirname, 'fixtures');

/** A page of the application, as the browser would have it. */
const page = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `workday-${name}.html`), 'utf8'),
    'text/html',
  );

/** A page of the application with Workday's own code on it, as it works. */
const working = (name: string) => {
  const doc = page(name);
  workdayActs(doc, '');
  return doc;
};

/** The application's address, which stays the same from page to page. */
const HERE =
  'https://larkspur.wd5.myworkdayjobs.com/en-US/LarkspurCareers/job/Denver-CO/Senior-Product-Manager_R2026-0147/apply/applyManually';

const run = (task: FormTask, doc: Document) => formPage(task, doc, HERE);

async function read(doc: Document): Promise<PageForm> {
  const answer = await run({ do: 'read' }, doc);
  if (answer.did !== 'read') throw new Error('It didn’t read the form.');
  return answer.form;
}

/** Each field as "kind: question", to compare at a glance. */
const asked = (form: PageForm) =>
  form.fields.map((field) => `${fieldKind(field)}: ${field.question}`);

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

const value = (doc: Document, id: string) =>
  (doc.getElementById(id) as HTMLInputElement | null)?.value;

/** What a date's part shows beside its box, as Workday shows what its keys put in it. */
const display = (doc: Document, id: string) => doc.getElementById(`${id}-display`)?.textContent;

const COUNTRY = ['United States', 'United States of America', 'USA'];

describe('reading Workday’s application', () => {
  it('reads My Information, by the step its progress bar is on, with Workday’s own boxes', async () => {
    const form = await read(page('my-information'));
    expect(form.step).toBe('My Information');
    expect(asked(form)).toEqual([
      'how-heard: How Did You Hear About Us?',
      'question: Have you previously been employed by Larkspur Energy or any of its subsidiaries?',
      'country: Country/Region',
      'first-name: First Name',
      'middle-name: Middle Name',
      'last-name: Last Name',
      'preferred-name: I have a preferred name',
      'street: Address Line 1',
      'city: City',
      'region: State',
      'postal-code: Postal Code',
      'question: Phone Device Type',
      'phone-country: Country Phone Code',
      'phone: Phone Number',
      'question: Phone Extension',
    ]);
    // Its dropdowns and lists you search take one of their own options, which show once open:
    // never the box beside a dropdown that keeps its pick, nor a list's picks as its options.
    expect(
      form.fields.filter((field) => field.control === 'combo').map((field) => field.question),
    ).toEqual([
      'How Did You Hear About Us?',
      'Country/Region',
      'State',
      'Phone Device Type',
      'Country Phone Code',
    ]);
    expect(form.fields.find((field) => field.question === 'Country Phone Code')).toMatchObject({
      options: [],
      hint: '',
      required: true,
    });
    // What only says how many are picked, or what a box holds, is no hint.
    expect(form.fields.every((field) => !/selected|current value/.test(field.hint))).toBe(true);
    expect(looksLikeApplication(form)).toBe(true);
  });

  it('reads My Experience’s part for each job and school, and the buttons that add another', async () => {
    const form = await read(page('my-experience'));
    expect(form.step).toBe('My Experience');
    expect(
      form.fields.map((field) => `${fieldKind(field)}: ${field.question}, in ${field.section}`),
    ).toEqual([
      'current-title: Job Title, in Work Experience 1',
      'current-company: Company, in Work Experience 1',
      'job-location: Location, in Work Experience 1',
      'job-current: I currently work here, in Work Experience 1',
      'job-start: From Month, in Work Experience 1',
      'job-start: From Year, in Work Experience 1',
      'job-end: To Month, in Work Experience 1',
      'job-end: To Year, in Work Experience 1',
      'job-summary: Role Description, in Work Experience 1',
      'school: School or University, in Education 1',
      'degree: Degree, in Education 1',
      'discipline: Field of Study, in Education 1',
      'gpa: Overall Result (GPA), in Education 1',
      'edu-start: From Year, in Education 1',
      'graduation: To (Actual or Expected) Year, in Education 1',
      'question: Type to Add Skills, in Skills',
      'resume: Resume/CV, in My Experience',
      'linkedin: LinkedIn, in Social Network URLs',
    ]);
    // A date's month and year are numbers to type, a key at a time, asked as its legend asks.
    expect(form.fields.find((field) => field.question === 'From Month')).toMatchObject({
      control: 'number',
      required: true,
    });
    // Workday's resume box has no name or id: the box around it names it.
    expect(form.fields.find((field) => field.control === 'file')?.question).toBe('Resume/CV');
    expect(form.adders).toEqual([
      { section: 'Work Experience', words: 'Add Another' },
      { section: 'Education', words: 'Add Another' },
      { section: 'Websites', words: 'Add' },
    ]);
    expect([partsOf(form, 'job'), partsOf(form, 'school')]).toEqual([1, 1]);
  });

  it('reads Application Questions as their legends ask them, never a dropdown’s own name', async () => {
    const form = await read(page('application-questions'));
    expect(form.step).toBe('Application Questions');
    expect(asked(form)).toEqual([
      'authorized: Are you legally authorized to work in the United States?',
      'sponsorship: Will you now or in the future require sponsorship for employment visa status?',
      'question: Why do you want to work at Larkspur Energy?',
      'question: How much travel are you open to?',
      'question: Which of these have you used? Select all that apply.',
    ]);
    // Workday's boxes for a question have no name: they're one, by the set they're in.
    expect(form.fields.at(-1)).toMatchObject({
      control: 'choices',
      options: ['Jira', 'SQL', 'Figma'],
    });
  });

  it('reads Voluntary Disclosures and Self Identify as self-identification, however they ask', async () => {
    const disclosures = await read(page('voluntary-disclosures'));
    expect(asked(disclosures)).toEqual([
      // "Please select one of the options below:" names no question: Workday's names do.
      'veteran: Please select one of the options below:',
      'hispanic: Are you Hispanic or Latino?',
      'race: Please select the race(s) you identify with:',
      'gender: What is your gender?',
      'consent: Yes, I have read and consent to the terms and conditions',
    ]);
    // No file or email, but a page of the application: its Fill button shows here too.
    expect(looksLikeApplication(disclosures)).toBe(true);
    const identify = await read(page('self-identify'));
    expect(identify.step).toBe('Self Identify');
    expect(asked(identify)).toEqual([
      // The form's language, its date to sign and an employee's number are yours, never drafted.
      'personal: Language',
      'full-name: Name',
      'personal: Employee ID (if applicable)',
      'personal: Date Month',
      'personal: Date Day',
      'personal: Date Year',
      // Boxes asked only as "Please check one of the boxes below:" ask what their options do.
      'disability: Voluntary Self-Identification of Disability',
    ]);
    expect(identify.fields.at(-1)).toMatchObject({
      control: 'choices',
      hint: 'Please check one of the boxes below:',
      required: true,
    });
  });

  it('reads Review, with nothing to fill, and the page to make an account as no application', async () => {
    const review = await read(page('review'));
    expect([review.step, review.fields.length, looksLikeApplication(review)]).toEqual([
      'Review',
      0,
      false,
    ]);
    const account = await read(page('create-account'));
    expect(account.step).toBe('Create Account/Sign In');
    expect(asked(account).slice(0, 4)).toEqual([
      'email: Email Address',
      'never: Password',
      'never: Verify New Password',
      'consent: I agree',
    ]);
    // The box only robots fill, which a browser that lays the page out never reads at all.
    expect(asked(account).slice(4)).toEqual([
      'never: Enter website. This input is for robots only, do not enter if you’re human.'.replace(
        '’',
        "'",
      ),
    ]);
    expect(looksLikeApplication(account)).toBe(false);
  });
});

describe('filling Workday’s application', () => {
  it('picks from its dropdowns and its lists you search, as clicks and Enter do', async () => {
    const doc = working('my-information');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            // Under Job Board, which what's typed doesn't look through: found group by group.
            to(form, 'How Did You Hear About Us?', { pick: ['LinkedIn'] }),
            to(form, 'Country/Region', { pick: COUNTRY }),
            to(form, 'First Name', { text: 'Ana María' }),
            to(form, 'Last Name', { text: 'Ruiz' }),
            to(form, 'Address Line 1', { text: '1420 Larimer St' }),
            to(form, 'City', { text: 'Denver' }),
            to(form, 'State', { pick: ['CO', 'Colorado'] }),
            to(form, 'Postal Code', { text: '80202' }),
            to(form, 'Phone Device Type', { pick: ['Mobile'], exact: true }),
            to(form, 'Phone Number', { text: '(303) 555-0142' }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'LinkedIn'],
      [true, 'United States of America'],
      [true, 'Ana María'],
      [true, 'Ruiz'],
      [true, '1420 Larimer St'],
      [true, 'Denver'],
      [true, 'Colorado'],
      [true, '80202'],
      [true, 'Mobile'],
      [true, '(303) 555-0142'],
    ]);
    // Picking the country put the address in again, as Workday's does: it's filled as it shows.
    expect(value(doc, 'address--addressLine1')).toBe('1420 Larimer St');
    expect(value(doc, 'address--city')).toBe('Denver');
    // The dropdown keeps the option, as Canvas Kit does: its words, its ID and its name.
    const country = doc.getElementById('country--country');
    expect(country?.getAttribute('aria-label')).toBe(
      'Country/Region United States of America Required',
    );
    expect(country?.getAttribute('value')).not.toBe('');
    // Nothing's left open, nor typed in a list you search.
    expect(doc.querySelector('[visibility="opened"]')).toBeNull();
    expect(doc.querySelector('[data-automation-id="responsiveMonikerPrompt"]')).toBeNull();
    expect(value(doc, 'source--source')).toBe('');
  });

  it('leaves a list you search that Workday picked for you, as the phone’s country code, as it is', async () => {
    const doc = working('my-information');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [to(form, 'Country Phone Code', { pick: ['Canada'], ifEmpty: true })],
        },
        doc,
      ),
    );
    expect(filled).toEqual([
      expect.objectContaining({ ok: true, shown: 'United States of America (+1)', kept: true }),
    ]);
  });

  it('types a date’s month and year a key at a time, as Workday’s boxes take only keys', async () => {
    const doc = working('my-experience');
    const form = await read(doc);
    const [fromMonth, fromYear] = form.fields.filter((field) => field.question.startsWith('From'));
    if (!fromMonth || !fromYear) throw new Error('No From');
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            { ref: fromMonth.ref, key: fromMonth.key, text: '04' },
            { ref: fromYear.ref, key: fromYear.key, text: '2023' },
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, '04'],
      [true, '2023'],
    ]);
    expect(display(doc, 'workExperience-225--startDate-dateSectionMonth')).toBe('04');
    expect(display(doc, 'workExperience-225--startDate-dateSectionYear')).toBe('2023');
    expect(
      doc
        .getElementById('workExperience-225--startDate-dateSectionMonth-input')
        ?.getAttribute('aria-valuenow'),
    ).toBe('4');
  });

  it('leaves what Workday filled from your resume as it is, and fills what’s empty', async () => {
    const doc = working('my-experience');
    // Workday filled the job's title from the resume, as Autofill with Resume does.
    (doc.getElementById('workExperience-225--jobTitle') as HTMLInputElement).value = 'Sr. PM';
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Job Title', { text: 'Senior Product Manager', ifEmpty: true }),
            to(form, 'Company', { text: 'Tidewater Analytics', ifEmpty: true }),
            // Its own name for a bachelor's, without the apostrophe, is the same.
            to(form, 'Degree', {
              pick: ["Bachelor's Degree", "Bachelor's", 'Bachelor', 'BS', 'BA', 'B.S.'],
              ifEmpty: true,
            }),
            // Past the dozen it shows, found by what's typed, and kept as Workday keeps the one
            // it found.
            to(form, 'Field of Study', { pick: ['Psychology'], ifEmpty: true }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown, each.kept ?? false])).toEqual([
      [true, 'Sr. PM', true],
      [true, 'Tidewater Analytics', false],
      [true, 'Bachelors', false],
      [true, 'Psychology', false],
    ]);
    expect(value(doc, 'workExperience-225--jobTitle')).toBe('Sr. PM');
    // Filled again, what holds an answer now stays.
    const again = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [to(await read(doc), 'Company', { text: 'Fernway', ifEmpty: true })],
        },
        doc,
      ),
    );
    expect(again).toEqual([
      expect.objectContaining({ ok: true, shown: 'Tidewater Analytics', kept: true }),
    ]);
  });

  it('keeps the resume Workday has: the job’s goes in only where it has none', async () => {
    const doc = working('my-experience');
    const resume = (form: PageForm) =>
      to(form, 'Resume/CV', {
        file: { name: 'Ana Ruiz - Resume.pdf', type: 'application/pdf', base64: 'JVBERi0=' },
        ifEmpty: true,
      });
    // With none, the field holds nothing, so the job's goes in, as the runs in a browser check.
    const empty = await read(doc);
    expect(await run({ do: 'values', fields: [resume(empty)] }, doc)).toMatchObject({
      values: [{ value: '' }],
    });
    // Workday lists a resume it has beside its box: that one stays.
    const list = doc.querySelector(
      '[data-automation-id="attachments-FileUpload"] > div:last-child',
    );
    list?.insertAdjacentHTML(
      'beforeend',
      '<div data-automation-id="file-upload-item"><div data-automation-id="file-upload-item-name">resume.pdf</div></div>',
    );
    const kept = filledOf(
      await run({ do: 'fill', url: HERE, answers: [resume(await read(doc))] }, doc),
    );
    expect(kept).toEqual([expect.objectContaining({ ok: true, shown: 'resume.pdf', kept: true })]);
  });

  it('presses Add Another for the parts asked for, and reads each new one', async () => {
    const doc = working('my-experience');
    const form = await read(doc);
    const [jobs] = form.adders;
    if (!jobs) throw new Error('No Add Another');
    const added = await run({ do: 'add', url: HERE, adder: jobs, times: 2 }, doc);
    expect(added).toEqual({ did: 'add', added: 2 });
    const now = await read(doc);
    expect(partsOf(now, 'job')).toBe(3);
    expect(
      now.fields
        .filter((field) => fieldKind(field) === 'current-title')
        .map((field) => field.section),
    ).toEqual(['Work Experience 1', 'Work Experience 2', 'Work Experience 3']);
    // The school's part is as it was.
    expect(partsOf(now, 'school')).toBe(1);
    // Only on the form it read, at the address it read it at.
    expect(
      await run({ do: 'add', url: 'https://elsewhere.example/apply', adder: jobs, times: 1 }, doc),
    ).toEqual({ did: 'elsewhere' });
  });

  it('says the step it’s on as it reads what’s in the fields, with how many fields it has', async () => {
    const values = await run({ do: 'values', fields: [] }, working('my-information'));
    expect(values).toMatchObject({ did: 'values', step: 'My Information', fields: 15 });
    const review = await run({ do: 'values', fields: [] }, page('review'));
    expect(review).toMatchObject({ step: 'Review', fields: 0 });
  });

  it('ticks your disability answer among Self Identify’s boxes, only as you set it in Profile', async () => {
    const doc = working('self-identify');
    const form = await read(doc);
    const disability = form.fields.at(-1);
    if (!disability) throw new Error('No disability');
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            {
              ref: disability.ref,
              key: disability.key,
              pick: [
                'No, I do not have a disability and have not had one in the past',
                'No, I don’t have a disability',
                'No, I do not have a disability',
                'No',
              ],
            },
          ],
        },
        doc,
      ),
    );
    expect(filled).toEqual([
      {
        ref: disability.ref,
        ok: true,
        shown: 'No, I do not have a disability and have not had one in the past',
        why: '',
      },
    ]);
    const boxes = [...doc.querySelectorAll<HTMLInputElement>('input[id$="-disabilityStatus"]')];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
    // Workday lets the others go untickable meanwhile.
    expect(boxes.map((box) => box.disabled)).toEqual([true, false, true]);
  });

  it('never fills a password, or agrees to anything, on Workday’s page to make an account', async () => {
    const doc = working('create-account');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Password', { text: 'hunter2' }),
            to(form, 'I agree', { text: 'yes' }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => each.ok)).toEqual([false, false]);
    expect(value(doc, 'input-15')).toBe('');
  });
});
