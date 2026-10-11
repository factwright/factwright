import {
  type Call,
  type FitReport,
  type Job,
  type JobDocs,
  type JobStatus,
  localDate,
  type ScorePart,
  type SearchDetail,
  type Sentiment,
} from '@factwright/core';

/** A date some days from today, so the samples always look current. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

const NO_DETAIL: SearchDetail = {
  why: [],
  gaps: [],
  flags: [],
  pick: null,
  what: null,
  stage: null,
  apply: null,
  note: null,
  parts: {},
  partsWhy: {},
  tags: [],
  report: null,
};

function part(key: ScorePart['key'], points: number, max: number, why: string): ScorePart {
  return { key, points, max, why, items: [] };
}

function report(total: number, verdict: string, parts: ScorePart[], date: string): FitReport {
  return {
    date,
    verdict,
    total,
    parts,
    filters: {
      pass: true,
      text: 'Pass. Remote or hybrid, and the pay clears your floor.',
      details: [],
    },
    why: [
      { text: 'Years of platform work that matches the team’s', sub: [] },
      { text: 'Led a build-system rewrite at a similar scale', sub: [] },
    ],
    gaps: [{ text: 'No production Rust', sub: [] }],
    flags: [{ text: 'A few reviews say promotions are slow', sub: [] }],
    sentiment: null,
  };
}

function sentiment(mood: Sentiment['mood'], summary: string, date: string): Sentiment {
  return {
    date,
    from: 'fit-check',
    mood,
    summary,
    points: [
      { text: 'Engineers praise their managers and the tooling budget.', sub: [] },
      { text: 'Some say on-call is heavy in the first year.', sub: [] },
    ],
  };
}

function call(id: string, extra: Partial<Call>): Call {
  return {
    id,
    kind: 'screen',
    onDate: day(1),
    atTime: null,
    state: 'scheduled',
    outcome: null,
    notes: null,
    ...extra,
  };
}

function resume(company: string, modified: string) {
  const name = `Resume - ${company}.pdf`;
  return {
    path: `applications/${company.toLowerCase().replace(/\W+/g, '-')}/${name}`,
    name,
    format: 'pdf' as const,
    size: 52_400,
    modified: `${modified}T15:00:00.000Z`,
  };
}

function job(base: Partial<Job> & Pick<Job, 'id' | 'company' | 'role'>): Job {
  return {
    companyKey: base.id.split('--')[0] ?? base.id,
    link: `https://jobs.example/${base.id}`,
    links: [],
    location: 'Remote, US',
    pay: null,
    source: 'HN October 2026',
    fit: null,
    search: null,
    folder: null,
    stage: 'new',
    firstSeen: day(-24),
    lastActivity: day(-6),
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    status: null,
    statusOn: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    notes: null,
    archived: false,
    manual: false,
    calls: [],
    statusLog: [],
    docKinds: [],
    ...base,
  };
}

const listed = (min: number, max: number) => ({
  text: `$${min}k–$${max}k`,
  min: min * 1000,
  max: max * 1000,
  source: 'listed' as const,
});

const changes = (id: string, steps: [JobStatus, number][]) =>
  steps.map(([status, offset], i) => ({ id: `${id}-${i}`, status, at: day(offset) }));

/** Made-up jobs for the sample screens, with every state the list and the panel can show. */
export function sampleJobs(): Job[] {
  return [
    job({
      id: 'northwind-labs--senior-software-engineer-platform',
      company: 'Northwind Labs',
      role: 'Senior Software Engineer, Platform',
      location: 'Hybrid, Seattle',
      pay: listed(175, 205),
      stage: 'resume',
      fit: { verdict: 'Strong', score: 86, date: day(-20) },
      fitReport: {
        ...report(
          86,
          'Strong',
          [
            {
              ...part('work', 34, 40, 'Platform services used by every product team'),
              items: [
                { mark: 'yes', text: 'Service platform: the internal platform you ran, live' },
                { mark: 'part', text: 'Cost tooling: partly, a smaller version' },
                { mark: 'no', text: 'Multi-region failover' },
              ],
            },
            part('role', 22, 25, 'Senior engineer on core infrastructure'),
            part('stack', 16, 20, 'Go, Kubernetes and Postgres all match'),
            part('reqs', 14, 15, 'Every must-have is covered'),
          ],
          day(-20),
        ),
      },
      sentiment: sentiment(
        'liked',
        'People praise the team and a steady pace. Pay sits at the top of the band.',
        day(-20),
      ),
      status: 'interview',
      statusOn: day(-3),
      appliedOn: day(-16),
      statusLog: changes('northwind', [
        ['applied', -16],
        ['screen', -10],
        ['interview', -3],
      ]),
      calls: [
        call('northwind-screen', {
          onDate: day(-9),
          atTime: '10:00',
          state: 'done',
          outcome: 'advanced',
          notes: 'Recruiter was friendly. Team of six.',
        }),
        call('northwind-panel', { kind: 'panel', onDate: day(4), atTime: '14:00' }),
      ],
      files: [resume('Northwind Labs', day(-17))],
      docKinds: ['posting', 'job', 'fit', 'prep', 'answers'],
      events: [
        {
          id: 'nw-search',
          tool: 'search',
          date: day(-24),
          title: 'Found in HN October 2026: Strong 84',
        },
        { id: 'nw-fit', tool: 'fit-check', date: day(-20), title: 'Fit check: Strong 86' },
        { id: 'nw-resume', tool: 'resume', date: day(-17), title: 'Resume built' },
        { id: 'nw-prep', tool: 'prep', date: day(-2), title: 'Interview prep written' },
      ],
      lastActivity: day(-2),
    }),
    job({
      id: 'acme-robotics--staff-engineer-developer-tools',
      company: 'Acme Robotics',
      role: 'Staff Engineer, Developer Tools',
      pay: { text: '$185k–$215k', min: 185_000, max: 215_000, source: 'estimate' },
      stage: 'checked',
      fit: { verdict: 'Good', score: 78, date: day(-1) },
      fitReport: report(
        78,
        'Good',
        [
          part('work', 31, 40, 'Build and CI tooling for hundreds of engineers'),
          part('role', 19, 25, 'Staff scope on a platform team'),
          part('stack', 14, 20, 'Go and TypeScript match; Rust would be new'),
          part('reqs', 14, 15, 'Eight-plus years and mentoring are covered'),
        ],
        day(-1),
      ),
      sentiment: sentiment(
        'liked',
        'Engineers like the tooling budget and the team. A few say promotions are slow.',
        day(-1),
      ),
      apply: [
        '- **Alert:** Apply on their careers page, not LinkedIn. The form asks for a short note about a tool you built.',
        '- **Email:** jobs@acme.example',
        '- **Subject:** "Staff Engineer, Developer Tools"',
        '',
        '1. Attach the resume as a PDF.',
        '2. Keep the note to three sentences.',
      ].join('\n'),
      docKinds: ['posting', 'job', 'fit'],
      lastActivity: day(-1),
      events: [{ id: 'acme-fit', tool: 'fit-check', date: day(-1), title: 'Fit check: Good 78' }],
    }),
    job({
      id: 'tidewater-analytics--senior-backend-engineer',
      company: 'Tidewater Analytics',
      role: 'Senior Backend Engineer',
      pay: listed(150, 180),
      stage: 'resume',
      fit: { verdict: 'Strong', score: 81, date: day(-14) },
      status: 'screen',
      statusOn: day(-2),
      appliedOn: day(-11),
      statusLog: changes('tidewater', [
        ['applied', -11],
        ['screen', -2],
      ]),
      calls: [call('tidewater-screen', { onDate: day(2), atTime: '10:30' })],
      files: [resume('Tidewater Analytics', day(-12))],
      docKinds: ['posting', 'job'],
    }),
    job({
      id: 'lumen-health--senior-full-stack-engineer',
      company: 'Lumen Health',
      role: 'Senior Full-Stack Engineer',
      pay: listed(160, 190),
      stage: 'resume',
      fit: { verdict: 'Good', score: 72, date: day(-6) },
      sentiment: sentiment(
        'mixed',
        'Good benefits and kind managers. Reorganizations come often.',
        day(-6),
      ),
      status: 'applied',
      statusOn: day(-3),
      appliedOn: day(-3),
      statusLog: changes('lumen', [['applied', -3]]),
      files: [resume('Lumen Health', day(-4))],
      docKinds: ['posting', 'answers'],
    }),
    job({
      id: 'brightpath-learning--software-engineer-iii',
      company: 'Brightpath Learning',
      role: 'Software Engineer III',
      location: 'Remote, Americas',
      pay: listed(140, 165),
      stage: 'resume',
      fit: { verdict: 'Worth a look', score: 69, date: day(-3) },
      files: [resume('Brightpath Learning', day(-1))],
      lastActivity: day(-1),
      docKinds: ['posting'],
    }),
    job({
      id: 'harbor-and-pine--senior-engineer-payments',
      company: 'Harbor & Pine',
      role: 'Senior Engineer, Payments',
      location: 'Hybrid, Denver',
      pay: listed(155, 185),
      stage: 'resume',
      fit: { verdict: 'Worth a look', score: 64, date: day(-15) },
      status: 'applied',
      statusOn: day(-12),
      appliedOn: day(-12),
      statusLog: changes('harbor', [['applied', -12]]),
      files: [resume('Harbor & Pine', day(-13))],
      notes: 'Referred by a former teammate. Ask about the new payments team.',
    }),
    job({
      id: 'fernway--engineering-lead',
      company: 'Fernway',
      role: 'Engineering Lead, Integrations',
      pay: listed(190, 220),
      stage: 'resume',
      fit: { verdict: 'Strong', score: 80, date: day(-30) },
      status: 'offer',
      statusOn: day(-1),
      appliedOn: day(-28),
      nextAction: 'Reply to the offer',
      nextOn: day(-1),
      statusLog: changes('fernway', [
        ['applied', -28],
        ['interview', -14],
        ['offer', -1],
      ]),
    }),
    job({
      id: 'copperleaf-energy--principal-engineer',
      company: 'Copperleaf Energy',
      role: 'Principal Engineer',
      pay: listed(190, 230),
      search: {
        source: 'HN October 2026',
        date: day(-2),
        tier: 'good',
        score: 71,
        detail: {
          ...NO_DETAIL,
          pick: 'Grid software with a small, senior team',
          what: 'Software that balances solar and battery storage',
          stage: 'Series B',
          parts: { work: 29, role: 18, stack: 12, reqs: 12 },
        },
      },
      firstSeen: day(-2),
      lastActivity: day(-2),
      docKinds: ['posting'],
    }),
    job({
      id: 'bluewave-staffing--senior-engineer',
      company: 'Bluewave Staffing',
      role: 'Senior Engineer (client: fintech)',
      firstSeen: day(-1),
      lastActivity: day(-1),
    }),
    job({
      id: 'meridian-freight--staff-engineer',
      company: 'Meridian Freight',
      role: 'Staff Engineer',
      stage: 'resume',
      fit: { verdict: 'Good', score: 70, date: day(-40) },
      status: 'rejected',
      statusOn: day(-9),
      appliedOn: day(-30),
      statusLog: changes('meridian', [
        ['applied', -30],
        ['rejected', -9],
      ]),
    }),
    job({
      id: 'sable-systems--platform-engineer',
      company: 'Sable Systems',
      role: 'Platform Engineer',
      stage: 'resume',
      status: 'ghosted',
      statusOn: day(-5),
      appliedOn: day(-45),
      statusLog: changes('sable', [
        ['applied', -45],
        ['ghosted', -5],
      ]),
    }),
    job({
      id: 'orchard-health--backend-engineer',
      company: 'Orchard Health',
      role: 'Backend Engineer',
      stage: 'checked',
      fit: { verdict: 'Long shot', score: 44, date: day(-8) },
      status: 'passed',
      statusOn: day(-8),
      statusLog: changes('orchard', [['passed', -8]]),
    }),
  ];
}

/** The documents behind the samples' Open buttons. */
export function sampleDocs(job: Job): JobDocs {
  const posting = [
    `# ${job.role}`,
    '',
    `${job.company} is hiring a ${job.role.toLowerCase()} to help the team build what comes next.`,
    '',
    '## What you’ll do',
    '- Own services that other teams build on',
    '  - Keep them fast and reliable',
    '  - Make them easy to use',
    '- Mentor engineers across the team',
    '',
    '## What you bring',
    '- Eight or more years building production systems',
    '- Experience with **Go** or **TypeScript**',
  ].join('\n');
  return Object.fromEntries(
    job.docKinds.map((kind) => [
      kind,
      kind === 'posting' ? posting : `# ${job.company}\n\nA sample ${kind} document.`,
    ]),
  );
}
