import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { RunSignal, StartResult, TerminalSize } from '../../shared/api.ts';
import type { Effort } from '../../shared/effort.ts';
import type { FiledFacts } from '../../shared/facts.ts';
import { type PlanLevels, planLevels } from '../../shared/levels.ts';
import type { Model } from '../../shared/models.ts';
import type { RunScope } from '../../shared/runs.ts';
import type { BoundRevision } from '../jobs/revisions.ts';
import { workspaceDir } from '../jobs/workspace.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { buildLaunchArgs, launchEnv } from './launch.ts';
import { loadPermissions } from './permissions.ts';
import type { PermissionAsker, QuestionAsker, RunServer } from './run-server.ts';
import { FIRST_RUN_SCREENS, ScreenWatch, TRUST_QUESTION } from './screen.ts';
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
  /** The levels that suit the user's plan, as Claude Code reported it just before. */
  levels: PlanLevels;
  /** Which model it runs on and how hard it thinks, when it was given them. */
  model: Model | undefined;
  effort: Effort | undefined;
}

/** Which model a run uses, and how hard it thinks. */
export interface RunLevels {
  model: Model;
  effort: Effort;
}

export interface LaunchOptions {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  server: Pick<RunServer, 'hookUrl' | 'toolsUrl'>;
  dark: boolean;
  /** Names the run's settings files, so runs that overlap don't share them. */
  name: string;
  /**
   * Which model it runs on and how hard it thinks, from the levels that suit the user's plan,
   * which only the check before it starts knows. Without them, Claude Code picks.
   */
  choose?: (levels: PlanLevels) => RunLevels;
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
  const levels = planLevels(status.plan, status.method);
  const chosen = options.choose?.(levels);

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
    ...chosen,
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
    levels,
    model: chosen?.model,
    effort: chosen?.effort,
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
  /** Its model and effort, from the levels that suit the user's plan. */
  choose?: ((levels: PlanLevels) => RunLevels) | undefined;
  scope?: RunScope;
  /** The revision it's started for, which its calls to revision_findings read. */
  revision?: BoundRevision | undefined;
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
  /**
   * Claude Code is showing its first-run screens, which it does until someone presses Enter
   * through them once.
   */
  onFirstRun: () => void;
  /** The run filed facts from the user's answers, which wait for the user to verify them. */
  onFiled?: (filed: FiledFacts) => void;
  /** Asks the user Claude's questions in the app's dialog. Without it, the terminal asks them. */
  ask?: QuestionAsker;
  /** Asks the user for Claude Code's permission prompts in the app. Without it, the terminal does. */
  permit?: PermissionAsker;
  /** The name of the user's template with an ID, for a permission prompt that would replace it. */
  templateName?: (id: string) => string | null;
}

interface Run {
  terminal: IPty;
  stopListening: () => void;
  /** Set when the user stops the run, so its exit doesn't read as a failure. */
  stopping: boolean;
  /** The model it runs on, how hard it thinks, and the levels that suited the plan it runs on. */
  model: Model | undefined;
  effort: Effort | undefined;
  levels: PlanLevels;
  scope: RunScope;
  /** Watches for Claude Code's first-run screens, which the user answers one after another. */
  firstRun: ScreenWatch;
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

  /**
   * The levels that suited the user's plan at the open run's start, or undefined when none is
   * open.
   */
  levels(): PlanLevels | undefined {
    return this.run?.levels;
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
    const { prompt, choose, scope = 'hunt', revision } = options;
    const launch = await prepareLaunch({
      dataDir: this.deps.dataDir,
      pluginDir: this.deps.pluginDir,
      server: this.deps.server,
      dark: this.deps.dark(),
      name: 'panel',
      scope,
      ...(choose ? { choose } : {}),
      ...(prompt ? { prompt } : {}),
    });
    if (!launch) return { ok: false, reason: 'not-ready' };

    const signals = new RunSignals(this.deps.onSignal);
    const trust = new ScreenWatch(TRUST_QUESTION);
    const firstRun = new ScreenWatch(FIRST_RUN_SCREENS);
    let heard = false;
    const pastScreens = () => {
      heard = true;
      trust.pastIt();
      firstRun.pastIt();
    };
    // Listening first, so no hook can arrive before the run is ready for it.
    const stopListening = this.deps.server.listen(
      launch.token,
      (event) => {
        pastScreens();
        signals.hear(event);
      },
      {
        // With no prompt, no hook comes until the user types. Claude Code reaches Factwright's
        // tools once it's past its first-run screens and the question about trust, so then it's
        // waiting for them.
        ...(!prompt && {
          tools: (method: string) => {
            if (method !== 'tools/list' || heard) return;
            pastScreens();
            this.deps.onSignal('ready');
          },
        }),
        scope,
        onFiled: this.deps.onFiled,
        ask: this.deps.ask,
        permit: this.deps.permit,
        // A call the user answered in the app is one the run no longer waits on them for.
        onAnswered: (call) => signals.answered(call),
        context: { workspace: launch.cwd, templateName: this.deps.templateName },
        ...(revision && { revision }),
      },
    );
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
      model: launch.model,
      effort: launch.effort,
      levels: launch.levels,
      scope,
      firstRun,
      exited: new Promise((resolve) => {
        exited = resolve;
      }),
    };
    this.run = run;
    terminal.onData((data) => {
      this.deps.onOutput(data);
      if (firstRun.saw(data)) this.deps.onFirstRun();
      if (trust.saw(data)) this.deps.onTrust();
    });
    terminal.onExit(({ exitCode }) => {
      run.stopListening();
      if (this.run === run) this.run = undefined;
      this.deps.onSignal(run.stopping || exitCode === 0 ? 'stopped' : 'failed');
      exited();
    });
    // Claude Code may first show its first-run screens and ask whether to trust the workspace,
    // which the window explains, so the run stays "starting" until a hook says otherwise.
    return { ok: true };
  }

  write(data: string): void {
    this.run?.terminal.write(data);
    // Enter answers a first-run screen, which may bring the next.
    if (data.includes('\r')) this.run?.firstRun.answered();
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
