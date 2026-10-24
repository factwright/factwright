import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { smartRecruitersActs } from '../scripts/smartrecruiters-own-code.ts';
import { looksLikeApplication } from '../src/fill.ts';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';
import { partsOf, partsOffers } from '../src/several-pages.ts';

// SmartRecruiters' newer application form, "Easy apply", built from its markup as public captures
// show it in September and October 2026, for a made-up company, Saltmarsh Robotics: its own
// components, each keeping its elements in a shadow root it leaves open, which its own code draws,
// acted out as scripts/smartrecruiters-own-code.ts has it. No page was saved from a real
// application for these, as SmartRecruiters shows automated browsers a bot check.
const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * A page of the form, with SmartRecruiters' own code on it, as it works: in the test's own window,
 * where a box you leave hears it, as its dates must to keep what's typed.
 */
const working = (name: string) => {
  const page = new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `smartrecruiters-${name}.html`), 'utf8'),
    'text/html',
  );
  document.title = page.title;
  document.body.replaceWith(document.importNode(page.body, true));
  smartRecruitersActs(document, '');
  return document;
};

/** The form's address, as SmartRecruiters' posting links to it. */
const HERE =
  'https://jobs.smartrecruiters.com/oneclick-ui/company/SaltmarshRobotics/publication/5a1c0de4-2b8f-4e7a-9d31-0c6e2f8b7a15?dcr_ci=SaltmarshRobotics';

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

/** What the page's own form was told, by each field's name, as Angular keeps it. */
const model = (doc: Document) =>
  (doc.defaultView as unknown as { srModel: Record<string, unknown> }).srModel;
/** How often its own Next and Submit were pressed. */
const pressed = (doc: Document) => {
  const { srNexts, srSubmits } = doc.defaultView as unknown as Record<string, number>;
  return { srNexts, srSubmits };
};

/** Presses one of the page's own buttons, as you would, by its name. */
const pressButton = (doc: Document, test: string, at = 0) => {
  const host = doc.querySelectorAll(`oc-button[data-test="${test}"] spl-button`)[at];
  (host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null)?.click();
};

describe('reading SmartRecruiters’ newer form', () => {
  it('reads its first page inside its components, by each one’s own label, part by part', async () => {
    const form = await read(working('application'));
    expect(form.step).toBe('Easy apply');
    expect(asked(form)).toEqual([
      'first-name: First name (text), in Personal information',
      'last-name: Last name (text), in Personal information',
      'email: Email (text), in Personal information',
      'email: Confirm your email (text), in Personal information',
      'city: City (combo), in Personal information',
      'phone-country: Country code (combo), in Personal information',
      'phone: Phone number (text), in Personal information',
      'linkedin: LinkedIn (text), in Your Profiles',
      'website: Website (text), in Your Profiles',
      // Its only field's heading is its question, so its part is the form's own, as the job's title.
      'resume: Resume (file), in Robotics Software Intern',
      'question: Let the company know about your interest working there (long), in Message to the Hiring Team',
    ]);
    // Required as its own boxes say, and its Easy Apply box, which reads a resume to fill the
    // form, is the site's own way to apply, never a field.
    expect(form.fields.find((field) => field.question === 'First name')?.required).toBe(true);
    expect(form.fields.find((field) => field.question === 'LinkedIn')?.required).toBe(false);
    // Its Add for a job and for a school.
    expect(form.adders).toEqual([
      { section: 'Experience', words: 'Add' },
      { section: 'Education', words: 'Add' },
    ]);
    expect(looksLikeApplication(form)).toBe(true);
  });

  it('reads the screening questions, inside a component inside the page, as their own words ask them', async () => {
    const form = await read(working('screening'));
    expect(form.step).toBe('Preliminary questions');
    expect(
      form.fields.map((field) => `${fieldKind(field)}: ${field.question} (${field.control})`),
    ).toEqual([
      'authorized: Are you legally authorized to work in the United States? (choice)',
      'sponsorship: Will you now or in the future require sponsorship for an employment visa? (choice)',
      'degree: What is your highest level of education? (combo)',
      'question: Which robot would you most like to build, and why? (text)',
      'consent: I declare that the information in this application is true and complete. (check)',
      'gender: Gender (combo)',
      'hispanic: Are you Hispanic or Latino? (choice)',
      'veteran: Are you a protected veteran? (choice)',
      'consent: You declare that you have read and agree to the privacy notice of Saltmarsh Robotics. (check)',
    ]);
    // Its radio buttons are its own, with no input, each named by its own words.
    expect(form.fields[0]).toMatchObject({ options: ['Yes', 'No'], required: true });
    expect(form.fields.find((field) => field.question === 'Gender')?.options).toEqual([]);
  });
});

describe('filling SmartRecruiters’ newer form', () => {
  it('types in its boxes, picks a place it offers, and the page’s own form hears each', async () => {
    const doc = working('application');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'First name', { text: 'Ana María' }),
            to(form, 'Email', { text: 'ana@example.com' }),
            to(form, 'Confirm your email', { text: 'ana@example.com' }),
            to(form, 'City', { pick: ['Denver, CO', 'Denver, Colorado'], place: true }),
            to(form, 'Country code', { pick: ['Canada'] }),
            to(form, 'Phone number', { text: '(303) 555-0142' }),
            to(form, 'LinkedIn', { text: 'https://www.linkedin.com/in/anaruiz' }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Ana María'],
      [true, 'ana@example.com'],
      [true, 'ana@example.com'],
      [true, 'Denver, CO, US'],
      // The country's box shows its code alone.
      [true, '+1'],
      [true, '(303) 555-0142'],
      [true, 'https://www.linkedin.com/in/anaruiz'],
    ]);
    expect(model(doc)).toMatchObject({
      firstName: 'Ana María',
      email: 'ana@example.com',
      emailConfirmation: 'ana@example.com',
      // A place is the one it offered, which is what the form keeps, never what was typed.
      'location-autocomplete': { id: 'US_CO_CITY_denver', text: 'Denver, CO, US' },
      'personal-info-phone': {
        country: 'CA',
        value: '(303) 555-0142',
        internationalFormat: '+1 (303) 555-0142',
      },
      linkedIn: 'https://www.linkedin.com/in/anaruiz',
    });
    expect(pressed(doc)).toMatchObject({ srNexts: 0, srSubmits: 0 });
  });

  it('fills a job’s part that Add opens: a title it offers as typed, and a date as MM/YYYY once you leave it', async () => {
    const doc = working('application');
    pressButton(doc, 'add-experience');
    const form = await read(doc);
    expect(asked(form).filter((each) => each.endsWith('Experience 1'))).toEqual([
      'current-title: Title (combo), in Experience 1',
      'current-company: Company (combo), in Experience 1',
      'job-location: Office location (combo), in Experience 1',
      'job-summary: Description (long), in Experience 1',
      'job-start: From (text), in Experience 1',
      'job-end: To (text), in Experience 1',
      'job-current: I currently work here (check), in Experience 1',
    ]);
    expect(partsOf(form, 'job')).toBe(1);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Title', { text: 'Director of Product' }),
            to(form, 'Company', { text: 'Tidewater Analytics' }),
            to(form, 'From', { text: '04/2023' }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Director of Product'],
      [true, 'Tidewater Analytics'],
      [true, '04/2023'],
    ]);
    expect(model(doc)).toMatchObject({
      'job-title-autocomplete': 'Director of Product',
      'company-autocomplete': 'Tidewater Analytics',
      startDate: '2023-04-01',
    });
  });

  it('fills a school’s part that Add opens, a school it offers picked as it says it', async () => {
    const doc = working('application');
    pressButton(doc, 'add-education');
    const form = await read(doc);
    expect(asked(form).filter((each) => each.endsWith('Education 1'))).toEqual([
      'school: Institution (combo), in Education 1',
      'discipline: Major (text), in Education 1',
      'degree: Degree (text), in Education 1',
      'edu-location: School location (combo), in Education 1',
      'edu-start: From (text), in Education 1',
      'graduation: To (text), in Education 1',
      'question: I currently attend (check), in Education 1',
    ]);
    expect(partsOf(form, 'school')).toBe(1);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Institution', { text: 'Colorado State University' }),
            to(form, 'Major', { text: 'Computer Science' }),
            to(form, 'Degree', { text: 'BS' }),
            to(form, 'From', { text: '08/2015' }),
            to(form, 'To', { text: '05/2019' }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Colorado State University'],
      [true, 'Computer Science'],
      [true, 'BS'],
      [true, '08/2015'],
      [true, '05/2019'],
    ]);
    expect(model(doc)).toMatchObject({
      'institution-autocomplete': 'Colorado State University',
      major: 'Computer Science',
      degree: 'BS',
      startDate: '2015-08-01',
      endDate: '2019-05-01',
    });
  });

  it('numbers a new part after the jobs it saved, and offers to add one for each other job', async () => {
    const doc = working('application');
    pressButton(doc, 'add-experience');
    const first = await read(doc);
    await run(
      {
        do: 'fill',
        url: HERE,
        answers: [
          to(first, 'Title', { text: 'Director of Product' }),
          to(first, 'From', { text: '04/2023' }),
          to(first, 'To', { text: '10/2026' }),
        ],
      },
      doc,
    );
    // You check the part, and press its own Save: it's a job the page lists, no fields left.
    pressButton(doc, 'experience-save');
    const saved = await read(doc);
    expect(partsOf(saved, 'job')).toBe(0);
    expect(saved.adders[0]).toEqual({ section: 'Experience', words: 'Add', saved: 1 });
    expect(partsOffers(saved, { jobs: 3, schools: 0 }).map((offer) => offer.label)).toEqual([
      'Add 2 for your other jobs',
    ]);
    pressButton(doc, 'add-experience');
    const next = await read(doc);
    expect(next.fields.find((field) => field.question === 'Title')?.section).toBe('Experience 2');
  });

  it('picks its own radio buttons and its lists’ options, and leaves agreeing for you', async () => {
    const doc = working('screening');
    const form = await read(doc);
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [
            to(form, 'Are you legally authorized to work in the United States?', { pick: ['Yes'] }),
            to(form, 'Will you now or in the future require sponsorship for an employment visa?', {
              pick: ['No'],
            }),
            to(form, 'What is your highest level of education?', {
              pick: ["Bachelor's degree", 'Bachelor of Science'],
            }),
            to(form, 'Gender', { pick: ['Female', 'Woman'] }),
          ],
        },
        doc,
      ),
    );
    expect(filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Yes'],
      [true, 'No'],
      [true, 'Bachelor of Science'],
      [true, 'Female'],
    ]);
    expect(model(doc)).toMatchObject({
      question_authorized: '1',
      question_sponsorship: '0',
      question_education: 'bs',
      question_gender: 'g1',
    });
    // Its boxes that agree are never ticked, and its Back and Submit never pressed.
    const declaration = (await read(doc)).fields.find((field) => field.control === 'check');
    expect(declaration?.question).toMatch(/^I declare/);
    expect(pressed(doc)).toMatchObject({ srNexts: 0, srSubmits: 0 });
  });
});
