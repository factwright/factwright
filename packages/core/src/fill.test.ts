import { describe, expect, it } from 'vitest';
import {
  answerField,
  NO_APPLICATIONS,
  NO_EQUAL_OPPORTUNITY,
  NO_PRIVATE,
  type OnFile,
  readEqualOpportunity,
} from './fill.ts';
import type { FieldControl, FormField } from './forms.ts';

const ON_FILE: OnFile = {
  you: {
    name: 'Ana María Ruiz',
    email: 'ana@example.com',
    phone: '(303) 555-0142',
    location: 'Denver, CO',
    linkedin: 'https://www.linkedin.com/in/anaruiz',
    website: 'https://anaruiz.dev',
  },
  applications: {
    ...NO_APPLICATIONS,
    github: 'https://github.com/anaruiz/',
    country: 'United States',
    countries: ['United States'],
    sponsorship: 'no',
  },
  kept: { ...NO_PRIVATE, street: '1420 Larimer St', postalCode: '80202' },
  authorization: 'US citizen',
  start: 'Two weeks’ notice',
  relocate: 'no',
  targetPay: '$165,000',
  resume: { company: 'Tidewater Analytics', title: 'Senior Product Manager' },
  job: { company: 'Harbor & Pine', foundOn: 'LinkedIn' },
  sent: [
    {
      question: 'What’s the biggest product bet you’ve made?',
      text: 'Moving our analytics to streaming, which cut report times from hours to seconds.',
      on: '2026-10-12',
      company: 'Lumen Health',
    },
    {
      question: 'Why do you want to work at Lumen Health?',
      text: 'Lumen’s mission is close to my own.',
      on: '2026-10-12',
      company: 'Lumen Health',
    },
  ],
  suggested: [
    {
      question: 'Why do you want to join Harbor & Pine?',
      answer: 'I’ve bought Harbor & Pine gear for years.',
      why: null,
      batch: 1,
    },
  ],
  files: { resume: 'Ana Ruiz - Resume.pdf', coverLetter: null },
  letterText: null,
  today: '2026-10-23',
};

/** A field, with only what a test sets. */
const field = (
  question: string,
  more: Partial<FormField> & { control?: FieldControl } = {},
): FormField => ({
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
});

const answer = (question: string, more: Partial<FormField> = {}, onFile: OnFile = ON_FILE) =>
  answerField(field(question, more), onFile);

describe('answering a form from what’s on file', () => {
  it('fills who you are from Profile', () => {
    expect(answer('First Name', { autocomplete: 'given-name' })).toMatchObject({
      text: 'Ana María',
      source: 'profile',
    });
    expect(answer('Last Name').text).toBe('Ruiz');
    expect(answer('Full name').text).toBe('Ana María Ruiz');
    expect(answer('Email', { type: 'email' }).text).toBe('ana@example.com');
    expect(answer('Phone', { type: 'tel' }).text).toBe('(303) 555-0142');
    expect(answer('City').text).toBe('Denver');
    expect(answer('Street address', { autocomplete: 'street-address' }).text).toBe(
      '1420 Larimer St',
    );
    expect(answer('Zip code').text).toBe('80202');
    expect(answer('Current location').text).toBe('Denver, CO');
    expect(answer('LinkedIn URL').text).toBe('https://www.linkedin.com/in/anaruiz');
    expect(answer('Portfolio URL').text).toBe('https://anaruiz.dev');
  });

  it('gives a choice the words to pick, with other names for a state or a country', () => {
    expect(answer('State', { control: 'choice', options: ['Colorado', 'Utah'] }).pick).toEqual([
      'CO',
      'Colorado',
    ]);
    expect(answer('Country', { control: 'combo' }).pick).toEqual([
      'United States',
      'United States of America',
      'USA',
      'US',
      'U.S.',
    ]);
    // Some forms ask for "your location" from a list of countries.
    const countries = Array.from({ length: 50 }, (_, at) => `Country ${at}`);
    expect(
      answer('What is your location?', { control: 'choice', options: countries }).pick?.[0],
    ).toBe('United States');
  });

  it('gives only your user name where a form asks for one', () => {
    expect(answer('Github', { hint: 'Please provide your GitHub username.' }).text).toBe('anaruiz');
    expect(answer('GitHub URL').text).toBe('https://github.com/anaruiz/');
  });

  it('takes where you work now from the job’s own resume', () => {
    expect(answer('Current company', { name: 'org' })).toMatchObject({
      text: 'Tidewater Analytics',
      source: 'resume',
    });
    expect(answer('Current job title').text).toBe('Senior Product Manager');
    expect(answer('Current company', {}, { ...ON_FILE, resume: null })).toMatchObject({
      source: 'you',
      left: 'unset',
    });
  });

  it('answers sponsorship the way the question asks it', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    expect(answer('Will you now or in the future require visa sponsorship?', choice).pick).toEqual([
      'No',
    ]);
    const later = {
      ...ON_FILE,
      applications: { ...ON_FILE.applications, sponsorship: 'later' as const },
    };
    expect(
      answer('Will you now or in the future require visa sponsorship?', choice, later).pick,
    ).toEqual(['Yes']);
    expect(answer('Do you currently require sponsorship?', choice, later).pick).toEqual(['No']);
    expect(answer('Can you work here without sponsorship?', choice, later).pick).toEqual(['Yes']);
    const unset = {
      ...ON_FILE,
      applications: { ...ON_FILE.applications, sponsorship: '' as const },
    };
    expect(answer('Do you require sponsorship?', choice, unset)).toMatchObject({ left: 'unset' });
  });

  it('says you can work in the countries Profile lists, and only those', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    expect(answer('Are you legally authorized to work in the United States?', choice).pick).toEqual(
      ['Yes'],
    );
    expect(answer('Do you have the right to work in the United Kingdom?', choice).pick).toEqual([
      'No',
    ]);
    expect(
      answer('Are you authorized to work in the country for which you applied?', choice).pick,
    ).toEqual(['Yes']);
    const none = { ...ON_FILE, applications: { ...ON_FILE.applications, countries: [] } };
    expect(answer('Are you authorized to work in the US?', choice, none)).toMatchObject({
      left: 'unset',
    });
  });

  it('says how you heard of the job by where you found it', () => {
    expect(answer('How did you hear about us?', { control: 'combo' }).pick?.[0]).toBe('LinkedIn');
    expect(answer('How did you hear about us?')).toMatchObject({ text: 'LinkedIn', source: 'job' });
  });

  it('fills pay only as you put it, and only as digits in a number box', () => {
    expect(answer('Salary expectations').text).toBe('$165,000');
    expect(answer('Desired salary', { control: 'number', type: 'number' }).text).toBe('165000');
    expect(
      answer('Desired salary', { control: 'choice', options: ['$100k–$150k', '$150k+'] }),
    ).toMatchObject({
      left: 'unset',
    });
  });

  it('answers an equal-opportunity question only as you set it in Profile', () => {
    const gender = { control: 'combo' as const, name: 'gender' };
    expect(answer('Gender', gender)).toMatchObject({ source: 'you', left: 'sensitive' });
    const set = {
      ...ON_FILE,
      kept: {
        ...ON_FILE.kept,
        equalOpportunity: {
          ...NO_EQUAL_OPPORTUNITY,
          gender: 'woman' as const,
          veteran: 'decline' as const,
        },
      },
    };
    expect(answer('Gender', gender, set).pick?.slice(0, 2)).toEqual(['Woman', 'Female']);
    expect(answer('Veteran Status', { control: 'choice' }, set).pick).toContain(
      'I don’t wish to answer',
    );
    expect(answer('Are you Hispanic/Latino?', { control: 'choice' }, set)).toMatchObject({
      left: 'sensitive',
    });
  });

  it('uploads the job’s own resume, and says there’s none when there isn’t', () => {
    expect(answer('Resume/CV', { control: 'file', type: 'file' })).toMatchObject({
      file: 'resume',
      source: 'job',
      from: 'Ana Ruiz - Resume.pdf',
    });
    expect(answer('Cover letter', { control: 'file', type: 'file' })).toMatchObject({
      left: 'unset',
    });
  });

  it('reuses what you sent before, unless the question is about another company', () => {
    expect(
      answer('What’s the biggest product bet you’ve made?', { control: 'long' }),
    ).toMatchObject({
      text: 'Moving our analytics to streaming, which cut report times from hours to seconds.',
      source: 'sent',
      from: 'From your Lumen Health application, Oct 12',
    });
    expect(answer('Why do you want to work at Lumen Health?', { control: 'long' })).toMatchObject({
      left: 'new',
    });
  });

  it('takes your Claude’s draft for this job next', () => {
    expect(answer('Why do you want to join Harbor & Pine?', { control: 'long' })).toMatchObject({
      text: 'I’ve bought Harbor & Pine gear for years.',
      source: 'claude',
    });
  });

  it('keeps to a field’s limit, leaving a longer answer for you', () => {
    expect(
      answer('What’s the biggest product bet you’ve made?', { control: 'long', limit: 20 }),
    ).toMatchObject({ left: 'new' });
  });

  it('reuses a choice only as the same option', () => {
    const sent = {
      ...ON_FILE,
      sent: [
        { question: 'Have you used Figma?', text: 'Yes, daily', on: '2026-10-01', company: 'Acme' },
      ],
    };
    expect(
      answer('Have you used Figma?', { control: 'choice', options: ['Yes, daily', 'No'] }, sent),
    ).toMatchObject({
      pick: ['Yes, daily'],
      exact: true,
    });
  });

  it('never fills a password or agrees to anything for you', () => {
    expect(answer('Password', { type: 'password' })).toMatchObject({
      source: 'you',
      left: 'never',
    });
    expect(answer('Date of birth', { control: 'date', type: 'date' })).toMatchObject({
      left: 'never',
    });
    expect(answer('I agree to the terms', { control: 'check', type: 'checkbox' })).toMatchObject({
      left: 'consent',
    });
  });

  it('leaves a question nothing on file answers for you', () => {
    expect(
      answer('Tell us about a time you disagreed with your manager.', { control: 'long' }),
    ).toMatchObject({
      kind: 'question',
      source: 'you',
      left: 'new',
    });
  });
});

describe('an equal-opportunity answer from a form’s option', () => {
  it('is the answer Profile keeps, however the form put it', () => {
    expect(readEqualOpportunity('gender', 'Female')).toBe('woman');
    expect(readEqualOpportunity('gender', 'Decline To Self Identify')).toBe('decline');
    expect(readEqualOpportunity('veteran', 'I am not a protected veteran')).toBe('no');
    expect(
      readEqualOpportunity(
        'disability',
        'No, I do not have a disability and have not had one in the past',
      ),
    ).toBe('no');
    expect(readEqualOpportunity('race', 'White (Not Hispanic or Latino)')).toBe('white');
  });

  it('is nothing for an option Profile doesn’t know', () => {
    expect(readEqualOpportunity('gender', 'I use another term')).toBeNull();
    expect(readEqualOpportunity('race', '')).toBeNull();
  });
});
