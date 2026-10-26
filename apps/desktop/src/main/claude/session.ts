import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { RunStep, TurnEnd } from '../../shared/activity.ts';
import type { RunSignal, TerminalSize } from '../../shared/api.ts';
import type { Effort } from '../../shared/effort.ts';
import type { FiledFacts } from '../../shared/facts.ts';
import { type PlanLevels, planLevels } from '../../shared/levels.ts';
import type { Model } from '../../shared/models.ts';
import type { RunChanges as RunChangesView } from '../../shared/run-changes.ts';
import type { RunScope } from '../../shared/runs.ts';
import type { BoundRevision } from '../jobs/revisions.ts';
import type { BoundChanges } from '../jobs/versions.ts';
import { workspaceDir } from '../jobs/workspace.ts';
import { asksNothing, asksNothingAfter, permitsNothing } from '../policy.ts';
import { RunActivity, turnEnd } from './activity.ts';
import { claudeCommand } from './command.ts';
import { findClaude, nodeFindDeps } from './find.ts';
import { buildLaunchArgs, launchEnv } from './launch.ts';
import { keepBefore, type TaskChanges } from './run-changes.ts';
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
  /** The settings and MCP config written for it, which no other run uses. */
  files: string[];
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
  server: Pick<RunServer, 'hookUrl' | 'activityUrl' | 'toolsUrl'>;
  dark: boolean;
  /** Names the run's settings files, so runs side by side don't share them. */
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
    activityUrl: options.server.activityUrl,
    dark: options.dark,
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
    files: [settings, mcpConfig],
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
  /** The changes the user asked for, which its calls to requested_changes read. */
  changes?: BoundChanges | undefined;
  /** The jobs it analyzes, by their IDs, which its tool calls know as its own. */
  jobs?: readonly string[] | undefined;
}

/** What a run needs from the app: where things live, and who answers what it asks the user. */
export interface RunDeps {
  /** The app's own data folder, which holds the workspace and each run's settings. */
  dataDir: string;
  pluginDir: string;
  /** Hears the run's hooks and answers its calls to Factwright's tools. */
  server: RunServer;
  dark: () => boolean;
  /** Asks the user Claude's questions in the app's dialog. Without it, the terminal asks them. */
  ask?: QuestionAsker;
  /** Asks the user for Claude Code's permission prompts in the app. Without it, the terminal does. */
  permit?: PermissionAsker;
  /** The name of the user's template with an ID, for a permission prompt that would replace it. */
  templateName?: (id: string) => string | null;
  /**
   * What the run's task changes in the workspace, with a copy of each file from before, for Undo:
   * Claude's own edits, heard before they happen, and what Factwright's tools write.
   */
  changes?: TaskChanges;
}

/**
 * A screen of Claude Code's own, which only its terminal answers: its first-run screens, which it
 * shows until someone presses Enter through them once, or its question about trusting the
 * workspace, which it asks once.
 */
export type RunScreen = 'first-run' | 'trust';

/** What a run tells the app as it goes. */
export interface RunEvents {
  output: (data: string) => void;
  /** Where it stands, from Claude Code's hooks. */
  signal: (signal: RunSignal) => void;
  /** A screen of Claude Code's own it shows now, or null once the user answered it. */
  screen: (screen: RunScreen | null) => void;
  /** Claude Code is past its first-run screens and the question about trust. */
  past: () => void;
  /** What Claude does, a tool call at a time, as it starts and once it's done. */
  step?: (step: RunStep) => void;
  /** How each turn ends: what Claude said last, or the error that ended it. */
  turnEnd?: (end: TurnEnd) => void;
  /** It filed facts from the user's answers, which wait for the user to verify them. */
  filed?: (filed: FiledFacts) => void;
  /** What its task changed: nothing as it starts, then once each turn of it ends. */
  changes?: (changes: RunChangesView) => void;
  /** It finished analyzing one of its task's jobs, by the job's ID. */
  analyzed?: (jobId: string) => void;
  /** It closed: stopped, by the user or as Claude Code quit, or failed. */
  exit: (signal: 'stopped' | 'failed') => void;
}

/** One run of the user's Claude Code, in a terminal of its own. */
export interface OpenRun {
  /** Sends what the user types. */
  write: (data: string) => void;
  /** Types a prompt and sends it, as the user would. */
  send: (prompt: string) => void;
  resize: (size: TerminalSize) => void;
  stop: () => void;
  /** Whether it has work going: starting, working, or waiting on the user. */
  hasWork: () => boolean;
  /** Settles once it has exited. */
  exited: Promise<void>;
}

/**
 * Starts one run of the user's Claude Code, locked down in the workspace, with its own token,
 * signals and settings files, named for it, so runs side by side share none of them. Says why
 * not when Claude Code isn't ready, or wouldn't start.
 */
export async function openRun(
  name: string,
  size: TerminalSize,
  options: RunOptions,
  deps: RunDeps,
  events: RunEvents,
): Promise<OpenRun | 'not-ready' | 'failed'> {
  const { prompt, choose, scope = 'hunt', revision, changes, jobs } = options;
  const launch = await prepareLaunch({
    dataDir: deps.dataDir,
    pluginDir: deps.pluginDir,
    server: deps.server,
    dark: deps.dark(),
    name,
    scope,
    ...(choose ? { choose } : {}),
    ...(prompt ? { prompt } : {}),
  });
  if (!launch) return 'not-ready';

  const signals = new RunSignals(events.signal);
  const kept = deps.changes;
  const tellChanges = (view: RunChangesView | null | undefined) => {
    if (view) events.changes?.(view);
  };
  tellChanges(kept?.begin());
  const activity = events.step && new RunActivity(events.step, launch.cwd);
  const trust = new ScreenWatch(TRUST_QUESTION);
  const firstRun = new ScreenWatch(FIRST_RUN_SCREENS);
  let heard = false;
  // A quick resume asks the user nothing, so from its prompt, the app's or one the user typed,
  // until the next prompt, Claude's questions are turned away. Analyzing several jobs turns away
  // Claude Code's permission prompts too.
  const quiet = { reason: asksNothing(prompt), permits: permitsNothing(prompt) };
  const pastScreens = () => {
    if (!heard) events.past();
    heard = true;
    trust.pastIt();
    firstRun.pastIt();
  };
  // Listening first, so no hook can arrive before the run is ready for it.
  const stopListening = deps.server.listen(
    launch.token,
    (event) => {
      pastScreens();
      quiet.reason = asksNothingAfter(quiet.reason, event);
      quiet.permits = asksNothingAfter(quiet.permits, event, permitsNothing);
      const hadWork = signals.hasWork();
      signals.hear(event);
      activity?.hear(event);
      const end = turnEnd(event);
      if (end) events.turnEnd?.(end);
      // What the task changed settles once a turn ends, and once the run reads as done without
      // a Stop hook, as when the user interrupts it, which Claude Code runs none for.
      if (end || (hadWork && !signals.hasWork())) tellChanges(kept?.settle());
    },
    {
      ...(activity && { activity: (event: unknown) => activity.started(event) }),
      // Each file Claude is about to change, and each one Factwright's tools are, is kept as it
      // was first, and each page they read is noted, for the task's card.
      ...(kept && {
        before: (event: unknown) => keepBefore(kept, event),
        keep: (path: string) => kept.keep(path),
        read: (url: string) => kept.read(url),
      }),
      // With no prompt, no hook comes until the user types. Claude Code reaches Factwright's
      // tools once it's past its first-run screens and the question about trust, so then it's
      // waiting for them.
      tools: (method: string) => {
        if (method !== 'tools/list' || heard) return;
        pastScreens();
        if (!prompt) signals.ready();
      },
      scope,
      onFiled: events.filed,
      ask: deps.ask,
      noQuestions: () => quiet.reason,
      noPermits: () => quiet.permits,
      permit: deps.permit,
      // A call the user answered in the app is one the run no longer waits on them for.
      onAnswered: (call) => signals.answered(call),
      context: { workspace: launch.cwd, templateName: deps.templateName },
      ...(revision && { revision }),
      ...(changes && { changes }),
      ...(jobs && { jobs }),
      ...(events.analyzed && { analyzed: events.analyzed }),
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
  } catch {
    stopListening();
    kept?.end();
    return 'failed';
  }

  let stopping = false;
  let closed = false;
  let exited = () => {};
  const done = new Promise<void>((resolve) => {
    exited = resolve;
  });
  terminal.onData((data) => {
    events.output(data);
    if (firstRun.saw(data)) events.screen('first-run');
    if (trust.saw(data)) events.screen('trust');
  });
  terminal.onExit(({ exitCode }) => {
    closed = true;
    stopListening();
    tellChanges(kept?.settle());
    kept?.end();
    // Its settings were for it alone: the next run of the same name writes its own.
    void Promise.all(launch.files.map((file) => rm(file, { force: true }))).catch(() => {});
    events.exit(stopping || exitCode === 0 ? 'stopped' : 'failed');
    exited();
  });
  // Claude Code may first show its first-run screens and ask whether to trust the workspace,
  // which the window explains, so the run stays "starting" until a hook says otherwise.
  return {
    write: (data) => {
      if (closed) return;
      terminal.write(data);
      // Enter answers a screen of Claude Code's own, which may bring the next.
      if (data.includes('\r') && !heard) {
        firstRun.answered();
        events.screen(null);
      }
    },
    send: (text) => {
      if (closed) return;
      // A prompt the user sends starts another task, which asks nothing only if it's a quick
      // resume's, as its hook says too.
      signals.prompted();
      terminal.write(text);
      // Typed together, Claude Code could read the Enter as part of a paste rather than a send.
      setTimeout(() => {
        if (!closed) terminal.write('\r');
      }, 150);
    },
    resize: (next) => {
      if (!closed) terminal.resize(next.cols, next.rows);
    },
    stop: () => {
      if (closed) return;
      stopping = true;
      terminal.kill();
    },
    hasWork: () => !closed && signals.hasWork(),
    exited: done,
  };
}
