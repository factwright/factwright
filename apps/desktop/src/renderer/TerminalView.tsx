import { FONTS } from '@factwright/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import { LONG_TEXT } from '../shared/pasted.ts';
import styles from './ClaudePanel.module.css';
import { pastedPictures, readPictures } from './jobs/Screenshots.tsx';
import { terminalColors, themeNow, watchTheme } from './theme.ts';

/**
 * The terminal one run's Claude Code runs in. It shows that run's output, sends what the user
 * types to it, follows the theme, and reports its size in characters whenever it changes. A picture pasted into it is saved where Claude can read it, with the run's
 * job, and pasted as where it is, which Claude Code takes as the picture itself. Long text pasted
 * into it is kept in a file for Claude to read whole, and pasted as words that say where.
 */
export function TerminalView({
  api,
  runId,
  jobId = null,
  onPasteProblem,
  attention = false,
  shown = true,
}: {
  api: FactwrightApi;
  /** The run it's the terminal of. */
  runId: string;
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
  const latestJob = useRef(jobId);
  const latestOnProblem = useRef(onPasteProblem);
  const latestShown = useRef(shown);
  const view = useRef<Terminal | null>(null);
  useEffect(() => {
    latestJob.current = jobId;
    latestOnProblem.current = onPasteProblem;
    latestShown.current = shown;
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const started = themeNow().mode;
    const terminal = new Terminal({
      fontFamily: FONTS.mono,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalColors(started),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    view.current = terminal;

    // A hidden panel has no size, so it keeps its last one until it shows again.
    const fitAndReport = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      fit.fit();
      api.resizeClaude(runId, { cols: terminal.cols, rows: terminal.rows });
    };
    const resizes = new ResizeObserver(fitAndReport);
    resizes.observe(element);
    const stopFollowing = watchTheme(() => {
      terminal.options.theme = terminalColors(started);
    });

    // What the user types goes to Claude Code in order. While long text they pasted is being kept,
    // what they type after it, Enter included, waits its turn behind the words that say where.
    let waiting: Promise<void> | null = null;
    const send = (data: string | Promise<string>) => {
      if (waiting === null && typeof data === 'string') {
        api.writeToClaude(runId, data);
        return;
      }
      const next = (waiting ?? Promise.resolve()).then(async () => {
        api.writeToClaude(runId, await data);
      });
      waiting = next;
      void next.then(() => {
        if (waiting === next) waiting = null;
      });
    };
    /** Text as the terminal's own paste sends it: lines end with Enter, marked as a paste. */
    const asPasted = (text: string) => {
      const lines = text.replace(/\r?\n/g, '\r');
      return terminal.modes.bracketedPasteMode ? `\x1b[200~${lines}\x1b[201~` : lines;
    };

    const typing = terminal.onData(send);
    const stopOutput = api.onClaudeOutput((output) => {
      if (output.runId === runId) terminal.write(output.data);
    });

    // Caught before the terminal's own paste, which takes only text, and hands it to Claude Code
    // in one go. On Windows, Claude Code can lose part of long text that comes in at once, without
    // a word, so long text goes to Claude in a file, and what's pasted says where.
    const paste = (event: ClipboardEvent) => {
      const files = pastedPictures(event);
      if (files.length === 0) {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (text.trim().length <= LONG_TEXT) return;
        event.preventDefault();
        event.stopPropagation();
        send(
          api
            .pasteText(runId, text)
            .catch(() => ({ ok: false as const }))
            .then((kept) => asPasted(kept.ok ? kept.words : text)),
        );
        return;
      }
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
    element.addEventListener('paste', paste, true);
    // A run that opens in view takes the keyboard, for what the user types.
    if (latestShown.current) terminal.focus();

    return () => {
      element.removeEventListener('paste', paste, true);
      stopOutput();
      typing.dispose();
      stopFollowing();
      resizes.disconnect();
      view.current = null;
      terminal.dispose();
    };
  }, [api, runId]);

  // Shown for the user's answer, it takes the keyboard, as it can't while it's folded away or in
  // another tab.
  useEffect(() => {
    if (shown && attention) view.current?.focus();
  }, [shown, attention]);

  return (
    <div ref={container} className={`${styles.terminal} ${attention ? styles.attention : ''}`} />
  );
}
