import { describe, expect, it } from 'vitest';
import { formFeed, formFeedRequests, readFormFeed } from './form-feed.ts';

const yesNo = [
  { label: 'Yes', value: 1 },
  { label: 'No', value: 0 },
];

/** A field of the form's own, as the API names them. */
const own = (id: number, type: string, values: unknown[] = []) => ({
  name: `question_${id}${type === 'multi_value_multi_select' ? '[]' : ''}`,
  type,
  values,
});

/**
 * What Greenhouse's job API answers with questions=true, for a made-up company's job: the fields
 * every form has, the form's own questions, and its location, compliance and demographic
 * questions, which it gives apart.
 */
const ANSWER = {
  id: 4012345,
  title: 'Account Executive, Mid-Market',
  absolute_url: 'https://job-boards.greenhouse.io/harborpine/jobs/4012345',
  company_name: 'Harbor & Pine Outfitters',
  location: { name: 'Portland, OR' },
  content: '&lt;p&gt;Sell outdoor gear to independent retailers.&lt;/p&gt;',
  questions: [
    {
      label: 'First Name',
      required: true,
      description: null,
      fields: [{ name: 'first_name', type: 'input_text', values: [] }],
    },
    {
      label: 'Last Name',
      required: true,
      description: null,
      fields: [{ name: 'last_name', type: 'input_text', values: [] }],
    },
    {
      label: 'Email',
      required: true,
      description: null,
      fields: [{ name: 'email', type: 'input_text', values: [] }],
    },
    {
      label: 'Phone',
      required: false,
      description: null,
      fields: [{ name: 'phone', type: 'input_text', values: [] }],
    },
    {
      label: 'Resume/CV',
      required: true,
      description: null,
      fields: [
        { name: 'resume', type: 'input_file', values: [] },
        { name: 'resume_text', type: 'textarea', values: [] },
      ],
    },
    {
      label: 'Cover Letter',
      required: false,
      description: null,
      fields: [
        { name: 'cover_letter', type: 'input_file', values: [] },
        { name: 'cover_letter_text', type: 'textarea', values: [] },
      ],
    },
    {
      label: 'LinkedIn Profile',
      required: false,
      description: null,
      fields: [own(1101, 'input_text')],
    },
    {
      label: 'Why do you want to join Harbor &amp; Pine? ',
      required: true,
      description:
        '<p>A few sentences,&nbsp;up to 1,000 characters.</p>\n<p>We read every one.</p>',
      fields: [own(1102, 'textarea')],
    },
    {
      label: 'Which regions have you sold into?',
      required: true,
      description: null,
      fields: [
        own(1103, 'multi_value_multi_select', [
          { label: 'Pacific Northwest', value: 1 },
          { label: 'Mountain West', value: 2 },
          { label: 'California', value: 3 },
        ]),
      ],
    },
    {
      label: 'Have you ever worked for Harbor &amp; Pine before, as an employee or a contractor?',
      required: true,
      description: null,
      fields: [own(1104, 'multi_value_single_select', yesNo)],
    },
    {
      label: 'Are you authorized to work in the country for which you applied?',
      required: true,
      description: null,
      fields: [own(1105, 'multi_value_single_select', yesNo)],
    },
    {
      label: 'Pronouns',
      required: false,
      description: '<p>If you’d like to, let us know.</p>',
      fields: [
        own(1106, 'multi_value_single_select', [
          { label: 'She/her', value: 1 },
          { label: 'He/him', value: 2 },
          { label: 'They/them', value: 3 },
        ]),
      ],
    },
    {
      label: 'Gender',
      required: false,
      description: null,
      fields: [
        own(1107, 'multi_value_single_select', [
          { label: 'Woman', value: 1 },
          { label: 'Man', value: 2 },
          { label: 'I don’t wish to answer', value: 3 },
        ]),
      ],
    },
    {
      label: 'Portfolio',
      required: false,
      description: null,
      fields: [own(1108, 'input_file')],
    },
    {
      label: 'Writing sample',
      required: false,
      description: '&lt;p&gt;Attach it, or paste it: 300 characters max.&lt;/p&gt;',
      fields: [own(1109, 'input_file'), own(1110, 'textarea')],
    },
    {
      label: 'Agreement to Arbitrate',
      required: true,
      description: '<p>I understand and agree that disputes go to arbitration.</p>',
      fields: [
        own(1111, 'multi_value_single_select', [
          { label: 'I understand and agree to the terms above.', value: 9 },
        ]),
      ],
    },
    {
      label: 'Do you consent to our keeping your application for a year?',
      required: true,
      description: null,
      fields: [own(1112, 'multi_value_single_select', yesNo)],
    },
    {
      label: 'Referral code',
      required: false,
      description: null,
      fields: [{ name: 'question_1113', type: 'input_hidden', values: [] }],
    },
    {
      label: 'Additional Information',
      required: false,
      description: '<p>Add anything else you’d like to share.</p>',
      fields: [own(1114, 'textarea')],
    },
  ],
  location_questions: [
    {
      label: 'Location',
      required: true,
      description: null,
      fields: [{ name: 'location', type: 'input_text', values: [] }],
    },
    {
      label: 'Latitude',
      required: true,
      description: null,
      fields: [{ name: 'latitude', type: 'input_hidden', values: [] }],
    },
  ],
  compliance: [
    {
      type: 'eeoc',
      description: '&lt;p&gt;Voluntary self-identification.&lt;/p&gt;',
      questions: [
        {
          label: 'VeteranStatus',
          required: false,
          fields: [
            {
              name: 'veteran_status',
              type: 'multi_value_single_select',
              values: [{ label: 'I am not a protected veteran', value: '1' }],
            },
          ],
        },
      ],
    },
  ],
  demographic_questions: {
    header: 'Tell us about yourself',
    questions: [
      {
        id: 7,
        label: 'How would you describe your racial or ethnic background?',
        required: false,
        type: 'multi_value_multi_select',
        answer_options: [{ id: 1, label: 'Prefer not to say', free_form: false }],
      },
    ],
  },
  data_compliance: [{ type: 'gdpr', requires_consent: false }],
};

describe('formFeed', () => {
  it('finds the first of a job’s links that’s a posting on Greenhouse', () => {
    expect(
      formFeed([
        null,
        'not a link',
        'https://jobs.lever.co/harborpine/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
        'https://job-boards.greenhouse.io/harborpine/jobs/4012345',
        'https://boards.greenhouse.io/other/jobs/1',
      ]),
    ).toEqual({
      url: 'https://job-boards.greenhouse.io/harborpine/jobs/4012345',
      source: { kind: 'greenhouse', boards: ['harborpine'], id: '4012345' },
    });
  });

  it('finds one a company’s own careers page embeds', () => {
    expect(formFeed(['https://www.harborpine.example/careers?gh_jid=4012345'])?.source).toEqual({
      kind: 'greenhouse',
      boards: ['harborpine'],
      id: '4012345',
    });
  });

  it('finds none on Lever, Ashby, Gem or a page of its own, which give no form’s questions', () => {
    expect(
      formFeed([
        'https://jobs.lever.co/harborpine/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
        'https://jobs.ashbyhq.com/harborpine/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
        'https://jobs.gem.com/harborpine/account-executive-42',
        'https://harborpine.example/jobs/account-executive',
        undefined,
      ]),
    ).toBeNull();
    expect(formFeed([])).toBeNull();
  });
});

describe('formFeedRequests', () => {
  it('asks the job API of each board the job may be on for its form’s questions', () => {
    expect(
      formFeedRequests({
        kind: 'greenhouse',
        boards: ['harborpine', 'harbor pine'],
        id: '4012345',
      }),
    ).toEqual([
      {
        url: 'https://boards-api.greenhouse.io/v1/boards/harborpine/jobs/4012345?questions=true',
        json: true,
      },
      {
        url: 'https://boards-api.greenhouse.io/v1/boards/harbor%20pine/jobs/4012345?questions=true',
        json: true,
      },
    ]);
  });
});

describe('readFormFeed', () => {
  it('keeps only the form’s own questions for your Claude, each as the form asks it', () => {
    expect(readFormFeed(ANSWER)).toEqual([
      {
        question: 'Why do you want to join Harbor & Pine?',
        hint: 'A few sentences, up to 1,000 characters. We read every one.',
        section: '',
        control: 'long',
        options: [],
        required: true,
        limit: 1000,
      },
      {
        question: 'Which regions have you sold into?',
        hint: '',
        section: '',
        control: 'choices',
        options: ['Pacific Northwest', 'Mountain West', 'California'],
        required: true,
        limit: null,
      },
      {
        question: 'Have you ever worked for Harbor & Pine before, as an employee or a contractor?',
        hint: '',
        section: '',
        control: 'choice',
        options: ['Yes', 'No'],
        required: true,
        limit: null,
      },
      {
        question: 'Writing sample',
        hint: 'Attach it, or paste it: 300 characters max.',
        section: '',
        control: 'long',
        options: [],
        required: false,
        limit: 300,
      },
      {
        question: 'Additional Information',
        hint: 'Add anything else you’d like to share.',
        section: '',
        control: 'long',
        options: [],
        required: false,
        limit: null,
      },
    ]);
  });

  it('leaves out what every form asks, and its location, compliance and demographic questions', () => {
    const asked = readFormFeed(ANSWER)?.map((each) => each.question) ?? [];
    for (const left of [
      'First Name',
      'Email',
      'Phone',
      'Resume/CV',
      'Cover Letter',
      'Location',
      'VeteranStatus',
      'How would you describe your racial or ethnic background?',
    ]) {
      expect(asked).not.toContain(left);
    }
  });

  it('leaves out what Factwright fills, or leaves for you, as the extension does on the form', () => {
    const asked = readFormFeed(ANSWER)?.map((each) => each.question) ?? [];
    for (const left of [
      // From Profile.
      'LinkedIn Profile',
      'Are you authorized to work in the country for which you applied?',
      'Pronouns',
      // Only from what you set in Profile, and never Claude's.
      'Gender',
      // Yours: a file to upload, agreeing to something, and a field the form hides.
      'Portfolio',
      'Agreement to Arbitrate',
      'Do you consent to our keeping your application for a year?',
      'Referral code',
    ]) {
      expect(asked).not.toContain(left);
    }
  });

  it('keeps no more than a form keeps, and cuts long words short', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      label: `Question ${i + 1}: what did you sell?`,
      required: false,
      fields: [own(2000 + i, 'textarea')],
    }));
    const long = 'Tell us more. '.repeat(60);
    const options = Array.from({ length: 400 }, (_, i) => ({ label: `Region ${i + 1}`, value: i }));
    const read = readFormFeed({
      questions: [
        { label: long, required: false, fields: [own(1, 'textarea')] },
        { label: 'Where have you sold?', fields: [own(2, 'multi_value_multi_select', options)] },
        ...many,
      ],
    });
    expect(read).toHaveLength(50);
    expect(read?.[0]?.question).toHaveLength(500);
    expect(read?.[0]?.question.endsWith('…')).toBe(true);
    expect(read?.[1]?.options).toHaveLength(300);
  });

  it('reads nothing from an answer that isn’t a job’s', () => {
    expect(readFormFeed(null)).toBeNull();
    expect(readFormFeed({ status: 404, error: 'Job not found' })).toBeNull();
    expect(readFormFeed({ questions: 'none' })).toBeNull();
    expect(readFormFeed([ANSWER])).toBeNull();
    expect(readFormFeed({ questions: [null, 'Why?', { label: 'Why?' }, { fields: [] }] })).toEqual(
      [],
    );
  });
});
