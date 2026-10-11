import type { ClaudeStatus, FactwrightApi, RunSignal, SetupCheck } from '../shared/api.ts';
import type { RunTask } from '../shared/runs.ts';
import { sampleTracker } from './jobs/sample-tracker.ts';

const READY: ClaudeStatus = { state: 'ready', version: '2.1.296', plan: 'max' };

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
      `\r\n${color(main, `⏺ Done. ${'jobId' in task ? 'The job’s panel shows what changed.' : 'The jobs that fit are under To review.'}`)}\r\n\r\n${color(secondary, '❯')} `,
    ],
  };
}

/**
 * Sample answers for checking the screens in a browser. The query string picks Claude's status,
 * such as ?claude=signed-out&platform=win32, and ?claude=checking never answers. ?jobs picks
 * the jobs: none, failed or loading. Starting Claude plays a short made-up run, so every state
 * of the panel can be seen, and status changes stick until the page reloads.
 */
export function sampleApi(): FactwrightApi {
  const query = new URLSearchParams(location.search);
  const claude = query.get('claude') ?? 'ready';
  const outputListeners = new Set<(data: string) => void>();
  const signalListeners = new Set<(signal: RunSignal) => void>();
  const print = (lines: string[]) => {
    for (const line of lines) for (const listener of outputListeners) listener(line);
  };
  const signal = (value: RunSignal) => {
    for (const listener of signalListeners) listener(value);
  };
  let waitingForAnswer = false;
  let run = sampleRun(false);
  const playTask = (task: RunTask) => {
    signal('working');
    print(run.task(task));
    setTimeout(() => {
      print(run.taskDone(task));
      signal('done');
    }, 1600);
  };
  return {
    platform: query.get('platform') ?? 'darwin',
    claudeStatus: () =>
      claude === 'checking' ? new Promise(() => {}) : Promise.resolve(SAMPLES[claude] ?? READY),
    setupCheck: async () => SETUP_CHECKS[query.get('setup') ?? 'passed'] ?? null,
    // Checking again takes a moment, then passes, as it would once Factwright is updated.
    checkSetup: () =>
      new Promise((resolve) => setTimeout(() => resolve(SETUP_CHECKS.passed ?? null), 1200)),
    onSetupCheck: () => () => {},
    startClaude: async (_size, task) => {
      run = sampleRun(window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (task) {
        setTimeout(() => playTask(task), 300);
        return { ok: true };
      }
      setTimeout(() => {
        signal('working');
        print(run.opening);
      }, 300);
      setTimeout(() => {
        print(run.question);
        waitingForAnswer = true;
        signal('needs-answer');
      }, 1800);
      return { ok: true };
    },
    runTask: async (task) => {
      playTask(task);
      return { ok: true };
    },
    stopClaude: () => signal('stopped'),
    writeToClaude: (data) => {
      if (!waitingForAnswer || !data.includes('\r')) return;
      waitingForAnswer = false;
      print(run.answered);
      signal('working');
      setTimeout(() => {
        print(run.finished);
        signal('done');
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
    ...sampleTracker(query.get('jobs')),
  };
}
