import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { successFactorsActs } from '../scripts/successfactors-own-code.ts';
import { looksLikeApplication } from '../src/fill.ts';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';
import { partsOf, partsOffers } from '../src/several-pages.ts';

// SAP SuccessFactors' application, on a company's career site on SuccessFactors, as its
// responsive page shows it once you've signed in: one long page of parts that open and close,
// filled in from your profile already, built from public captures of it from 2024 to October 2026
// for a made-up company, Copperline Utilities, with its own code acted out as
// scripts/successfactors-own-code.ts has it.
const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * A page of the application, with SuccessFactors' own code on it, as it works: in the test's own
 * window, where a box you leave hears it.
 */
const working = (name: string) => {
  const page = new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `successfactors-${name}.html`), 'utf8'),
    'text/html',
  );
  document.title = page.title;
  document.body.replaceWith(document.importNode(page.body, true));
  successFactorsActs(document);
  return document;
};

/** The application's address once you've signed in, which is your session's. */
const HERE = 'https://career17.sapsf.com/portalcareer?_s.crb=sample';

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

/** A box's value, by its label's words. */
const boxValue = (doc: Document, label: string, nth = 0) => {
  const named = [...doc.querySelectorAll('label')].filter(
    (each) => each.textContent?.replaceAll('*', '').trim() === label,
  )[nth];
  return (doc.getElementById(named?.htmlFor ?? '') as HTMLInputElement | null)?.value;
};

/** The radio button a group has picked, by the group's question. */
const pickedIn = (doc: Document, question: string) => {
  const label = [...doc.querySelectorAll('label')].find((each) =>
    each.textContent?.includes(question),
  );
  const group = doc.getElementById(label?.htmlFor ?? '');
  return group
    ?.querySelector('[role="radio"][aria-checked="true"]')
    ?.parentElement?.textContent?.trim();
};

/** How often the form was sent, and Apply and Save pressed. */
const sent = (doc: Document) => {
  const { sfSubmits, sfApplies, sfSaves } = doc.defaultView as unknown as Record<string, number>;
  return { sfSubmits, sfApplies, sfSaves };
};

describe('reading SuccessFactors’ application', () => {
  it('reads its page of parts as one page, each part by its own heading, and its own lists and radios', async () => {
    const form = await read(working('application'));
    // One page, by the form's own name, so what it filled in from your profile stays.
    expect(form.step).toBe('Job Application Form');
    expect(asked(form)).toEqual([
      'first-name: First Name (text), in Profile Information',
      'middle-name: Middle Name (text), in Profile Information',
      'last-name: Last Name (text), in Profile Information',
      'email: Email Address (text), in Profile Information',
      'phone: Cell Phone (text), in Profile Information',
      'street: Address (text), in Profile Information',
      'city: City (text), in Profile Information',
      'country: Country (combo), in Profile Information',
      'region: State/Province (combo), in Profile Information',
      'postal-code: Zip/Postal Code (text), in Profile Information',
      'current-company: Company Name (text), in Outside Work Experience',
      'current-title: Title (text), in Outside Work Experience',
      'job-start: Start Date (date), in Outside Work Experience',
      'job-end: End Date (date), in Outside Work Experience',
      'question: Type of Business (combo), in Outside Work Experience',
      'pay: Desired Salary (text), in Job-Specific Information',
      'question: Currency (choice), in Job-Specific Information',
      'how-heard: How did you hear about this position? (combo), in Job-Specific Information',
      'authorized: Do you currently have the right to work in the location/country the position is offered? (choice), in Job-Specific Information',
      'sponsorship: Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa)? (choice), in Job-Specific Information',
      'gender: What is your gender? (choice), in Job-Specific Information',
      'race: Race/Ethnicity (combo), in Job-Specific Information',
      'veteran: Veteran Status (combo), in Job-Specific Information',
      'consent: Typed Signature (text), in Job-Specific Information',
    ]);
    // Its own radio buttons, by their own labels, "No Selection" among them, which picks none.
    expect(form.fields.find((field) => field.question === 'What is your gender?')?.options).toEqual(
      ['No Selection', 'Female', 'Male'],
    );
    // Its calendars want a day, which a job's dates never have: they're yours to pick.
    expect(form.fields.find((field) => field.question === 'Start Date')?.control).toBe('date');
    // Its Add for each part that lists jobs or schools, but for a part that's closed.
    expect(form.adders).toEqual([
      { section: 'Outside Work Experience', words: 'Add' },
      { section: 'Formal Education', words: 'Add' },
    ]);
    expect(partsOf(form, 'job')).toBe(1);
    expect(partsOf(form, 'school')).toBe(0);
    expect(looksLikeApplication(form)).toBe(true);
  });

  it('never takes its page to sign in for an application, and never fills a password', async () => {
    const doc = working('sign-in');
    const form = await read(doc);
    expect(asked(form)).toEqual([
      'email: Email Address: (text), in Already have an account?',
      'never: Password: (text), in Already have an account?',
    ]);
    expect(looksLikeApplication(form)).toBe(false);
    const filled = filledOf(
      await run(
        { do: 'fill', url: HERE, answers: [to(form, 'Password:', { text: 'not-a-password' })] },
        doc,
      ),
    );
    expect(filled).toEqual([expect.objectContaining({ ok: false, why: 'not-taken' })]);
    expect((doc.getElementById('password') as HTMLInputElement).value).toBe('');
  });

  it('says what its fields hold, as your profile filled them in, and its lists show it', async () => {
    const doc = working('application');
    const form = await read(doc);
    const answer = await run({ do: 'values', fields: form.fields }, doc);
    if (answer.did !== 'values') throw new Error('No values');
    const shown = Object.fromEntries(
      form.fields.map((field) => [
        field.question,
        answer.values.find((each) => each.ref === field.ref)?.value ?? '',
      ]),
    );
    expect(shown).toMatchObject({
      'First Name': 'Ana',
      'Last Name': 'Ruiz',
      'Email Address': 'ana@example.com',
      Country: 'United States',
      'State/Province': '',
      'Company Name': 'Tidewater Analytics',
      'Start Date': '04/01/2023',
      // Its lists' "No Selection", and its radio buttons', are none picked.
      'What is your gender?': '',
      Currency: '',
    });
  });
});

describe('filling SuccessFactors’ application', () => {
  it('fills what your profile left empty: a box, a list found by typing, its radios, and a select', async () => {
    const doc = working('application');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'First Name', { text: 'Ana María', ifEmpty: true }),
            to(form, 'Cell Phone', { text: '(303) 555-0142', ifEmpty: true }),
            to(form, 'City', { text: 'Cheyenne', ifEmpty: true }),
            to(form, 'Country', { pick: ['United States'], ifEmpty: true }),
            // Past the first page of its list: found by typing.
            to(form, 'State/Province', { pick: ['Wyoming', 'WY'], ifEmpty: true }),
            to(form, 'Currency', { pick: ['USD'], ifEmpty: true }),
            to(form, 'How did you hear about this position?', {
              pick: ['LinkedIn'],
              ifEmpty: true,
            }),
            to(
              form,
              'Do you currently have the right to work in the location/country the position is offered?',
              { pick: ['Yes'], ifEmpty: true },
            ),
            to(
              form,
              'Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa)?',
              { pick: ['No'], ifEmpty: true },
            ),
            to(form, 'What is your gender?', { pick: ['Female'], ifEmpty: true }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown, each.kept ?? false])).toEqual([
      // What your profile filled in stays.
      [true, 'Ana', true],
      [true, '(303) 555-0142', false],
      [true, 'Cheyenne', false],
      [true, 'United States', true],
      [true, 'Wyoming', false],
      [true, 'USD', false],
      [true, 'LinkedIn', false],
      [true, 'Yes', false],
      [true, 'No', false],
      [true, 'Female', false],
    ]);
    expect(boxValue(doc, 'First Name')).toBe('Ana');
    expect(boxValue(doc, 'State/Province')).toBe('Wyoming');
    expect(doc.getElementById('95:_input')?.getAttribute('title')).toBe('Wyoming');
    expect(pickedIn(doc, 'right to work')).toBe('Yes');
    expect(pickedIn(doc, 'gender')).toBe('Female');
    // Nothing was sent: no Enter, no Apply, no Save.
    expect(sent(doc)).toEqual({ sfSubmits: 0, sfApplies: 0, sfSaves: 0 });
  });

  it('fills a row your profile filled with the same job, and adds rows for the others', async () => {
    const doc = working('application');
    const form = await read(doc);
    const part = 'Outside Work Experience';
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Company Name', {
              text: 'Tidewater Analytics',
              ifEmpty: true,
              part,
              names: true,
            }),
            to(form, 'Title', { text: 'Director of Product', ifEmpty: true, part }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Tidewater Analytics'],
      [true, 'Director of Product'],
    ]);
    // Factwright has three jobs on file, and the part has room for one.
    const [offer] = partsOffers(form, { jobs: 3, schools: 0 });
    expect(offer?.label).toBe('Add 2 for your other jobs');
    if (!offer) throw new Error('No offer');
    expect(await run({ do: 'add', url: HERE, adder: offer.adder, times: offer.more }, doc)).toEqual(
      { did: 'add', added: 2 },
    );
    const now = await read(doc);
    expect(partsOf(now, 'job')).toBe(3);
    expect(asked(now).filter((each) => each.endsWith('in Outside Work Experience'))).toHaveLength(
      15,
    );
    // Each new row's boxes are empty, and its calendars drawn, for you to pick a day.
    expect(boxValue(doc, 'Company Name', 1)).toBe('');
    expect(
      now.fields.filter((field) => field.question === 'Start Date').map((field) => field.control),
    ).toEqual(['date', 'date', 'date']);
    expect(sent(doc)).toEqual({ sfSubmits: 0, sfApplies: 0, sfSaves: 0 });
  });

  it('adds a row for a school to a part with none, and fills its box and its lists', async () => {
    const doc = working('application');
    const form = await read(doc);
    const offers = partsOffers(form, { jobs: 1, schools: 2 });
    expect(offers.map((offer) => offer.label)).toEqual(['Add 2 for your other schools']);
    const [school] = offers;
    if (!school) throw new Error('No offer');
    expect(await run({ do: 'add', url: HERE, adder: school.adder, times: 2 }, doc)).toEqual({
      did: 'add',
      added: 2,
    });
    const now = await read(doc);
    const row = [
      'school: School (text), in Formal Education',
      'degree: Degree (combo), in Formal Education',
      'discipline: Major (combo), in Formal Education',
      'edu-start: Start Date (date), in Formal Education',
      'graduation: End Date (date), in Formal Education',
    ];
    expect(asked(now).filter((each) => each.endsWith('in Formal Education'))).toEqual([
      ...row,
      ...row,
    ]);
    // The part says it has a row now, not that it has none.
    expect(doc.getElementById('149:_noItemsText')?.style.display).toBe('none');
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(now, 'School', { text: 'CU Boulder', ifEmpty: true }),
            to(now, 'Degree', { pick: ["Bachelor's Degree", 'B.S.'], ifEmpty: true }),
            to(now, 'Major', { pick: ['Computer Science'], ifEmpty: true }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'CU Boulder'],
      [true, "Bachelor's Degree"],
      [true, 'Computer Science'],
    ]);
  });
});
