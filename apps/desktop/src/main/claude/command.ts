/** A program to start and its arguments, ready for execFile or a terminal. */
export interface Command {
  file: string;
  args: string[];
  /** Pass the arguments to Windows as written, since they're already quoted for cmd.exe. */
  verbatim: boolean;
}

/**
 * How to start `claude` with these arguments. An npm install on Windows is `claude.cmd`, which
 * Windows only runs through cmd.exe. The arguments are the app's own. The one exception is a
 * company the user typed for a job search, in the prompt, which `searchCompany` keeps to plain
 * names and https links without the % or ! that cmd.exe would expand inside quotes.
 */
export function claudeCommand(claude: string, args: readonly string[], platform: string): Command {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(claude)) {
    const line = [claude, ...args].map((part) => `"${part.replaceAll('"', '""')}"`).join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { file: claude, args: [...args], verbatim: false };
}
