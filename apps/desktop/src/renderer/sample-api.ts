import type { ClaudeStatus, FactwrightApi, RunSignal, SetupCheck } from '../shared/api.ts';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
import { ASK_FIRST, type ClaudePermissions } from '../shared/permissions.ts';
import type { RunTask } from '../shared/runs.ts';
import { sampleProfile } from './about/sample-profile.ts';
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

/** Setup checks for ?setup=: the one a new version of Claude Code could fail, or a pass. */
const SETUP_CHECKS: Readonly<Record<string, SetupCheck>> = {
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
    question: [
      `${color('32', '⏺')} ${color(main, 'Happy to. One question first, so the prep fits.')}\r\n\r\n`,
      ` ${color(`1;${main}`, 'Which role is the call about?')}\r\n\r\n`,
      ` ${color('34', '❯ 1. Senior Backend Engineer at Tidewater Analytics')}\r\n`,
      `   ${color(main, '2. Staff Engineer at Acme Robotics')}\r\n`,
      `   ${color(main, '3. Type something else')}\r\n`,
    ],
    answered: [
      `\r\n${color(secondary, '⏺ User answered Claude’s questions:')}\r\n`,
      `${color(secondary, '  ⎿  · Which role is the call about? → Tidewater Analytics')}\r\n\r\n`,
      `${color('34', '✻')} ${color(secondary, 'Reading the posting and your facts…')}\r\n`,
    ],
    /** Interview prep stopping to ask which round it's for, with ?run=asks. */
    round: [
      `\r\n${color('32', '⏺')} ${color(main, 'Read the posting, your fit check, the resume you sent and your notes.')}\r\n\r\n`,
      ` ${color(`1;${main}`, 'Which round is the interview?')}\r\n\r\n`,
      ` ${color('34', '❯ 1. Panel with the platform team')}\r\n`,
      `   ${color(main, '2. Hiring manager, one on one')}\r\n`,
      `   ${color(main, '3. Type something else')}\r\n`,
    ],
    roundAnswered: [
      `\r\n${color(secondary, '⏺ User answered Claude’s questions:')}\r\n`,
      `${color(secondary, '  ⎿  · Which round is the interview? → Panel with the platform team')}\r\n\r\n`,
      `${color('34', '✻')} ${color(secondary, 'Checking company news and writing your prep sheet…')}\r\n`,
    ],
    finished: [
      `\r\n${color(main, '⏺ Your prep sheet is ready: likely questions, your best stories, and')}`,
      `${color(main, ' three questions to ask them.')}\r\n\r\n${color(secondary, '❯')} `,
    ],
    /** A Run button's command, typed into the run, and a short made-up result. */
    task: (task: RunTask) =>
      'jobId' in task
        ? [
            `${color(main, `/factwright:${task.skill} job ${task.jobId}`)}\r\n\r\n`,
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

/**
 * Sample answers for checking the screens in a browser. The query string picks Claude's status,
 * such as ?claude=signed-out&platform=win32, and ?claude=checking never answers. ?plan picks the
 * plan Claude is ready on: pro, team, or api for an API key. ?jobs picks the jobs: none, failed
 * or loading. ?profile picks how far the user's profile has come: new, started or done.
 * ?profiles picks how many profiles there are: two, three with an added one open (added), or two
 * after one stopped short of opening (stopped). Starting Claude plays a short made-up run, so
 * every state of the panel can be seen, and status changes stick until the page reloads. With
 * ?run=asks, interview prep stops to ask a question, as the README's screenshots show it.
 */
export function sampleApi(): FactwrightApi {
  const query = new URLSearchParams(location.search);
  const claude = query.get('claude') ?? 'ready';
  const ready = PLANS[query.get('plan') ?? ''] ?? READY;
  const outputListeners = new Set<(data: string) => void>();
  const signalListeners = new Set<(signal: RunSignal) => void>();
  const print = (lines: string[]) => {
    for (const line of lines) for (const listener of outputListeners) listener(line);
  };
  const signal = (value: RunSignal) => {
    for (const listener of signalListeners) listener(value);
  };
  let waitingForAnswer = false;
  // What answering plays: the opening run's question, or interview prep's, with ?run=asks.
  let afterAnswer: 'opening' | 'round' = 'opening';
  const asks = query.get('run') === 'asks';
  // ?trust=ask starts with Claude Code's question about trusting the folder, once.
  let waitingForTrust = false;
  let trusted = query.get('trust') !== 'ask';
  let afterTrust: () => void = () => {};
  const trustListeners = new Set<() => void>();
  let run = sampleRun(false);
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
  let models: ModelChoices = DEFAULT_MODELS;
  let effort: EffortChoices = DEFAULT_EFFORT;
  const playTask = (task: RunTask) => {
    signal('working');
    print(run.task(task));
    if (asks && task.skill === 'interview-prep') {
      setTimeout(() => {
        print(run.round);
        waitingForAnswer = true;
        afterAnswer = 'round';
        signal('needs-answer');
      }, 1200);
      return;
    }
    setTimeout(() => {
      print(run.taskDone(task));
      done();
    }, 1600);
  };
  return {
    platform: query.get('platform') ?? 'darwin',
    version: query.get('version') ?? '0.1.0',
    claudeStatus: () =>
      claude === 'checking'
        ? new Promise(() => {})
        : Promise.resolve(claude === 'ready' ? ready : (SAMPLES[claude] ?? ready)),
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
          print(run.question);
          waitingForAnswer = true;
          afterAnswer = 'opening';
          signal('needs-answer');
        }, 1800);
      };
      if (trusted) {
        play();
        return { ok: true };
      }
      afterTrust = play;
      setTimeout(() => {
        print(run.trust);
        waitingForTrust = true;
        for (const listener of trustListeners) listener();
      }, 300);
      return { ok: true };
    },
    runTask: async (task) => {
      playTask(task);
      return { ok: true };
    },
    stopClaude: () => signal('stopped'),
    writeToClaude: (data) => {
      if (waitingForTrust && data.includes('\r')) {
        waitingForTrust = false;
        trusted = true;
        afterTrust();
        return;
      }
      if (!waitingForAnswer || !data.includes('\r')) return;
      waitingForAnswer = false;
      print(afterAnswer === 'round' ? run.roundAnswered : run.answered);
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
    onClaudeTrust: (listener) => {
      trustListeners.add(listener);
      return () => trustListeners.delete(listener);
    },
    // ?resume=spaced, dates-last, icons, sidebar or footer gives every resume a problem to X-ray.
    ...sampleTracker(query.get('jobs'), query.get('resume')),
    ...sampleSync(query.get('sync'), query.get('approve')),
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
    // What Claude may do without asking, kept until the page reloads.
    claudePermissions: async () => permissions,
    setClaudePermissions: async (chosen) => {
      permissions = chosen;
      return chosen;
    },
  };
}
