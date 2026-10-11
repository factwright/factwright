import { localDate } from '@factwright/core';
import type { ClaudeStatus, FactwrightApi, JobList, RunSignal } from '../shared/api.ts';
import { sampleDocs, sampleJobs } from './jobs/sample-jobs.ts';

const READY: ClaudeStatus = { state: 'ready', version: '2.1.296', plan: 'max' };

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
  const jobsMode = query.get('jobs');
  let list: JobList = {
    jobs: jobsMode === 'none' ? [] : sampleJobs(),
    readAt: new Date().toISOString(),
  };
  const jobListeners = new Set<(list: JobList) => void>();

  return {
    platform: query.get('platform') ?? 'darwin',
    claudeStatus: () =>
      claude === 'checking' ? new Promise(() => {}) : Promise.resolve(SAMPLES[claude] ?? READY),
    startClaude: async () => {
      run = sampleRun(window.matchMedia('(prefers-color-scheme: dark)').matches);
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
    listJobs: () =>
      jobsMode === 'loading'
        ? new Promise(() => {})
        : jobsMode === 'failed'
          ? Promise.reject(new Error('Sample failure'))
          : Promise.resolve(list),
    jobDocs: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      return job ? sampleDocs(job) : null;
    },
    updateJob: async (jobId, changes) => {
      const { status } = changes;
      if (status === undefined) return unsaved();
      const today = localDate();
      list = {
        ...list,
        jobs: list.jobs.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status,
                statusOn: status ? today : null,
                statusLog: status
                  ? [
                      ...job.statusLog,
                      { id: `${jobId}-${job.statusLog.length}`, status, at: today },
                    ]
                  : job.statusLog,
              }
            : job,
        ),
      };
      for (const listener of jobListeners) listener(list);
      return { ok: true };
    },
    addJob: unsaved,
    addCall: unsaved,
    updateCall: unsaved,
    deleteCall: unsaved,
    redateStatusChange: unsaved,
    undoStatusChange: unsaved,
    onJobsChanged: (listener) => {
      jobListeners.add(listener);
      return () => jobListeners.delete(listener);
    },
    openFile: async () => ({ ok: false, message: 'The sample screens can’t open files.' }),
  };
}

/** Edits in the sample screens go nowhere. */
async function unsaved() {
  return { ok: false as const, message: 'The sample screens don’t save changes.' };
}
