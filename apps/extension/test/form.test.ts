import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldKind } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { type FormAnswer, type FormTask, formPage, type PageForm } from '../src/page/form.ts';

// The applications are Greenhouse's, Lever's and Ashby's forms as Chromium showed them on
// 2026-10-23: the same elements, classes and attributes, with the companies made up, and long
// lists of countries cut short. The plain one is made up, for what those three don't have.
const FIXTURES = join(import.meta.dirname, 'fixtures');

/** A fixture, as the browser would have it. */
const fixture = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `${name}.html`), 'utf8'),
    'text/html',
  );

/** Where the tests' forms are, as the page's address. */
const HERE = 'https://jobs.example/apply';

const run = (task: FormTask, doc: Document) => formPage(task, doc, HERE);

async function read(doc: Document): Promise<PageForm> {
  const answer = await run({ do: 'read' }, doc);
  if (answer.did !== 'read') throw new Error('It didn’t read the form.');
  return answer.form;
}

/** Each field as "kind: question", to compare at a glance. */
const asked = (form: PageForm) =>
  form.fields.map((field) => `${fieldKind(field)}: ${field.question}`);

describe('reading an application form', () => {
  it('reads a Greenhouse form, with its question for each field and its own boxes that pick', async () => {
    const form = await read(fixture('greenhouse-application'));
    expect(asked(form)).toEqual([
      'first-name: First Name',
      'last-name: Last Name',
      'email: Email',
      'country: Country',
      'phone: Phone',
      'location: Location (City)',
      'resume: Resume/CV',
      'linkedin: LinkedIn Profile',
      'question: Other Website',
      'question: Why do you want to join Harbor & Pine?',
      'pronouns: Pronouns',
      'question: Additional Information',
      'location: From where do you intend to work?',
      'preferred-name: Preferred First Name',
      'authorized: Are you authorized to work in the country for which you applied?',
      'question: Have you ever worked for Harbor & Pine before, as an employee or a contractor/consultant?',
      'gender: Gender',
      'hispanic: Are you Hispanic/Latino?',
      'veteran: Veteran Status',
    ]);
    expect(form.fields.map((field) => field.control)).toEqual([
      'text',
      'text',
      'text',
      'combo',
      'text',
      'combo',
      'file',
      'text',
      'text',
      'long',
      'combo',
      'long',
      'text',
      'text',
      'combo',
      'combo',
      'combo',
      'combo',
      'combo',
    ]);
    // Its required fields, marked with "*" or by the field itself, and the resume by its group.
    expect(form.fields.filter((field) => field.required).map((field) => field.question)).toEqual([
      'First Name',
      'Last Name',
      'Email',
      'Country',
      'Phone',
      'Location (City)',
      'Resume/CV',
      'Why do you want to join Harbor & Pine?',
      'From where do you intend to work?',
      'Are you authorized to work in the country for which you applied?',
      'Have you ever worked for Harbor & Pine before, as an employee or a contractor/consultant?',
    ]);
    expect(form.fields[9]?.hint).toBe(
      'Please share 3-4 sentences on why you want to join Harbor & Pine',
    );
  });

  it('reads a Lever form, with its options as each label says them', async () => {
    const form = await read(fixture('lever-application'));
    expect(asked(form)).toEqual([
      'resume: Resume/CV',
      'full-name: Full name',
      'pronouns: Pronouns',
      'question: Custom',
      'email: Email',
      'phone: Phone',
      'location: Current location',
      'current-company: Current company',
      'linkedin: LinkedIn URL',
      'github: GitHub URL',
      'website: Portfolio URL',
      'question: Other website',
      'question: Have you ever been previously employed by Northwind Labs?',
      'location: What is your location?',
      'gender: What best describes your gender?',
      'race: What is your race/ethnicity?:',
      'veteran: Are you a veteran/have you served in the military?',
      'consent: Northwind Labs has my consent to contact me about future job opportunities.',
    ]);
    expect(form.fields[2]?.options.slice(0, 3)).toEqual(['He/him', 'She/her', 'They/them']);
    expect(form.fields[14]?.options).toEqual([
      'Woman',
      'Man',
      'Non-binary',
      'I use another term',
      'Prefer not to disclose',
    ]);
  });

  it('reads an Ashby form, with each field’s hint, and leaves out its drop-anywhere upload', async () => {
    const form = await read(fixture('ashby-application'));
    expect(asked(form).slice(0, 6)).toEqual([
      'full-name: Name',
      'email: Email',
      'resume: Resume',
      'cover-letter-text: Cover letter',
      'github: Github',
      'linkedin: LinkedIn',
    ]);
    expect(form.fields[4]?.hint).toMatch(/^Please provide your GitHub username/);
    expect(form.fields.filter((field) => field.control === 'file')).toHaveLength(1);
  });

  it('reads no field kept from you, or see-through, as a page keeps traps for bots', async () => {
    const form = await read(fixture('hidden-fields'));
    const questions = form.fields.map((field) => field.question);
    expect(questions).toEqual(
      expect.arrayContaining(['Full name', 'Are you willing to relocate?']),
    );
    // Without layout, as here, a page can only say so on the field or around it; a browser,
    // which lays the page out, leaves out the rest too (scripts/e2e-fill.ts).
    for (const hidden of ['Nickname', 'Email', 'Phone']) expect(questions).not.toContain(hidden);
  });

  it('reads only the form’s own fields: none hidden, in a header or footer, or a search', async () => {
    const form = await read(fixture('plain-application'));
    expect(asked(form)).toEqual([
      'full-name: Full name',
      'email: Email address',
      'phone: Phone',
      'region: State',
      'sponsorship: Will you now or in the future require visa sponsorship?',
      'question: Which shifts can you work?',
      'question: Why do you want to work at Fernway?',
      'resume: Resume',
      'never: Date of birth',
      'never: Create a password',
      'consent: I agree to the privacy policy',
    ]);
    expect(form.fields[3]?.options).toEqual(['Colorado', 'Utah']);
    expect(form.fields[6]).toMatchObject({ limit: 500, hint: 'Up to 500 characters max.' });
    expect(form.title).toBe('Apply: Operations Manager | Fernway');
    expect(form.submitted).toBe(false);
  });

  it('knows a page that says an application went in', async () => {
    const doc = new DOMParser().parseFromString(
      '<main><h1>Thank you for applying!</h1><p>We’ll be in touch.</p></main>',
      'text/html',
    );
    expect((await read(doc)).submitted).toBe(true);
  });
});

describe('filling a form', () => {
  /** Fills the plain form, and gives back the page and how each field went. */
  async function fillPlain(answers: (form: PageForm) => FormTask & { do: 'fill' }) {
    const doc = fixture('plain-application');
    const form = await read(doc);
    const filled = (await run(answers(form), doc)) as Extract<FormAnswer, { did: 'fill' }>;
    return { doc, form, filled: filled.filled };
  }
  const at = (form: PageForm, question: string) => {
    const field = form.fields.find((each) => each.question === question);
    if (!field) throw new Error(`No ${question}`);
    return { ref: field.ref, key: field.key };
  };

  it('types into boxes, picks options, and checks each took, as the page shows them', async () => {
    const { doc, filled } = await fillPlain((form) => ({
      do: 'fill',
      url: HERE,
      answers: [
        { ...at(form, 'Full name'), text: 'Ana María Ruiz' },
        { ...at(form, 'Email address'), text: 'ana@example.com' },
        { ...at(form, 'State'), pick: ['CO', 'Colorado'] },
        { ...at(form, 'Will you now or in the future require visa sponsorship?'), pick: ['No'] },
        { ...at(form, 'Which shifts can you work?'), pick: ['Day', 'Night'] },
        { ...at(form, 'Why do you want to work at Fernway?'), text: 'Your routes run on time.' },
      ],
    }));
    expect(filled.map(({ ok, shown }) => [ok, shown])).toEqual([
      [true, 'Ana María Ruiz'],
      [true, 'ana@example.com'],
      [true, 'Colorado'],
      [true, 'No'],
      [true, 'Day, Night'],
      [true, 'Your routes run on time.'],
    ]);
    expect((doc.getElementById('full') as HTMLInputElement).value).toBe('Ana María Ruiz');
    expect((doc.getElementById('state') as HTMLSelectElement).value).toBe('CO');
    const sponsor = doc.querySelector<HTMLInputElement>('input[name="sponsor"][value="no"]');
    expect(sponsor?.checked).toBe(true);
  });

  it('says when no option is the answer, and changes nothing there', async () => {
    const { doc, filled } = await fillPlain((form) => ({
      do: 'fill',
      url: HERE,
      answers: [{ ...at(form, 'State'), pick: ['Texas', 'TX'] }],
    }));
    expect(filled).toEqual([{ ref: 3, ok: false, shown: '', why: 'no-option' }]);
    expect((doc.getElementById('state') as HTMLSelectElement).value).toBe('');
  });

  it('picks only an option with the same words, for an answer given to another form', async () => {
    const { filled } = await fillPlain((form) => ({
      do: 'fill',
      url: HERE,
      answers: [{ ...at(form, 'State'), pick: ['Color'], exact: true }],
    }));
    expect(filled[0]).toMatchObject({ ok: false, why: 'no-option' });
  });

  it('never fills a password or agrees to anything, whatever it’s asked to put there', async () => {
    const { doc, filled } = await fillPlain((form) => ({
      do: 'fill',
      url: HERE,
      answers: [
        { ...at(form, 'Create a password'), text: 'hunter2' },
        { ...at(form, 'I agree to the privacy policy'), text: 'yes' },
      ],
    }));
    expect(filled.map((each) => each.ok)).toEqual([false, false]);
    expect((doc.getElementById('pw') as HTMLInputElement).value).toBe('');
    expect(doc.querySelector<HTMLInputElement>('input[name="consent"]')?.checked).toBe(false);
  });

  it('finds a field that moved, as when a form adds one above it, and fills nothing in its place', async () => {
    const doc = fixture('plain-application');
    const form = await read(doc);
    const email = form.fields[1];
    if (!email) throw new Error('No email field');
    const added = doc.createElement('div');
    added.innerHTML =
      '<label for="pref">Preferred name</label><input id="pref" name="preferred" />';
    doc.getElementById('apply')?.prepend(added);
    const filled = (await run(
      {
        do: 'fill',
        url: HERE,
        answers: [{ ref: email.ref, key: email.key, text: 'ana@example.com' }],
      },
      doc,
    )) as Extract<FormAnswer, { did: 'fill' }>;
    expect(filled.filled[0]?.ok).toBe(true);
    expect((doc.getElementById('mail') as HTMLInputElement).value).toBe('ana@example.com');
    expect((doc.getElementById('pref') as HTMLInputElement).value).toBe('');
    // A key no field has is never filled at all.
    const gone = (await run(
      { do: 'fill', url: HERE, answers: [{ ref: 2, key: 'gone', text: 'x' }] },
      doc,
    )) as Extract<FormAnswer, { did: 'fill' }>;
    expect(gone.filled).toEqual([{ ref: 2, ok: false, shown: '', why: 'moved' }]);
  });

  it('reads what’s in the fields it’s asked about, whole, and never a password’s', async () => {
    const doc = fixture('plain-application');
    const form = await read(doc);
    (doc.getElementById('mail') as HTMLInputElement).value = 'ana@example.com';
    (doc.getElementById('pw') as HTMLInputElement).value = 'hunter2';
    const long = 'A long answer. '.repeat(100).trim();
    (doc.getElementById('why') as HTMLTextAreaElement).value = long;
    const named = (questions: string[]) =>
      form.fields
        .filter((field) => questions.includes(field.question))
        .map(({ ref, key }) => ({ ref, key }));
    const values = (await run(
      {
        do: 'values',
        fields: named([
          'Email address',
          'Create a password',
          'Why do you want to work at Fernway?',
        ]),
      },
      doc,
    )) as Extract<FormAnswer, { did: 'values' }>;
    expect(values.values.map((each) => each.value)).toEqual(['ana@example.com', long, '']);
    expect(JSON.stringify(values)).not.toContain('hunter2');
    expect(values.submitted).toBe(false);
    // Only those: the phone it wasn't asked about isn't read.
    (doc.getElementById('tel') as HTMLInputElement).value = '(303) 555-0142';
    const one = (await run({ do: 'values', fields: named(['Email address']) }, doc)) as Extract<
      FormAnswer,
      { did: 'values' }
    >;
    expect(JSON.stringify(one)).not.toContain('555-0142');
  });

  it('fills only the form at the address it read it at', async () => {
    const doc = fixture('plain-application');
    const form = await read(doc);
    const answer = await run(
      {
        do: 'fill',
        url: 'https://jobs.example/other/apply',
        answers: [{ ...at(form, 'Full name'), text: 'Ana María Ruiz' }],
      },
      doc,
    );
    expect(answer).toEqual({ did: 'elsewhere' });
    expect((doc.getElementById('full') as HTMLInputElement).value).toBe('');
    // What's after a # can change as a page goes through its own steps.
    const same = await run(
      {
        do: 'fill',
        url: `${HERE}#step-2`,
        answers: [{ ...at(form, 'Full name'), text: 'Ana María Ruiz' }],
      },
      doc,
    );
    expect(same).toMatchObject({ did: 'fill', filled: [{ ok: true }] });
  });

  it('says how each field went by the place it was asked about, though the field moved', async () => {
    const doc = fixture('plain-application');
    const form = await read(doc);
    const added = doc.createElement('div');
    added.innerHTML =
      '<label for="pref">Preferred name</label><input id="pref" name="preferred" />';
    doc.getElementById('apply')?.prepend(added);
    const email = at(form, 'Email address');
    const filled = (await run(
      { do: 'fill', url: HERE, answers: [{ ...email, text: 'ana@example.com' }] },
      doc,
    )) as Extract<FormAnswer, { did: 'fill' }>;
    expect(filled.filled).toEqual([
      { ref: email.ref, ok: true, shown: 'ana@example.com', why: '' },
    ]);
  });

  it('never clicks a button that submits, and stops anything submitting the form as it fills', async () => {
    document.body.innerHTML = `
      <form id="apply" action="/apply">
        <label id="country">Country</label>
        <button role="combobox" aria-labelledby="country" aria-controls="countries">Pick one</button>
        <div role="listbox" id="countries"><div role="option">Canada</div></div>
        <label for="name">Full name</label>
        <input id="name" name="name" />
        <button type="submit">Submit application</button>
      </form>`;
    const apply = document.getElementById('apply') as HTMLFormElement;
    // A page that submits its form once a box changes.
    (document.getElementById('name') as HTMLInputElement).addEventListener('change', () =>
      apply.requestSubmit(),
    );
    let submitted = 0;
    let clicked = 0;
    apply.addEventListener('submit', (event) => {
      submitted += 1;
      event.preventDefault();
    });
    document.querySelector('button[role="combobox"]')?.addEventListener('click', () => {
      clicked += 1;
    });
    const form = await formPage({ do: 'read' }, document, HERE);
    if (form.did !== 'read') throw new Error('It didn’t read the form.');
    const [country, name] = form.form.fields;
    if (!country || !name) throw new Error('No fields');
    await formPage(
      {
        do: 'fill',
        url: HERE,
        answers: [
          { ref: country.ref, key: country.key, pick: ['Canada'] },
          { ref: name.ref, key: name.key, text: 'Ana María Ruiz' },
        ],
      },
      document,
      HERE,
    );
    expect(clicked).toBe(0);
    expect(submitted).toBe(0);
    // Once it's done, the page is as it was: you submit it.
    apply.requestSubmit();
    expect(submitted).toBe(1);
    document.body.innerHTML = '';
  });

  it('outlines what’s left for you in orange, until it has an answer', async () => {
    const doc = fixture('plain-application');
    const form = await read(doc);
    const why = form.fields[6];
    if (!why) throw new Error('No question');
    await run({ do: 'outline', fields: [{ ref: why.ref, key: why.key }] }, doc);
    const box = doc.getElementById('why') as HTMLTextAreaElement;
    expect(box.style.outline).toContain('solid');
    box.value = 'Because.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(box.style.outline).toBe('');
  });
});
