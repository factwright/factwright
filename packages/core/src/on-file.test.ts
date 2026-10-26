import { describe, expect, it } from 'vitest';
import { NO_APPLICATIONS, REMEMBERED_KINDS } from './fill.ts';
import { isEqualOpportunity } from './forms.ts';
import { matchJobs } from './matching.ts';
import {
  foundOn,
  isSyncedAnswer,
  keptLength,
  kindTargetsIn,
  MOST_QUESTIONS,
  NO_CONTACT,
  payAskFor,
  profileAnswer,
  profileForForms,
  sentAnswersOf,
  uploadName,
  withFormQuestions,
  withProfileAnswers,
  withSentAnswers,
} from './on-file.ts';

const WHEN = { today: '2026-10-23', now: '2026-10-23T18:30:00.000Z' };

describe('what forms ask, from Profile’s answers.json', () => {
  it('reads each answer forms ask', () => {
    const read = profileForForms({
      you: { name: 'Ana María Ruiz', email: 'ana@example.com', location: 'Denver, CO' },
      applications: {
        pronouns: 'She/her',
        countries: ['United States', ' united states '],
        leaving: 'I want to build data products at a bigger scale.',
      },
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
      applications: {
        ...NO_APPLICATIONS,
        pronouns: 'She/her',
        countries: ['United States'],
        leaving: 'I want to build data products at a bigger scale.',
      },
      authorization: 'US citizen',
      start: 'Two weeks',
      relocate: 'maybe',
      targetPay: '$150,000',
    });
    // Why you're leaving takes a few sentences, where the rest take a line.
    const long = 'x'.repeat(1000);
    expect(profileForForms({ applications: { leaving: long } }).applications.leaving).toBe(long);
    expect(profileForForms({ applications: { city: long } }).applications).toEqual(NO_APPLICATIONS);
    expect(keptLength('leaving')).toBe(1000);
    expect(keptLength('city')).toBe(200);
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
    expect(
      profileForForms({ applications: { pronouns: 'She/her', leaving: 'x'.repeat(1001) } })
        .applications,
    ).toEqual(NO_APPLICATIONS);
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

describe('new answers kept in Profile’s answers.json', () => {
  it('are every kind Profile keeps for forms, but those that never sync', () => {
    expect(REMEMBERED_KINDS.filter((kind) => !isSyncedAnswer(kind))).toEqual([
      'street',
      'postal-code',
      ...REMEMBERED_KINDS.filter(isEqualOpportunity),
    ]);
  });

  it('each go in their place, as the app reads them, and leave the rest of the file as it is', () => {
    const file = {
      you: { name: 'Ana María Ruiz', email: 'ana@example.com', phone: '', later: 'kept' },
      applications: { pronouns: 'She/her', countries: ['United States'] },
      roles: ['Product Manager'],
      fromLater: { kept: true },
    };
    const kept = withProfileAnswers(file, [
      { kind: 'phone', text: '(303) 555-0199' },
      { kind: 'city', text: 'Denver' },
      { kind: 'how-heard', text: 'A friend' },
      { kind: 'leaving', text: 'A bigger scale.' },
      { kind: 'start-date', text: 'Two weeks' },
    ]);
    expect(kept).toEqual({
      you: {
        ...NO_CONTACT,
        name: 'Ana María Ruiz',
        email: 'ana@example.com',
        phone: '(303) 555-0199',
        later: 'kept',
      },
      applications: {
        ...NO_APPLICATIONS,
        pronouns: 'She/her',
        countries: ['United States'],
        city: 'Denver',
        howHeard: 'A friend',
        leaving: 'A bigger scale.',
      },
      roles: ['Product Manager'],
      fromLater: { kept: true },
      start: 'Two weeks',
    });
    expect(profileAnswer(kept, 'phone')).toBe('(303) 555-0199');
    expect(profileAnswer(kept, 'city')).toBe('Denver');
    expect(profileAnswer(kept, 'start-date')).toBe('Two weeks');
    expect(profileAnswer(kept, 'leaving')).toBe('A bigger scale.');
    expect(profileAnswer(kept, 'github')).toBe('');
    // A part that doesn't hold up reads as nothing told, as the app reads it.
    expect(withProfileAnswers({ you: { email: 42 } }, [{ kind: 'phone', text: '1' }])).toEqual({
      you: { ...NO_CONTACT, phone: '1' },
    });
    expect(withProfileAnswers(file, [])).toEqual(file);
  });
});

describe('the pay to ask for at a job', () => {
  const KINDS = {
    first: { id: 'developer', name: 'Developer' },
    others: [
      { id: 'project-manager', name: 'Project manager', targetPay: '$150,000', roles: ['PM'] },
      { id: 'teacher', name: 'Teacher' },
    ],
  };
  const job = (more: Partial<Parameters<typeof payAskFor>[0] & object> = {}) => ({
    payAsk: null,
    suggestedAsk: null,
    kind: null,
    kindFound: null,
    ...more,
  });

  it('reads each kind of job’s target, the first kind’s from answers.json', () => {
    expect(kindTargetsIn({ targetPay: '$180,000' }, KINDS)).toEqual([
      { id: 'developer', name: 'Developer', targetPay: '$180,000' },
      { id: 'project-manager', name: 'Project manager', targetPay: '$150,000' },
      { id: 'teacher', name: 'Teacher', targetPay: '' },
    ]);
    // With one kind of job, that one, unnamed.
    expect(kindTargetsIn({ targetPay: '$180,000' }, null)).toEqual([
      { id: '', name: '', targetPay: '$180,000' },
    ]);
    expect(kindTargetsIn(null, { first: KINDS.first, others: [] })).toEqual([
      { id: '', name: '', targetPay: '' },
    ]);
  });

  it('is yours for the job, or else your Claude’s suggestion, or else your target', () => {
    const kinds = kindTargetsIn({ targetPay: '$180,000' }, KINDS);
    expect(payAskFor(job({ payAsk: '$190,000', suggestedAsk: '$185,000' }), kinds)).toEqual({
      text: '$190,000',
      from: 'you',
      kind: null,
    });
    expect(payAskFor(job({ suggestedAsk: ' $185,000 ' }), kinds)).toEqual({
      text: '$185,000',
      from: 'claude',
      kind: null,
    });
    expect(payAskFor(job(), kinds)).toEqual({
      text: '$180,000',
      from: 'target',
      kind: 'Developer',
    });
  });

  it('takes the target of the kind of job it’s under, or else your first kind’s', () => {
    const kinds = kindTargetsIn({ targetPay: '$180,000' }, KINDS);
    expect(payAskFor(job({ kind: 'project-manager' }), kinds)).toEqual({
      text: '$150,000',
      from: 'target',
      kind: 'Project manager',
    });
    // As a fit check found it, by name.
    expect(payAskFor(job({ kindFound: 'Project Manager' }), kinds)?.text).toBe('$150,000');
    // A kind with no target has none.
    expect(payAskFor(job({ kind: 'teacher' }), kinds)).toBeNull();
    // A form with no job saved goes by the first kind's.
    expect(payAskFor(null, kinds)?.text).toBe('$180,000');
    // With one kind of job, its target, with no kind to name.
    expect(payAskFor(job(), kindTargetsIn({ targetPay: '$180,000' }, null))).toEqual({
      text: '$180,000',
      from: 'target',
      kind: null,
    });
    expect(payAskFor(job(), kindTargetsIn({}, null))).toBeNull();
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
        { question: 'Why are you leaving?', text: 'A bigger scale.' },
        { question: 'What are your salary expectations?', text: '$185,000' },
      ]),
    ).toEqual([
      { question: 'Why us?', nth: 0, text: 'Data products.' },
      { question: 'If yes, please explain.', nth: 0, text: 'First.' },
      { question: 'If yes, please explain.', nth: 1, text: 'Second.' },
      // Why you're leaving, as put for this job, but never the rest of what Profile answers.
      { question: 'Why are you leaving?', nth: 0, text: 'A bigger scale.' },
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

  it('uploads a file under its own name', () => {
    expect(uploadName(file)).toBe('AnaRuizResume.pdf');
    expect(uploadName({ ...file, name: 'SteveHillyerResume10242026_Talkiatry.pdf' })).toBe(
      'SteveHillyerResume10242026_Talkiatry.pdf',
    );
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
