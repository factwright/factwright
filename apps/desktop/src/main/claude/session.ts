import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { RunSignal, StartResult, TerminalSize } from '../../shared/api.ts';
import { workspaceDir } from '../jobs/workspace.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { buildLaunchArgs, launchEnv } from './launch.ts';
import { EMPTY_MCP_CONFIG, HOOK_TOKEN_VARIABLE, sessionSettings } from './settings.ts';
import type { SignalServer } from './signals.ts';
import { claudeStatus, nodeStatusDeps } from './status.ts';

/** What a run needs from the app: where things live, and where its output and signals go. */
export interface SessionDeps {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  signals: SignalServer;
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
    const claude = await findClaude(nodeFindDeps());
    if (!claude || (await claudeStatus(nodeStatusDeps())).state !== 'ready') {
      return { ok: false, reason: 'not-ready' };
    }

    const workspace = workspaceDir(this.deps.dataDir);
    const runDir = join(this.deps.dataDir, 'run');
    await mkdir(workspace, { recursive: true });
    await mkdir(runDir, { recursive: true });
    const settings = join(runDir, 'settings.json');
    const mcpConfig = join(runDir, 'mcp.json');
    const hookSettings = sessionSettings({
      hookUrl: this.deps.signals.url,
      dark: this.deps.dark(),
    });
    await writeFile(settings, JSON.stringify(hookSettings, null, 2));
    await writeFile(mcpConfig, JSON.stringify(EMPTY_MCP_CONFIG));

    const args = buildLaunchArgs({
      pluginDir: this.deps.pluginDir,
      mcpConfig,
      settings,
      permissionMode: 'default',
      ...(prompt ? { prompt } : {}),
    });
    const command = claudeCommand(claude, args, process.platform);
    const token = randomBytes(32).toString('hex');
    const path = [dirname(claude), process.env.PATH ?? ''].join(delimiter);

    let terminal: IPty;
    try {
      terminal = spawn(command.file, command.verbatim ? command.args.join(' ') : command.args, {
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd: workspace,
        // The token reaches Claude Code's hooks through its environment, never a file.
        env: { ...launchEnv(process.env, path), [HOOK_TOKEN_VARIABLE]: token },
      });
    } catch (error) {
      return { ok: false, reason: 'failed', message: String(error) };
    }

    const run: Run = {
      terminal,
      stopListening: this.deps.signals.listen(token, this.deps.onSignal),
      stopping: false,
    };
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

  resize(size: TerminalSize): void {
    this.run?.terminal.resize(size.cols, size.rows);
  }

  stop(): void {
    if (!this.run) return;
    this.run.stopping = true;
    this.run.terminal.kill();
  }
}
