import {
  type Call,
  type CallDoc,
  type CallDocKind,
  callDocFile,
  type FitReport,
  type Job,
  type JobDocs,
  type JobStatus,
  localDate,
  type Note,
  type ScorePart,
  type SearchDetail,
  type Sentiment,
} from '@factwright/core';

/** The sample job that's furthest along, with a screen done and a panel coming up. */
const NORTHWIND = 'northwind-labs--senior-software-engineer-platform';

/** A date some days from today, so the samples always look current. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** The HN thread most samples came from, and a LinkedIn search from a few days ago. */
const HN_RUN = { folder: '2026-10-hn-whos-hiring', source: 'HN October 2026', date: day(-24) };
const LINKEDIN_RUN = (() => {
  const date = day(-3);
  const label = MONTH_DAY.format(new Date(`${date}T12:00:00`));
  return { folder: `${date}-linkedin`, source: `LinkedIn ${label}`, date };
})();

/** A note the user jotted, some days ago. */
const note = (id: string, offset: number, text: string): Note => ({
  id,
  on: day(offset),
  text,
  at: `${day(offset)}T17:30:00.000Z`,
});

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
    ask: [
      {
        text: 'GraphQL (nice-to-have): your facts show REST APIs at Tidewater. Have you used GraphQL?',
        sub: [],
      },
    ],
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

/** Claude's prep sheet or thank-you notes for a sample job's call, written some days ago. */
function callDoc(jobId: string, callId: string, kind: CallDocKind, offset: number): CallDoc {
  return {
    callId,
    kind,
    path: callDocFile(jobId, callId, kind),
    modified: `${day(offset)}T16:00:00.000Z`,
  };
}

function call(id: string, extra: Partial<Call>): Call {
  return {
    id,
    kind: 'screen',
    onDate: day(1),
    atTime: null,
    minutes: null,
    mode: null,
    place: null,
    people: [],
    state: 'scheduled',
    outcome: null,
    notes: null,
    debrief: null,
    ...extra,
  };
}

function resume(company: string, modified: string, format: 'pdf' | 'docx' = 'pdf') {
  const name = `Resume - ${company}.${format}`;
  return {
    path: `applications/${company.toLowerCase().replace(/\W+/g, '-')}/${name}`,
    name,
    format,
    size: format === 'pdf' ? 52_400 : 11_900,
    modified: `${modified}T15:00:00.000Z`,
  };
}

/** A cover letter's files, as the cover-letter skill names them: a PDF, or a Word file too. */
/** A Projects page's files for one of the made-up jobs. */
function projectPages(company: string, modified: string) {
  const short = company.replace(/\W+/g, '');
  const name = `AlexRiveraProjects10172026_${short}.pdf`;
  return [
    {
      path: `applications/${company.toLowerCase().replace(/\W+/g, '-')}/${name}`,
      name,
      format: 'pdf' as const,
      size: 41_200,
      modified: `${modified}T16:30:00.000Z`,
    },
  ];
}

function letters(company: string, modified: string, formats: readonly ('pdf' | 'docx')[]) {
  const short = company.replace(/\W+/g, '');
  return formats.map((format) => {
    const name = `AlexRiveraCoverLetter_${short}.${format}`;
    return {
      path: `applications/${company.toLowerCase().replace(/\W+/g, '-')}/${name}`,
      name,
      format,
      size: format === 'pdf' ? 38_100 : 9_800,
      modified: `${modified}T16:00:00.000Z`,
    };
  });
}

/** A made-up job, with anything not given left empty. */
export function sampleJob(base: Partial<Job> & Pick<Job, 'id' | 'company' | 'role'>): Job {
  return {
    companyKey: base.id.split('--')[0] ?? base.id,
    link: `https://jobs.example/${base.id}`,
    links: [],
    location: 'Remote, US',
    pay: null,
    source: HN_RUN.source,
    fit: null,
    search: null,
    searches: [HN_RUN],
    kindFound: null,
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
    letters: [],
    projectPages: [],
    outreach: [],
    status: null,
    statusOn: null,
    backOn: null,
    passReason: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    kind: null,
    manual: false,
    calls: [],
    callDocs: [],
    statusLog: [],
    notes: [],
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
    sampleJob({
      id: NORTHWIND,
      company: 'Northwind Labs',
      role: 'Senior Software Engineer, Platform',
      location: 'Hybrid, Seattle',
      pay: listed(175, 205),
      stage: 'review',
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
          minutes: 30,
          mode: 'phone',
          people: [{ name: 'Priya Shah', role: 'Recruiter' }],
          state: 'done',
          outcome: 'advanced',
          notes: 'She calls my cell.',
          debrief:
            'Friendly. She asked why I’m leaving and my notice period (two weeks). Team of six, mostly Go. She liked the deploy pipeline story. Next: a panel with the hiring manager, a staff engineer and a PM.',
        }),
        call('northwind-panel', {
          kind: 'panel',
          onDate: day(4),
          atTime: '14:00',
          minutes: 60,
          mode: 'video',
          place: 'https://meet.example.com/northwind-panel',
          people: [
            { name: 'Dana Lee', role: 'Hiring manager' },
            { name: 'Sam Ortiz', role: 'Staff engineer' },
            { name: 'Ana Ruiz', role: 'Product manager' },
          ],
          notes: 'System design and team fit. Bring the cost-tooling numbers.',
        }),
      ],
      callDocs: [
        callDoc(NORTHWIND, 'northwind-screen', 'prep', -10),
        callDoc(NORTHWIND, 'northwind-screen', 'thanks', -9),
        callDoc(NORTHWIND, 'northwind-panel', 'prep', -1),
      ],
      notes: [
        note(
          'northwind-note-1',
          -9,
          'Screen with Priya, the recruiter. Team of six, mostly Go. She liked the deploy pipeline story.',
        ),
        note(
          'northwind-note-2',
          -3,
          'Panel set for Friday: the hiring manager, a staff engineer and a PM. Bring the cost-tooling numbers.',
        ),
      ],
      files: [resume('Northwind Labs', day(-17)), resume('Northwind Labs', day(-17), 'docx')],
      docKinds: ['posting', 'job', 'fit', 'prep', 'answers'],
      questions: [
        'Why do you want to work at Northwind?',
        'Tell us about a system you scaled. What broke first?',
        'Are you authorized to work in the US without sponsorship?',
      ],
      sent: [
        {
          question: 'Why do you want to work at Northwind?',
          text: 'Honestly, the platform team. I’ve run an internal platform for four years and I miss being close to the people using it. Your teams seem to actually talk to each other.',
          on: day(-16),
          at: `${day(-16)}T18:00:00.000Z`,
          nth: 0,
        },
      ],
      asks: [
        {
          id: `${day(-3)}-i-have-a-45-minute-panel`,
          question:
            'I have a 45 minute panel on Friday. What should I expect, and what should I ask them?',
          on: day(-3),
        },
      ],
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
    sampleJob({
      id: 'acme-robotics--staff-engineer-developer-tools',
      company: 'Acme Robotics',
      role: 'Staff Engineer, Developer Tools',
      pay: { text: '$185k–$215k', min: 185_000, max: 215_000, source: 'estimate' },
      stage: 'review',
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
    sampleJob({
      id: 'tidewater-analytics--senior-backend-engineer',
      company: 'Tidewater Analytics',
      role: 'Senior Backend Engineer',
      pay: listed(150, 180),
      stage: 'review',
      fit: { verdict: 'Strong', score: 81, date: day(-14) },
      status: 'screen',
      statusOn: day(-2),
      appliedOn: day(-11),
      statusLog: changes('tidewater', [
        ['applied', -11],
        ['screen', -2],
      ]),
      calls: [
        call('tidewater-screen', {
          onDate: day(2),
          atTime: '10:30',
          minutes: 30,
          mode: 'phone',
          people: [{ name: 'Jordan Wells', role: 'Recruiter' }],
        }),
      ],
      notes: [
        note('tidewater-note', -2, 'Recruiter reached out on email. Asked for my notice period.'),
      ],
      files: [resume('Tidewater Analytics', day(-12))],
      docKinds: ['posting', 'job'],
    }),
    sampleJob({
      id: 'lumen-health--senior-full-stack-engineer',
      company: 'Lumen Health',
      role: 'Senior Full-Stack Engineer',
      pay: listed(160, 190),
      stage: 'review',
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
      letters: letters('Lumen Health', day(-4), ['pdf', 'docx']),
      projectPages: projectPages('Lumen Health', day(-4)),
      docKinds: ['posting', 'answers', 'letter', 'projects'],
    }),
    sampleJob({
      id: 'brightpath-learning--software-engineer-iii',
      company: 'Brightpath Learning',
      role: 'Software Engineer III',
      location: 'Remote, Americas',
      pay: listed(140, 165),
      stage: 'review',
      fit: { verdict: 'Worth a look', score: 69, date: day(-3) },
      source: LINKEDIN_RUN.source,
      searches: [LINKEDIN_RUN],
      files: [resume('Brightpath Learning', day(-1))],
      apply: [
        '- **Alert:** Email your resume and a cover letter. There’s no form.',
        '- **Email:** jobs@brightpath.example',
        '',
        '1. Attach your resume and a cover letter, both as PDFs.',
      ].join('\n'),
      status: 'apply',
      statusOn: day(-1),
      statusLog: changes('brightpath', [['apply', -1]]),
      lastActivity: day(-1),
      docKinds: ['posting'],
    }),
    sampleJob({
      id: 'quarry-labs--senior-software-engineer',
      company: 'Quarry Labs',
      role: 'Senior Software Engineer',
      pay: listed(165, 195),
      stage: 'review',
      fit: { verdict: 'Strong', score: 83, date: day(-2) },
      status: 'apply',
      statusOn: day(-1),
      statusLog: changes('quarry', [['apply', -1]]),
      events: [
        { id: 'quarry-fit', tool: 'fit-check', date: day(-2), title: 'Fit check: Strong 83' },
      ],
      docKinds: ['posting', 'job', 'fit'],
      lastActivity: day(-1),
    }),
    sampleJob({
      id: 'wavelength-audio--senior-backend-engineer',
      company: 'Wavelength Audio',
      role: 'Senior Backend Engineer',
      pay: listed(150, 175),
      status: 'review',
      statusOn: day(-2),
      statusLog: changes('wavelength', [['review', -2]]),
      lastActivity: day(-2),
      docKinds: ['posting'],
    }),
    sampleJob({
      id: 'pinecrest-software--platform-lead',
      company: 'Pinecrest Software',
      role: 'Platform Lead',
      kindFound: 'project-manager',
      pay: listed(185, 215),
      stage: 'review',
      fit: { verdict: 'Good', score: 74, date: day(-15) },
      status: 'later',
      statusOn: day(-14),
      backOn: day(0),
      statusLog: changes('pinecrest', [['later', -14]]),
      events: [
        { id: 'pinecrest-fit', tool: 'fit-check', date: day(-15), title: 'Fit check: Good 74' },
      ],
      docKinds: ['posting', 'job', 'fit'],
      lastActivity: day(-14),
    }),
    sampleJob({
      id: 'ridgeline-analytics--senior-data-engineer',
      company: 'Ridgeline Analytics',
      role: 'Senior Data Engineer',
      pay: listed(160, 185),
      status: 'later',
      statusOn: day(-4),
      backOn: day(6),
      statusLog: changes('ridgeline', [['later', -4]]),
      lastActivity: day(-4),
      docKinds: ['posting'],
    }),
    sampleJob({
      id: 'saltmarsh-games--engineering-manager',
      company: 'Saltmarsh Games',
      role: 'Engineering Manager',
      kindFound: 'project-manager',
      status: 'later',
      statusOn: day(-9),
      statusLog: changes('saltmarsh', [['later', -9]]),
      lastActivity: day(-9),
    }),
    sampleJob({
      id: 'harbor-and-pine--senior-engineer-payments',
      company: 'Harbor & Pine',
      role: 'Senior Engineer, Payments',
      location: 'Hybrid, Denver',
      pay: listed(155, 185),
      stage: 'review',
      fit: { verdict: 'Worth a look', score: 64, date: day(-15) },
      status: 'applied',
      statusOn: day(-12),
      appliedOn: day(-12),
      statusLog: changes('harbor', [['applied', -12]]),
      files: [resume('Harbor & Pine', day(-13))],
      earlierNotes: 'Referred by a former teammate. Ask about the new payments team.',
    }),
    sampleJob({
      id: 'fernway--engineering-lead',
      company: 'Fernway',
      role: 'Engineering Lead, Integrations',
      kindFound: 'project-manager',
      pay: listed(190, 220),
      stage: 'review',
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
    sampleJob({
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
        again: false,
      },
      firstSeen: day(-2),
      lastActivity: day(-2),
      docKinds: ['posting'],
    }),
    sampleJob({
      id: 'granite-health--staff-software-engineer',
      company: 'Granite Health',
      role: 'Staff Software Engineer',
      pay: listed(180, 210),
      source: LINKEDIN_RUN.source,
      searches: [LINKEDIN_RUN],
      search: {
        source: LINKEDIN_RUN.source,
        date: LINKEDIN_RUN.date,
        tier: 'worth',
        score: 58,
        detail: { ...NO_DETAIL, pick: 'A patient-records platform moving to Go' },
        again: false,
      },
      firstSeen: day(-3),
      lastActivity: day(-3),
      docKinds: ['posting'],
    }),
    sampleJob({
      id: 'bluewave-staffing--senior-engineer',
      company: 'Bluewave Staffing',
      role: 'Senior Engineer (client: fintech)',
      source: LINKEDIN_RUN.source,
      searches: [LINKEDIN_RUN],
      firstSeen: day(-1),
      lastActivity: day(-1),
    }),
    sampleJob({
      id: 'meridian-freight--staff-engineer',
      company: 'Meridian Freight',
      role: 'Staff Engineer',
      stage: 'review',
      fit: { verdict: 'Good', score: 70, date: day(-40) },
      status: 'rejected',
      statusOn: day(-9),
      appliedOn: day(-30),
      statusLog: changes('meridian', [
        ['applied', -30],
        ['rejected', -9],
      ]),
    }),
    sampleJob({
      id: 'sable-systems--platform-engineer',
      company: 'Sable Systems',
      role: 'Platform Engineer',
      stage: 'review',
      status: 'ghosted',
      statusOn: day(-5),
      appliedOn: day(-45),
      statusLog: changes('sable', [
        ['applied', -45],
        ['ghosted', -5],
      ]),
    }),
    // Passed on, then found again by a later search: it stays passed.
    sampleJob({
      id: 'orchard-health--backend-engineer',
      company: 'Orchard Health',
      role: 'Backend Engineer',
      stage: 'review',
      fit: { verdict: 'Long shot', score: 44, date: day(-8) },
      searches: [HN_RUN, LINKEDIN_RUN],
      search: {
        source: LINKEDIN_RUN.source,
        date: LINKEDIN_RUN.date,
        tier: 'long',
        score: null,
        detail: NO_DETAIL,
        again: true,
      },
      events: [
        {
          id: 'orchard-hn',
          tool: 'search',
          date: HN_RUN.date,
          title: `Found in ${HN_RUN.source}: Long shot`,
        },
        {
          id: 'orchard-linkedin',
          tool: 'search',
          date: LINKEDIN_RUN.date,
          title: `Found again in ${LINKEDIN_RUN.source}: Long shot`,
        },
      ],
      status: 'passed',
      statusOn: day(-8),
      passReason: 'work',
      statusLog: changes('orchard', [['passed', -8]]),
    }),
    sampleJob({
      id: 'kestrel-robotics--staff-engineer-autonomy',
      company: 'Kestrel Robotics',
      role: 'Staff Engineer, Autonomy',
      stage: 'review',
      fit: { verdict: 'Good', score: 75, date: day(-26) },
      status: 'role-closed',
      statusOn: day(-6),
      appliedOn: day(-21),
      statusLog: changes('kestrel', [
        ['applied', -21],
        ['role-closed', -6],
      ]),
      notes: [
        note('kestrel-note', -6, 'The recruiter wrote that the role is on hold until next year.'),
      ],
    }),
  ];
}

/**
 * The same job as the Quarry Labs sample's, which a search found under a shorter name and another
 * title, for Merge with…: ?jobs=twice.
 */
export function sampleDuplicate(): Job {
  return sampleJob({
    id: 'quarry--senior-platform-engineer',
    company: 'Quarry',
    role: 'Senior Platform Engineer',
    pay: listed(165, 195),
    source: LINKEDIN_RUN.source,
    searches: [LINKEDIN_RUN],
    search: {
      source: LINKEDIN_RUN.source,
      date: LINKEDIN_RUN.date,
      tier: 'strong',
      score: 80,
      detail: { ...NO_DETAIL, pick: 'Platform work on a small team' },
      again: false,
    },
    firstSeen: LINKEDIN_RUN.date,
    lastActivity: LINKEDIN_RUN.date,
    docKinds: ['posting'],
  });
}

/** The documents behind the samples' Open buttons. */
/** Claude's answers to the sample jobs' application questions. */
const SAMPLE_ANSWERS = [
  '# Application questions: Northwind Labs, Senior Software Engineer, Platform',
  '',
  'Drafted on the day you applied. Q1 traces to facts/work.md#internal-platform.',
  '',
  '## Why do you want to work at Northwind?',
  '',
  'I’ve run an internal platform for four years, and the best part is working with the teams that use it. Northwind’s platform group sounds like that, and the posting says you want someone who talks to product teams before building for them.',
  '',
  '## Tell us about a system you scaled. What broke first?',
  '',
  'Our deploy pipeline. It went from a dozen services to about two hundred, and the queue broke before anything else did. I split it by team and added a fast lane for small changes.',
  '',
  '## Checkbox questions',
  '| Question | Pick | Why |',
  '|---|---|---|',
  '| Are you authorized to work in the US without sponsorship? | Yes | From your profile |',
].join('\n');

/** A cover letter for a job, as the cover-letter skill writes its cover-letter.json. */
function sampleLetter(job: Job): string {
  return JSON.stringify({
    output_name: `AlexRiveraCoverLetter_${job.company.replace(/\W+/g, '')}`,
    name: 'Alex Rivera',
    headline: 'Staff Platform Engineer',
    contact: { email: 'alex@example.com', location: 'Remote, US' },
    date: MONTH_DAY.format(new Date()),
    recipient: ['Dana Brooks', 'Engineering Manager, Care Team', job.company],
    greeting: 'Dear Dana Brooks,',
    paragraphs: [
      `${job.company}’s posting says the care team ships to clinics every week and wants that to feel boring. I spent the last four years making releases boring at Tidewater Analytics, where I cut deploy time by **~40%** across twelve services.`,
      'Two things from that work fit what you’re building. I moved every team onto one deploy pipeline with automatic rollback, so a bad release undoes itself before anyone gets paged. And I ran the on-call rotation that kept it honest, writing the runbooks new engineers learned from.',
      'Your posting also asks for someone who mentors. I paired with four engineers through their first on-call rotations, and two of them now lead their own services.',
      'I’d love half an hour to walk through the pipeline and hear where releases hurt most at your clinics. I’m free most afternoons in the next two weeks.',
    ],
    closing: 'Best regards,',
  });
}

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
    '- Kubernetes in production, and CI/CD you’ve built yourself',
    '- Observability with Datadog or Prometheus',
    '',
    '## Nice to have',
    '- Rust',
    '- Terraform',
    '- Developer experience work',
  ].join('\n');
  return Object.fromEntries(
    job.docKinds.map((kind) => [
      kind,
      kind === 'posting'
        ? posting
        : kind === 'answers' && job.company === 'Northwind Labs'
          ? SAMPLE_ANSWERS
          : kind === 'letter'
            ? sampleLetter(job)
            : kind === 'projects'
              ? sampleProjectsPage(job)
              : `# ${job.company}\n\nA sample ${kind} document.`,
    ]),
  );
}

/** A job's Projects page's data, as the projects-page skill writes it. */
function sampleProjectsPage(job: Job): string {
  return JSON.stringify({
    output_name: `AlexRiveraProjects10172026_${job.company.replace(/\W+/g, '')}`,
    name: 'Alex Rivera',
    headline: 'Staff Platform Engineer',
    heading: 'Selected Projects',
    shape: 'cards',
    projects: [
      { name: 'Trailhead', what: 'A free app that maps trail conditions from hikers’ reports.' },
      { name: 'Code Club at Lincoln Library', what: 'Free Saturday coding classes.' },
      { name: 'pg-queue', what: 'A small job queue that runs on Postgres.' },
    ],
  });
}

/** The panel's prep sheet, as the interview prep skill writes one for a call. */
const PANEL_PREP = [
  '# Prep: Northwind Labs, Senior Software Engineer, Platform',
  '',
  '- **Conversation:** Panel interview, 1 hour on video, with Dana Lee (Hiring manager), Sam Ortiz (Staff engineer) and Ana Ruiz (Product manager)',
  '',
  '## Five minutes before',
  '- **Land:** the deploy pipeline you rebuilt (deploys from 40 minutes to 6), the cost tooling that saved $310k a year, and how you bring product along.',
  '- **Pitch:** platform engineer who makes other teams faster, with numbers to show it.',
  '- **Gap:** no production Rust. Say so, then point to the Go services you own.',
  '- **Ask Dana:** what would make the first six months a success? **Ask Sam:** where does the platform hurt most today?',
  '- **Logistics:** join from the link on the call; have the resume you sent open.',
  '',
  '## What this round is for',
  'A panel checks the same story from three seats: can you do the work (Sam), will the team be better with you (Dana), and can you work with product (Ana). Expect 15 to 20 minutes each.',
  '',
  '## Who you’re meeting',
  '- **Dana Lee, hiring manager:** runs the platform team of six. Cares about delivery and how you grow others.',
  '- **Sam Ortiz, staff engineer:** wrote the team’s posts on their move to Kubernetes. Expect system design.',
  '- **Ana Ruiz, product manager:** owns the developer portal. Expect questions about trade-offs and saying no.',
  '',
  '## So far',
  '- Priya liked the deploy pipeline story on the screen. Tell it again here, with the numbers, but lead with the cost tooling for Dana.',
  '- You said two weeks’ notice. Keep it the same.',
  '',
  '## Likely questions',
  '1. **Walk us through a platform you designed.** The deploy pipeline: the problem, the design, 40 → 6 minutes. (facts/acme.md#deploys)',
  '2. **How do you decide what the platform builds next?** Usage data plus the cost review; the $310k story. (facts/acme.md#cost-tooling)',
  '3. **Tell me about a disagreement with product.** The rollout you slowed down for safety, and how you found a middle path.',
  '',
  '## Questions to ask them',
  '- Dana: what would make the first six months a success?',
  '- Sam: what’s the one part of the platform you’d rebuild first?',
  '- Ana: how do platform requests get weighed against product work?',
].join('\n');

/** Thank-you notes after the screen, as the thank-you skill writes them. */
const SCREEN_THANKS = [
  '## Priya Shah',
  '',
  '**Subject:** Thank you: today’s call about the platform role',
  '',
  'Hi Priya,',
  '',
  'Thank you for the call today. It was good to hear how the team of six works, and that Go is most of what they write: it’s what I’ve built in for the last four years. I’m keen on the role, and I’m free for the panel any afternoon next week.',
  '',
  'Best,',
  'Alex',
].join('\n');

/** What Claude wrote for each of a sample job's calls, by the call's ID. */
export function sampleCallDocs(job: Job): Record<string, Partial<Record<CallDocKind, string>>> {
  const docs: Record<string, Partial<Record<CallDocKind, string>>> = {};
  for (const doc of job.callDocs) {
    const call = job.calls.find((each) => each.id === doc.callId);
    const text =
      doc.callId === 'northwind-panel'
        ? PANEL_PREP
        : doc.kind === 'thanks'
          ? SCREEN_THANKS
          : `# Prep: ${job.company}, ${job.role}\n\nA sample prep sheet for the ${call?.kind ?? 'call'}.`;
    docs[doc.callId] = { ...docs[doc.callId], [doc.kind]: text };
  }
  return docs;
}
