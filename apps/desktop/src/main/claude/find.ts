import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { claudeByPath } from '../../shared/claude-commands.ts';

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
  const path = onPath(deps).filter((each) => !inAppAliases(each, deps));
  const found = await firstFile([...path, ...installSpots(deps)], deps);
  if (found) return found;
  return deps.platform === 'win32' ? null : askLoginShell(deps);
}

/**
 * Whether a path is among Windows' app aliases, in %LOCALAPPDATA%\Microsoft\WindowsApps. An older
 * Claude Desktop puts a Claude.exe there, ahead of Claude Code on PATH, which opens the desktop
 * app. Claude Code is never there.
 */
function inAppAliases(path: string, { platform }: FindDeps): boolean {
  return platform === 'win32' && /\\microsoft\\windowsapps$/i.test(win32.dirname(path));
}

/**
 * What the user types to start the claude at `path` in a new terminal window: null when `claude`
 * alone starts it, or else its whole path. Claude Code's installer doesn't add its folder to PATH
 * on Windows, nor always on a Mac. A new PowerShell window has the PATH the app has. A new
 * Terminal window on a Mac has the login shell's, which an app opened from Finder doesn't, so the
 * shell is asked.
 */
export async function claudeInTerminal(path: string, deps: FindDeps): Promise<string | null> {
  const windows = deps.platform === 'win32';
  const { normalize } = windows ? win32 : posix;
  // Windows' paths ignore case.
  const key = (each: string) => (windows ? normalize(each).toLowerCase() : normalize(each));
  const same = (found: string | null) => found !== null && key(found) === key(path);
  if (same(await firstFile(onPath(deps), deps))) return null;
  if (!windows && same(await askLoginShell(deps))) return null;
  return claudeByPath(deps.platform, path, deps.home);
}

/**
 * What the user types to start Claude Code once its own installer has put it in place: its whole
 * path, as a new terminal window may not find it by name.
 */
export function installedClaude(deps: FindDeps): string {
  return claudeByPath(deps.platform, nativeSpot(deps), deps.home);
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

/** The first of `paths` that's a file. */
async function firstFile(paths: string[], { platform, isFile }: FindDeps): Promise<string | null> {
  const { isAbsolute } = platform === 'win32' ? win32 : posix;
  for (const path of paths) {
    // A relative path would depend on the current folder, so only absolute ones count.
    if (isAbsolute(path) && (await isFile(path))) return path;
  }
  return null;
}

/** `claude` in each PATH folder, in the order the system looks. */
function onPath({ platform, env }: FindDeps): string[] {
  if (platform === 'win32') {
    // Windows finds `claude` by trying each PATHEXT extension: claude.exe, claude.cmd and so on.
    const names = (env.PATHEXT || DEFAULT_PATHEXT)
      .split(';')
      .filter(Boolean)
      .map((extension) => `claude${extension.toLowerCase()}`);
    return (env.PATH ?? '')
      .split(win32.delimiter)
      .flatMap((folder) => names.map((name) => win32.join(folder, name)));
  }
  return (env.PATH ?? '').split(posix.delimiter).map((folder) => posix.join(folder, 'claude'));
}

/** Where Claude Code's own installer puts it. */
function nativeSpot({ platform, home }: FindDeps): string {
  return platform === 'win32'
    ? win32.join(home, '.local', 'bin', 'claude.exe')
    : posix.join(home, '.local/bin/claude');
}

/** Where Claude Code's installers put it, its own installer's first. */
function installSpots(deps: FindDeps): string[] {
  const { platform, env, home } = deps;
  if (platform === 'win32') {
    return [nativeSpot(deps), win32.join(env.APPDATA ?? '', 'npm', 'claude.cmd')];
  }
  return [
    nativeSpot(deps),
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
