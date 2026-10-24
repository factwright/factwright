import type { FieldReply } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import type { FieldValue, PageField, PageForm } from '../src/page/form.ts';
import { carriedOn, NO_EARLIER, nextPageOf, partsOffers, siteOf } from '../src/several-pages.ts';

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

const form = (step: string, fields: PageField[], more: Partial<PageForm> = {}): PageForm => ({
  url: 'https://larkspur.wd5.myworkdayjobs.com/en-US/Careers/job/Denver/PM_R1/apply/applyManually',
  title: 'Senior Product Manager',
  fields,
  submitted: false,
  step,
  adders: [],
  ...more,
});

const valuesOf = (fields: PageField[], texts: string[]): FieldValue[] =>
  fields.map((each, at) => ({ ref: each.ref, key: each.key, value: texts[at] ?? '' }));

describe('an application that runs over several pages', () => {
  it('keeps each page’s own answers and new answers, for when you mark the job applied', () => {
    const why = field('Why Larkspur?', { control: 'long' });
    const phone = field('Phone Number', { type: 'tel' });
    const questions = form('Application Questions', [why, phone]);
    const replies: FieldReply[] = [
      { kind: 'question', source: 'you', left: 'new' },
      { kind: 'phone', text: '(303) 555-0142', source: 'profile' },
    ];
    const earlier = carriedOn(
      {
        form: questions,
        replies,
        values: valuesOf([why, phone], ['Your grid work.', '(720) 555-0199']),
        job: 'larkspur--pm',
        copyOnly: false,
      },
      NO_EARLIER,
    );
    expect(earlier.job).toBe('larkspur--pm');
    expect(earlier.sent).toEqual([{ question: 'Why Larkspur?', text: 'Your grid work.' }]);
    expect(earlier.offers.map((offer) => [offer.kind, offer.text])).toEqual([
      ['phone', '(720) 555-0199'],
    ]);
    // A later page's answer to the same question takes the earlier one's place.
    const later = carriedOn(
      {
        form: form('Review', [why]),
        replies: [replies[0] as FieldReply],
        values: valuesOf([why], ['Your grid work, and its team.']),
        job: null,
        copyOnly: false,
      },
      earlier,
    );
    expect(later.sent).toEqual([
      { question: 'Why Larkspur?', text: 'Your grid work, and its team.' },
    ]);
    expect(later.job).toBe('larkspur--pm');
  });

  it('keeps nothing for a form on one page, or one it only gives answers to copy for', () => {
    const why = field('Why us?', { control: 'long' });
    const page = {
      form: form('', [why]),
      replies: [{ kind: 'question', source: 'you', left: 'new' } as FieldReply],
      values: valuesOf([why], ['Because.']),
      job: null,
      copyOnly: false,
    };
    expect(carriedOn(page, NO_EARLIER)).toBe(NO_EARLIER);
    expect(carriedOn({ ...page, form: form('Questions', [why]), copyOnly: true }, NO_EARLIER)).toBe(
      NO_EARLIER,
    );
  });

  it('tells the page the application went on to, by its step, and nothing on the same one', () => {
    const page = form('My Information', [field('First Name')]);
    const read = (step: string, fields: number) => ({
      did: 'values' as const,
      url: page.url,
      submitted: false,
      values: [],
      step,
      fields,
    });
    expect(nextPageOf(page, read('My Experience', 18))).toEqual({
      step: 'My Experience',
      fields: 18,
    });
    expect(nextPageOf(page, read('My Information', 15))).toBeNull();
    // A page that isn't one of several, as after Submit, is for the panel's other checks.
    expect(nextPageOf(page, read('', 0))).toBeNull();
    expect(nextPageOf(page, null)).toBeNull();
  });

  it('offers to add a part for each job and school on file the form has none for, with its own Add', () => {
    const job = (n: number) =>
      ['Job Title', 'Company'].map((question) =>
        field(question, { section: `My Experience › Work Experience ${n}` }),
      );
    const experience = form(
      'My Experience',
      [...job(1), field('School or University', { section: 'Education 1' })],
      {
        adders: [
          { section: 'My Experience › Work Experience', words: 'Add Another' },
          { section: 'My Experience › Education', words: 'Add Another' },
          { section: 'My Experience › Websites', words: 'Add' },
        ],
      },
    );
    expect(
      partsOffers(experience, { jobs: 3, schools: 2 }).map(({ adder, more, label }) => [
        adder.section,
        more,
        label,
      ]),
    ).toEqual([
      ['My Experience › Work Experience', 2, 'Add 2 for your other jobs'],
      ['My Experience › Education', 1, 'Add 1 for your other school'],
    ]);
    expect(partsOffers(experience, { jobs: 3, schools: 2 })[0]?.says).toBe(
      'Factwright has 3 jobs on file, and My Experience › Work Experience has room for 1 yet. Add a part for each of the others, and Factwright fills them in.',
    );
    // Nothing when the form has room for all, has no button that adds one, or the app says none.
    expect(partsOffers(experience, { jobs: 1, schools: 1 })).toEqual([]);
    expect(partsOffers({ ...experience, adders: [] }, { jobs: 3, schools: 2 })).toEqual([]);
    expect(partsOffers(experience, undefined)).toEqual([]);
    // At most ten at once.
    expect(partsOffers(experience, { jobs: 40, schools: 0 })[0]?.more).toBe(10);
  });

  it('names a page’s site by its origin', () => {
    expect(siteOf('https://larkspur.wd5.myworkdayjobs.com/en-US/x')).toBe(
      'https://larkspur.wd5.myworkdayjobs.com',
    );
    expect(siteOf('not an address')).toBe('');
  });
});
