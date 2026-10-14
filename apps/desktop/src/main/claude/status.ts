import { execFile } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import type { ClaudeStatus } from '../../shared/api.ts';
import { checkAuth } from './auth.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { launchEnv } from './launch.ts';
import { checkVersion, MIN_VERSION } from './version.ts';

/** How claudeStatus finds and runs `claude`, passed in so tests don't touch the computer. */
export interface StatusDeps {
  find: () => Promise<string | null>;
  /** Runs `claude` and resolves with what it printed, even when it exits with an error. */
  run: (claude: string, args: readonly string[]) => Promise<string>;
}

/** Checks that the user's Claude Code is installed, new enough and signed in. Uses none of their plan. */
export async function claudeStatus(deps: StatusDeps): Promise<ClaudeStatus> {
  const claude = await deps.find();
  if (!claude) return { state: 'missing' };
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
  return {
    find: () => findClaude(nodeFindDeps()),
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
