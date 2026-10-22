import { localDate } from '@factwright/core';
import type { RunStep, TurnEnd } from '../shared/activity.ts';
import type { ClaudeStatus, FactwrightApi, RunSignal, SetupCheck } from '../shared/api.ts';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
import type { PermissionAsk } from '../shared/permission-asks.ts';
import { ASK_FIRST, type ClaudePermissions } from '../shared/permissions.ts';
import {
  isAnswered,
  type QuestionRound,
  type RoundQuestion,
  type RoundReply,
} from '../shared/rounds.ts';
import { type RunTask, taskJob } from '../shared/runs.ts';
import { sampleProfile } from './about/sample-profile.ts';
import { sampleSaveHelper } from './extension/sample-helper.ts';
import { sampleFacts } from './facts/sample-facts.ts';
import { sampleTracker } from './jobs/sample-tracker.ts';
import { sampleProfiles } from './profiles/sample-profiles.ts';
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
    case 'page':
      return `factwright - read_page (MCP)(url: "${ask.url}")`;
    case 'profile':
      return 'factwright - save_about_you (MCP)';
    case 'template':
      return `factwright - save_template (MCP)(id: "${ask.template}")`;
  }
}

/** A permission prompt for the made-up run, with ?permit= and its kind, in place of its question. */
const SAMPLE_PERMITS: Readonly<Record<string, PermissionAsk>> = {
  page: {
    id: 'perm_sample',
    kind: 'page',
    url: 'https://northwindlabs.com/careers/senior-software-engineer-platform',
    host: 'northwindlabs.com',
  },
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

/** Each question answered, with what the user picked and wrote, as Claude Code notes them. */
const noted = (round: QuestionRound, reply: RoundReply): [string, string][] =>
  round.questions.flatMap(({ question }, at): [string, string][] => {
    const answer = reply[at];
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
 * ?permit=edit, write, read, page, profile or template has the first run ask Claude Code's OK
 * for that instead, in its dialog. ?helper picks where the browsers stand in the Save to
 * Factwright window (see extension/sample-helper.ts).
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
    default:
      return reading;
  }
}

export function sampleApi(): FactwrightApi {
  const query = new URLSearchParams(location.search);
  const claude = query.get('claude') ?? 'ready';
  const ready = PLANS[query.get('plan') ?? ''] ?? READY;
  const outputListeners = new Set<(data: string) => void>();
  const signalListeners = new Set<(signal: RunSignal) => void>();
  const stepListeners = new Set<(step: RunStep) => void>();
  const endListeners = new Set<(end: TurnEnd) => void>();
  const step = (value: RunStep) => {
    for (const listener of stepListeners) listener(value);
  };
  const ended = (end: TurnEnd) => {
    for (const listener of endListeners) listener(end);
  };
  // ?jobs picks the jobs, and a made-up run leaves its work on them.
  const tracker = sampleTracker(query.get('jobs'), query.get('resume'), query.has('revised'));
  const print = (lines: string[]) => {
    for (const line of lines) for (const listener of outputListeners) listener(line);
  };
  const signal = (value: RunSignal) => {
    for (const listener of signalListeners) listener(value);
  };
  let waitingForAnswer = false;
  // What answering plays: the opening run's question, interview prep's, with ?run=asks, or a
  // permission prompt, with ?permit=.
  let afterAnswer: 'opening' | 'round' | 'permission' = 'opening';
  const asks = query.get('run') === 'asks';
  // ?first-run=show starts with Claude Code's first-run screens, once, each until Enter.
  let firstRunLeft = query.get('first-run') === 'show' ? 2 : 0;
  let afterFirstRun: () => void = () => {};
  const firstRunListeners = new Set<() => void>();
  // ?trust=ask starts with Claude Code's question about trusting the folder, once.
  let waitingForTrust = false;
  let trusted = query.get('trust') !== 'ask';
  let afterTrust: () => void = () => {};
  const trustListeners = new Set<() => void>();
  let run = sampleRun(false);
  // The round of Claude's questions waiting in its dialog, and what answering it plays.
  const questionListeners = new Set<(round: QuestionRound | null) => void>();
  let asking: { round: QuestionRound; after: 'opening' | 'round' } | null = null;
  const tellQuestion = (round: QuestionRound | null) => {
    for (const listener of questionListeners) listener(round);
  };
  const askRound = (round: QuestionRound, after: 'opening' | 'round') => {
    asking = { round, after };
    signal('needs-answer');
    tellQuestion(round);
  };
  const roundAsked = query.get('ask');
  // A permission prompt waiting in its dialog, with ?permit=, in place of the first question.
  const permissionListeners = new Set<(ask: PermissionAsk | null) => void>();
  let permitting: PermissionAsk | null = null;
  const tellPermission = (ask: PermissionAsk | null) => {
    for (const listener of permissionListeners) listener(ask);
  };
  const askPermission = (ask: PermissionAsk) => {
    permitting = ask;
    print(run.permission(ask));
    signal('needs-answer');
    tellPermission(ask);
  };
  const carryOn = () => {
    signal('working');
    setTimeout(() => {
      print(run.finished);
      done();
    }, 1600);
  };
  // ?filed has the made-up run file facts from the user's answers as it finishes, once.
  const facts = sampleFacts(query.get('profile'));
  const filedListeners = new Set<(filed: FiledFacts) => void>();
  let fileOnce = query.has('filed');
  const done = () => {
    signal('done');
    if (!fileOnce) return;
    fileOnce = false;
    const filed = facts.fileAnswers();
    for (const listener of filedListeners) listener(filed);
  };
  let permissions: ClaudePermissions = ASK_FIRST;
  let reminding = query.get('reminders') !== 'off';
  let models: ModelChoices = DEFAULT_MODELS;
  let effort: EffortChoices = DEFAULT_EFFORT;
  // ?end=question has a run stop to ask in its own words, and ?end=rate_limit end in that error.
  const ending = query.get('end');
  // The task at hand, which a reply to the made-up run's question finishes.
  let current: RunTask | null = null;
  const finish = (task: RunTask | null) => {
    if (task) tracker.madeBy(task);
    ended({ said: 'Done. The job’s panel shows what changed.', error: null });
    done();
  };
  const playTask = (task: RunTask) => {
    current = task;
    signal('working');
    print(run.task(task));
    if (asks && task.skill === 'interview-prep') {
      setTimeout(() => {
        print(run.roundIntro);
        askRound(PREP_ROUND, 'round');
      }, 1200);
      return;
    }
    const steps = sampleSteps(task).map((each, i) => ({
      ...each,
      id: `sample-${Date.now()}-${i}`,
    }));
    steps.forEach((each, i) => {
      setTimeout(() => step({ ...each, state: 'running' }), 300 + i * STEP_MS);
      setTimeout(() => step({ ...each, state: 'done' }), 300 + (i + 0.7) * STEP_MS);
    });
    setTimeout(
      () => {
        print(run.taskDone(task));
        if (!ending) {
          finish(task);
          return;
        }
        ended(
          ending === 'question'
            ? { said: 'Which template would you like for it, Classic or Minimal?', error: null }
            : { said: null, error: { kind: ending, message: 'API Error: Rate limit reached' } },
        );
        done();
      },
      300 + steps.length * STEP_MS,
    );
  };
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
    startClaude: async (_size, task) => {
      run = sampleRun(window.matchMedia('(prefers-color-scheme: dark)').matches);
      const play = () => {
        if (task) {
          setTimeout(() => playTask(task), 300);
          return;
        }
        setTimeout(() => {
          signal('working');
          print(run.opening);
        }, 300);
        setTimeout(() => {
          print(run.intro);
          const permit = SAMPLE_PERMITS[query.get('permit') ?? ''];
          if (permit) askPermission(permit);
          else askRound(openingRound(roundAsked), 'opening');
        }, 1800);
      };
      const askTrust = () => {
        if (trusted) {
          play();
          return;
        }
        afterTrust = play;
        setTimeout(() => {
          print(run.trust);
          waitingForTrust = true;
          for (const listener of trustListeners) listener();
        }, 300);
      };
      if (firstRunLeft === 0) {
        askTrust();
        return { ok: true };
      }
      afterFirstRun = () => {
        print(['\x1b[H\x1b[2J']);
        askTrust();
      };
      setTimeout(() => {
        print(run.firstRun[0] ?? []);
        for (const listener of firstRunListeners) listener();
      }, 300);
      return { ok: true };
    },
    runTask: async (task) => {
      playTask(task);
      return { ok: true };
    },
    // A focus kept in memory until the page reloads, by an ID like the app's.
    saveSearchFocus: async () => ({
      ok: true,
      id: `${localDate()}-${Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0')}`,
    }),
    stopClaude: () => {
      if (asking) {
        asking = null;
        tellQuestion(null);
      }
      if (permitting) {
        permitting = null;
        tellPermission(null);
      }
      signal('stopped');
    },
    writeToClaude: (data) => {
      if (firstRunLeft > 0 && data.includes('\r')) {
        firstRunLeft -= 1;
        if (firstRunLeft === 0) {
          afterFirstRun();
          return;
        }
        // A moment later, as Claude Code draws it, the next screen says so too, as in the app.
        const next = run.firstRun[run.firstRun.length - firstRunLeft] ?? [];
        setTimeout(() => {
          print(next);
          for (const listener of firstRunListeners) listener();
        }, 150);
        return;
      }
      if (waitingForTrust && data.includes('\r')) {
        waitingForTrust = false;
        trusted = true;
        afterTrust();
        return;
      }
      if (!waitingForAnswer || !data.includes('\r')) return;
      waitingForAnswer = false;
      if (afterAnswer === 'permission') {
        print(run.allowed);
        carryOn();
        return;
      }
      print(
        afterAnswer === 'round'
          ? run.answered([[PREP_QUESTION, PREP_ANSWER]], NEXT.round)
          : run.answered([['Which role is the call about?', 'Tidewater Analytics']], NEXT.opening),
      );
      signal('working');
      setTimeout(() => {
        print(run.finished);
        done();
      }, 1600);
    },
    resizeClaude: () => {},
    onClaudeOutput: (listener) => {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onClaudeSignal: (listener) => {
      signalListeners.add(listener);
      return () => signalListeners.delete(listener);
    },
    onClaudeStep: (listener) => {
      stepListeners.add(listener);
      return () => stepListeners.delete(listener);
    },
    onClaudeTurnEnd: (listener) => {
      endListeners.add(listener);
      return () => endListeners.delete(listener);
    },
    // A reply carries on the made-up run, as a message typed in the terminal does.
    replyToClaude: (text) => {
      print([`> ${text}\r\n`]);
      signal('working');
      setTimeout(() => {
        print(run.finished);
        finish(current);
      }, 1600);
    },
    // The window is always in view in the screens preview, so a done run tells no one.
    tellRunDone: () => {},
    onOpenRunResult: () => () => {},
    onClaudeTrust: (listener) => {
      trustListeners.add(listener);
      return () => trustListeners.delete(listener);
    },
    onClaudeFirstRun: (listener) => {
      firstRunListeners.add(listener);
      return () => firstRunListeners.delete(listener);
    },
    // Claude's questions, in their dialog: answered there, or sent to the terminal.
    claudeQuestion: async () => asking?.round ?? null,
    onClaudeQuestion: (listener) => {
      questionListeners.add(listener);
      return () => questionListeners.delete(listener);
    },
    answerClaude: async (id, reply) => {
      const waiting = asking;
      if (!waiting || waiting.round.id !== id) {
        return { ok: false, message: 'Claude isn’t waiting for these answers anymore.' };
      }
      asking = null;
      tellQuestion(null);
      if (reply === 'terminal') {
        print(waiting.after === 'round' ? run.round : run.question);
        waitingForAnswer = true;
        afterAnswer = waiting.after;
        return { ok: true };
      }
      print(run.answered(noted(waiting.round, reply), NEXT[waiting.after]));
      carryOn();
      return { ok: true };
    },
    // Claude Code's permission prompts, in their dialog: answered there, or in the terminal.
    claudePermission: async () => permitting,
    onClaudePermission: (listener) => {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
    answerPermission: async (id, answer) => {
      const waiting = permitting;
      if (!waiting || waiting.id !== id) {
        return { ok: false, message: 'Claude Code isn’t waiting for this anymore.' };
      }
      permitting = null;
      tellPermission(null);
      if (answer === 'terminal') {
        waitingForAnswer = true;
        afterAnswer = 'permission';
        return { ok: true };
      }
      print(answer.allow ? run.allowed : run.denied(answer.note));
      carryOn();
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
    // What Claude may do without asking, kept until the page reloads.
    claudePermissions: async () => permissions,
    setClaudePermissions: async (chosen) => {
      permissions = chosen;
      return chosen;
    },
  };
}
