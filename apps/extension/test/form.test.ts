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

  it('says which part of the form each field is in, as for each job and school', async () => {
    const job = (at: number) => `
      <div class="employment">
        <div class="header"><h3>Work Experience ${at}</h3></div>
        <label>Company <input name="company-${at}"></label>
        <label>Title <input name="title-${at}"></label>
        <fieldset>
          <legend>Start date *</legend>
          <label>Month <select name="start-month-${at}"><option></option><option>March</option></select></label>
          <label>Year <input name="start-year-${at}"></label>
        </fieldset>
        <label><input type="checkbox" name="current-${at}"> I currently work here</label>
      </div>`;
    const doc = new DOMParser().parseFromString(
      `<main>
        <h1>Operations Manager</h1>
        <form>
          <label>Email <input type="email" name="email"></label>
          ${job(1)}
          ${job(2)}
          <div class="education">
            <h3>Education</h3>
            <label>School <input name="school"></label>
            <label>Degree <input name="degree"></label>
          </div>
          <fieldset>
            <legend>Professional reference</legend>
            <label>Name <input name="r1"></label>
            <label>Phone <input type="tel" name="r2"></label>
            <label>Relationship <input name="r3"></label>
            <label>Years known <input name="r4"></label>
          </fieldset>
          <label>Location <input name="location"></label>
        </form>
      </main>`,
      'text/html',
    );
    const form = await read(doc);
    const jobFields = (at: number) => [
      `current-company: Company, in Work Experience ${at}`,
      `current-title: Title, in Work Experience ${at}`,
      `job-start: Start date Month, in Work Experience ${at}`,
      `job-start: Start date Year, in Work Experience ${at}`,
      `job-current: I currently work here, in Work Experience ${at}`,
    ];
    expect(
      form.fields.map((field) => `${fieldKind(field)}: ${field.question}, in ${field.section}`),
    ).toEqual([
      'email: Email, in Operations Manager',
      ...jobFields(1),
      ...jobFields(2),
      'school: School, in Education',
      'degree: Degree, in Education',
      // A reference's name and phone are never yours.
      'question: Name, in Operations Manager › Professional reference',
      'question: Phone, in Operations Manager › Professional reference',
      'question: Relationship, in Operations Manager › Professional reference',
      'question: Years known, in Operations Manager › Professional reference',
      // Past the parts for jobs and schools, the form's own again.
      'location: Location, in Operations Manager',
    ]);
    // A date's month and year ask whatever their set does.
    expect(form.fields[3]?.required).toBe(true);
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

  it('waits a moment for a list that gets its options once another is answered, as a state’s does', async () => {
    const doc = new DOMParser().parseFromString(
      `<form>
        <label for="country">Country</label>
        <select id="country"><option value="">Select…</option><option>Canada</option><option>United States</option></select>
        <label for="region">State</label>
        <select id="region"><option value="">Select…</option></select>
      </form>`,
      'text/html',
    );
    const region = doc.getElementById('region') as HTMLSelectElement;
    // The page's own code asks its site for the country's states once it's picked.
    doc.getElementById('country')?.addEventListener('change', () => {
      setTimeout(() => {
        for (const name of ['Colorado', 'Texas']) region.append(new Option(name, name));
      }, 300);
    });
    const form = await read(doc);
    const [country, state] = form.fields;
    if (!country || !state) throw new Error('No fields');
    const filled = await run(
      {
        do: 'fill',
        url: HERE,
        answers: [
          { ref: country.ref, key: country.key, pick: ['United States'] },
          { ref: state.ref, key: state.key, pick: ['CO', 'Colorado'] },
        ],
      },
      doc,
    );
    if (filled.did !== 'fill') throw new Error('It didn’t fill the form.');
    expect(filled.filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'United States'],
      [true, 'Colorado'],
    ]);
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

describe('the boxes applicant systems make of their own', () => {
  /** An option's words as compared: lowercase, letters and digits. */
  const plainly = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const fieldOf = (form: PageForm, question: string) => {
    const field = form.fields.find((each) => each.question === question);
    if (!field) throw new Error(`No ${question}`);
    return field;
  };
  const filledOf = (answer: FormAnswer) => {
    if (answer.did !== 'fill') throw new Error('It didn’t fill the form.');
    return answer.filled;
  };
  const DENVER = ['Denver, CO', 'Denver, Colorado', 'Denver', 'United States'];

  /**
   * Lever's location box, as its own code works: as you type, it looks the city up, saying it's
   * loading, then lists the places it found, or says it found none; a click on one keeps it, in
   * the box and in a hidden field, which is what Lever takes.
   */
  function leverLooksUp(doc: Document, places: string[]) {
    const box = doc.getElementById('location-input') as HTMLInputElement;
    const kept = doc.getElementById('selected-location') as HTMLInputElement;
    const results = doc.querySelector('.dropdown-results') as HTMLElement;
    const none = doc.querySelector('.dropdown-no-results') as HTMLElement;
    const loading = doc.querySelector('.dropdown-loading-results') as HTMLElement;
    none.style.display = 'none';
    loading.style.display = 'none';
    box.addEventListener('keyup', () => {
      loading.style.display = '';
      none.style.display = 'none';
      results.replaceChildren();
      setTimeout(() => {
        loading.style.display = 'none';
        const city = plainly(box.value.split(',')[0] ?? '');
        const found = places.filter((place) => city && plainly(place).includes(city));
        if (found.length === 0) none.style.display = '';
        for (const place of found) {
          const option = doc.createElement('div');
          option.className = 'dropdown-location';
          option.textContent = place;
          option.addEventListener('click', () => {
            box.value = place;
            kept.value = JSON.stringify({ name: place });
            results.replaceChildren();
          });
          results.append(option);
        }
      }, 100);
    });
    return { box, kept };
  }

  it('reads Lever’s location box as one that takes only its own suggestions', async () => {
    const field = fieldOf(await read(fixture('lever-application')), 'Current location');
    expect(field).toMatchObject({ control: 'combo', options: [] });
    expect(fieldKind(field)).toBe('location');
  });

  it('types the place in Lever’s location box, picks the one it suggests, and checks Lever kept it', async () => {
    const doc = fixture('lever-application');
    const { box, kept } = leverLooksUp(doc, [
      'Denver City, Texas, United States',
      'Denver, Colorado, United States',
    ]);
    const { ref, key } = fieldOf(await read(doc), 'Current location');
    const filled = filledOf(
      await run({ do: 'fill', url: HERE, answers: [{ ref, key, pick: DENVER, place: true }] }, doc),
    );
    expect(filled).toEqual([{ ref, ok: true, shown: 'Denver, Colorado, United States', why: '' }]);
    expect(box.value).toBe('Denver, Colorado, United States');
    expect(JSON.parse(kept.value)).toEqual({ name: 'Denver, Colorado, United States' });
  });

  it('leaves Lever’s location box empty where it suggests no such place, as it takes nothing typed', async () => {
    const doc = fixture('lever-application');
    const { box, kept } = leverLooksUp(doc, ['Boulder, Colorado, United States']);
    const { ref, key } = fieldOf(await read(doc), 'Current location');
    const filled = filledOf(
      await run({ do: 'fill', url: HERE, answers: [{ ref, key, pick: DENVER, place: true }] }, doc),
    );
    expect(filled).toEqual([{ ref, ok: false, shown: '', why: 'no-option' }]);
    expect(box.value).toBe('');
    expect(kept.value).toBe('');
  });

  it('picks the matching place Greenhouse suggests for Location (City), and checks it shows', async () => {
    const doc = fixture('greenhouse-application');
    const box = doc.getElementById('candidate-location') as HTMLInputElement;
    const shell = box.closest('.select-shell') as HTMLElement;
    const places = [
      'Denver City, Texas, United States',
      'Denver, Denver County, Colorado, United States',
      'Denver, Pennsylvania, United States',
    ];
    // Greenhouse's own code, a box of react-select's: as you type, a moment later, the places it
    // found, in a list it names; a click shows the one picked beside the box.
    box.addEventListener('input', () => {
      setTimeout(() => {
        shell.querySelector('.select__menu')?.remove();
        const menu = doc.createElement('div');
        menu.className = 'select__menu';
        const list = doc.createElement('div');
        list.setAttribute('role', 'listbox');
        list.id = 'react-select-candidate-location-listbox';
        const typed = plainly(box.value.split(',')[0] ?? '');
        for (const place of places.filter((each) => typed && plainly(each).includes(typed))) {
          const option = doc.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = place;
          option.addEventListener('click', () => {
            const shown = doc.createElement('div');
            shown.className = 'select__single-value';
            shown.textContent = place;
            shell.querySelector('.select__value-container')?.prepend(shown);
            box.value = '';
            menu.remove();
            box.setAttribute('aria-expanded', 'false');
            box.removeAttribute('aria-controls');
          });
          list.append(option);
        }
        menu.append(list);
        shell.append(menu);
        box.setAttribute('aria-expanded', 'true');
        box.setAttribute('aria-controls', list.id);
      }, 100);
    });
    const field = fieldOf(await read(doc), 'Location (City)');
    const filled = filledOf(
      await run(
        {
          do: 'fill',
          url: HERE,
          answers: [{ ref: field.ref, key: field.key, pick: DENVER, place: true }],
        },
        doc,
      ),
    );
    // Not Denver City, Texas, though it starts with Denver and comes first.
    expect(filled).toEqual([
      {
        ref: field.ref,
        ok: true,
        shown: 'Denver, Denver County, Colorado, United States',
        why: '',
      },
    ]);
  });

  it('reads Ashby’s Yes and No as a choice of one, never the hidden box it keeps the answer in', async () => {
    const form = await read(fixture('ashby-application'));
    const asked = fieldOf(form, 'Are you based in a EU or equivalent timezone?');
    expect(asked).toMatchObject({ control: 'choice', options: ['Yes', 'No'] });
    expect(form.fields.filter((field) => field.control === 'check')).toEqual([]);
  });

  it('picks Ashby’s Yes or No as a click does, and checks it stayed pressed', async () => {
    const doc = fixture('ashby-application');
    // Ashby's own code: a click presses the one, and lets the other go.
    for (const button of doc.querySelectorAll('button[aria-pressed]')) {
      button.addEventListener('click', () => {
        for (const each of button.parentElement?.querySelectorAll('button[aria-pressed]') ?? []) {
          each.setAttribute('aria-pressed', String(each === button));
        }
      });
    }
    const asked = fieldOf(await read(doc), 'Are you based in a EU or equivalent timezone?');
    const answer = { ref: asked.ref, key: asked.key, pick: ['No'] };
    expect(filledOf(await run({ do: 'fill', url: HERE, answers: [answer] }, doc))).toEqual([
      { ref: asked.ref, ok: true, shown: 'No', why: '' },
    ]);
    const values = await run({ do: 'values', fields: [answer] }, doc);
    expect(values).toMatchObject({ values: [{ ref: asked.ref, value: 'No' }] });
    // A page that never presses it hasn't taken it.
    const still = fixture('ashby-application');
    const again = fieldOf(await read(still), 'Are you based in a EU or equivalent timezone?');
    expect(
      filledOf(
        await run(
          { do: 'fill', url: HERE, answers: [{ ref: again.ref, key: again.key, pick: ['Yes'] }] },
          still,
        ),
      ),
    ).toEqual([{ ref: again.ref, ok: false, shown: '', why: 'not-taken' }]);
  });

  it('presses Yes or No in a form that would submit on such a button, and the form isn’t submitted', async () => {
    document.body.innerHTML = `
      <form id="apply">
        <label for="relocate">Would you relocate?</label>
        <div class="yesno"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div>
        <label for="name">Full name</label><input id="name" name="name" />
      </form>`;
    const apply = document.getElementById('apply') as HTMLFormElement;
    let submitted = 0;
    apply.addEventListener('submit', (event) => {
      submitted += 1;
      event.preventDefault();
    });
    for (const button of document.querySelectorAll('button[aria-pressed]')) {
      button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true'));
    }
    const read = await formPage({ do: 'read' }, document, HERE);
    if (read.did !== 'read') throw new Error('It didn’t read the form.');
    const asked = read.form.fields.find((field) => field.question === 'Would you relocate?');
    if (!asked) throw new Error('No question');
    const filled = await formPage(
      { do: 'fill', url: HERE, answers: [{ ref: asked.ref, key: asked.key, pick: ['Yes'] }] },
      document,
      HERE,
    );
    expect(filledOf(filled)).toEqual([{ ref: asked.ref, ok: true, shown: 'Yes', why: '' }]);
    expect(submitted).toBe(0);
    document.body.innerHTML = '';
  });
});

describe('fields inside components', () => {
  /**
   * A page built of components that each keep their own elements, in a shadow root the page
   * leaves open, as a form made of web components is: each field's label and box inside its own,
   * and the form's headings and sets around them, outside.
   */
  function componentsPage(): Document {
    const doc = new DOMParser().parseFromString(
      `<main><form>
        <h2>Personal information</h2>
        <x-field data-id="first" data-label="First name *"></x-field>
        <x-field data-id="email" data-label="Email" data-type="email"></x-field>
        <h2>Experience</h2>
        <fieldset>
          <legend>Are you willing to relocate?</legend>
          <x-radio data-id="yes" data-label="Yes"></x-radio>
          <x-radio data-id="no" data-label="No"></x-radio>
        </fieldset>
        <x-field data-id="summary" aria-label="Tell us about yourself" data-type="textarea"></x-field>
      </form></main>`,
      'text/html',
    );
    for (const host of doc.querySelectorAll<HTMLElement>('x-field, x-radio')) {
      const { id = '', label = '', type = 'text' } = host.dataset;
      const inner = host.attachShadow({ mode: 'open' });
      if (host.tagName === 'X-RADIO') {
        inner.innerHTML = `<input type="radio" name="relocate" id="${id}"><label for="${id}">${label}</label>`;
      } else if (type === 'textarea') {
        inner.innerHTML = `<textarea id="${id}"></textarea>`;
      } else {
        inner.innerHTML = `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}"${label.endsWith('*') ? ' required' : ''}></div>`;
      }
    }
    return doc;
  }

  it('reads each field inside its component, by its own label inside, and the parts around it outside', async () => {
    const form = await read(componentsPage());
    expect(
      form.fields.map(
        (field) => `${fieldKind(field)}: ${field.question} (${field.control}), in ${field.section}`,
      ),
    ).toEqual([
      'first-name: First name (text), in Personal information',
      'email: Email (text), in Personal information',
      'relocation: Are you willing to relocate? (choice), in Experience',
      'question: Tell us about yourself (long), in Experience',
    ]);
    expect(form.fields[0]?.required).toBe(true);
    expect(form.fields[2]?.options).toEqual(['Yes', 'No']);
  });

  it('fills a field inside a component as typing would, and the page outside hears it', async () => {
    const doc = componentsPage();
    const form = await read(doc);
    const [first, , relocate] = form.fields;
    if (!first || !relocate) throw new Error('No fields');
    const heard: string[] = [];
    doc.querySelector('form')?.addEventListener('input', (event) => {
      heard.push((event.target as Element).tagName);
    });
    const filled = await run(
      {
        do: 'fill',
        url: HERE,
        answers: [
          { ref: first.ref, key: first.key, text: 'Ana' },
          { ref: relocate.ref, key: relocate.key, pick: ['Yes'] },
        ],
      },
      doc,
    );
    if (filled.did !== 'fill') throw new Error('It didn’t fill the form.');
    expect(filled.filled.map((each) => [each.ok, each.shown])).toEqual([
      [true, 'Ana'],
      [true, 'Yes'],
    ]);
    const box = doc.querySelector('x-field')?.shadowRoot?.querySelector('input');
    expect(box?.value).toBe('Ana');
    // As typing does, what goes in is heard outside the component, as the component itself.
    expect(heard).toContain('X-FIELD');
  });
});
