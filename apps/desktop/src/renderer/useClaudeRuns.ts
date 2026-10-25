import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, RunPhase, RunsView, RunView, StartProblem } from '../shared/api.ts';
import { AT_ONCE, laneOf, type RunTask } from '../shared/runs.ts';
import { BUSY } from './jobs/RunActions.tsx';
import { isBoolean, readPref, writePref } from './prefs.ts';

export interface ClaudeRuns {
  /** Every run, and every task waiting in line, in the order they were asked for: the tabs. */
  runs: readonly RunView[];
  /** How many may run at once. */
  atOnce: number;
  /** The run whose tab shows, or null when there's none. */
  selected: RunView | null;
  select: (runId: string) => void;
  /**
   * Whether Claude's work shows: the terminal the selected run's Claude Code runs in, under the bar
   * that says where it stands. A task starts with it folded away, unless the user chose to see it,
   * and it opens when only the terminal can take the user's answer.
   */
  open: boolean;
  /**
   * Starts Claude, maybe with a task to run on a job, in a run of its own, or puts the task in line
   * for its turn, and shows its tab.
   */
  start: (task?: RunTask) => void;
  stop: (runId: string) => void;
  /** Closes a run's tab, quitting its Claude Code, or taking its task out of line. */
  close: (runId: string) => void;
  /** Shows Claude's work, such as for a question only the terminal can take: a run's, or the one shown. */
  show: (runId?: string) => void;
  hide: () => void;
  /** Shows or hides Claude's work as the user asks, and keeps that for the next task. */
  showWork: (open: boolean) => void;
  /** Sends a run's Claude a reply, as if typed and sent. */
  reply: (runId: string, text: string) => void;
}

/** Where the user's choice to see Claude's work as it runs is kept. */
const SHOW_WORK = 'claude.showWork';

/** Why a run didn't start, in words to act on. */
export const START_PROBLEMS: Readonly<Record<StartProblem, string>> = {
  'not-ready': 'Claude Code isn’t ready. The card in the sidebar says what to do.',
  failed: 'Claude Code couldn’t start.',
  revision: 'This revision needs sending again. Send it from the resume’s ATS X-ray.',
  changes: 'These changes need asking for again. Use Request changes again.',
};

/** Whether Claude Code is open for a run, or about to be. */
export const isOpen = (phase: RunPhase) =>
  phase === 'starting' ||
  phase === 'ready' ||
  phase === 'working' ||
  phase === 'needs-answer' ||
  phase === 'done';

/**
 * Whether a task could start now, rather than wait in line: fewer run than may at once, and no
 * other task on its job, or the same part of the job hunt, is going or waiting.
 */
export function startsNow(view: Pick<ClaudeRuns, 'runs' | 'atOnce'>, task: RunTask): boolean {
  const lane = laneOf(task);
  const going = view.runs.filter((run) => BUSY.includes(run.phase)).length;
  const taken = view.runs.some(
    (run) => (run.phase === 'in-line' || BUSY.includes(run.phase)) && laneOf(run.task) === lane,
  );
  return going < view.atOnce && !taken;
}

const NO_RUNS: RunsView = { runs: [], atOnce: AT_ONCE.usual };

/**
 * Follows the user's Claude runs, each in a tab of Claude's panel, as the app says where each one
 * stands, and the tasks waiting their turn. Each task gets a run of its own. A start the app
 * refused shows as a tab of its own, which says Claude Code couldn't start.
 */
export function useClaudeRuns(api: FactwrightApi): ClaudeRuns {
  const [view, setView] = useState<RunsView>(NO_RUNS);
  const [refused, setRefused] = useState<RunView[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // The run the user just asked for, to show once the app says its ID.
  const asked = useRef(0);

  useEffect(() => {
    let live = true;
    let heard = false;
    const stop = api.onClaudeRuns((next) => {
      heard = true;
      if (live) setView(next);
    });
    // The runs going before the window listened, such as after it loaded again.
    api.claudeRuns().then(
      (now) => {
        if (live && !heard) setView(now);
      },
      () => {},
    );
    return () => {
      live = false;
      stop();
    };
  }, [api]);

  const runs = refused.length > 0 ? [...view.runs, ...refused] : view.runs;
  // A tab that closed hands over to the newest one left.
  const selected = runs.find((run) => run.id === chosen) ?? runs.at(-1) ?? null;

  const start = useCallback(
    (task?: RunTask) => {
      // A task runs with its work folded away, unless the user chose to see it. Claude with no
      // task waits for the user to type, which only the terminal takes.
      setOpen(task ? readPref(SHOW_WORK, false, isBoolean) : true);
      asked.current += 1;
      const ask = asked.current;
      api.startClaude(task).then(
        (runId) => {
          if (ask === asked.current) setChosen(runId);
        },
        () => {
          const id = `refused-${ask}`;
          setRefused((was) => [
            ...was,
            {
              id,
              task: task ?? null,
              phase: 'failed',
              waits: null,
              screen: null,
              startedAt: null,
              problem: 'failed',
            },
          ]);
          if (ask === asked.current) setChosen(id);
        },
      );
    },
    [api],
  );

  const close = useCallback(
    (runId: string) => {
      // The tab beside it shows next: the one after it, or before it when it was last.
      const at = runs.findIndex((run) => run.id === runId);
      const next = runs[at + 1] ?? runs[at - 1];
      if (selected?.id === runId) setChosen(next?.id ?? null);
      if (runId.startsWith('refused-')) setRefused((was) => was.filter((run) => run.id !== runId));
      else api.closeRun(runId);
      if (!next) setOpen(false);
    },
    [api, runs, selected],
  );

  return {
    runs,
    atOnce: view.atOnce,
    selected,
    select: setChosen,
    open,
    start,
    stop: useCallback((runId: string) => api.stopClaude(runId), [api]),
    close,
    show: useCallback((runId?: string) => {
      if (runId) setChosen(runId);
      setOpen(true);
    }, []),
    hide: useCallback(() => setOpen(false), []),
    showWork: useCallback((shown: boolean) => {
      setOpen(shown);
      writePref(SHOW_WORK, shown);
    }, []),
    reply: useCallback((runId: string, text: string) => api.replyToClaude(runId, text), [api]),
  };
}
