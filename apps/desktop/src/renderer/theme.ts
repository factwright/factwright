import {
  SYSTEM_THEME,
  TERMINAL_COLORS,
  type TerminalColors,
  type Theme,
  type ThemeChoice,
  type ThemeMode,
  themeShown,
} from '@factwright/ui';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The theme chosen. */
let chosen: ThemeChoice = SYSTEM_THEME;
const listeners = new Set<() => void>();

/** Puts a theme on the whole window. Following the system leaves it to its light or dark setting. */
export function showTheme(choice: ThemeChoice): void {
  chosen = choice;
  const root = document.documentElement;
  if (choice === SYSTEM_THEME) delete root.dataset.theme;
  else root.dataset.theme = choice;
  for (const listener of listeners) listener();
}

/** The theme the window shows now. */
export const themeNow = (): Theme => themeShown(chosen, systemDark().matches);

/** Hears when the theme the window shows changes, by choice or with the system's setting. */
export function watchTheme(listener: () => void): () => void {
  const system = systemDark();
  listeners.add(listener);
  system.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    system.removeEventListener('change', listener);
  };
}

/**
 * The colors for the terminal of a run that started in a light or a dark theme. Claude Code picks
 * its text's colors once, as it starts, so a run started in the other kind of theme keeps that
 * kind's plain colors, which its text stays readable on, rather than turn pale on pale.
 */
export function terminalColors(started: ThemeMode): TerminalColors {
  const theme = themeNow();
  return theme.mode === started ? theme.terminal : TERMINAL_COLORS[started];
}
