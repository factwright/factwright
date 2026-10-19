/**
 * Claude Code's commands, written for the user to run in their own terminal: PowerShell on
 * Windows, or Terminal on a Mac. Factwright shows them, and never runs them itself.
 */

/** Where Anthropic's guide shows how to add Claude Code to PATH, so `claude` alone starts it. */
export const PATH_GUIDE = 'https://code.claude.com/docs/en/troubleshoot-install#verify-your-path';

/** Text in single quotes for a Mac or Linux shell, which take everything in them as it is. */
const shellQuoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** Text in single quotes for PowerShell, which takes curly single quotes as quotes too. */
const powerShellQuoted = (text: string) => `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;

/**
 * What the user types to start the Claude Code at `path` by its whole path, for a terminal that
 * doesn't find `claude` by name. In their home folder, the shell fills that part in, so it reads
 * as Anthropic's guide writes it, such as ~/.local/bin/claude. PowerShell runs a quoted path only
 * after &, its call operator.
 */
export function claudeByPath(platform: string, path: string, home: string): string {
  const windows = platform === 'win32';
  const separator = windows ? '\\' : '/';
  const base = home.endsWith(separator) ? home : `${home}${separator}`;
  const start = path.slice(0, base.length);
  // Windows' paths ignore case.
  const inHome = windows ? start.toLowerCase() === base.toLowerCase() : start === base;
  const rest = inHome ? path.slice(base.length) : '';
  // Only plain names follow the home folder's, which need no quoting there.
  if (windows) {
    return /^[\w .\\-]+$/.test(rest)
      ? `& "$env:USERPROFILE\\${rest}"`
      : `& ${powerShellQuoted(path)}`;
  }
  return /^[\w./-]+$/.test(rest) ? `~/${rest}` : shellQuoted(path);
}

/**
 * The command that signs Claude Code in, for the user to run in their terminal, where `claude` is
 * what they type to start it: with a profile's own Claude Code folder, when it has one. On a Mac
 * the folder holds for that one command. PowerShell would keep it for the rest of the window,
 * where someone signing in to another profile next would sign in to this one, so the command puts
 * it back as it was, even when stopped with Ctrl+C.
 */
export function signInCommand(platform: string, folder: string | null, claude: string): string {
  const login = `${claude} auth login`;
  if (!folder) return login;
  return platform === 'win32'
    ? `$saved = $env:CLAUDE_CONFIG_DIR; try { $env:CLAUDE_CONFIG_DIR = ${powerShellQuoted(folder)}; ${login} } finally { $env:CLAUDE_CONFIG_DIR = $saved }`
    : `CLAUDE_CONFIG_DIR=${shellQuoted(folder)} ${login}`;
}
