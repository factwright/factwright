import { localDate } from '@factwright/core';
import {
  type RunProgress,
  type RunStep,
  type TodoItem,
  type TurnEnd,
  todoAt,
} from '../shared/activity.ts';
import type {
  ClaudeStatus,
  FactwrightApi,
  RunOutput,
  RunSignal,
  RunsView,
  RunView,
  SetupCheck,
  WaitingAsk,
  WaitingRound,
} from '../shared/api.ts';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
import type { PermissionAsk } from '../shared/permission-asks.ts';
import {
  isAnswered,
  type QuestionRound,
  type RoundQuestion,
  type RoundReply,
  SKIPPED_ANSWER,
} from '../shared/rounds.ts';
import {
  AT_ONCE,
  lanesOf,
  type RunTask,
  TEMPLATE_SKILL,
  THANKS_SKILL,
  taskJob,
} from '../shared/runs.ts';
import { sampleProfile } from './about/sample-profile.ts';
import { sampleSaveHelper } from './extension/sample-helper.ts';
import { sampleFacts } from './facts/sample-facts.ts';
import { sampleTracker } from './jobs/sample-tracker.ts';
import { sampleProfiles } from './profiles/sample-profiles.ts';
import { sampleChanges } from './sample-changes.ts';
import { sampleSync } from './sync/sample-sync.ts';

const READY: ClaudeStatus = {
  state: 'ready',
  version: '2.1.296',
  plan: 'max',
  method: 'subscription',
};

/** Ready on another plan, for ?plan=: a Pro plan, or an API key, which bills every token. */
const PLANS: Readonly<Record<string, ClaudeStatus>> = {
  pro: { ...READY, plan: 'pro' },
  team: { ...READY, plan: 'team' },
  api: { state: 'ready', version: READY.version, method: 'api_key' },
};

/**
 * Setup checks for ?setup=: the one a new version of Claude Code could fail, one that stopped on
 * Claude Code's first-run screens, or a pass.
 */
const SETUP_CHECKS: Readonly<Record<string, SetupCheck>> = {
  'first-run': { version: READY.version, result: 'first-run', at: '2026-10-11T18:00:00.000Z' },
  failed: {
    version: READY.version,
    result: 'failed',
    problem:
      'Claude Code closed before it reached Factwright’s tools. It last showed: “error: unknown option ‘--restricted’”.',
    at: '2026-10-11T18:00:00.000Z',
  },
  passed: { version: READY.version, result: 'passed', at: '2026-10-11T18:00:00.000Z' },
};

const SAMPLES: Readonly<Record<string, ClaudeStatus>> = {
  ready: READY,
  'signed-out': { state: 'signed-out', version: '2.1.296' },
  'too-old': { state: 'too-old', version: '2.0.12', minimum: '2.1.270' },
  missing: { state: 'missing' },
  unknown: { state: 'unknown' },
};

/**
 * A made-up run, in the colors Claude Code's ANSI themes use: main text, secondary text, and a
 * bar behind the user's message (seen in a real run of the dark theme; light mirrors it).
 */
function sampleRun(dark: boolean) {
  const [main, secondary, bar] = dark ? ['97', '37', '100'] : ['30', '90', '47'];
  const color = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`;
  return {
    /** Claude Code's first-run screens, each until Enter, for ?first-run=show. */
    firstRun: [
      [
        '\x1b[H\x1b[2J',
        ` ${color(main, 'Let’s get started.')}\r\n\r\n`,
        ` ${color(`1;${main}`, 'Choose the text style that looks best with your terminal')}\r\n`,
        ` ${color(secondary, 'To change this later, run /theme')}\r\n\r\n`,
        ` ${color('34', '❯ 1. Dark mode ✔')}\r\n`,
        `   ${color(main, '2. Light mode')}\r\n`,
      ],
      [
        '\x1b[H\x1b[2J',
        ` ${color(`1;${main}`, 'Security notes:')}\r\n\r\n`,
        ` ${color(secondary, '1.')} ${color(main, 'Claude can make mistakes.')}\r\n`,
        ` ${color(secondary, '2.')} ${color(main, 'Due to prompt injection risks, only use it with code you trust')}\r\n\r\n`,
        ` ${color(secondary, 'Press Enter to continue…')}\r\n`,
      ],
    ],
    /** Claude Code's question, the first time it opens a folder, for ?trust=ask. */
    trust: [
      ` ${color(`1;${main}`, 'Do you trust the files in this folder?')}\r\n\r\n`,
      ` ${color(secondary, 'Claude Code will be able to read, edit, and run files here.')}\r\n\r\n`,
      ` ${color('34', '❯ 1. Yes, I trust this folder')}\r\n`,
      `   ${color(main, '2. No, exit')}\r\n\r\n`,
    ],
    opening: [
      `${color(`1;${main}`, '✻ Claude Code')}  ${color(secondary, '~/Factwright/workspace')}\r\n\r\n`,
      `\x1b[${bar};${secondary}m❯ \x1b[${main}mHelp me get ready for a recruiter call on Monday.\x1b[K\x1b[0m\r\n\r\n`,
    ],
    /** What Claude says before its first question. */
    intro: [
      `${color('32', '⏺')} ${color(main, 'Happy to. One question first, so the prep fits.')}\r\n\r\n`,
    ],
    /** The question as the terminal asks it, once the user sends it there. */
    question: [
      ` ${color(`1;${main}`, 'Which role is the call about?')}\r\n\r\n`,
      ` ${color('34', '❯ 1. Senior Backend Engineer at Tidewater Analytics')}\r\n`,
      `   ${color(main, '2. Staff Engineer at Acme Robotics')}\r\n`,
      `   ${color(main, '3. Type something else')}\r\n`,
    ],
    /** The answers, as Claude Code notes them, and what Claude does next. */
    answered: (answers: [string, string][], next: string) => [
      `\r\n${color(secondary, '⏺ User answered Claude’s questions:')}\r\n`,
      ...answers.map(
        ([question, answer], at) =>
          `${color(secondary, `  ${at === 0 ? '⎿' : ' '}  · ${question} → ${answer}`)}\r\n`,
      ),
      `\r\n${color('34', '✻')} ${color(secondary, next)}\r\n`,
    ],
    /** Claude Code's own permission prompt, in the terminal, behind the app's dialog. */
    permission: (ask: PermissionAsk) => [
      `${color('32', '⏺')} ${color(`1;${main}`, permissionCall(ask))}\r\n\r\n`,
      ` ${color(main, 'Do you want to proceed?')}\r\n`,
      ` ${color('34', '❯ 1. Yes')}\r\n`,
      `   ${color(main, '2. No')}\r\n`,
    ],
    allowed: [`\r\n${color('34', '✻')} ${color(secondary, 'Carrying on with the prep…')}\r\n`],
    denied: (note: string) => [
      `\r\n${color('32', '⏺')} ${color(main, note.trim() ? `Understood: “${note.trim()}”. I’ll carry on without it.` : 'Understood. I’ll carry on without it.')}\r\n`,
    ],
    /** Interview prep stopping to ask about a gap the call will likely probe, with ?run=asks. */
    roundIntro: [
      `\r\n${color('32', '⏺')} ${color(main, 'Read the posting, your fit check, the resume you sent, and how the recruiter screen went.')}\r\n\r\n`,
    ],
    round: [
      ` ${color(`1;${main}`, PREP_QUESTION)}\r\n\r\n`,
      ` ${color('34', `❯ 1. ${PREP_ANSWER}`)}\r\n`,
      `   ${color(main, '2. Yes, I’ll tell you about it')}\r\n`,
      `   ${color(main, '3. Type something else')}\r\n`,
    ],
    finished: [
      `\r\n${color(main, '⏺ Your prep sheet is ready: likely questions, your best stories, and')}`,
      `${color(main, ' three questions to ask them.')}\r\n\r\n${color(secondary, '❯')} `,
    ],
    /** A Run button's command, typed into the run, and a short made-up result. */
    task: (task: RunTask) =>
      'findings' in task
        ? [
            `${color(main, `/factwright:${task.skill} job ${task.jobId} findings ${task.findings.join(' ')}${task.template ? ` template ${task.template}` : ''}`)}\r\n\r\n`,
            `${color('34', '✻')} ${color(secondary, 'Reading what you picked in the ATS X-ray…')}\r\n`,
          ]
        : 'jobId' in task
          ? [
              `${color(main, `/factwright:${task.skill} job ${task.jobId}${taskTail(task)}`)}\r\n\r\n`,
              `${color('34', '✻')} ${color(secondary, 'Reading everything on file for the job…')}\r\n`,
            ]
          : [
              `${color(main, `/factwright:${task.skill}`)}\r\n\r\n`,
              `${color('34', '✻')} ${color(secondary, 'Reading the newest “Who is hiring?” thread…')}\r\n`,
            ],
    taskDone: (task: RunTask) => [
      `\r\n${color(main, `⏺ Done. ${'jobId' in task ? 'The job’s panel shows what changed.' : 'The jobs that fit are under New.'}`)}\r\n\r\n${color(secondary, '❯')} `,
    ],
  };
}

/** Claude Code's line for a call that needs the user's OK, as its terminal prompt names it. */
function permissionCall(ask: PermissionAsk): string {
  switch (ask.kind) {
    case 'edit':
      return `Update(${ask.file})`;
    case 'write':
      return `Write(${ask.file})`;
    case 'read':
      return `Read(${ask.file})`;
    case 'profile':
      return 'factwright - save_about_you (MCP)';
    case 'template':
      return `factwright - save_template (MCP)(id: "${ask.template}")`;
  }
}

/** A permission prompt for the made-up run, with ?permit= and its kind, in place of its question. */
const SAMPLE_PERMITS: Readonly<Record<string, PermissionAsk>> = {
  edit: {
    id: 'perm_sample',
    kind: 'edit',
    file: 'facts/tidewater-analytics.md',
    outside: false,
    before: '> Cut deploy time by ~40%.',
    after: '> Cut deploy time by ~40% by moving 12 services onto one deploy pipeline.',
    everywhere: false,
  },
  write: {
    id: 'perm_sample',
    kind: 'write',
    file: 'guide/voice.md',
    outside: false,
    replaces: false,
    content:
      '# How you sound\n\n- Plain words, short sentences.\n- Numbers over adjectives: "~40% faster", not "much faster".\n- No "passionate" or "rockstar".',
  },
  read: {
    id: 'perm_sample',
    kind: 'read',
    file: '/Users/alex/Documents/Resume 2024.pdf',
    outside: true,
  },
  profile: {
    id: 'perm_sample',
    kind: 'profile',
    changes: [
      { label: 'When you can start', value: 'Two weeks’ notice' },
      { label: 'Base pay you’re aiming for', value: '$185,000' },
    ],
  },
  template: {
    id: 'perm_sample',
    kind: 'template',
    template: 'navy-sidebar-clean',
    name: 'Navy Sidebar (clean)',
    look: 'Navy headings in one column, with no letter-spacing, icons or sidebar, so applicant systems read it in order.',
    replace: false,
    replacing: null,
    code: JSON.stringify(
      {
        factwright: 'template',
        version: 1,
        name: 'Navy Sidebar (clean)',
        look: 'Navy headings in one column.',
        css: 'h2 { color: #1f3a5f; letter-spacing: 0; }',
      },
      null,
      2,
    ),
  },
};

/** What Claude does once a round is answered. */
const NEXT = {
  opening: 'Reading the posting and your facts…',
  round: 'Looking up who you’re meeting and writing your prep sheet…',
} as const;

/** What interview prep asks with ?run=asks, and the answer the screenshots pick. */
const PREP_QUESTION = 'They’ll likely probe multi-region failover. Have you run it?';
const PREP_ANSWER = 'No, so help me handle the gap';

/** The rest of a run's command after the job, as the app types it: the call, or the question. */
function taskTail(task: RunTask): string {
  if ('quick' in task) return `${'again' in task && task.again ? ' new version' : ''} quick`;
  if ('askId' in task) return ` question ${task.askId}`;
  if (!('callId' in task)) return '';
  return ` call ${task.callId}${'practice' in task && task.practice ? ' practice' : ''}`;
}

/** A question to pick an answer for, with nothing about words or numbers. */
const choice = (
  question: Pick<RoundQuestion, 'question' | 'header' | 'multiSelect' | 'options'>,
): RoundQuestion => ({
  kind: 'choice',
  description: null,
  placeholder: null,
  number: null,
  ...question,
});

/**
 * The made-up run's first round: which role, and with ?ask=more, what to cover and how long. With
 * ?ask=kinds, it asks for a number and for a line of words instead.
 */
function openingRound(ask: string | null): QuestionRound {
  const option = (label: string, description: string) => ({ label, description, preview: null });
  if (ask === 'kinds') {
    return {
      id: 'toolu_sample_opening',
      questions: [
        {
          question: 'How many years have you run Kubernetes in production?',
          header: 'Kubernetes',
          kind: 'number',
          description: 'The posting asks for 3 or more. Your facts show EKS at Tidewater.',
          placeholder: null,
          multiSelect: false,
          options: [],
          number: { min: 0, max: 40, step: 0.5, unit: 'years', start: null },
        },
        {
          question: 'Anything the recruiter already knows, or that you’d rather not bring up?',
          header: 'Context',
          kind: 'text',
          description: null,
          placeholder: 'Such as a notice period, or a gap in your history',
          multiSelect: false,
          options: [],
          number: null,
        },
      ],
    };
  }
  const role = choice({
    question: 'Which role is the call about?',
    header: 'Role',
    multiSelect: false,
    options: [
      option(
        'Senior Backend Engineer at Tidewater Analytics',
        'The recruiter screen on Monday, from your notes.',
      ),
      option('Staff Engineer at Acme Robotics', 'Applied last week. No call logged yet.'),
    ],
  });
  if (ask !== 'more') return { id: 'toolu_sample_opening', questions: [role] };
  return {
    id: 'toolu_sample_opening',
    questions: [
      role,
      choice({
        question: 'What should the prep sheet cover?',
        header: 'Focus',
        multiSelect: true,
        options: [
          option('Likely questions', 'With answers from your fact bank.'),
          option('Your best stories', 'Two or three, with the numbers that back them.'),
          option('Questions to ask them', 'About the team, the work and what comes next.'),
          option('Pay and logistics', 'Your range, notice period and start date.'),
        ],
      }),
      choice({
        question: 'How long is the call?',
        header: 'Length',
        multiSelect: false,
        options: [
          option('15 minutes', 'A quick check on fit and pay.'),
          option('30 minutes', 'The usual recruiter screen.'),
          option('45 minutes or more', 'Room for a technical question or two.'),
        ],
      }),
    ],
  };
}

/**
 * Interview prep's round, with ?run=asks: a gap the call will likely probe, which the facts
 * don't show, as the skill asks before it writes the prep sheet.
 */
const PREP_ROUND: QuestionRound = {
  id: 'toolu_sample_round',
  questions: [
    choice({
      question: PREP_QUESTION,
      header: 'Failover',
      multiSelect: false,
      options: [
        {
          label: PREP_ANSWER,
          description: 'Noted as a gap, with a way to frame it on the call.',
          preview: null,
        },
        {
          label: 'Yes, I’ll tell you about it',
          description: 'Saved as a fact for you to verify, and used in the prep.',
          preview: null,
        },
      ],
    }),
  ],
};

/** What tailoring a resume asks, with ?runs=asking: what the posting wants that the facts don't show. */
const RESUME_ROUND: QuestionRound = {
  id: 'toolu_sample_resume',
  questions: [
    choice({
      question: 'The posting wants GraphQL. Have you used GraphQL?',
      header: 'GraphQL',
      multiSelect: false,
      options: [
        {
          label: 'Yes, in production',
          description: 'Saved as a fact for you to verify.',
          preview: null,
        },
        { label: 'Some: a side project or a course', description: null, preview: null },
        { label: 'No', description: 'Noted as a gap, so it isn’t asked again.', preview: null },
      ],
    }),
  ],
};

/** What a cover letter asks, with ?runs=asking: which story leads it. */
const LETTER_ROUND: QuestionRound = {
  id: 'toolu_sample_letter',
  questions: [
    choice({
      question: 'Which story should the letter lead with?',
      header: 'Story',
      multiSelect: false,
      options: [
        {
          label: 'The deploy pipeline at Tidewater',
          description: 'Cut deploy time by about 40%, which the posting’s first line is about.',
          preview: null,
        },
        {
          label: 'The on-call runbooks',
          description: 'The posting asks for someone who makes on-call calmer.',
          preview: null,
        },
      ],
    }),
  ],
};

/** Each question answered, with what the user picked and wrote, as Claude Code notes them. */
const noted = (round: QuestionRound, reply: RoundReply): [string, string][] =>
  round.questions.flatMap(({ question }, at): [string, string][] => {
    const answer = reply[at];
    if (answer?.skipped) return [[question, SKIPPED_ANSWER]];
    if (!answer || !isAnswered(answer)) return [];
    return [[question, [...answer.picks, answer.other.trim()].filter(Boolean).join(', ')]];
  });

/**
 * Sample answers for checking the screens in a browser. The query string picks Claude's status,
 * such as ?claude=signed-out&platform=win32, and ?claude=checking never answers. With
 * ?path=off, a new terminal doesn't find Claude Code by name, as after its installer on Windows,
 * so the steps start it by its whole path, as they do while it's missing. ?plan picks the
 * plan Claude is ready on: pro, team, or api for an API key. ?jobs picks the jobs: none, failed
 * or loading. ?profile picks how far the user's profile has come: new, started or done.
 * ?profiles picks how many profiles there are: two, three with an added one open (added), or two
 * after one stopped short of opening (stopped). Starting Claude plays a short made-up run, so
 * every state of the panel can be seen, and status changes stick until the page reloads. Claude's
 * questions open in their dialog. With ?run=asks, interview prep stops to ask a question, as the
 * README's screenshots show it, and ?ask=more makes the first run's round three questions, or
 * ?ask=kinds a number and a line of words.
 * ?permit=edit, write, read, profile or template has the first run ask Claude Code's OK
 * for that instead, in its dialog. ?helper picks where the browsers stand in the Browser
 * extension window (see extension/sample-helper.ts).
 */
/** How long each made-up step of a run takes, in milliseconds. */
const STEP_MS = 900;

/** What the made-up run does for a task, a tool call at a time, as Claude Code's hooks tell it. */
function sampleSteps(task: RunTask): Omit<RunStep, 'id' | 'state'>[] {
  const folder = `applications/${taskJob(task) ?? 'the-job'}`;
  const reading = [
    { tool: 'mcp__factwright__job_details', detail: null },
    { tool: 'Read', detail: 'facts/platform-engineering.md' },
  ];
  switch (task.skill) {
    case 'focused-resume':
      return [
        ...reading,
        { tool: 'Read', detail: 'guide/writing.md' },
        { tool: 'Write', detail: `${folder}/resume.json` },
        { tool: 'mcp__factwright__build_resume', detail: null },
      ];
    case 'cover-letter':
      return [
        ...reading,
        { tool: 'Write', detail: `${folder}/cover-letter.json` },
        { tool: 'mcp__factwright__build_cover_letter', detail: null },
      ];
    case 'fit-check':
      return [
        { tool: 'mcp__factwright__read_posting', detail: 'jobs.example' },
        ...reading,
        { tool: 'WebSearch', detail: 'Copperleaf Energy engineering team reviews' },
        { tool: 'Write', detail: `${folder}/fit-check.md` },
      ];
    // A call's prep sheet, or the thank-you notes after it. A mock interview saves nothing.
    case 'interview-prep':
      return 'callId' in task && !('practice' in task)
        ? [...reading, { tool: 'mcp__factwright__save_call_prep', detail: null }]
        : reading;
    case THANKS_SKILL:
      return [...reading, { tool: 'mcp__factwright__save_thank_you', detail: null }];
    default:
      return reading;
  }
}

export function sampleApi(): FactwrightApi {
  const query = new URLSearchParams(location.search);
  const claude = query.get('claude') ?? 'ready';
  const ready = PLANS[query.get('plan') ?? ''] ?? READY;
  // ?jobs picks the jobs, and a made-up run leaves its work on them.
  const tracker = sampleTracker(query.get('jobs'), query.get('resume'), query.has('revised'));
  // What answering plays: the opening run's question, interview prep's, with ?run=asks, or a
  // permission prompt, with ?permit=.
  const asks = query.get('run') === 'asks';
  // ?first-run=show starts with Claude Code's first-run screens, once, each until Enter.
  let firstRunLeft = query.get('first-run') === 'show' ? 2 : 0;
  // ?trust=ask starts with Claude Code's question about trusting the folder, once.
  let trusted = query.get('trust') !== 'ask';
  const roundAsked = query.get('ask');
  // ?filed has the made-up run file facts from the user's answers as it finishes, once.
  const facts = sampleFacts(query.get('profile'));
  let fileOnce = query.has('filed');
  // What each made-up task changed, for its card once it's done. ?changes picks none, or since.
  const changes = sampleChanges(query.get('changes'));
  let reminding = query.get('reminders') !== 'off';
  let models: ModelChoices = DEFAULT_MODELS;
  let effort: EffortChoices = DEFAULT_EFFORT;
  // ?end=question has a run stop to ask in its own words, and ?end=rate_limit end in that error.
  const ending = query.get('end');
  const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  // The made-up runs, side by side, a tab each, and the tasks waiting in line, as many at once
  // as the app runs them.
  const tabs: RunView[] = [];
  let atOnce: number = AT_ONCE.usual;
  let count = 0;
  const runsListeners = new Set<(view: RunsView) => void>();
  const runsView = (): RunsView => ({
    runs: tabs.map((tab) => ({ ...tab })),
    atOnce,
    setUp: trusted && firstRunLeft === 0,
  });
  const tellRuns = () => {
    const view = runsView();
    for (const listener of runsListeners) listener(view);
  };
  const outputListeners = new Set<(output: RunOutput) => void>();
  const stepListeners = new Set<(step: { runId: string; step: RunStep }) => void>();
  const progressListeners = new Set<(progress: { runId: string; progress: RunProgress }) => void>();
  const endListeners = new Set<(end: { runId: string; end: TurnEnd }) => void>();
  const filedListeners = new Set<(filed: { runId: string; filed: FiledFacts }) => void>();
  // What the runs wait on the user for in the window's dialog, in the order it came in.
  let rounds: (WaitingRound & { after: 'opening' | 'round' })[] = [];
  let permits: WaitingAsk[] = [];
  let since = 0;
  const questionListeners = new Set<(rounds: WaitingRound[]) => void>();
  const permissionListeners = new Set<(asks: WaitingAsk[]) => void>();
  const tellQuestions = () => {
    for (const listener of questionListeners) listener([...rounds]);
  };
  const tellPermissions = () => {
    for (const listener of permissionListeners) listener([...permits]);
  };

  /** One made-up run: what it prints, and what the user answers in its terminal plays. */
  interface Sample {
    id: string;
    task: RunTask | null;
    lines: ReturnType<typeof sampleRun>;
    /** What Enter in its terminal answers: a round sent there, or Claude Code's own prompt. */
    terminal: 'opening' | 'round' | 'permission' | null;
    /** Its task's record of what it changed. */
    record: string;
    /** Claude Code's screens it waits at, and what comes once they're answered. */
    screen: 'first-run' | 'trust' | null;
    afterScreens: () => void;
    stopped: boolean;
  }
  const samples = new Map<string, Sample>();
  const tabOf = (id: string) => tabs.find((each) => each.id === id);
  const set = (id: string, changed: Partial<RunView>) => {
    const tab = tabOf(id);
    if (!tab) return;
    Object.assign(tab, changed);
    tellRuns();
  };
  const print = (sample: Sample, lines: string[]) => {
    for (const data of lines)
      for (const listener of outputListeners) listener({ runId: sample.id, data });
  };
  const step = (sample: Sample, value: RunStep) => {
    for (const listener of stepListeners) listener({ runId: sample.id, step: value });
  };
  const progress = (sample: Sample, value: RunProgress) => {
    for (const listener of progressListeners) listener({ runId: sample.id, progress: value });
  };
  const ended = (sample: Sample, end: TurnEnd) => {
    for (const listener of endListeners) listener({ runId: sample.id, end });
  };
  const signal = (sample: Sample, phase: RunSignal) => {
    if (sample.stopped || !tabOf(sample.id)) return;
    set(sample.id, { phase, screen: null });
    pump();
  };
  const askRound = (sample: Sample, round: QuestionRound, after: 'opening' | 'round') => {
    since += 1;
    rounds = [
      ...rounds,
      { ...round, id: `${sample.id}/${round.id}`, runId: sample.id, since, after },
    ];
    signal(sample, 'needs-answer');
    tellQuestions();
  };
  const askPermission = (sample: Sample, ask: PermissionAsk) => {
    since += 1;
    permits = [...permits, { ...ask, id: `${sample.id}/${ask.id}`, runId: sample.id, since }];
    print(sample, sample.lines.permission(ask));
    signal(sample, 'needs-answer');
    tellPermissions();
  };
  const done = (sample: Sample) => {
    signal(sample, 'done');
    if (!fileOnce) return;
    fileOnce = false;
    const filed = facts.fileAnswers();
    for (const listener of filedListeners) listener({ runId: sample.id, filed });
  };
  const carryOn = (sample: Sample) => {
    signal(sample, 'working');
    setTimeout(() => {
      print(sample, sample.lines.finished);
      done(sample);
    }, 1600);
  };
  const finish = (sample: Sample) => {
    if (sample.task) tracker.madeBy(sample.task);
    ended(sample, { said: 'Done. The job’s panel shows what changed.', error: null });
    changes.done(sample.record, sample.task);
    done(sample);
  };
  const playTask = (sample: Sample, task: RunTask) => {
    signal(sample, 'working');
    print(sample, sample.lines.task(task));
    if (asks && task.skill === 'interview-prep') {
      setTimeout(() => {
        print(sample, sample.lines.roundIntro);
        askRound(sample, PREP_ROUND, 'round');
      }, 1200);
      return;
    }
    const steps = sampleSteps(task).map((each, i) => ({
      ...each,
      id: `sample-${Date.now()}-${i}`,
    }));
    steps.forEach((each, i) => {
      setTimeout(() => step(sample, { ...each, state: 'running' }), 300 + i * STEP_MS);
      setTimeout(() => step(sample, { ...each, state: 'done' }), 300 + (i + 0.7) * STEP_MS);
    });
    setTimeout(
      () => {
        if (sample.stopped) return;
        print(sample, sample.lines.taskDone(task));
        if (!ending) {
          finish(sample);
          return;
        }
        ended(
          sample,
          ending === 'question'
            ? { said: 'Which template would you like for it, Classic or Minimal?', error: null }
            : { said: null, error: { kind: ending, message: 'API Error: Rate limit reached' } },
        );
        done(sample);
      },
      300 + steps.length * STEP_MS,
    );
  };
  // Claude with no task opens on its own question, or a permission prompt with ?permit=.
  const play = (sample: Sample) => {
    const { task } = sample;
    if (task) {
      setTimeout(() => playTask(sample, task), 300);
      return;
    }
    setTimeout(() => {
      signal(sample, 'working');
      print(sample, sample.lines.opening);
    }, 300);
    setTimeout(() => {
      print(sample, sample.lines.intro);
      const permit = SAMPLE_PERMITS[query.get('permit') ?? ''];
      if (permit) askPermission(sample, permit);
      else askRound(sample, openingRound(roundAsked), 'opening');
    }, 1800);
  };
  const askTrust = (sample: Sample) => {
    if (trusted) {
      play(sample);
      return;
    }
    sample.afterScreens = () => play(sample);
    setTimeout(() => {
      print(sample, sample.lines.trust);
      sample.screen = 'trust';
      set(sample.id, { screen: 'trust' });
    }, 300);
  };
  const launch = (sample: Sample) => {
    set(sample.id, { phase: 'starting', waits: null, startedAt: Date.now() });
    sample.record = changes.begin(sample.id);
    if (firstRunLeft === 0) {
      askTrust(sample);
      return;
    }
    sample.afterScreens = () => {
      print(sample, ['\x1b[H\x1b[2J']);
      askTrust(sample);
    };
    setTimeout(() => {
      print(sample, sample.lines.firstRun[0] ?? []);
      sample.screen = 'first-run';
      set(sample.id, { screen: 'first-run' });
    }, 300);
  };
  // The line: tasks start in the order they were asked for, as many at once as may, and never
  // two on one job.
  const pump = () => {
    const busy = (tab: RunView) => ['starting', 'working', 'needs-answer'].includes(tab.phase);
    let going = tabs.filter(busy).length;
    const lanes = new Set(tabs.filter(busy).flatMap((tab) => lanesOf(tab.task)));
    for (const tab of tabs) {
      if (tab.phase !== 'in-line') continue;
      const mine = lanesOf(tab.task);
      const waits = mine.some((lane) => lanes.has(lane))
        ? 'job'
        : tab.task && going >= atOnce
          ? 'turn'
          : null;
      for (const lane of mine) lanes.add(lane);
      if (waits) {
        if (tab.waits !== waits) set(tab.id, { waits });
        continue;
      }
      going += 1;
      const sample = samples.get(tab.id);
      if (sample) launch(sample);
    }
  };
  /** A made-up run, or a task in line for one, as the window would start it. */
  const add = (task: RunTask | null): Sample => {
    count += 1;
    const id = `run-${count}`;
    tabs.push({
      id,
      task,
      phase: 'in-line',
      waits: 'turn',
      screen: null,
      startedAt: null,
      problem: null,
    });
    const sample: Sample = {
      id,
      task,
      lines: sampleRun(dark()),
      terminal: null,
      record: '',
      screen: null,
      afterScreens: () => {},
      stopped: false,
    };
    samples.set(id, sample);
    return sample;
  };
  const close = (id: string) => {
    const at = tabs.findIndex((tab) => tab.id === id);
    if (at < 0) return;
    tabs.splice(at, 1);
    const sample = samples.get(id);
    if (sample) sample.stopped = true;
    samples.delete(id);
    rounds = rounds.filter((round) => round.runId !== id);
    permits = permits.filter((ask) => ask.runId !== id);
    tellQuestions();
    tellPermissions();
    tellRuns();
    pump();
  };
  // ?runs=side opens on runs side by side: three at work, one done that stopped on a question,
  // and a cover letter in line for its job's resume. ?runs=asking has three runs waiting on the
  // user at once: two rounds of questions and a permission prompt. ?runs=strips has a run on each
  // kind of step the working strip draws, held there: reading, searching, writing, checking
  // facts with a helper, building a PDF, a job search at step 3 of 7 with four helpers, and
  // thinking.
  const scene = query.get('runs');
  const sideBySide = (tasks: RunTask[], start: (sample: Sample, at: number) => void) => {
    const now = Date.now();
    const started = tasks.map((task, at) => {
      const sample = add(task);
      set(sample.id, {
        phase: 'working',
        waits: null,
        startedAt: now - Math.max(4 - at, 1) * 61_000,
      });
      return sample;
    });
    // What each run says comes once the window listens.
    setTimeout(() => {
      started.forEach((sample, at) => {
        sample.record = changes.begin(sample.id);
        if (sample.task) print(sample, sample.lines.task(sample.task));
        start(sample, at);
      });
    }, 500);
  };
  if (scene === 'side') {
    const at = (tool: string, detail: string | null) => ({ tool, detail, id: `${tool}-${detail}` });
    sideBySide(
      [
        { skill: 'focused-resume', jobId: 'tidewater-analytics--senior-backend-engineer' },
        { skill: 'cover-letter', jobId: 'acme-robotics--staff-engineer-developer-tools' },
        { skill: 'fit-check', jobId: 'copperleaf-energy--principal-engineer' },
        { skill: 'focused-resume', jobId: 'quarry-labs--senior-software-engineer' },
      ],
      (sample, index) => {
        const doing = [
          at('Write', 'applications/tidewater-analytics--senior-backend-engineer/resume.json'),
          at('mcp__factwright__build_cover_letter', null),
          at('WebSearch', 'Copperleaf Energy engineering team reviews'),
        ][index];
        if (doing) {
          step(sample, { ...at('Read', 'facts/platform-engineering.md'), state: 'done' });
          step(sample, { ...doing, state: 'running' });
          return;
        }
        // The fourth is done, and stopped to ask something in its own words.
        set(sample.id, { phase: 'done' });
        ended(sample, {
          said: 'The posting lists Rust as a must. Should I lead with your Go work, or leave Rust off and say so in the letter?',
          error: null,
        });
      },
    );
    add({ skill: 'cover-letter', jobId: 'tidewater-analytics--senior-backend-engineer' });
    pump();
  } else if (scene === 'strips') {
    const at = (tool: string, detail: string | null, helper?: string): RunStep => ({
      id: `${tool}-${detail}-${helper}`,
      tool,
      detail,
      state: 'running',
      ...(helper && { helper }),
    });
    const done = (step: RunStep): RunStep => ({ ...step, state: 'done' });
    // Where Claude is on a to-do list, given as what each item is and what Claude says while it's
    // on it: on the one given.
    const onList = (items: [string, string][], on: number) =>
      todoAt(
        items.map(
          ([text, doing], i): TodoItem => ({
            text,
            doing,
            state: i < on ? 'completed' : i === on ? 'in_progress' : 'pending',
          }),
        ),
      );
    const posting = (jobId: string) => `applications/${jobId}/posting.md`;
    const strips: { task: RunTask; steps: RunStep[]; progress?: RunProgress }[] = [
      {
        task: { skill: 'focused-resume', jobId: 'tidewater-analytics--senior-backend-engineer' },
        steps: [
          done(at('Read', posting('tidewater-analytics--senior-backend-engineer'))),
          at('Read', 'facts/platform-engineering.md'),
        ],
      },
      {
        task: { skill: 'who-to-message', jobId: 'copperleaf-energy--principal-engineer' },
        steps: [
          done(at('Read', posting('copperleaf-energy--principal-engineer'))),
          at('WebSearch', 'Copperleaf Energy engineering manager platform'),
        ],
      },
      {
        task: { skill: 'cover-letter', jobId: 'acme-robotics--staff-engineer-developer-tools' },
        steps: [
          done(at('Read', 'facts/platform-engineering.md')),
          at(
            'Write',
            'applications/acme-robotics--staff-engineer-developer-tools/cover-letter.json',
          ),
        ],
      },
      {
        task: { skill: 'focused-resume', jobId: 'quarry-labs--senior-software-engineer' },
        steps: [
          done(at('mcp__factwright__build_resume', null)),
          done(at('Agent', 'Fact-check the resume')),
          at('Read', 'facts/platform-engineering.md', 'agent-fact-check'),
        ],
        progress: {
          todo: onList(
            [
              ['Set up the folder', 'Setting up the folder'],
              ['Research the company', 'Researching the company'],
              ['Pull out what the posting asks for', 'Pulling out what the posting asks for'],
              ['Map your facts to it', 'Mapping your facts to it'],
              ['Ask about the gaps', 'Asking about the gaps'],
              ['Draft the resume', 'Drafting the resume'],
              ['Build it and fit the pages', 'Building it and fitting the pages'],
              ['Fact-check the resume', 'Fact-checking the resume'],
              ['Sum up what changed', 'Summing up what changed'],
            ],
            7,
          ),
          helpers: [{ id: 'agent-fact-check', what: 'Fact-check the resume' }],
        },
      },
      {
        task: {
          skill: 'projects-page',
          jobId: 'northwind-labs--senior-software-engineer-platform',
        },
        steps: [
          done(
            at(
              'Write',
              'applications/northwind-labs--senior-software-engineer-platform/projects-page.json',
            ),
          ),
          at('mcp__factwright__build_projects_page', null),
        ],
      },
      {
        task: { skill: 'job-search', sources: { sites: ['hn', 'boards'] } },
        steps: [
          done(at('mcp__factwright__hn_jobs', null)),
          ...['1–50', '51–100', '101–150', '151–186'].map((part) =>
            done(at('Agent', `Filter listings ${part}`)),
          ),
          at('Read', 'searches/2026-10-hn/listings.md', 'agent-1'),
          at('mcp__factwright__job_board', null, 'agent-2'),
          at('WebSearch', 'Lakeside Data platform team remote', 'agent-3'),
          at('mcp__factwright__find_job', null, 'agent-4'),
        ],
        progress: {
          todo: onList(
            [
              ['Read HN’s October thread', 'Reading HN’s October thread'],
              ['Read the company boards', 'Reading the company boards'],
              ['Filter the listings', 'Filtering the listings'],
              ['Verify and score the jobs', 'Verifying and scoring the jobs'],
              ['Write the report', 'Writing the report'],
              ['List the near misses', 'Listing the near misses'],
              ['Sum up the search', 'Summing up the search'],
            ],
            2,
          ),
          helpers: [
            { id: 'agent-1', what: 'Filter listings 1–50' },
            { id: 'agent-2', what: 'Filter listings 51–100' },
            { id: 'agent-3', what: 'Filter listings 101–150' },
            { id: 'agent-4', what: 'Filter listings 151–186' },
          ],
        },
      },
      {
        task: { skill: 'salary-check', jobId: 'granite-health--staff-software-engineer' },
        steps: [done(at('Read', posting('granite-health--staff-software-engineer')))],
      },
    ];
    sideBySide(
      strips.map(({ task }) => task),
      (sample, index) => {
        const strip = strips[index];
        if (!strip) return;
        for (const each of strip.steps) step(sample, each);
        if (strip.progress) progress(sample, strip.progress);
      },
    );
  } else if (scene === 'asking') {
    sideBySide(
      [
        { skill: 'focused-resume', jobId: 'tidewater-analytics--senior-backend-engineer' },
        { skill: 'cover-letter', jobId: 'acme-robotics--staff-engineer-developer-tools' },
        { skill: TEMPLATE_SKILL, source: '2026-10-25-1.pdf' },
      ],
      (sample, index) => {
        if (index === 0) askRound(sample, RESUME_ROUND, 'round');
        else if (index === 1) askRound(sample, LETTER_ROUND, 'round');
        else if (SAMPLE_PERMITS.template) askPermission(sample, SAMPLE_PERMITS.template);
      },
    );
  }
  return {
    platform: query.get('platform') ?? 'darwin',
    version: query.get('version') ?? '0.1.0',
    claudeStatus: () => {
      if (claude === 'checking') return new Promise(() => {});
      const status = claude === 'ready' ? ready : (SAMPLES[claude] ?? ready);
      // Where Claude Code's own installer puts it, as the app says it on each system.
      const typed =
        (query.get('platform') ?? 'darwin') === 'win32'
          ? '& "$env:USERPROFILE\\.local\\bin\\claude.exe"'
          : '~/.local/bin/claude';
      const byPath =
        status.state !== 'ready' && (status.state === 'missing' || query.get('path') === 'off');
      return Promise.resolve(byPath ? { ...status, claude: typed } : status);
    },
    setupCheck: async () => SETUP_CHECKS[query.get('setup') ?? 'passed'] ?? null,
    // Checking again takes a moment, then passes, as it would once Factwright is updated.
    checkSetup: () =>
      new Promise((resolve) => setTimeout(() => resolve(SETUP_CHECKS.passed ?? null), 1200)),
    onSetupCheck: () => () => {},
    startClaude: async (task) => {
      const sample = add(task ?? null);
      tellRuns();
      pump();
      return sample.id;
    },
    claudeRuns: async () => runsView(),
    onClaudeRuns: (listener) => {
      runsListeners.add(listener);
      return () => runsListeners.delete(listener);
    },
    runsAtOnce: async () => atOnce,
    setRunsAtOnce: async (chosen) => {
      atOnce = chosen;
      tellRuns();
      pump();
      return chosen;
    },
    // A focus kept in memory until the page reloads, by an ID like the app's.
    saveSearchFocus: async () => ({
      ok: true,
      id: `${localDate()}-${Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0')}`,
    }),
    stopClaude: (runId) => {
      const sample = samples.get(runId);
      if (!sample) return;
      if (tabOf(runId)?.phase === 'in-line') {
        close(runId);
        return;
      }
      rounds = rounds.filter((round) => round.runId !== runId);
      permits = permits.filter((ask) => ask.runId !== runId);
      tellQuestions();
      tellPermissions();
      set(runId, { phase: 'stopped', screen: null });
      sample.stopped = true;
      pump();
    },
    closeRun: close,
    writeToClaude: (runId, data) => {
      const sample = samples.get(runId);
      if (!sample || !data.includes('\r')) return;
      if (sample.screen === 'first-run' && firstRunLeft > 0) {
        firstRunLeft -= 1;
        set(runId, { screen: null });
        if (firstRunLeft === 0) {
          sample.screen = null;
          sample.afterScreens();
          return;
        }
        // A moment later, as Claude Code draws it, the next screen says so too, as in the app.
        const next = sample.lines.firstRun[sample.lines.firstRun.length - firstRunLeft] ?? [];
        setTimeout(() => {
          print(sample, next);
          set(runId, { screen: 'first-run' });
        }, 150);
        return;
      }
      if (sample.screen === 'trust') {
        sample.screen = null;
        trusted = true;
        set(runId, { screen: null });
        sample.afterScreens();
        return;
      }
      const answering = sample.terminal;
      if (!answering) return;
      sample.terminal = null;
      if (answering === 'permission') {
        print(sample, sample.lines.allowed);
        carryOn(sample);
        return;
      }
      print(
        sample,
        answering === 'round'
          ? sample.lines.answered([[PREP_QUESTION, PREP_ANSWER]], NEXT.round)
          : sample.lines.answered(
              [['Which role is the call about?', 'Tidewater Analytics']],
              NEXT.opening,
            ),
      );
      carryOn(sample);
    },
    resizeClaude: () => {},
    onClaudeOutput: (listener) => {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onClaudeStep: (listener) => {
      stepListeners.add(listener);
      return () => stepListeners.delete(listener);
    },
    onClaudeProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    onClaudeTurnEnd: (listener) => {
      endListeners.add(listener);
      return () => endListeners.delete(listener);
    },
    // A reply carries on the made-up run, as a message typed in the terminal does.
    replyToClaude: (runId, text) => {
      const sample = samples.get(runId);
      if (!sample) return;
      print(sample, [`> ${text}\r\n`]);
      signal(sample, 'working');
      setTimeout(() => {
        print(sample, sample.lines.finished);
        finish(sample);
      }, 1600);
    },
    // The window is always in view in the screens preview, so a done run tells no one.
    tellRunDone: () => {},
    onOpenRunResult: () => () => {},
    // The screens never have the browser extension ask for anything.
    onRunRequest: () => () => {},
    answerRunRequest: () => {},
    // Claude's questions, in their dialog: answered there, or sent to the terminal.
    claudeQuestions: async () => [...rounds],
    onClaudeQuestions: (listener) => {
      questionListeners.add(listener);
      return () => questionListeners.delete(listener);
    },
    answerClaude: async (id, reply) => {
      const waiting = rounds.find((round) => round.id === id);
      const sample = waiting && samples.get(waiting.runId);
      if (!waiting || !sample) {
        return { ok: false, message: 'Claude isn’t waiting for these answers anymore.' };
      }
      rounds = rounds.filter((round) => round !== waiting);
      tellQuestions();
      if (reply === 'terminal') {
        print(sample, waiting.after === 'round' ? sample.lines.round : sample.lines.question);
        sample.terminal = waiting.after;
        return { ok: true };
      }
      print(sample, sample.lines.answered(noted(waiting, reply), NEXT[waiting.after]));
      carryOn(sample);
      return { ok: true };
    },
    // Claude Code's permission prompts, in their dialog: answered there, or in the terminal.
    claudePermissions: async () => [...permits],
    onClaudePermissions: (listener) => {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
    answerPermission: async (id, answer) => {
      const waiting = permits.find((ask) => ask.id === id);
      const sample = waiting && samples.get(waiting.runId);
      if (!waiting || !sample) {
        return { ok: false, message: 'Claude Code isn’t waiting for this anymore.' };
      }
      permits = permits.filter((ask) => ask !== waiting);
      tellPermissions();
      if (answer === 'terminal') {
        sample.terminal = 'permission';
        return { ok: true };
      }
      print(sample, answer.allow ? sample.lines.allowed : sample.lines.denied(answer.note));
      carryOn(sample);
      return { ok: true };
    },
    // ?resume=spaced, dates-last, icons, sidebar or footer gives every resume a problem to X-ray,
    // and ?revised a revision sent before it was last built, for the before-and-after.
    ...tracker,
    ...sampleSync(query.get('sync'), query.get('approve'), query.get('server'), query.get('plan')),
    ...sampleProfile(query.get('profile')),
    ...facts.api,
    onFactsFiled: (listener) => {
      filedListeners.add(listener);
      return () => filedListeners.delete(listener);
    },
    ...sampleProfiles(query.get('profiles')),
    // ?update=ready shows an update waiting to be installed.
    updateStatus: async () =>
      query.get('update') === 'ready'
        ? {
            state: 'ready',
            version: '0.2.0',
            notes:
              '- **Fact bank:** search reads what each tag means.\n- Resumes build faster on Windows.',
          }
        : { state: 'none' },
    onUpdateChanged: () => () => {},
    installUpdate: async () => true,
    ...sampleSaveHelper(query.get('helper'), query.get('platform') ?? 'darwin'),
    // Which model Claude runs on, kept until the page reloads.
    claudeModels: async () => models,
    setClaudeModels: async (chosen) => {
      models = chosen;
      return chosen;
    },
    // How hard Claude thinks, kept until the page reloads.
    claudeEffort: async () => effort,
    setClaudeEffort: async (chosen) => {
      effort = chosen;
      return chosen;
    },
    // Reminders before calls, on unless ?reminders=off, kept until the page reloads.
    callReminders: async () => reminding,
    setCallReminders: async (on) => {
      reminding = on;
      return on;
    },
    // ?open=<job ID> opens that job, as clicking a call's reminder does.
    onOpenJob: (listener) => {
      const jobId = query.get('open');
      const timer = jobId ? setTimeout(() => listener(jobId), 500) : undefined;
      return () => clearTimeout(timer);
    },
    ...changes.api,
  };
}
