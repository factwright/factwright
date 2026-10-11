import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, RunSignal, TerminalSize } from '../shared/api.ts';
import type { RunTask } from '../shared/runs.ts';

/** Where the panel's run stands. "idle" means nothing is running. */
export type RunPhase = 'idle' | 'starting' | RunSignal;

export interface ClaudeRun {
  phase: RunPhase;
  /** Whether the panel is showing. It hides on request and comes back when Claude needs the user. */
  open: boolean;
  /** A plain-words reason, when a run couldn't start. */
  problem: string | undefined;
  /** Changes with every new run, so the panel starts each one with a fresh terminal. */
  runId: number;
  /** The skill and job the panel's latest run was started for, if a Run button started it. */
  task: RunTask | null;
  /**
   * Starts Claude, maybe with a skill to run on a job. Claude that's open and done takes the task
   * as its next message; otherwise a new run starts once the terminal knows its size.
   */
  requestStart: (task?: RunTask) => void;
  /** Takes the terminal's size: the first report starts a requested run, later ones resize it. */
  onTerminalSize: (size: TerminalSize) => void;
  stop: () => void;
  show: () => void;
  hide: () => void;
  close: () => void;
}

const START_PROBLEMS = {
  'not-ready': 'Claude Code isn’t ready. The card in the sidebar says what to do.',
  busy: 'Claude is already running.',
  failed: 'Claude Code couldn’t start.',
  'not-running': 'Claude Code has closed. Start it again.',
} as const;

/** Runs the user's Claude Code in the panel and follows its signals. */
export function useClaudeRun(api: FactwrightApi): ClaudeRun {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [runId, setRunId] = useState(0);
  const [task, setTask] = useState<RunTask | null>(null);
  // A run waiting for the terminal's size, with its task. Cleared the moment it launches, so it
  // launches once.
  const pending = useRef<{ task: RunTask | undefined } | null>(null);

  useEffect(
    () =>
      api.onClaudeSignal((signal) => {
        setPhase(signal);
        // The panel comes back whenever Claude needs the user.
        if (signal === 'needs-answer') setOpen(true);
      }),
    [api],
  );

  const startNew = useCallback((next?: RunTask) => {
    pending.current = { task: next };
    setPhase('starting');
    setRunId((id) => id + 1);
  }, []);

  const requestStart = useCallback(
    (next?: RunTask) => {
      setProblem(undefined);
      setTask(next ?? null);
      setOpen(true);
      if (!next || phase !== 'done') {
        startNew(next);
        return;
      }
      setPhase('working');
      api.runTask(next).then(
        (result) => {
          // Claude Code closed since the last signal, so start it again with the task.
          if (!result.ok) startNew(next);
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
    requestStart,
    onTerminalSize,
    stop: useCallback(() => api.stopClaude(), [api]),
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
    close: useCallback(() => {
      setOpen(false);
      setPhase('idle');
      setProblem(undefined);
    }, []),
  };
}
