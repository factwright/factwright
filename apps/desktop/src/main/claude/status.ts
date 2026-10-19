import { execFile } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import type { ClaudeStatus } from '../../shared/api.ts';
import { checkAuth } from './auth.ts';
import { claudeCommand } from './command.ts';
import { claudeInTerminal, findClaude, installedClaude, nodeFindDeps } from './find.ts';
import { launchEnv } from './launch.ts';
import { checkVersion, MIN_VERSION } from './version.ts';

/** How claudeStatus finds and runs `claude`, passed in so tests don't touch the computer. */
export interface StatusDeps {
  find: () => Promise<string | null>;
  /** Runs `claude` and resolves with what it printed, even when it exits with an error. */
  run: (claude: string, args: readonly string[]) => Promise<string>;
  /**
   * What the user types to start the claude found in a new terminal window: null when `claude`
   * alone starts it, or else its whole path.
   */
  inTerminal: (claude: string) => Promise<string | null>;
  /** What the user types to start Claude Code once its own installer has put it in place. */
  installed: () => string;
}

/**
 * Checks that the user's Claude Code is installed, new enough and signed in. Uses none of their
 * plan. When it isn't ready, it says what the user types to start it in their terminal, for the
 * commands the window shows them, when that isn't just `claude`.
 */
export async function claudeStatus(deps: StatusDeps): Promise<ClaudeStatus> {
  const claude = await deps.find();
  if (!claude) return { state: 'missing', claude: deps.installed() };
  const status = await check(claude, deps);
  if (status.state === 'ready') return status;
  const typed = await deps.inTerminal(claude);
  return typed ? { ...status, claude: typed } : status;
}

/** Whether the claude found is new enough and signed in. */
async function check(claude: string, deps: StatusDeps): Promise<ClaudeStatus> {
  const version = checkVersion(await deps.run(claude, ['--version']));
  if (version.status === 'unreadable') return { state: 'unknown' };
  if (version.status === 'too-old') {
    return { state: 'too-old', version: version.version, minimum: MIN_VERSION };
  }
  // A signed-out `claude auth status` may exit with an error, so its output is read either way.
  const auth = checkAuth(await deps.run(claude, ['auth', 'status', '--json']));
  if (auth.status === 'unreadable') return { state: 'unknown' };
  if (auth.status === 'signed-out') return { state: 'signed-out', version: version.version };
  return { state: 'ready', version: version.version, plan: auth.plan, method: auth.method };
}

const RUN_TIMEOUT_MS = 15_000;

/** StatusDeps for the computer the app runs on. */
export function nodeStatusDeps(): StatusDeps {
  const computer = nodeFindDeps();
  return {
    find: () => findClaude(computer),
    inTerminal: (claude) => claudeInTerminal(claude, computer),
    installed: () => installedClaude(computer),
    run: (claude, args) =>
      new Promise((resolve) => {
        const command = claudeCommand(claude, args, process.platform);
        // claude's own folder goes first on PATH, so anything it runs alongside it is found too.
        const path = [dirname(claude), process.env.PATH ?? ''].join(delimiter);
        execFile(
          command.file,
          command.args,
          {
            env: launchEnv(process.env, path),
            timeout: RUN_TIMEOUT_MS,
            windowsVerbatimArguments: command.verbatim,
          },
          (_error, stdout) => resolve(String(stdout)),
        );
      }),
  };
}
