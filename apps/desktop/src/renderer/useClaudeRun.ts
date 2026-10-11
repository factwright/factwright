import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, RunSignal, TerminalSize } from '../shared/api.ts';

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
  /** Opens the panel for a new run. It starts once the terminal knows its size. */
  requestStart: () => void;
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
} as const;

/** Runs the user's Claude Code in the panel and follows its signals. */
export function useClaudeRun(api: FactwrightApi): ClaudeRun {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [runId, setRunId] = useState(0);
  // A run waiting for the terminal's size. Cleared the moment it launches, so it launches once.
  const pending = useRef(false);

  useEffect(
    () =>
      api.onClaudeSignal((signal) => {
        setPhase(signal);
        // The panel comes back whenever Claude needs the user.
        if (signal === 'needs-answer') setOpen(true);
      }),
    [api],
  );

  const requestStart = useCallback(() => {
    pending.current = true;
    setProblem(undefined);
    setPhase('starting');
    setOpen(true);
    setRunId((id) => id + 1);
  }, []);

  const onTerminalSize = useCallback(
    (size: TerminalSize) => {
      if (!pending.current) {
        api.resizeClaude(size);
        return;
      }
      pending.current = false;
      const fail = (reason: keyof typeof START_PROBLEMS) => {
        setPhase('idle');
        setProblem(START_PROBLEMS[reason]);
      };
      api.startClaude(size).then(
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
