import { describe, expect, it } from 'vitest';
import { NO_APPLICATIONS } from './fill.ts';
import { matchJobs } from './matching.ts';
import {
  foundOn,
  MOST_QUESTIONS,
  NO_CONTACT,
  profileForForms,
  sentAnswersOf,
  uploadName,
  withFormQuestions,
  withSentAnswers,
} from './on-file.ts';

const WHEN = { today: '2026-10-23', now: '2026-10-23T18:30:00.000Z' };

describe('what forms ask, from Profile’s answers.json', () => {
  it('reads each answer forms ask', () => {
    const read = profileForForms({
      you: { name: 'Ana María Ruiz', email: 'ana@example.com', location: 'Denver, CO' },
      applications: { pronouns: 'She/her', countries: ['United States', ' united states '] },
      authorization: 'US citizen',
      start: 'Two weeks',
      relocate: 'maybe',
      targetPay: '$150,000',
      roles: ['Product Manager'],
    });
    expect(read).toEqual({
      you: {
        ...NO_CONTACT,
        name: 'Ana María Ruiz',
        email: 'ana@example.com',
        location: 'Denver, CO',
      },
      applications: { ...NO_APPLICATIONS, pronouns: 'She/her', countries: ['United States'] },
      authorization: 'US citizen',
      start: 'Two weeks',
      relocate: 'maybe',
      targetPay: '$150,000',
    });
  });

  it('takes nothing told for an answer that doesn’t hold up, and keeps the rest', () => {
    const read = profileForForms({
      you: { name: 'x'.repeat(201) },
      applications: { sponsorship: 'always' },
      authorization: 42,
      relocate: 'sometimes',
      targetPay: 'x'.repeat(121),
      start: 'Now',
    });
    expect(read).toEqual({
      you: NO_CONTACT,
      applications: NO_APPLICATIONS,
      authorization: '',
      start: 'Now',
      relocate: '',
      targetPay: '',
    });
    expect(profileForForms(null)).toEqual(profileForForms({}));
  });
});

describe('the questions a form adds to a job', () => {
  it('adds each the job doesn’t have, as many times as the form asks it', () => {
    expect(
      withFormQuestions(
        ['Why us?'],
        ['WHY US', 'If yes, please explain.', 'If yes, please explain.', 'Why us?'],
      ),
    ).toEqual(['Why us?', 'If yes, please explain.', 'If yes, please explain.', 'Why us?']);
  });

  it('changes nothing when the job has them all, or keeps as many as a job keeps', () => {
    expect(withFormQuestions(['Why us?', 'Salary?'], ['why us', 'Salary?'])).toBeNull();
    const many = Array.from({ length: MOST_QUESTIONS + 5 }, (_, at) => `Question ${at + 1}?`);
    expect(withFormQuestions([], many)).toHaveLength(MOST_QUESTIONS);
  });
});

describe('what Mark as applied records', () => {
  it('only the form’s own questions, each time a form asks one, never a blank', () => {
    expect(
      sentAnswersOf([
        { question: 'Email', text: 'ana@example.com' },
        { question: 'Why us?', text: '  Data products.  ' },
        { question: 'If yes, please explain.', text: 'First.' },
        { question: 'If yes, please explain.', text: 'Second.' },
        { question: 'Anything else?', text: '   ' },
      ]),
    ).toEqual([
      { question: 'Why us?', nth: 0, text: 'Data products.' },
      { question: 'If yes, please explain.', nth: 0, text: 'First.' },
      { question: 'If yes, please explain.', nth: 1, text: 'Second.' },
    ]);
  });

  it('in place of what was kept for the same question, and the same time it’s asked', () => {
    const before = [
      { question: 'Why us?', nth: 0, text: 'Old.', on: '2026-10-12', at: '2026-10-12T10:00:00Z' },
      { question: 'Why now?', nth: 0, text: 'Kept.', on: '2026-10-12', at: '2026-10-12T10:00:00Z' },
    ];
    const { sent, recorded } = withSentAnswers(
      before,
      [
        { question: 'why us', nth: 0, text: 'New.' },
        { question: 'Why remote?', nth: 0, text: 'Added.' },
        { question: 'Why later?', nth: 0, text: ' ' },
      ],
      WHEN,
    );
    expect(recorded).toBe(2);
    expect(sent).toEqual([
      { question: 'why us', nth: 0, text: 'New.', on: WHEN.today, at: WHEN.now },
      before[1],
      { question: 'Why remote?', nth: 0, text: 'Added.', on: WHEN.today, at: WHEN.now },
    ]);
  });
});

describe('a job’s uploads and where it was found', () => {
  const file = {
    path: 'applications/a/AnaRuizResume.pdf',
    name: 'AnaRuizResume.pdf',
    format: 'pdf' as const,
    size: 10,
    modified: '2026-10-20T10:00:00.000Z',
  };

  it('names an upload as a person would, or by the file’s own name', () => {
    expect(uploadName('Ana María Ruiz', 'resume', file)).toBe('Ana María Ruiz - Resume.pdf');
    expect(uploadName('Ana/Ruiz', 'cover-letter', file)).toBe('Ana Ruiz - Cover Letter.pdf');
    expect(uploadName(' ', 'resume', file)).toBe('AnaRuizResume.pdf');
  });

  it('says where you found it, by the site it was saved from', () => {
    const at = (url: string) => ({ links: [{ url }], link: null }) as Parameters<typeof foundOn>[0];
    expect(foundOn(at('https://www.linkedin.com/jobs/view/1/'))).toBe('LinkedIn');
    expect(foundOn(at('https://jobs.lever.co/acme/1'))).toBe('Company website');
    expect(foundOn({ links: [], link: null } as unknown as Parameters<typeof foundOn>[0])).toBe('');
  });
});

describe('finding a job on file', () => {
  it('best match first: the same posting, then the same role', () => {
    const job = (id: string, role: string, url: string) => ({
      id,
      company: 'Acme Robotics',
      companyKey: '',
      role,
      links: [{ url }],
    });
    const jobs = [
      job('acme--pm', 'Product Manager', 'https://acme.example/careers'),
      job('acme--staff', 'Staff Engineer', 'https://jobs.lever.co/acme/1'),
    ];
    expect(
      matchJobs(jobs, {
        company: 'Acme Robotics',
        role: 'Product Manager',
        link: 'https://jobs.lever.co/acme/1',
      }).map(({ job: found, match }) => [found.id, match]),
    ).toEqual([
      ['acme--staff', 'posting'],
      ['acme--pm', 'role'],
    ]);
  });
});
