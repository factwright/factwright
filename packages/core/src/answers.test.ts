import { describe, expect, it } from 'vitest';
import {
  ASK_ID,
  applicationAnswers,
  askId,
  questionKey,
  readSuggestedAnswers,
  type SuggestedAnswer,
} from './answers.ts';
import type { SentAnswer } from './tracker.ts';

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

const sent = (question: string, text: string, nth = 0, at = '2026-10-08T12:00:00.000Z') =>
  ({ question, nth, text, on: at.slice(0, 10), at }) satisfies SentAnswer;

const suggestion = (question: string, answer: string, batch = 1): SuggestedAnswer => ({
  question,
  answer,
  why: null,
  batch,
});

describe('readSuggestedAnswers', () => {
  it('reads each question and its answer, and each row of a table of picks, in order', () => {
    expect(readSuggestedAnswers(ANSWERS)).toEqual([
      {
        question: 'Why do you want to work at Acme?',
        answer: "I've spent three years making deploys boring.\n\nYour robots need that too.",
        why: null,
        batch: 1,
      },
      {
        question: 'Which languages have you used in production?',
        answer: 'Go, Python',
        why: 'Both daily since 2022',
        batch: 1,
      },
      { question: 'Are you open to on-call?', answer: 'Yes', why: null, batch: 1 },
      {
        question: 'Anything else we should know?',
        answer: 'Nope, the resume covers it.',
        why: null,
        batch: 1,
      },
    ]);
  });

  it('ends an answer where the next run’s title starts, leaving that title out', () => {
    const added = `${ANSWERS}\n# Application questions: Acme Robotics, Staff Engineer\n\nDrafted 2026-10-09.\n\n## Why do you want to work at Acme?\n\nShorter this time.\n`;
    const found = readSuggestedAnswers(added);
    expect(found.find((each) => each.question === 'Anything else we should know?')?.answer).toBe(
      'Nope, the resume covers it.',
    );
    expect(found.filter((each) => each.question.startsWith('Why do you'))).toEqual([
      expect.objectContaining({ batch: 1 }),
      {
        question: 'Why do you want to work at Acme?',
        answer: 'Shorter this time.',
        why: null,
        batch: 2,
      },
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
  it('lists the pasted questions in order, with Claude’s suggestion and what was sent', () => {
    const answers = applicationAnswers(
      ['1. Why do you want to work at Acme? *', 'What are your salary expectations?'],
      readSuggestedAnswers(ANSWERS),
      [sent('Why do you want to work at Acme?', 'Deploys, mostly.')],
    );
    expect(answers.map(({ question }) => question)).toEqual([
      '1. Why do you want to work at Acme? *',
      'What are your salary expectations?',
      'Which languages have you used in production?',
      'Are you open to on-call?',
      'Anything else we should know?',
    ]);
    expect(answers[0]?.suggested).toContain('making deploys boring');
    expect(answers[0]?.sent?.text).toBe('Deploys, mostly.');
    expect(answers[1]).toEqual({
      question: 'What are your salary expectations?',
      nth: 0,
      suggested: null,
      why: null,
      sent: null,
    });
    expect(answers[2]).toMatchObject({ suggested: 'Go, Python', why: 'Both daily since 2022' });
  });

  it('keeps every pasted question, even ones alike, so none goes missing', () => {
    const answers = applicationAnswers(
      [
        'Have you used Kubernetes?',
        'Have you used Kubernetes in production?',
        'If yes, please explain.',
        'Are you open to on-call?',
        'If yes, please explain.',
      ],
      [],
      [],
    );
    expect(answers.map(({ question, nth }) => [question, nth])).toEqual([
      ['Have you used Kubernetes?', 0],
      ['Have you used Kubernetes in production?', 0],
      ['If yes, please explain.', 0],
      ['Are you open to on-call?', 0],
      ['If yes, please explain.', 1],
    ]);
  });

  it('gives a question asked twice the answers in order, and a later run’s answer in place', () => {
    const answers = applicationAnswers(
      ['If yes, please explain.', 'If yes, please explain.'],
      [
        suggestion('If yes, please explain.', 'First'),
        suggestion('If yes, please explain.', 'Second'),
        suggestion('If yes, please explain.', 'First, again', 2),
      ],
      [sent('If yes, please explain.', 'Sent second', 1)],
    );
    expect(answers.map(({ suggested, sent }) => [suggested, sent?.text ?? null])).toEqual([
      ['First, again', null],
      ['Second', 'Sent second'],
    ]);
  });

  it('matches a question Claude shortened only when none has its exact words', () => {
    const answers = applicationAnswers(
      ['Why do you want to work at Acme Robotics, and why now?', 'Why Acme?'],
      [suggestion('Why do you want to work at Acme Robotics', 'Deploys.')],
      [],
    );
    expect(answers.map((each) => each.suggested)).toEqual(['Deploys.', null]);
    const exact = applicationAnswers(
      ['Have you used Kubernetes?', 'Have you used Kubernetes in production?'],
      [suggestion('Have you used Kubernetes in production?', 'Yes, for three years.')],
      [],
    );
    expect(exact.map((each) => each.suggested)).toEqual([null, 'Yes, for three years.']);
  });

  it('keeps an answer the user recorded for a question no longer pasted', () => {
    expect(applicationAnswers([], [], [sent('Can you start in two weeks?', 'Yes')])).toEqual([
      {
        question: 'Can you start in two weeks?',
        nth: 0,
        suggested: null,
        why: null,
        sent: sent('Can you start in two weeks?', 'Yes'),
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
