import { FONTS, TERMINAL_COLORS } from '@factwright/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { FactwrightApi, TerminalSize } from '../shared/api.ts';
import styles from './ClaudePanel.module.css';
import { pastedPictures, readPictures } from './jobs/Screenshots.tsx';

/**
 * The terminal Claude Code runs in. It shows Claude's output, sends what the user types, follows
 * the system's light or dark setting, and reports its size in characters whenever it changes.
 * A picture pasted into it is saved where Claude can read it, with the run's job, and pasted as
 * where it is, which Claude Code takes as the picture itself.
 */
export function TerminalView({
  api,
  onSize,
  onTyped,
  jobId = null,
  onPasteProblem,
  attention = false,
  shown = true,
}: {
  api: FactwrightApi;
  onSize: (size: TerminalSize) => void;
  /** Hears what the user types, after it's sent to Claude Code. */
  onTyped?: (data: string) => void;
  /** The job the run is for, which a pasted picture is kept with. */
  jobId?: string | null;
  /** Hears why a pasted picture couldn't be kept, or null once one is. */
  onPasteProblem?: (message: string | null) => void;
  /** Whether Claude Code waits on an answer only the terminal takes, which outlines it. */
  attention?: boolean;
  /** Whether it shows, rather than folded away, which it can only take the keyboard while it does. */
  shown?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latestOnSize = useRef(onSize);
  const latestOnTyped = useRef(onTyped);
  const latestJob = useRef(jobId);
  const latestOnProblem = useRef(onPasteProblem);
  const view = useRef<Terminal | null>(null);
  useEffect(() => {
    latestOnSize.current = onSize;
    latestOnTyped.current = onTyped;
    latestJob.current = jobId;
    latestOnProblem.current = onPasteProblem;
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const colors = () => (dark.matches ? TERMINAL_COLORS.dark : TERMINAL_COLORS.light);
    const terminal = new Terminal({
      fontFamily: FONTS.mono,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: colors(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    view.current = terminal;

    // A hidden panel has no size, so it keeps its last one until it shows again.
    const fitAndReport = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      fit.fit();
      latestOnSize.current({ cols: terminal.cols, rows: terminal.rows });
    };
    const resizes = new ResizeObserver(fitAndReport);
    resizes.observe(element);
    const followTheme = () => {
      terminal.options.theme = colors();
    };
    dark.addEventListener('change', followTheme);

    const typing = terminal.onData((data) => {
      api.writeToClaude(data);
      latestOnTyped.current?.(data);
    });
    const stopOutput = api.onClaudeOutput((data) => terminal.write(data));

    // Caught before the terminal's own paste, which takes only text.
    const pastePicture = (event: ClipboardEvent) => {
      const files = pastedPictures(event);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void readPictures(files).then(async (pictures) => {
        for (const picture of pictures) {
          const saved = await api.pasteImage(
            { name: picture.name, bytes: picture.bytes },
            latestJob.current,
          );
          latestOnProblem.current?.(saved.ok ? null : saved.message);
          if (saved.ok) terminal.paste(`"${saved.file}" `);
        }
      });
    };
    element.addEventListener('paste', pastePicture, true);
    const stopSignals = api.onClaudeSignal((signal) => {
      if (signal === 'needs-answer') terminal.focus();
    });
    terminal.focus();

    return () => {
      element.removeEventListener('paste', pastePicture, true);
      stopSignals();
      stopOutput();
      typing.dispose();
      dark.removeEventListener('change', followTheme);
      resizes.disconnect();
      view.current = null;
      terminal.dispose();
    };
  }, [api]);

  // Shown for the user's answer, it takes the keyboard, as it can't while it's folded away.
  useEffect(() => {
    if (shown && attention) view.current?.focus();
  }, [shown, attention]);

  return (
    <div ref={container} className={`${styles.terminal} ${attention ? styles.attention : ''}`} />
  );
}
