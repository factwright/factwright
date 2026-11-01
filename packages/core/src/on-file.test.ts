import { describe, expect, it } from 'vitest';
import { NO_APPLICATIONS, REMEMBERED_KINDS } from './fill.ts';
import { isEqualOpportunity } from './forms.ts';
import { matchJobs } from './matching.ts';
import {
  foundOn,
  isStartingResume,
  isSyncedAnswer,
  keptLength,
  kindTargetsIn,
  MOST_QUESTIONS,
  NO_CONTACT,
  payAskFor,
  profileAnswer,
  profileForForms,
  type ResumeShape,
  resumeDetails,
  sentAnswersOf,
  startingFolders,
  startingOnFile,
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

  it('reads each kind of job’s target and titles, the first kind’s from answers.json', () => {
    expect(kindTargetsIn({ targetPay: '$180,000', roles: ['Developer'] }, KINDS)).toEqual([
      { id: 'developer', name: 'Developer', targetPay: '$180,000', roles: ['Developer'] },
      { id: 'project-manager', name: 'Project manager', targetPay: '$150,000', roles: ['PM'] },
      { id: 'teacher', name: 'Teacher', targetPay: '', roles: [] },
    ]);
    // With one kind of job, that one, unnamed.
    expect(kindTargetsIn({ targetPay: '$180,000', roles: ['Developer'] }, null)).toEqual([
      { id: '', name: '', targetPay: '$180,000', roles: ['Developer'] },
    ]);
    expect(kindTargetsIn(null, { first: KINDS.first, others: [] })).toEqual([
      { id: '', name: '', targetPay: '', roles: [] },
    ]);
  });

  it('reads a kind’s titles as the app reads them', () => {
    const rolesOf = (roles: unknown) =>
      kindTargetsIn(
        { roles },
        { first: KINDS.first, others: [{ id: 'teacher', name: 'Teacher', roles }] },
      ).map((kind) => kind.roles);
    // Trimmed, without blanks or repeats.
    expect(rolesOf([' Dev ', '', 'dev', 'PM'])).toEqual([
      ['Dev', 'PM'],
      ['Dev', 'PM'],
    ]);
    // A list that doesn't hold up is nothing told.
    const none = [[], []];
    expect(rolesOf('Dev')).toEqual(none);
    expect(rolesOf(['Dev', 7])).toEqual(none);
    expect(rolesOf(['x'.repeat(121)])).toEqual(none);
    expect(rolesOf(Array.from({ length: 31 }, (_, at) => `Title ${at}`))).toEqual(none);
    // Of two by one id, those of the one the app keeps: not one that doesn't read as a kind.
    expect(
      kindTargetsIn(
        {},
        {
          first: KINDS.first,
          others: [
            { id: 'teacher', name: '', roles: ['Left out'], targetPay: '$1' },
            { id: 'teacher', name: 'Teacher', roles: ['Kept'], targetPay: '$2' },
          ],
        },
      )[1],
    ).toEqual({ id: 'teacher', name: 'Teacher', roles: ['Kept'], targetPay: '$2' });
    // Nor one left out for another's name.
    expect(
      kindTargetsIn(
        {},
        {
          first: KINDS.first,
          others: [
            { id: 'alpha', name: 'Alpha' },
            { id: 'teacher', name: 'alpha', roles: ['Left out'], targetPay: '$1' },
            { id: 'teacher', name: 'Teacher', roles: ['Kept'], targetPay: '$2' },
          ],
        },
      )[2],
    ).toEqual({ id: 'teacher', name: 'Teacher', roles: ['Kept'], targetPay: '$2' });
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

  it('goes by your first kind still, for a job only its title fits another kind', () => {
    const kinds = kindTargetsIn({ targetPay: '$180,000' }, KINDS);
    const title = { ...job(), role: 'PM' };
    expect(startingFolders(title, kinds)[1]).toMatchObject({
      kind: 'Project manager',
      ofJob: true,
    });
    expect(payAskFor(title, kinds)).toEqual({
      text: '$180,000',
      from: 'target',
      kind: 'Developer',
    });
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

describe('what a resume says you did in a position', () => {
  const position = (more: Partial<ResumeShape['experience'][number]> = {}) => ({
    title: 'Program Manager',
    company: 'Acme',
    start: '2021',
    end: 'Present',
    ...more,
  });
  const resume = (...experience: ResumeShape['experience']): ResumeShape => ({
    name: 'Ana Ruiz',
    summary: '',
    experience,
  });
  const linesOf = (more: Partial<ResumeShape['experience'][number]>) =>
    resumeDetails(resume(position(more)), 'job').positions[0]?.lines;

  it('is nothing for a position with no bullets', () => {
    expect(linesOf({})).toEqual([]);
    expect(linesOf({ bullet_groups: [{ bullets: [] }] })).toEqual([]);
  });

  it('is its intro, then a line to each bullet, across its groups, as plain text', () => {
    expect(
      linesOf({
        intro: 'Joined as the **first** PM.',
        bullet_groups: [
          { heading: 'Delivery', bullets: [{ text: 'Ran **40** projects.' }] },
          { heading: 'Planning', bullets: [{ lead: 'Roadmap', text: 'Set it.\n  Twice.' }] },
        ] as never,
      }),
    ).toEqual(['Joined as the first PM.', 'Ran 40 projects.', 'Roadmap: Set it. Twice.']);
  });

  it('never carries a placeholder still to be filled in, or letters typed as one', () => {
    expect(
      linesOf({
        bullet_groups: [
          { bullets: [{ text: 'Grew revenue [[x%]].' }, { text: 'Grew pro\uFB01t twice.' }] },
        ],
      }),
    ).toEqual(['Grew profit twice.']);
  });

  it('is the same for a job’s resume and your newest, which the form filler never takes it from', () => {
    const made = resume(position({ bullet_groups: [{ bullets: [{ text: 'Ran it.' }] }] }));
    expect(resumeDetails(made, 'newest').positions[0]?.lines).toEqual(['Ran it.']);
  });
});

describe('a form’s job’s starting resumes', () => {
  const KINDS = [
    { id: 'pmo', name: 'PMO', roles: ['Program Manager', 'PMO Manager'] },
    { id: 'strategy', name: 'Strategy', roles: ['Strategy Manager'] },
  ];
  const NOT_SET = { kind: null, kindFound: null, role: 'Account Executive' };
  const titled = (role: string) => ({ kind: null, kindFound: null, role });

  it('with one kind of job, are at the top of base, for any job or none', () => {
    const one = [{ folder: 'base', kind: '', ofJob: true }];
    expect(startingFolders(NOT_SET, [])).toEqual(one);
    expect(startingFolders(null, [{ id: '', name: '', roles: [] }])).toEqual(one);
    expect(
      startingFolders({ ...NOT_SET, kind: 'gone', kindFound: 'gone' }, [KINDS[0] as never]),
    ).toEqual(one);
    // A title that fits has nothing to tell apart.
    expect(startingFolders(titled('Program Manager'), [KINDS[0] as never])).toEqual(one);
  });

  it('are those of the kind you put the job under, or else the one found for it', () => {
    const pmo = [{ folder: 'base', kind: 'PMO', ofJob: true }];
    const strategy = [{ folder: 'base/strategy', kind: 'Strategy', ofJob: true }];
    const job = (kind: string | null, kindFound: string | null) => ({
      ...NOT_SET,
      kind,
      kindFound,
    });
    expect(startingFolders(job('pmo', 'strategy'), KINDS)).toEqual(pmo);
    expect(startingFolders(job(null, 'strategy'), KINDS)).toEqual(strategy);
    expect(startingFolders(job(null, 'Strategy (`strategy`)'), KINDS)).toEqual(strategy);
    expect(startingFolders(job('gone', 'pmo'), KINDS)).toEqual(pmo);
  });

  it('are each kind’s, none of them the job’s, while nothing says which, or with no job saved', () => {
    const each = [
      { folder: 'base', kind: 'PMO', ofJob: false },
      { folder: 'base/strategy', kind: 'Strategy', ofJob: false },
    ];
    expect(startingFolders(NOT_SET, KINDS)).toEqual(each);
    expect(startingFolders({ ...NOT_SET, kind: 'gone', kindFound: 'gone' }, KINDS)).toEqual(each);
    expect(startingFolders(null, KINDS)).toEqual(each);
  });

  describe('for a job nothing has said the kind of, by its title', () => {
    const NEITHER = [
      { folder: 'base', kind: 'PMO', ofJob: false },
      { folder: 'base/strategy', kind: 'Strategy', ofJob: false },
    ];
    const TAKES_PMO = [
      { folder: 'base', kind: 'PMO', ofJob: true, byTitle: true },
      { folder: 'base/strategy', kind: 'Strategy', ofJob: false },
    ];
    const TAKES_STRATEGY = [
      { folder: 'base', kind: 'PMO', ofJob: false },
      { folder: 'base/strategy', kind: 'Strategy', ofJob: true, byTitle: true },
    ];

    it('takes the one kind it fits, marked, with the other kinds still beside it', () => {
      expect(startingFolders(titled('Strategy Manager'), KINDS)).toEqual(TAKES_STRATEGY);
      // By any of a kind's titles, the first kind's too, and written any way.
      expect(startingFolders(titled('PMO Manager'), KINDS)).toEqual(TAKES_PMO);
      expect(startingFolders(titled('program mgr'), KINDS)).toEqual(TAKES_PMO);
    });

    it('takes one that says more about the same work, either way round', () => {
      expect(startingFolders(titled('Strategy Manager, Payments'), KINDS)).toEqual(TAKES_STRATEGY);
      expect(startingFolders(titled('Manager, Strategy (Remote)'), KINDS)).toEqual(TAKES_STRATEGY);
      const said = [
        { id: 'pmo', name: 'PMO', roles: ['Program Manager, Infrastructure'] },
        { id: 'strategy', name: 'Strategy', roles: ['Strategist'] },
      ];
      expect(startingFolders(titled('Program Manager'), said)).toEqual(TAKES_PMO);
    });

    it('goes by the work, however senior, as Profile asks that apart from the titles', () => {
      expect(startingFolders(titled('Senior Strategy Manager'), KINDS)).toEqual(TAKES_STRATEGY);
      expect(startingFolders(titled('Sr. Program Manager II'), KINDS)).toEqual(TAKES_PMO);
      const senior = [
        { id: 'pmo', name: 'PMO', roles: ['Principal Program Manager'] },
        { id: 'strategy', name: 'Strategy', roles: ['Strategist'] },
      ];
      expect(startingFolders(titled('Program Manager'), senior)).toEqual(TAKES_PMO);
    });

    it('takes none it’s apart from, or another kind of work', () => {
      expect(startingFolders(titled('Product Manager'), KINDS)).toEqual(NEITHER);
      expect(startingFolders(titled('Strategy Analyst'), KINDS)).toEqual(NEITHER);
      expect(startingFolders(titled('Program Manager, Designer'), KINDS)).toEqual(NEITHER);
      const engineers = [
        { id: 'pmo', name: 'PMO', roles: ['Engineer'] },
        { id: 'strategy', name: 'Strategy', roles: ['Strategist'] },
      ];
      expect(startingFolders(titled('Engineer, Support'), engineers)).toEqual(NEITHER);
    });

    it('takes none where two kinds fit, by one title or each by its own', () => {
      const both = [
        { id: 'pmo', name: 'PMO', roles: ['Program Manager'] },
        { id: 'strategy', name: 'Strategy', roles: ['Program Manager'] },
      ];
      expect(startingFolders(titled('Program Manager'), both)).toEqual(NEITHER);
      expect(startingFolders(titled('Senior Program Manager, Data'), both)).toEqual(NEITHER);
      // Each kind by a title of its own, and one fitting the same and the other more.
      expect(startingFolders(titled('Strategy Program Manager'), KINDS)).toEqual(NEITHER);
      const close = [
        { id: 'pmo', name: 'PMO', roles: ['Manager'] },
        { id: 'strategy', name: 'Strategy', roles: ['Strategy Manager'] },
      ];
      expect(startingFolders(titled('Strategy Manager'), close)).toEqual(NEITHER);
    });

    it('takes none for a kind with no titles, or a job with none', () => {
      const none = [
        { id: 'pmo', name: 'PMO', roles: [] },
        { id: 'strategy', name: 'Strategy', roles: [] },
      ];
      expect(startingFolders(titled('PMO'), none)).toEqual(NEITHER);
      expect(startingFolders(titled(''), KINDS)).toEqual(NEITHER);
      expect(startingFolders(titled('(Remote)'), KINDS)).toEqual(NEITHER);
    });

    it('never wins over the kind you put it under, or the one found for it', () => {
      const pmo = [{ folder: 'base', kind: 'PMO', ofJob: true }];
      const job = titled('Strategy Manager');
      expect(startingFolders({ ...job, kind: 'pmo' }, KINDS)).toEqual(pmo);
      expect(startingFolders({ ...job, kindFound: 'pmo' }, KINDS)).toEqual(pmo);
      // One that names none of your kinds says nothing, as for a kind since removed.
      expect(startingFolders({ ...job, kind: 'gone', kindFound: 'gone' }, KINDS)).toEqual(
        TAKES_STRATEGY,
      );
    });

    it('takes one that says only how senior by its whole words alone', () => {
      const chiefs = [
        { id: 'pmo', name: 'PMO', roles: ['Chief of Staff'] },
        { id: 'strategy', name: 'Strategy', roles: ['Director'] },
      ];
      expect(startingFolders(titled('Chief of Staff'), chiefs)).toEqual(TAKES_PMO);
      expect(startingFolders(titled('Director'), chiefs)).toEqual(TAKES_STRATEGY);
      // Which fits no work at that level, and no other title with no work in it.
      expect(startingFolders(titled('Director of Strategy'), chiefs)).toEqual(NEITHER);
      expect(startingFolders(titled('Vice President'), chiefs)).toEqual(NEITHER);
    });

    it('goes by the whole words of titles in letters matching can’t read', () => {
      const kinds = [
        { id: 'pmo', name: 'PMO', roles: ['プロジェクトマネージャー'] },
        { id: 'strategy', name: 'Strategy', roles: ['戦略コンサルタント', 'Java 开发经理'] },
      ];
      expect(startingFolders(titled('プロジェクトマネージャー'), kinds)).toEqual(TAKES_PMO);
      expect(startingFolders(titled('戦略コンサルタント'), kinds)).toEqual(TAKES_STRATEGY);
      // Matching reads all of these as nothing, or the Latin alone, which is no fit for that.
      expect(startingFolders(titled('営業マネージャー'), kinds)).toEqual(NEITHER);
      expect(startingFolders(titled('Java Developer'), kinds)).toEqual(NEITHER);
      expect(startingFolders(titled('Java 测试经理'), kinds)).toEqual(NEITHER);
      expect(
        startingFolders(titled('Java'), [
          { id: 'pmo', name: 'PMO', roles: ['Java 开发经理'] },
          { id: 'strategy', name: 'Strategy', roles: ['Strategist'] },
        ]),
      ).toEqual(NEITHER);
      // A title in letters it can't read fits no title it can, and the other way round.
      expect(startingFolders(titled('Project Manager'), kinds)).toEqual(NEITHER);
      expect(startingFolders(titled('プロジェクトマネージャー'), KINDS)).toEqual(NEITHER);
    });

    it('carries the kind’s mark through to what its resumes say', () => {
      const [, strategy] = startingFolders(titled('Strategy Manager'), KINDS);
      expect(startingOnFile(strategy as never, [])).toEqual({
        kind: 'Strategy',
        ofJob: true,
        byTitle: true,
        positions: [],
      });
    });
  });

  it('are a folder’s resumes’ data, without a copy sync kept of one', () => {
    expect(isStartingResume('big-company-leader.json')).toBe(true);
    expect(isStartingResume('startup (old).pdf')).toBe(false);
    expect(isStartingResume('AnaRuizResume_Startups.pdf')).toBe(false);
    expect(isStartingResume('big-company-leader (Sam’s MacBook Pro, Oct 12).json')).toBe(false);
    expect(isStartingResume('big-company-leader (conflict 1).json')).toBe(false);
  });

  it('say what you did in each position that says, from each file in turn', () => {
    const job = (title: string, ...text: string[]) => ({
      title,
      company: 'Acme',
      start: '2021',
      end: '2023',
      bullet_groups: [{ bullets: text.map((one) => ({ text: one })) }],
    });
    const file = (...experience: ResumeShape['experience']): ResumeShape => ({
      name: 'Ana Ruiz',
      summary: '',
      experience,
    });
    expect(
      startingOnFile({ folder: 'base', kind: 'PMO', ofJob: true }, [
        file(job('Lead', 'Led it.'), job('Analyst')),
        file(job('Director', 'Ran it.')),
      ]),
    ).toEqual({
      kind: 'PMO',
      ofJob: true,
      positions: [
        { company: 'Acme', title: 'Lead', start: '2021', lines: ['Led it.'] },
        { company: 'Acme', title: 'Director', start: '2021', lines: ['Ran it.'] },
      ],
    });
  });
});
