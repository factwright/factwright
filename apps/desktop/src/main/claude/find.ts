import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';

/** What findClaude needs from the computer, passed in so tests run the same on any OS. */
export interface FindDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  isFile: (path: string) => Promise<boolean>;
  /** Runs the shell with these arguments and resolves with what it prints, or rejects. */
  runShell: (shell: string, args: readonly string[]) => Promise<string>;
}

// What Windows itself uses when PATHEXT isn't set.
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const SHELL_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

/**
 * Finds the user's `claude`: on PATH, then where its installers put it, then through the login
 * shell. An app opened from Finder or the Start menu doesn't get the PATH a terminal has.
 */
export async function findClaude(deps: FindDeps): Promise<string | null> {
  const { isAbsolute } = deps.platform === 'win32' ? win32 : posix;
  for (const path of candidates(deps)) {
    // A relative path would depend on the current folder, so only absolute ones count.
    if (isAbsolute(path) && (await deps.isFile(path))) return path;
  }
  return deps.platform === 'win32' ? null : askLoginShell(deps);
}

/** FindDeps for the computer the app runs on, from Node's own modules. */
export function nodeFindDeps(): FindDeps {
  return {
    platform: process.platform,
    // process.env itself, not a copy: on Windows it ignores case, so PATH also finds Path.
    env: process.env,
    home: homedir(),
    isFile: async (path) => {
      const stats = await stat(path).catch(() => null);
      return stats?.isFile() ?? false;
    },
    runShell: async (shell, args) => {
      // Interactive shells ignore SIGTERM, so one that runs too long is killed outright.
      const { stdout } = await execFileAsync(shell, args, {
        timeout: SHELL_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      return stdout;
    },
  };
}

/** Each PATH folder, then where Claude Code's installers put it. */
function candidates({ platform, env, home }: FindDeps): string[] {
  if (platform === 'win32') {
    // Windows finds `claude` by trying each PATHEXT extension: claude.exe, claude.cmd and so on.
    const names = (env.PATHEXT || DEFAULT_PATHEXT)
      .split(';')
      .filter(Boolean)
      .map((extension) => `claude${extension.toLowerCase()}`);
    const onPath = (env.PATH ?? '')
      .split(win32.delimiter)
      .flatMap((folder) => names.map((name) => win32.join(folder, name)));
    return [
      ...onPath,
      win32.join(home, '.local', 'bin', 'claude.exe'),
      win32.join(env.APPDATA ?? '', 'npm', 'claude.cmd'),
    ];
  }
  const onPath = (env.PATH ?? '')
    .split(posix.delimiter)
    .map((folder) => posix.join(folder, 'claude'));
  return [
    ...onPath,
    posix.join(home, '.local/bin/claude'),
    posix.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    posix.join(home, '.npm-global/bin/claude'),
  ];
}

/** Asks the user's login shell, which has the PATH their terminal has. */
async function askLoginShell({ env, isFile, runShell }: FindDeps): Promise<string | null> {
  const shell = env.SHELL || '/bin/zsh';
  const output = await runShell(shell, ['-ilc', 'command -v claude']).catch(() => '');
  // Startup files can print banners first, so only the last line that's an absolute path counts.
  const lines = output.split('\n').map((line) => line.trim());
  const path = lines.filter((line) => posix.isAbsolute(line)).at(-1);
  return path !== undefined && (await isFile(path)) ? path : null;
}
