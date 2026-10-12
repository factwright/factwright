import { describe, expect, it } from 'vitest';
import { ASK_ID, applicationAnswers, askId, questionKey, readSuggestedAnswers } from './answers.ts';

const ANSWERS = `# Application questions: Acme Robotics, Staff Engineer

Drafted 2026-10-07. Q1 traces to facts/work.md#deploys.

## Why do you want to work at Acme?

I've spent three years making deploys boring.

Your robots need that too.

## Checkbox questions
| Question | Pick | Why |
|---|---|---|
| Which languages have you used in production? | Go, Python | Both daily since 2022 |
| Are you open to on-call? | Yes | |

## Anything else we should know?

Nope, the resume covers it.
`;

describe('readSuggestedAnswers', () => {
  it('reads each question and its answer, and each row of a table of picks', () => {
    expect(readSuggestedAnswers(ANSWERS)).toEqual([
      {
        question: 'Why do you want to work at Acme?',
        answer: "I've spent three years making deploys boring.\n\nYour robots need that too.",
        why: null,
      },
      {
        question: 'Which languages have you used in production?',
        answer: 'Go, Python',
        why: 'Both daily since 2022',
      },
      { question: 'Are you open to on-call?', answer: 'Yes', why: null },
      {
        question: 'Anything else we should know?',
        answer: 'Nope, the resume covers it.',
        why: null,
      },
    ]);
  });

  it('keeps the later answer to a question answered twice, since answers.md is added to', () => {
    const twice = `${ANSWERS}\n## Why do you want to work at Acme?\n\nShorter this time.\n`;
    const found = readSuggestedAnswers(twice);
    expect(found.filter((each) => each.question.startsWith('Why do you'))).toEqual([
      { question: 'Why do you want to work at Acme?', answer: 'Shorter this time.', why: null },
    ]);
  });

  it('reads nothing from no file, or one with no questions yet', () => {
    expect(readSuggestedAnswers(null)).toEqual([]);
    expect(readSuggestedAnswers('# Application questions: Acme\n\nDrafted 2026-10-07.')).toEqual(
      [],
    );
    expect(readSuggestedAnswers('## Why Acme?\n\n')).toEqual([]);
  });
});

describe('questionKey', () => {
  it('matches the same question however it’s numbered, punctuated or marked', () => {
    expect(questionKey('1. Why Acme? *')).toBe('why acme');
    expect(questionKey('Q2) Why Acme (required)')).toBe('why acme');
    expect(questionKey('**Why Acme?**')).toBe('why acme');
    expect(questionKey('Why   Acme…')).toBe('why acme');
    expect(questionKey('2026 plans?')).toBe('2026 plans');
  });
});

describe('applicationAnswers', () => {
  const suggested = readSuggestedAnswers(ANSWERS);

  it('lists the pasted questions in order, with Claude’s suggestion and what was sent', () => {
    const answers = applicationAnswers(
      ['1. Why do you want to work at Acme? *', 'What are your salary expectations?'],
      suggested,
      [
        {
          question: 'Why do you want to work at Acme?',
          text: 'Deploys, mostly.',
          on: '2026-10-08',
        },
      ],
    );
    expect(answers.map(({ question }) => question)).toEqual([
      '1. Why do you want to work at Acme? *',
      'What are your salary expectations?',
      'Which languages have you used in production?',
      'Are you open to on-call?',
      'Anything else we should know?',
    ]);
    expect(answers[0]?.suggested).toContain('making deploys boring');
    expect(answers[0]?.sent).toEqual({
      question: 'Why do you want to work at Acme?',
      text: 'Deploys, mostly.',
      on: '2026-10-08',
    });
    expect(answers[1]).toEqual({
      question: 'What are your salary expectations?',
      suggested: null,
      why: null,
      sent: null,
    });
    expect(answers[2]).toMatchObject({ suggested: 'Go, Python', why: 'Both daily since 2022' });
  });

  it('matches a question Claude shortened, but not a different one', () => {
    const answers = applicationAnswers(
      ['Why do you want to work at Acme Robotics, and why now?', 'Why Acme?'],
      [{ question: 'Why do you want to work at Acme Robotics', answer: 'Deploys.', why: null }],
      [],
    );
    expect(answers.map((each) => each.suggested)).toEqual(['Deploys.', null]);
  });

  it('keeps an answer the user recorded for a question no longer pasted', () => {
    const answers = applicationAnswers(
      [],
      [],
      [{ question: 'Can you start in two weeks?', text: 'Yes', on: '2026-10-08' }],
    );
    expect(answers).toEqual([
      {
        question: 'Can you start in two weeks?',
        suggested: null,
        why: null,
        sent: { question: 'Can you start in two weeks?', text: 'Yes', on: '2026-10-08' },
      },
    ]);
  });
});

describe('askId', () => {
  it('names a question by its day and first words, unique among the job’s', () => {
    const question = 'I have a 15 minute recruiter call tomorrow. What should I expect?';
    expect(askId(question, '2026-10-12', [])).toBe('2026-10-12-i-have-a-15-minute-recruiter');
    expect(askId(question, '2026-10-12', ['2026-10-12-i-have-a-15-minute-recruiter'])).toBe(
      '2026-10-12-i-have-a-15-minute-recruiter-2',
    );
    expect(askId('???', '2026-10-12', [])).toBe('2026-10-12-question');
    expect(askId('Qué tal el equipo?', '2026-10-12', [])).toBe('2026-10-12-que-tal-el-equipo');
  });

  it('makes IDs that name a file safely, and only those pass', () => {
    expect(ASK_ID.test(askId('What’s their stack?', '2026-10-12', []))).toBe(true);
    for (const id of ['../secrets', '2026-10-12', '2026-10-12-', 'notes', '2026-10-12-a/b']) {
      expect(ASK_ID.test(id)).toBe(false);
    }
  });
});
