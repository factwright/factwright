import { FONTS, TERMINAL_COLORS } from '@factwright/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { FactwrightApi, TerminalSize } from '../shared/api.ts';
import styles from './ClaudePanel.module.css';

/**
 * The terminal Claude Code runs in. It shows Claude's output, sends what the user types, follows
 * the system's light or dark setting, and reports its size in characters whenever it changes.
 */
export function TerminalView({
  api,
  onSize,
  onTyped,
}: {
  api: FactwrightApi;
  onSize: (size: TerminalSize) => void;
  /** Hears what the user types, after it's sent to Claude Code. */
  onTyped?: (data: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latestOnSize = useRef(onSize);
  const latestOnTyped = useRef(onTyped);
  useEffect(() => {
    latestOnSize.current = onSize;
    latestOnTyped.current = onTyped;
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
    const stopSignals = api.onClaudeSignal((signal) => {
      if (signal === 'needs-answer') terminal.focus();
    });
    terminal.focus();

    return () => {
      stopSignals();
      stopOutput();
      typing.dispose();
      dark.removeEventListener('change', followTheme);
      resizes.disconnect();
      terminal.dispose();
    };
  }, [api]);

  return <div ref={container} className={styles.terminal} />;
}
