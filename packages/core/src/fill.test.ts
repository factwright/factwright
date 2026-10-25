import { describe, expect, it } from 'vitest';
import {
  answerField,
  answerForm,
  blocksOnFile,
  datedAs,
  NO_APPLICATIONS,
  NO_EQUAL_OPPORTUNITY,
  NO_PRIVATE,
  type OnFile,
  type ResumeOnFile,
  readEqualOpportunity,
} from './fill.ts';
import type { FieldControl, FormField } from './forms.ts';
import { NO_HISTORY, type WorkHistory } from './history.ts';

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
  pay: { text: '$165,000', from: 'target', kind: null },
  resume: {
    from: 'job',
    name: 'Ana María Ruiz',
    email: 'ana@example.com',
    phone: '(303) 555-0142',
    location: 'Denver, CO',
    linkedin: 'https://www.linkedin.com/in/anaruiz',
    website: '',
    company: 'Tidewater Analytics',
    title: 'Senior Product Manager',
    since: '2021',
    positions: [
      {
        company: 'Tidewater Analytics',
        title: 'Senior Product Manager',
        location: 'Denver, CO',
        start: '2021',
        end: 'Present',
      },
    ],
    education: [],
    skills: [],
    sections: [],
    summary: '',
  },
  history: NO_HISTORY,
  job: { company: 'Harbor & Pine', foundOn: 'LinkedIn', location: 'Denver, CO' },
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
      'U.S.A.',
    ]);
    // Some forms ask for "your location" from a list of cities, and some from one of countries:
    // the page picks the first of these it has.
    expect(answer('What is your location?', { control: 'choice' }).pick).toEqual([
      'Denver, CO',
      'Denver',
      'United States',
      'United States of America',
      'USA',
      'US',
      'U.S.',
      'U.S.A.',
    ]);
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
    // Only the question asks it the other way round, never what's said beside it.
    expect(
      answer(
        'Will you now or in the future require visa sponsorship?',
        { ...choice, hint: 'Choose No if you can work without sponsorship.' },
        ON_FILE,
      ).pick,
    ).toEqual(['No']);
    const unset = {
      ...ON_FILE,
      applications: { ...ON_FILE.applications, sponsorship: '' as const },
    };
    expect(answer('Do you require sponsorship?', choice, unset)).toMatchObject({ left: 'unset' });
  });

  it('says you can work in the countries Profile lists, and leaves the rest for you', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    const yes = (question: string, onFile = ON_FILE) => answer(question, choice, onFile).pick;
    expect(yes('Are you legally authorized to work in the United States?')).toEqual(['Yes']);
    expect(yes('Are you legally authorized to work in the US?')).toEqual(['Yes']);
    expect(yes('Are you authorized to work in the U.S.?')).toEqual(['Yes']);
    // Elsewhere you may be able to, with a visa: it's yours to say.
    for (const question of [
      'Do you have the right to work in the United Kingdom?',
      'Do you have the right to work in the UK?',
      'Are you legally authorized to work in Spain?',
      'Are you authorized to work in the EU?',
      'Are you authorized to work in the US or Canada?',
    ]) {
      expect(answer(question, choice)).toMatchObject({ source: 'you', left: 'unset' });
    }
    const canada = { ...ON_FILE, applications: { ...ON_FILE.applications, countries: ['Canada'] } };
    expect(answer('Are you legally authorized to work in the US?', choice, canada)).toMatchObject({
      left: 'unset',
    });
    expect(yes('Are you legally authorized to work in Canada?', canada)).toEqual(['Yes']);
  });

  it('asks where the job is when a question names no country', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    const question = 'Are you authorized to work in the country for which you applied?';
    expect(answer(question, choice).pick).toEqual(['Yes']);
    const at = (location: string) => ({
      ...ON_FILE,
      job: { company: 'Harbor & Pine', foundOn: 'LinkedIn', location },
    });
    expect(answer(question, choice, at('Remote - US')).pick).toEqual(['Yes']);
    expect(answer(question, choice, at('London, UK'))).toMatchObject({ left: 'unset' });
    expect(answer(question, choice, at('Remote'))).toMatchObject({ left: 'unset' });
    expect(answer(question, choice, { ...ON_FILE, job: null })).toMatchObject({ left: 'unset' });
    const none = { ...ON_FILE, applications: { ...ON_FILE.applications, countries: [] } };
    expect(answer('Are you authorized to work in the US?', choice, none)).toMatchObject({
      left: 'unset',
    });
  });

  it('answers whether you can work without sponsorship from both', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    const question =
      'Are you legally authorized to work in the United States without the need for employer sponsorship, now or at any time in the future?';
    expect(answer(question, choice).pick).toEqual(['Yes']);
    const later = {
      ...ON_FILE,
      applications: { ...ON_FILE.applications, sponsorship: 'later' as const },
    };
    expect(answer(question, choice, later).pick).toEqual(['No']);
    // Asked together any other way, it's yours to read.
    expect(
      answer('Are you authorized to work in the US? If you need sponsorship, answer No.', choice),
    ).toMatchObject({ kind: 'question', left: 'new' });
  });

  it('leaves whether you live near the job, or need help moving, for you', () => {
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    expect(answer('Are you willing to relocate?', choice).pick).toEqual(['No']);
    expect(
      answer('Are you located in the Denver area or willing to relocate?', choice),
    ).toMatchObject({ kind: 'question', left: 'new' });
    expect(answer('Will you require relocation assistance?', choice)).toMatchObject({
      kind: 'question',
    });
  });

  it('says how you heard of the job by where you found it', () => {
    expect(answer('How did you hear about us?', { control: 'combo' }).pick?.[0]).toBe('LinkedIn');
    expect(answer('How did you hear about us?')).toMatchObject({ text: 'LinkedIn', source: 'job' });
  });

  it('fills pay only as you put it, and only as one yearly amount in a number box', () => {
    expect(answer('Salary expectations').text).toBe('$165,000');
    const number = { control: 'number' as const, type: 'number' };
    expect(answer('Desired salary', number).text).toBe('165000');
    const pay = (text: string, question = 'Desired salary') =>
      answer(question, number, { ...ON_FILE, pay: { text, from: 'target', kind: null } });
    expect(pay('$150k').text).toBe('150000');
    for (const left of [
      pay('$150-170k'),
      pay('$60 an hour'),
      pay('$165,000', 'Desired salary (in thousands)'),
    ]) {
      expect(left).toMatchObject({ source: 'you', left: 'unset' });
    }
    expect(answer('Desired salary', {}, { ...ON_FILE, pay: null })).toMatchObject({
      source: 'you',
      left: 'unset',
    });
  });

  it('fills the job’s own ask, saying whose it is, or else your target', () => {
    const asked = (pay: OnFile['pay']) =>
      answer('What are your salary expectations?', {}, { ...ON_FILE, pay });
    expect(asked({ text: '$185,000', from: 'you', kind: null })).toEqual({
      kind: 'pay',
      text: '$185,000',
      source: 'job',
      from: 'Your ask for this job',
    });
    expect(asked({ text: '$180,000', from: 'claude', kind: null })).toEqual({
      kind: 'pay',
      text: '$180,000',
      source: 'claude',
      from: 'Your Claude’s suggestion for this job',
    });
    expect(asked({ text: '$160,000', from: 'target', kind: 'Project manager' })).toEqual({
      kind: 'pay',
      text: '$160,000',
      source: 'profile',
      from: 'Your target for Project manager jobs',
    });
    expect(asked({ text: '$165,000', from: 'target', kind: null })).toEqual({
      kind: 'pay',
      text: '$165,000',
      source: 'profile',
    });
  });

  it('picks the option whose band holds the ask, the whole of a range, and leaves the rest', () => {
    const BANDS = [
      'Less than $100,000',
      '$100,000 - $149,999',
      '$150,000 - $199,999',
      '$200,000 or more',
      'Prefer not to say',
    ];
    const picked = (text: string, options = BANDS, control: FieldControl = 'choice') =>
      answer(
        'Desired salary range',
        { control, options },
        { ...ON_FILE, pay: { text, from: 'you', kind: null } },
      );
    expect(picked('$185,000')).toEqual({
      kind: 'pay',
      pick: ['$150,000 - $199,999'],
      exact: true,
      source: 'job',
      from: 'Your ask for this job',
    });
    expect(picked('$95k').pick).toEqual(['Less than $100,000']);
    expect(picked('$250,000').pick).toEqual(['$200,000 or more']);
    expect(picked('$160,000 - $180,000').pick).toEqual(['$150,000 - $199,999']);
    expect(picked('$185,000', BANDS, 'combo').pick).toEqual(['$150,000 - $199,999']);
    // Where two bands meet at the ask, the higher: an ask is the least you'd want.
    expect(picked('$150,000', ['$100k-$150k', '$150k-$200k', '$200k+']).pick).toEqual([
      '$150k-$200k',
    ]);
    // By the hour, as both put it.
    expect(picked('$90 an hour', ['$70 - $85 per hour', '$85 - $100 per hour']).pick).toEqual([
      '$85 - $100 per hour',
    ]);
    // The same words, whatever they say.
    expect(picked('Negotiable', ['Negotiable', '$100k+']).pick).toEqual(['Negotiable']);
    // Of two bands that start at the ask, the narrower.
    expect(picked('$150,000', ['$150,000+', '$150,000 - $199,999']).pick).toEqual([
      '$150,000 - $199,999',
    ]);
    // A tier's number before its band, as some forms put it.
    expect(picked('$120,000', ['Tier 1 - $50k-$100k', 'Tier 2 - $100k-$150k']).pick).toEqual([
      'Tier 2 - $100k-$150k',
    ]);
    for (const left of [
      // A range that runs over two bands, or past the last.
      picked('$140,000 - $160,000'),
      picked('$150k', ['$50k - $100k', '$100k - $140k']),
      // No amount to go by.
      picked('Negotiable'),
      // Another currency than the ask's.
      picked('$185,000', ['€100,000 - €150,000', '€150,000 - €200,000']),
      picked('£85,000', ['$50,000 - $100,000']),
      picked('$185,000', ['CA$150,000 - CA$199,999', 'C$200,000+']),
      // Options it hasn't seen yet, as a list that loads as you type.
      picked('$185,000', []),
    ]) {
      expect(left).toEqual({ kind: 'pay', source: 'you', left: 'pick' });
    }
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

  it('never types an equal-opportunity answer, or gives one to a question that isn’t asking it', () => {
    const set = {
      ...ON_FILE,
      kept: {
        ...ON_FILE.kept,
        equalOpportunity: {
          ...NO_EQUAL_OPPORTUNITY,
          disability: 'yes' as const,
          veteran: 'yes' as const,
        },
      },
    };
    const choice = { control: 'choice' as const, options: ['Yes', 'No'] };
    expect(answer('Disability Status', { control: 'combo' }, set).pick?.[0]).toBe(
      'Yes, I have a disability (or previously had a disability)',
    );
    expect(answer('Disability Status', { control: 'long' }, set)).toMatchObject({
      left: 'sensitive',
    });
    for (const [question, more] of [
      ['Do you need a disability accommodation for your interview?', choice],
      [
        'If you need an accommodation because of a disability, tell us how we can help.',
        { control: 'long' as const },
      ],
      ['Describe your military service, if any.', { control: 'long' as const }],
      ['Are you a military spouse?', choice],
    ] as const) {
      const reply = answer(question, more, set);
      expect(reply.pick ?? []).not.toContain('Yes');
      expect(reply.text).toBeUndefined();
      expect(reply.source).toBe('you');
    }
  });

  it('never answers a personal question, even with what you sent before', () => {
    const sent = {
      ...ON_FILE,
      sent: [
        { question: 'Sexual orientation', text: 'Bisexual', on: '2026-10-01', company: 'Acme' },
        { question: 'What is your age?', text: '34', on: '2026-10-01', company: 'Acme' },
        {
          question: 'Have you ever been convicted of a felony?',
          text: 'No',
          on: '2026-10-01',
          company: 'Acme',
        },
      ],
    };
    for (const question of [
      'Sexual orientation',
      'What is your age?',
      'Have you ever been convicted of a felony?',
    ]) {
      expect(answer(question, { control: 'choice', options: ['Yes', 'No'] }, sent)).toMatchObject({
        kind: 'personal',
        source: 'you',
        left: 'personal',
      });
    }
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

  it('never reuses words about another company, whatever the question', () => {
    const sent = {
      ...ON_FILE,
      sent: [
        {
          question: 'Why do you want to work here?',
          text: 'I’d love to bring my background to Lumen Health.',
          on: '2026-10-12',
          company: 'Lumen Health',
        },
      ],
    };
    expect(answer('Why do you want to work here?', { control: 'long' }, sent)).toMatchObject({
      left: 'new',
    });
    // At the same company, it fits.
    const again = { ...sent, job: { company: 'Lumen Health', foundOn: '', location: '' } };
    expect(answer('Why do you want to work here?', { control: 'long' }, again).source).toBe('sent');
  });

  it('takes your Claude’s draft for this job next', () => {
    expect(answer('Why do you want to join Harbor & Pine?', { control: 'long' })).toMatchObject({
      text: 'I’ve bought Harbor & Pine gear for years.',
      source: 'claude',
    });
  });

  it('leaves a question your Claude said is yours for you, saying why', () => {
    const yours: OnFile = {
      ...ON_FILE,
      suggested: [
        {
          question: 'Tell us about a time you used HL7.',
          answer: 'For you: the facts don’t say whether you’ve used HL7.',
          why: null,
          batch: 1,
        },
      ],
    };
    expect(answer('Tell us about a time you used HL7.', { control: 'long' }, yours)).toEqual({
      kind: 'question',
      source: 'you',
      left: 'new',
      from: 'For you: the facts don’t say whether you’ve used HL7.',
    });
  });

  it('picks each of the options your Claude chose, for a question that takes any of them', () => {
    const picked: OnFile = {
      ...ON_FILE,
      suggested: [
        {
          question: 'Which tools do you use?',
          answer: 'SQL; Python',
          why: 'On the resume.',
          batch: 1,
        },
      ],
    };
    expect(
      answer(
        'Which tools do you use?',
        { control: 'choices', options: ['SQL', 'Python', 'Excel'] },
        picked,
      ),
    ).toMatchObject({ pick: ['SQL', 'Python'], exact: true, source: 'claude' });
    // One that takes one of them takes the draft whole.
    expect(
      answer('Which tools do you use?', { control: 'choice', options: ['SQL; Python'] }, picked),
    ).toMatchObject({ pick: ['SQL; Python'] });
    // Picks on lines of their own, as a list, and a long run of spaces, read in one pass.
    const listed: OnFile = {
      ...ON_FILE,
      suggested: [
        {
          question: 'Which tools do you use?',
          answer: `- SQL\n- Python\n\n${' \t'.repeat(50_000)}`,
          why: null,
          batch: 1,
        },
      ],
    };
    const started = Date.now();
    expect(
      answer('Which tools do you use?', { control: 'choices', options: ['SQL', 'Python'] }, listed),
    ).toMatchObject({ pick: ['SQL', 'Python'] });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('gives the other answers on file that fit too, for the field menus to offer', () => {
    const question = 'What’s the biggest product bet you’ve made?';
    const twice: OnFile = {
      ...ON_FILE,
      sent: [
        { question, text: 'Streaming analytics.', on: '2026-10-20', company: 'Northwind' },
        { question, text: 'Streaming analytics.', on: '2026-10-14', company: 'Fernway' },
        { question, text: 'A pricing change.', on: '2026-10-12', company: 'Lumen Health' },
        { question, text: 'x'.repeat(300), on: '2026-10-10', company: 'Tidewater' },
      ],
      suggested: [{ question, answer: 'Your Claude’s take.', why: null, batch: 1 }],
    };
    // The newest is the answer, as before; the same words again aren't another; one too long
    // for the field isn't one.
    expect(answer(question, { control: 'long', limit: 200 }, twice)).toEqual({
      kind: 'question',
      text: 'Streaming analytics.',
      source: 'sent',
      from: 'From your Northwind application, Oct 20',
      others: [
        {
          text: 'A pricing change.',
          source: 'sent',
          from: 'From your Lumen Health application, Oct 12',
        },
        { text: 'Your Claude’s take.', source: 'claude', from: 'Your Claude’s draft for this job' },
      ],
    });
    // One answer on file has no others.
    expect(answer(question, { control: 'long' })).not.toHaveProperty('others');
  });

  it('answers as before when the newest you sent is too long, offering an older one beside it', () => {
    const question = 'What’s the biggest product bet you’ve made?';
    const sent = [
      { question, text: 'x'.repeat(300), on: '2026-10-20', company: 'Northwind' },
      { question, text: 'A pricing change.', on: '2026-10-12', company: 'Lumen Health' },
    ];
    const older = {
      text: 'A pricing change.',
      source: 'sent',
      from: 'From your Lumen Health application, Oct 12',
    };
    // With your Claude's draft, the draft is the answer, as it was.
    const drafted: OnFile = {
      ...ON_FILE,
      sent,
      suggested: [{ question, answer: 'Your Claude’s take.', why: null, batch: 1 }],
    };
    expect(answer(question, { control: 'long', limit: 200 }, drafted)).toEqual({
      kind: 'question',
      text: 'Your Claude’s take.',
      source: 'claude',
      from: 'Your Claude’s draft for this job',
      others: [older],
    });
    // With none, it's left for you, as it was, and with one that says it's yours, with why.
    expect(
      answer(question, { control: 'long', limit: 200 }, { ...ON_FILE, sent, suggested: [] }),
    ).toEqual({ kind: 'question', source: 'you', left: 'new' });
    const yours: OnFile = {
      ...ON_FILE,
      sent,
      suggested: [{ question, answer: 'For you: not on file.', why: null, batch: 1 }],
    };
    expect(answer(question, { control: 'long', limit: 200 }, yours)).toEqual({
      kind: 'question',
      source: 'you',
      left: 'new',
      from: 'For you: not on file.',
    });
  });

  it('keeps a long form’s other answers within what the extension’s helper takes', () => {
    const questions = Array.from({ length: 40 }, (_, at) => `Question ${at}: tell us more?`);
    const many: OnFile = {
      ...ON_FILE,
      sent: questions.flatMap((question) =>
        ['Acme', 'Fernway', 'Lumen'].map((company, at) => ({
          question,
          text: `Take ${at + 1}: ${'words '.repeat(500)}`,
          on: '2026-10-12',
          company,
        })),
      ),
    };
    const replies = answerForm(
      questions.map((question) => field(question, { control: 'long' })),
      many,
    );
    const carried = replies.reduce(
      (sum, reply) =>
        sum + (reply.others ?? []).reduce((all, other) => all + (other.text?.length ?? 0), 0),
      0,
    );
    expect(carried).toBeGreaterThan(0);
    expect(carried).toBeLessThanOrEqual(100_000);
    // Each field keeps its own answer, whatever its others.
    expect(
      replies.every((reply) => reply.source === 'sent' && reply.text?.startsWith('Take 1')),
    ).toBe(true);
  });

  it('gives what you sent before over a draft that says the question is yours', () => {
    const question = 'Tell us about a time you used HL7.';
    const both: OnFile = {
      ...ON_FILE,
      sent: [{ question, text: 'At Tidewater.', on: '2026-10-12', company: 'Lumen Health' }],
      suggested: [{ question, answer: 'For you: not on file.', why: null, batch: 1 }],
    };
    expect(answer(question, { control: 'long' }, both)).toEqual({
      kind: 'question',
      text: 'At Tidewater.',
      source: 'sent',
      from: 'From your Lumen Health application, Oct 12',
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
    // However it's asked, and whatever you said before.
    const sent = {
      ...ON_FILE,
      sent: [
        {
          question: 'Do you acknowledge our applicant privacy notice?',
          text: 'Yes',
          on: '2026-10-01',
          company: 'Acme',
        },
      ],
    };
    expect(
      answer(
        'Do you acknowledge our applicant privacy notice?',
        { control: 'choice', options: ['Yes', 'No'] },
        sent,
      ),
    ).toMatchObject({ kind: 'consent', left: 'consent' });
  });

  it('never ticks a box, even one that says what Profile knows, as Workday’s preferred name', () => {
    expect(answer('I have a preferred name', { control: 'check', type: 'checkbox' })).toEqual({
      kind: 'preferred-name',
      source: 'you',
      left: 'pick',
    });
    expect(answer('Phone', { control: 'check', type: 'checkbox' })).toMatchObject({
      source: 'you',
      left: 'pick',
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

describe('why you’re leaving', () => {
  const LEAVING =
    'I’ve grown all I can on a small team, and I want to build data products at a bigger scale.';
  const withLeaving: OnFile = {
    ...ON_FILE,
    applications: { ...ON_FILE.applications, leaving: LEAVING },
  };

  it('fills Profile’s answer however a form asks, never your title or company', () => {
    for (const [question, control] of [
      ['Reason for leaving your current position', 'text'],
      ['Reason for leaving current employer', 'long'],
      ['Why are you looking for a new role?', 'long'],
      ['Why did you leave your last job?', 'long'],
      ['Reason for wanting to change', 'long'],
    ] as const) {
      expect(answer(question, { control }, withLeaving)).toEqual({
        kind: 'leaving',
        text: LEAVING,
        source: 'profile',
      });
    }
  });

  it('leaves it for you when Profile has none, and never puts your title in its place', () => {
    for (const question of [
      'Reason for leaving your current position',
      'Reason for leaving current employer',
      'Reason(s) for leaving current employer',
      'Please explain why you are leaving your current employer',
      'Tell us why you’re leaving your current role',
      'Briefly describe why you are leaving your current position',
    ]) {
      expect(answer(question)).toEqual({ kind: 'leaving', source: 'you', left: 'unset' });
    }
    // However else it's worded, a question about leaving never gets them.
    expect(answer('Describe your departure from your current employer')).toEqual({
      kind: 'question',
      source: 'you',
      left: 'new',
    });
    // A box for paragraphs about where you work now is a question for you or your Claude.
    expect(answer('Tell us about your current role', { control: 'long' })).toEqual({
      kind: 'question',
      source: 'you',
      left: 'new',
    });
    expect(answer('Current company', { control: 'long' })).toMatchObject({ kind: 'question' });
  });

  it('offers what you sent before and your Claude’s draft for this job beside it', () => {
    const question = 'Why are you looking to leave your current role?';
    const onFile: OnFile = {
      ...withLeaving,
      sent: [{ question, text: 'I want more scope.', on: '2026-10-12', company: 'Lumen Health' }],
      suggested: [
        {
          question,
          answer: 'I want to build data products at Harbor & Pine’s scale.',
          why: null,
          batch: 1,
        },
      ],
    };
    expect(answer(question, { control: 'long' }, onFile)).toEqual({
      kind: 'leaving',
      text: LEAVING,
      source: 'profile',
      others: [
        {
          text: 'I want more scope.',
          source: 'sent',
          from: 'From your Lumen Health application, Oct 12',
        },
        {
          text: 'I want to build data products at Harbor & Pine’s scale.',
          source: 'claude',
          from: 'Your Claude’s draft for this job',
        },
      ],
    });
    // With nothing in Profile, they answer it, as they answer a form's own question.
    const blank = { ...onFile, applications: ON_FILE.applications };
    expect(answer(question, { control: 'long' }, blank)).toMatchObject({
      kind: 'leaving',
      text: 'I want more scope.',
      source: 'sent',
    });
  });

  it('keeps to a field’s limit, and picks only the option with Profile’s words', () => {
    expect(answer('Reason for leaving', { control: 'long', limit: 40 }, withLeaving)).toEqual({
      kind: 'leaving',
      source: 'you',
      left: 'unset',
    });
    const options = ['Laid off', 'Resigned', 'Contract ended', 'Other'];
    expect(answer('Reason for leaving', { control: 'choice', options }, withLeaving)).toEqual({
      kind: 'leaving',
      source: 'you',
      left: 'pick',
    });
    const laidOff = { ...ON_FILE, applications: { ...ON_FILE.applications, leaving: 'laid off' } };
    expect(answer('Reason for leaving', { control: 'choice', options }, laidOff)).toEqual({
      kind: 'leaving',
      pick: ['Laid off'],
      exact: true,
      source: 'profile',
    });
  });

  it('answers it for the newest job alone, where a form asks it of each job', () => {
    const part = (n: number) => ({ section: `Work Experience ${n}` });
    const replies = answerForm(
      [
        field('Company', part(1)),
        field('Reason for Leaving', { ...part(1), control: 'long' }),
        field('Company', part(2)),
        field('Reason for Leaving', { ...part(2), control: 'long' }),
      ],
      withLeaving,
    );
    expect(replies[1]).toEqual({ kind: 'leaving', text: LEAVING, source: 'profile' });
    expect(replies[3]).toEqual({ kind: 'leaving', source: 'you', left: 'new' });
  });
});

describe('answering from a resume where Profile is blank', () => {
  /** A resume Factwright made for another job: the newest, for a job that has none. */
  const NEWEST: ResumeOnFile = {
    from: 'newest',
    name: 'Ana María Ruiz',
    email: 'ana.ruiz@example.com',
    phone: '(720) 555-0199',
    location: 'Boulder, CO',
    linkedin: 'https://www.linkedin.com/in/anaruiz',
    website: 'https://anaruiz.dev',
    company: 'Tidewater Analytics',
    title: 'Senior Product Manager',
    since: '2021',
    positions: [
      {
        company: 'Tidewater Analytics',
        title: 'Senior Product Manager',
        location: 'Denver, CO',
        start: 'Mar 2021',
        end: 'Present',
      },
      { company: 'Fernway', title: 'Product Manager', location: '', start: '2018', end: '2021' },
    ],
    education: [
      {
        school: 'University of Colorado Boulder',
        degree: 'B.S., Computer Science',
        start: '2010',
        end: '2014',
      },
    ],
    skills: [
      { category: 'Product', items: ['Roadmaps', 'Discovery'] },
      { category: 'Data', items: ['SQL', 'Python'] },
    ],
    sections: [{ heading: 'Certifications', items: ['Certified Scrum Product Owner'] }],
    summary: 'Product manager who ships data products.',
  };
  /** Profile with nothing told, as after skipping setup, with only the newest resume. */
  const BLANK: OnFile = {
    ...ON_FILE,
    you: { name: '', email: '', phone: '', location: '', linkedin: '', website: '' },
    applications: { ...NO_APPLICATIONS, countries: ['United States'] },
    resume: NEWEST,
  };
  const from = (question: string, more: Partial<FormField> = {}) =>
    answerField(field(question, more), BLANK);

  it('fills who you are from your newest resume, and says so', () => {
    expect(from('First Name', { autocomplete: 'given-name' })).toMatchObject({
      text: 'Ana María',
      source: 'resume',
      from: 'From your newest resume',
    });
    expect(from('Last Name').text).toBe('Ruiz');
    expect(from('Full name').text).toBe('Ana María Ruiz');
    expect(from('Email', { type: 'email' }).text).toBe('ana.ruiz@example.com');
    expect(from('Phone', { type: 'tel' }).text).toBe('(720) 555-0199');
    expect(from('Current location').text).toBe('Boulder, CO');
    expect(from('City').text).toBe('Boulder');
    expect(from('State', { control: 'choice' }).pick).toEqual(['CO', 'Colorado']);
    expect(from('Country', { control: 'combo' }).pick?.[0]).toBe('United States');
    expect(from('LinkedIn URL').text).toBe('https://www.linkedin.com/in/anaruiz');
    expect(from('Portfolio URL').text).toBe('https://anaruiz.dev');
    expect(from('Phone country code', { control: 'combo' }).pick?.[0]).toBe('United States');
  });

  it('keeps Profile’s answer first, where it has one', () => {
    expect(answer('Email', { type: 'email' }).text).toBe('ana@example.com');
    expect(answer('Email', { type: 'email' }).source).toBe('profile');
    // The job's own resume says where you work now, as before.
    expect(answer('Current company')).toMatchObject({
      text: 'Tidewater Analytics',
      from: 'From the job’s resume',
    });
  });

  it('fills your school, degree and field of study, as a resume lists them', () => {
    expect(from('School').text).toBe('University of Colorado Boulder');
    expect(
      from('Degree', {
        control: 'choice',
        options: ['High School', "Associate's Degree", "Bachelor's Degree", "Master's Degree"],
      }).pick?.[0],
    ).toBe("Bachelor's Degree");
    expect(from('Degree').text).toBe('B.S., Computer Science');
    expect(from('Discipline').text).toBe('Computer Science');
    expect(from('Graduation year').text).toBe('2014');
    // A date picker reads a date its own way, so that's yours.
    expect(from('Graduation date', { control: 'date', type: 'date' })).toMatchObject({
      left: 'pick',
    });
  });

  it('fills your skills, certifications and summary where a form asks for them by name', () => {
    expect(from('Skills').text).toBe('Roadmaps, Discovery, SQL, Python');
    expect(from('Skills', { control: 'long' }).text).toBe(
      'Product: Roadmaps, Discovery\nData: SQL, Python',
    );
    expect(
      from('Skills', { control: 'choices', options: ['SQL', 'Java', 'Python'] }),
    ).toMatchObject({ pick: ['Roadmaps', 'Discovery', 'SQL', 'Python'], exact: true });
    expect(from('Certifications').text).toBe('Certified Scrum Product Owner');
    expect(from('Professional summary', { control: 'long' }).text).toBe(
      'Product manager who ships data products.',
    );
    expect(from('Skills', { limit: 10 })).toMatchObject({ left: 'unset' });
  });

  it('leaves what no resume says for you: a middle name, an apartment, a GPA', () => {
    for (const question of ['Middle name', 'Address line 2', 'GPA']) {
      expect(from(question)).toMatchObject({ source: 'you', left: 'unset' });
    }
  });

  it('leaves it all for you with no resume either', () => {
    expect(answerField(field('Full name'), { ...BLANK, resume: null })).toMatchObject({
      left: 'unset',
    });
  });
});

describe('a form that asks for each job and school', () => {
  /** Three positions at one company, then one at another, and two schools. */
  const HISTORY: WorkHistory = {
    jobs: [
      {
        company: 'Tidewater Analytics',
        location: 'Denver, CO',
        positions: [
          {
            title: 'Director of Product',
            start: '2023-04',
            end: 'present',
            summary: 'Runs the data products team.',
          },
          { title: 'Senior Product Manager', start: '2021-03', end: '2023-04', summary: '' },
          { title: 'Product Manager', start: '2019-06', end: '2021-03', summary: '' },
        ],
      },
      {
        company: 'Fernway',
        location: 'Boulder, CO',
        positions: [{ title: 'Associate PM', start: '2017', end: '2019', summary: '' }],
      },
    ],
    schools: [
      {
        school: 'CU Boulder',
        degree: 'B.S.',
        field: 'Computer Science',
        start: '2013',
        end: '2017',
      },
      { school: 'Denver East High School', degree: '', field: '', start: '', end: '2013' },
    ],
  };
  const WITH: OnFile = { ...ON_FILE, history: HISTORY };
  /** One block of a form's part for jobs, as Greenhouse asks it, the nth time. */
  const job = (n: number) => [
    field('Company name', { section: 'Employment', name: `employment_company_${n}` }),
    field('Title', { section: 'Employment', name: `employment_title_${n}` }),
    field('Start date month', {
      section: 'Employment',
      control: 'combo',
      name: `employment_start_month_${n}`,
    }),
    field('Start date year', {
      section: 'Employment',
      control: 'combo',
      name: `employment_start_year_${n}`,
    }),
    field('End date year', {
      section: 'Employment',
      control: 'combo',
      name: `employment_end_year_${n}`,
    }),
  ];

  it('fills each job it asks for with the next position, three at one company as three', () => {
    const fields = [...job(0), ...job(1), ...job(2), ...job(3)];
    const replies = answerForm(fields, WITH);
    const said = replies.map((reply) => reply.text ?? reply.pick?.[0] ?? `(${reply.left})`);
    expect(said).toEqual([
      'Tidewater Analytics',
      'Director of Product',
      'April',
      '2023',
      // A job you still hold has no end year to pick.
      '(pick)',
      'Tidewater Analytics',
      'Senior Product Manager',
      'March',
      '2021',
      '2023',
      'Tidewater Analytics',
      'Product Manager',
      'June',
      '2019',
      '2021',
      'Fernway',
      'Associate PM',
      '(unset)',
      '2017',
      '2019',
    ]);
    expect(replies[0]).toMatchObject({ source: 'profile', from: 'From your work history' });
  });

  it('fills a part the form numbers itself with that job, as the ones before it are on the form', () => {
    // SmartRecruiters lists the jobs you saved, and shows one part to fill: its third.
    const editor = [
      field('Title', { section: 'Experience 3' }),
      field('Company', { section: 'Experience 3' }),
    ];
    const said = answerForm(editor, WITH).map((reply) => reply.text);
    expect(said).toEqual(['Product Manager', 'Tidewater Analytics']);
    // Numbered from the first, the form's numbers and its order agree.
    const numbered = [1, 2].flatMap((n) => [
      field('Title', { section: `Work Experience ${n}` }),
      field('Company', { section: `Work Experience ${n}` }),
    ]);
    expect(answerForm(numbered, WITH).map((reply) => reply.text)).toEqual([
      'Director of Product',
      'Tidewater Analytics',
      'Senior Product Manager',
      'Tidewater Analytics',
    ]);
  });

  it('asks for the job you hold now when a form asks once, apart from the part for each job', () => {
    expect(answerField(field('Current company'), WITH).text).toBe('Tidewater Analytics');
    expect(answerField(field('Current job title'), WITH).text).toBe('Director of Product');
    const replies = answerForm([field('Current company'), ...job(0)], WITH);
    expect(replies[1]?.text).toBe('Tidewater Analytics');
  });

  it('fills each school, with its degree, field and years', () => {
    const school = (n: number) => [
      field('School', { section: 'Education', name: `education_school_${n}` }),
      field('Degree', {
        section: 'Education',
        control: 'combo',
        name: `education_degree_${n}`,
      }),
      field('Discipline', { section: 'Education', name: `education_discipline_${n}` }),
      field('End date year', { section: 'Education', name: `education_end_year_${n}` }),
    ];
    const said = answerForm([...school(0), ...school(1)], WITH).map(
      (reply) => reply.text ?? reply.pick?.[0] ?? `(${reply.left})`,
    );
    expect(said).toEqual([
      'CU Boulder',
      "Bachelor's Degree",
      'Computer Science',
      '2017',
      'Denver East High School',
      '(unset)',
      '(unset)',
      '2013',
    ]);
  });

  it('types a date as a box for one takes it, and a job still going as Present', () => {
    const typed = (question: string, more: Partial<FormField> = {}) =>
      answerForm([field(question, { section: 'Work experience', ...more })], WITH)[0];
    expect(typed('Start date')?.text).toBe('04/2023');
    expect(typed('End date')?.text).toBe('Present');
    expect(typed('Start date', { type: 'month' })?.text).toBe('2023-04');
    expect(typed('Start date', { control: 'date', type: 'date' })).toMatchObject({ left: 'pick' });
    // Its month and year, as three boxes ask them, and its day, which no job's dates say.
    expect(
      ['Start Date Month', 'Start Date Day', 'Start Date Year'].map((question) =>
        typed(question, { control: question.endsWith('Year') ? 'text' : 'choice' }),
      ),
    ).toEqual([
      expect.objectContaining({ pick: expect.arrayContaining(['April']) }),
      expect.objectContaining({ left: 'pick' }),
      expect.objectContaining({ text: '2023' }),
    ]);
    expect(typed('Description', { control: 'long' })?.text).toBe('Runs the data products team.');
    expect(typed('I currently work here', { control: 'check' })).toMatchObject({ left: 'pick' });
  });

  it('takes the positions a resume lists when Profile has no work history', () => {
    const resume = ON_FILE.resume;
    if (!resume) throw new Error('No resume');
    const onFile: OnFile = {
      ...ON_FILE,
      resume: {
        ...resume,
        positions: [
          ...resume.positions,
          {
            company: 'Fernway',
            title: 'Product Manager',
            location: '',
            start: 'Jun 2018',
            end: '03/2021',
          },
        ],
      },
    };
    const said = answerForm([...job(0), ...job(1)], onFile).map(
      (reply) => reply.text ?? reply.pick?.[0] ?? `(${reply.left})`,
    );
    expect(said).toEqual([
      'Tidewater Analytics',
      'Senior Product Manager',
      '(unset)',
      '2021',
      '(pick)',
      'Fernway',
      'Product Manager',
      'June',
      '2018',
      '2021',
    ]);
  });

  it('says how many jobs and schools on file a form can take, one to a part', () => {
    expect(blocksOnFile(WITH)).toEqual({ jobs: 4, schools: 2 });
    // With no work history, the resume's: one position, and no school.
    expect(blocksOnFile(ON_FILE)).toEqual({ jobs: 1, schools: 0 });
    // Past what the history lists, the resume's, as each part takes the next.
    const resume = ON_FILE.resume as ResumeOnFile;
    const twoListed: OnFile = {
      ...ON_FILE,
      history: { jobs: [], schools: HISTORY.schools.slice(0, 1) },
      resume: {
        ...resume,
        education: [
          { school: 'CU Boulder', degree: 'B.S.', start: '2013', end: '2017' },
          { school: 'Denver East High School', degree: '', start: '', end: '2013' },
        ],
      },
    };
    expect(blocksOnFile(twoListed)).toEqual({ jobs: 1, schools: 2 });
  });

  it('reads a resume’s dates as the work history keeps them', () => {
    expect(
      ['Mar 2021', 'March 2021', '03/2021', '2021', 'Present', '', 'soon'].map(datedAs),
    ).toEqual(['2021-03', '2021-03', '2021-03', '2021', 'present', '', '']);
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
