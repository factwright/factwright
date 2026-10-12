import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { RunSignal, StartResult, TerminalSize } from '../../shared/api.ts';
import type { Effort } from '../../shared/effort.ts';
import type { Model } from '../../shared/models.ts';
import type { RunScope } from '../../shared/runs.ts';
import { workspaceDir } from '../jobs/workspace.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { buildLaunchArgs, launchEnv } from './launch.ts';
import { loadPermissions } from './permissions.ts';
import type { RunServer } from './run-server.ts';
import { TrustWatch } from './screen.ts';
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
  /** The user's Claude plan, such as "max", when Claude Code says. */
  plan: string | undefined;
  /** How hard it thinks, when it was given an effort. */
  effort: Effort | undefined;
}

export interface LaunchOptions {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  server: Pick<RunServer, 'hookUrl' | 'toolsUrl'>;
  dark: boolean;
  /** Names the run's settings files, so runs that overlap don't share them. */
  name: string;
  /** Which model to run on. Without one, Claude Code picks. */
  model?: Model;
  /**
   * How hard it thinks, from the user's plan, which only the check before it starts knows.
   * Without it, Claude Code's default for the model.
   */
  effort?: (plan: string | undefined) => Effort;
  /** What it may change without asking. Every run but getting started is "hunt". */
  scope?: RunScope;
  prompt?: string;
}

/**
 * Finds the user's Claude Code and writes a run's settings and MCP config, ready to start it
 * locked down in the workspace. Null when Claude Code isn't installed and signed in.
 */
export async function prepareLaunch(options: LaunchOptions): Promise<Launch | null> {
  const claude = await findClaude(nodeFindDeps());
  const status = claude ? await claudeStatus(nodeStatusDeps()) : null;
  if (!claude || status?.state !== 'ready') return null;
  const plan = status.plan;
  const effort = options.effort?.(plan);

  const workspace = workspaceDir(options.dataDir);
  const runDir = join(options.dataDir, 'run');
  await mkdir(workspace, { recursive: true });
  await mkdir(runDir, { recursive: true });
  const settings = join(runDir, `${options.name}-settings.json`);
  const mcpConfig = join(runDir, `${options.name}-mcp.json`);
  const hookSettings = sessionSettings({
    hookUrl: options.server.hookUrl,
    dark: options.dark,
    permissions: await loadPermissions(options.dataDir),
    ...(options.scope ? { scope: options.scope } : {}),
  });
  await writeFile(settings, JSON.stringify(hookSettings, null, 2));
  await writeFile(mcpConfig, JSON.stringify(toolsConfig(options.server.toolsUrl), null, 2));

  const args = buildLaunchArgs({
    pluginDir: options.pluginDir,
    mcpConfig,
    settings,
    permissionMode: 'default',
    ...(options.model ? { model: options.model } : {}),
    ...(effort ? { effort } : {}),
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
    plan,
    effort,
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

/** What a run is for: its first prompt, its model and effort, and what it may change. */
export interface RunOptions {
  prompt?: string | undefined;
  model?: Model | undefined;
  /** How hard it thinks, from the user's plan. */
  effort?: ((plan: string | undefined) => Effort) | undefined;
  scope?: RunScope;
}

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
  /** Claude Code is asking whether to trust the workspace, which it does once. */
  onTrust: () => void;
}

interface Run {
  terminal: IPty;
  stopListening: () => void;
  /** Set when the user stops the run, so its exit doesn't read as a failure. */
  stopping: boolean;
  /** The model it runs on, how hard it thinks, and the plan it runs on. */
  model: Model | undefined;
  effort: Effort | undefined;
  plan: string | undefined;
  scope: RunScope;
  /** Settles once it has exited. */
  exited: Promise<void>;
}

/** The user's Claude Code, running in the panel. One run at a time. */
export class ClaudeSession {
  private readonly deps: SessionDeps;
  private run: Run | undefined;
  private starting = false;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  /** Whether a run is starting or going. */
  busy(): boolean {
    return this.starting || this.run !== undefined;
  }

  /** The model the open run is on, or undefined when none is open. */
  model(): Model | undefined {
    return this.run?.model;
  }

  /** How hard the open run thinks, or undefined when none is open. */
  effort(): Effort | undefined {
    return this.run?.effort;
  }

  /** The user's Claude plan, as of the open run's start, or undefined when none is open. */
  plan(): string | undefined {
    return this.run?.plan;
  }

  /** What the open run may change without asking, or undefined when none is open. */
  scope(): RunScope | undefined {
    return this.run?.scope;
  }

  /** Starts a run, once one that's stopping has closed, such as to change models. */
  async start(size: TerminalSize, options: RunOptions = {}): Promise<StartResult> {
    if (this.run?.stopping) await this.run.exited;
    if (this.busy()) return { ok: false, reason: 'busy' };
    this.starting = true;
    try {
      return await this.launch(size, options);
    } finally {
      this.starting = false;
    }
  }

  private async launch(size: TerminalSize, options: RunOptions): Promise<StartResult> {
    const { prompt, model, effort, scope = 'hunt' } = options;
    const launch = await prepareLaunch({
      dataDir: this.deps.dataDir,
      pluginDir: this.deps.pluginDir,
      server: this.deps.server,
      dark: this.deps.dark(),
      name: 'panel',
      scope,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(prompt ? { prompt } : {}),
    });
    if (!launch) return { ok: false, reason: 'not-ready' };

    const signals = new RunSignals(this.deps.onSignal);
    const trust = new TrustWatch();
    // Listening first, so no hook can arrive before the run is ready for it.
    const stopListening = this.deps.server.listen(launch.token, (event) => {
      trust.pastIt();
      signals.hear(event);
    });
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

    let exited = () => {};
    const run: Run = {
      terminal,
      stopListening,
      stopping: false,
      model,
      effort: launch.effort,
      plan: launch.plan,
      scope,
      exited: new Promise((resolve) => {
        exited = resolve;
      }),
    };
    this.run = run;
    terminal.onData((data) => {
      this.deps.onOutput(data);
      if (trust.saw(data)) this.deps.onTrust();
    });
    terminal.onExit(({ exitCode }) => {
      run.stopListening();
      if (this.run === run) this.run = undefined;
      this.deps.onSignal(run.stopping || exitCode === 0 ? 'stopped' : 'failed');
      exited();
    });
    // Claude Code may first ask whether to trust the workspace, which the window explains, so
    // the run stays "starting" until a hook says otherwise.
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
