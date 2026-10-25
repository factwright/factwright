import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, RunSignal, TerminalSize } from '../shared/api.ts';
import type { RunTask } from '../shared/runs.ts';
import { isBoolean, readPref, writePref } from './prefs.ts';

/** Where the panel's run stands. "idle" means nothing is running. */
export type RunPhase = 'idle' | 'starting' | RunSignal;

export interface ClaudeRun {
  phase: RunPhase;
  /**
   * Whether Claude's work shows: the terminal Claude Code runs in, under the bar that says where
   * the run stands. A task starts with it folded away, unless the user chose to see it, and it
   * opens when only the terminal can take the user's answer.
   */
  open: boolean;
  /** A plain-words reason, when a run couldn't start. */
  problem: string | undefined;
  /** Changes with every new run, so the panel starts each one with a fresh terminal. */
  runId: number;
  /** The skill and job the panel's latest run was started for, if a Run button started it. */
  task: RunTask | null;
  /** Changes with every task started, so what's said of the last one starts over. */
  taskId: number;
  /** When the task at hand started, in milliseconds, or null before the first. */
  startedAt: number | null;
  /** Claude Code is asking whether to trust the workspace, and the user hasn't answered yet. */
  trustAsked: boolean;
  /**
   * Claude Code is showing one of its first-run screens, which it shows until someone presses
   * Enter through them once, and the user hasn't answered it yet.
   */
  firstRun: boolean;
  /**
   * The user typed into the run, which answers a question on screen, such as about trust, or a
   * first-run screen.
   */
  typed: (data: string) => void;
  /**
   * Starts Claude, maybe with a skill to run on a job. Claude that's open and done, or ready
   * with nothing to do yet, takes the task as its next message; otherwise a new run starts once
   * the terminal knows its size.
   */
  requestStart: (task?: RunTask) => void;
  /** Takes the terminal's size: the first report starts a requested run, later ones resize it. */
  onTerminalSize: (size: TerminalSize) => void;
  stop: () => void;
  /** Shows Claude's work, such as for a question only the terminal can take. */
  show: () => void;
  hide: () => void;
  /** Shows or hides Claude's work as the user asks, and keeps that for the next task. */
  showWork: (open: boolean) => void;
  /** Puts the panel away, quitting Claude Code that's done, or ready with nothing to do. */
  close: () => void;
}

/** Where the user's choice to see Claude's work as it runs is kept. */
const SHOW_WORK = 'claude.showWork';

const START_PROBLEMS = {
  'not-ready': 'Claude Code isn’t ready. The card in the sidebar says what to do.',
  busy: 'Claude is already running.',
  failed: 'Claude Code couldn’t start.',
  'not-running': 'Claude Code has closed. Start it again.',
  'new-run': 'This needs Claude to start again. Start it again.',
  revision: 'This revision needs sending again. Send it from the resume’s ATS X-ray.',
  changes: 'These changes need asking for again. Use Request changes again.',
} as const;

/** Runs the user's Claude Code in the panel and follows its signals. */
export function useClaudeRun(api: FactwrightApi): ClaudeRun {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [runId, setRunId] = useState(0);
  const [task, setTask] = useState<RunTask | null>(null);
  const [taskId, setTaskId] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [trustAsked, setTrustAsked] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  // A run waiting for the terminal's size, with its task. Cleared the moment it launches, so it
  // launches once.
  const pending = useRef<{ task: RunTask | undefined } | null>(null);
  // Set while a run closes out of sight, so its closing isn't shown: to make way for one on
  // another model, or as the user closes the panel.
  const closing = useRef(false);

  useEffect(
    () =>
      api.onClaudeSignal((signal) => {
        if (closing.current && (signal === 'stopped' || signal === 'failed')) {
          closing.current = false;
          return;
        }
        setPhase(signal);
        // Any signal means Claude Code is past its first-run screens and the question about trust.
        setTrustAsked(false);
        setFirstRun(false);
      }),
    [api],
  );

  // Claude Code waits on the user to trust the workspace, which only the terminal takes.
  useEffect(
    () =>
      api.onClaudeTrust(() => {
        setTrustAsked(true);
        // The question comes after the first-run screens.
        setFirstRun(false);
        setOpen(true);
      }),
    [api],
  );

  // And on its first-run screens, which the user presses Enter through.
  useEffect(
    () =>
      api.onClaudeFirstRun(() => {
        setFirstRun(true);
        setOpen(true);
      }),
    [api],
  );

  const startNew = useCallback((next?: RunTask) => {
    pending.current = { task: next };
    setTrustAsked(false);
    setFirstRun(false);
    setPhase('starting');
    setRunId((id) => id + 1);
  }, []);

  const requestStart = useCallback(
    (next?: RunTask) => {
      setProblem(undefined);
      setTask(next ?? null);
      setTaskId((id) => id + 1);
      setStartedAt(Date.now());
      // A task runs with its work folded away, unless the user chose to see it. Claude with no
      // task waits for the user to type, which only the terminal takes.
      setOpen(next ? readPref(SHOW_WORK, false, isBoolean) : true);
      if (!next || (phase !== 'done' && phase !== 'ready')) {
        startNew(next);
        return;
      }
      setPhase('working');
      api.runTask(next).then(
        (result) => {
          if (result.ok) return;
          // The task needs a run of its own, so this run makes way for a new one.
          if (result.reason === 'new-run') {
            closing.current = true;
            api.stopClaude();
          }
          // Otherwise Claude Code closed since the last signal: start it again with the task.
          startNew(next);
        },
        () => startNew(next),
      );
    },
    [api, phase, startNew],
  );

  const onTerminalSize = useCallback(
    (size: TerminalSize) => {
      const launch = pending.current;
      if (!launch) {
        api.resizeClaude(size);
        return;
      }
      pending.current = null;
      const fail = (reason: keyof typeof START_PROBLEMS) => {
        setPhase('idle');
        setProblem(START_PROBLEMS[reason]);
      };
      api.startClaude(size, launch.task).then(
        (result) => {
          if (!result.ok) fail(result.reason);
        },
        () => fail('failed'),
      );
    },
    [api],
  );

  return {
    phase,
    open,
    problem,
    runId,
    task,
    taskId,
    startedAt,
    requestStart,
    onTerminalSize,
    stop: useCallback(() => api.stopClaude(), [api]),
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
    showWork: useCallback((shown: boolean) => {
      setOpen(shown);
      writePref(SHOW_WORK, shown);
    }, []),
    close: useCallback(() => {
      // Claude Code that's done, or ready with nothing to do, quits as its panel goes.
      if (phase === 'done' || phase === 'ready') {
        closing.current = true;
        api.stopClaude();
      }
      setOpen(false);
      setPhase('idle');
      setProblem(undefined);
      setTrustAsked(false);
      setFirstRun(false);
    }, [api, phase]),
    trustAsked,
    firstRun,
    // Enter picks an answer, so the question about trust, or a first-run screen, is behind the
    // user. The next first-run screen, if there is one, says so again.
    typed: useCallback((data: string) => {
      if (!data.includes('\r')) return;
      setTrustAsked(false);
      setFirstRun(false);
    }, []),
  };
}
