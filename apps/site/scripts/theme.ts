import { themeCss } from '@factwright/ui/theme';
import { TERMINAL_COLORS } from '@factwright/ui/tokens';

/**
 * The colors Claude Code shows in Claude's panel, in the roles it gives them: main and secondary
 * text, the bar behind the user's message, done marks, and the picked answer.
 */
function terminalRoles(mode: 'light' | 'dark'): string {
  const colors = TERMINAL_COLORS[mode];
  const [main, dim, bar] =
    mode === 'dark'
      ? [colors.brightWhite, colors.white, colors.brightBlack]
      : [colors.black, colors.brightBlack, colors.white];
  return `--term-main: ${main}; --term-dim: ${dim}; --term-bar: ${bar}; --term-ok: ${colors.green}; --term-pick: ${colors.blue};`;
}

/**
 * The design system's theme, as the app has it, plus the terminal's roles: every color, font
 * and size the site uses, in light and dark.
 */
export function siteThemeCss(): string {
  return [
    themeCss(),
    `:root, [data-theme="light"] { ${terminalRoles('light')} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${terminalRoles('dark')} } }`,
    `[data-theme="dark"] { ${terminalRoles('dark')} }`,
  ].join('\n');
}
