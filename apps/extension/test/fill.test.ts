import type { FieldReply } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import {
  fieldValue,
  fillAnswers,
  isCopyOnly,
  looksLikeApplication,
  newAnswers,
  sentAnswers,
} from '../src/fill.ts';
import type { FieldValue, PageField, PageForm } from '../src/page/form.ts';

let place = 0;
/** A field as the page function reads one, with only what a test sets. */
const field = (question: string, more: Partial<PageField> = {}): PageField => {
  const ref = more.ref ?? place++;
  return {
    ref,
    key: `INPUT|text|${ref}||${question}`,
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
  };
};

const form = (fields: PageField[]): PageForm => ({
  url: 'https://job-boards.greenhouse.io/harborpine/jobs/4567890',
  title: 'Job Application for Account Executive at Harbor & Pine',
  fields,
  submitted: false,
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
});
