import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { RunSignal, StartResult, TerminalSize } from '../../shared/api.ts';
import { workspaceDir } from '../jobs/workspace.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { buildLaunchArgs, launchEnv } from './launch.ts';
import type { RunServer } from './run-server.ts';
import { RUN_TOKEN_VARIABLE, sessionSettings, toolsConfig } from './settings.ts';
import { RunSignals } from './signals.ts';
import { claudeStatus, nodeStatusDeps } from './status.ts';

/** How to start Claude Code for one run: its command, folder, environment and token. */
export interface Launch {
  file: string;
  /** The arguments, or on Windows one command line, as node-pty takes them. */
  args: string[] | string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The run's own token, which its hooks and tool calls carry. */
  token: string;
}

export interface LaunchOptions {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  server: Pick<RunServer, 'hookUrl' | 'toolsUrl'>;
  dark: boolean;
  /** Names the run's settings files, so runs that overlap don't share them. */
  name: string;
  prompt?: string;
}

/**
 * Finds the user's Claude Code and writes a run's settings and MCP config, ready to start it
 * locked down in the workspace. Null when Claude Code isn't installed and signed in.
 */
export async function prepareLaunch(options: LaunchOptions): Promise<Launch | null> {
  const claude = await findClaude(nodeFindDeps());
  if (!claude || (await claudeStatus(nodeStatusDeps())).state !== 'ready') return null;

  const workspace = workspaceDir(options.dataDir);
  const runDir = join(options.dataDir, 'run');
  await mkdir(workspace, { recursive: true });
  await mkdir(runDir, { recursive: true });
  const settings = join(runDir, `${options.name}-settings.json`);
  const mcpConfig = join(runDir, `${options.name}-mcp.json`);
  const hookSettings = sessionSettings({ hookUrl: options.server.hookUrl, dark: options.dark });
  await writeFile(settings, JSON.stringify(hookSettings, null, 2));
  await writeFile(mcpConfig, JSON.stringify(toolsConfig(options.server.toolsUrl), null, 2));

  const args = buildLaunchArgs({
    pluginDir: options.pluginDir,
    mcpConfig,
    settings,
    permissionMode: 'default',
    ...(options.prompt ? { prompt: options.prompt } : {}),
  });
  const command = claudeCommand(claude, args, process.platform);
  const token = randomBytes(32).toString('hex');
  const path = [dirname(claude), process.env.PATH ?? ''].join(delimiter);
  return {
    file: command.file,
    args: command.verbatim ? command.args.join(' ') : command.args,
    cwd: workspace,
    // The token reaches Claude Code's hooks and tool calls through its environment, never a file.
    env: { ...launchEnv(process.env, path), [RUN_TOKEN_VARIABLE]: token },
    token,
  };
}

/** Starts Claude Code with no terminal on screen, for the setup check. */
export const startHidden = (launch: Launch): IPty =>
  spawn(launch.file, launch.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: launch.cwd,
    env: launch.env,
  });

/** What a run needs from the app: where things live, and where its output and signals go. */
export interface SessionDeps {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  /** Hears the run's hooks and answers its calls to Factwright's tools. */
  server: RunServer;
  dark: () => boolean;
  onOutput: (data: string) => void;
  onSignal: (signal: RunSignal) => void;
}

interface Run {
  terminal: IPty;
  stopListening: () => void;
  /** Set when the user stops the run, so its exit doesn't read as a failure. */
  stopping: boolean;
}

/** The user's Claude Code, running in the panel. One run at a time. */
export class ClaudeSession {
  private readonly deps: SessionDeps;
  private run: Run | undefined;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  async start(size: TerminalSize, prompt?: string): Promise<StartResult> {
    if (this.run) return { ok: false, reason: 'busy' };
    const launch = await prepareLaunch({
      dataDir: this.deps.dataDir,
      pluginDir: this.deps.pluginDir,
      server: this.deps.server,
      dark: this.deps.dark(),
      name: 'panel',
      ...(prompt ? { prompt } : {}),
    });
    if (!launch) return { ok: false, reason: 'not-ready' };

    const signals = new RunSignals(this.deps.onSignal);
    // Listening first, so no hook can arrive before the run is ready for it.
    const stopListening = this.deps.server.listen(launch.token, (event) => signals.hear(event));
    let terminal: IPty;
    try {
      terminal = spawn(launch.file, launch.args, {
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd: launch.cwd,
        env: launch.env,
      });
    } catch (error) {
      stopListening();
      return { ok: false, reason: 'failed', message: String(error) };
    }

    const run: Run = { terminal, stopListening, stopping: false };
    this.run = run;
    terminal.onData(this.deps.onOutput);
    terminal.onExit(({ exitCode }) => {
      run.stopListening();
      this.run = undefined;
      this.deps.onSignal(run.stopping || exitCode === 0 ? 'stopped' : 'failed');
    });
    // Claude Code may first ask whether to trust the workspace, so the run stays "starting"
    // until a hook says otherwise.
    return { ok: true };
  }

  write(data: string): void {
    this.run?.terminal.write(data);
  }

  /** Types a prompt into the run that's open, and sends it, as the user would. */
  send(prompt: string): StartResult {
    const run = this.run;
    if (!run) return { ok: false, reason: 'not-running' };
    run.terminal.write(prompt);
    // Typed together, Claude Code could read the Enter as part of a paste rather than a send.
    setTimeout(() => {
      if (this.run === run) run.terminal.write('\r');
    }, 150);
    return { ok: true };
  }

  resize(size: TerminalSize): void {
    this.run?.terminal.resize(size.cols, size.rows);
  }

  stop(): void {
    if (!this.run) return;
    this.run.stopping = true;
    this.run.terminal.kill();
  }
}
