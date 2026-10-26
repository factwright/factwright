import { join } from 'node:path';
import { EFFORTS, type Effort } from '../../shared/effort.ts';
import { MODELS, type Model } from '../../shared/models.ts';

/** The rules every run follows, whichever skill is working, appended to Claude's instructions. */
export const STANDING_RULES = 'standing-rules.md';

/** The only permission modes the app launches Claude Code with. */
export const PERMISSION_MODES = ['default', 'acceptEdits'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * Paths to Factwright's plugin, MCP config and settings, the permission mode, the model, how hard
 * it thinks, and a prompt.
 */
export interface LaunchOptions {
  pluginDir: string;
  mcpConfig: string;
  settings: string;
  permissionMode: PermissionMode;
  /** Which model to run on. Without one, Claude Code picks. */
  model?: Model;
  /** How hard it thinks. Without one, Claude Code's default for the model. */
  effort?: Effort;
  prompt?: string;
}

/**
 * What every run asks of Claude Code through its environment, unless the user set it themselves:
 * the to-do list Claude keeps, which Claude Code leaves out on its newest models, so the working
 * strip can say "Step 3 of 7".
 */
export const RUN_VARIABLES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
};

// Set by a Claude Code session for its own children. Left in, they'd change how this one starts.
// Agent teams are off too: Factwright files the user's answers only for the run's own Claude,
// which it tells apart from a subagent by Claude Code's hooks, and teammates are another kind.
const PARENT_SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
]);

/**
 * Arguments for a session that loads only Factwright's plugin, its standing rules, its MCP
 * servers and its settings.
 */
export function buildLaunchArgs(options: LaunchOptions): string[] {
  const { pluginDir, mcpConfig, settings, permissionMode, model, effort, prompt } = options;
  // Types vanish at runtime, and the mode, the model and the effort may come from a message or a
  // file.
  if (!PERMISSION_MODES.includes(permissionMode)) {
    throw new Error(`Unsupported permission mode: ${permissionMode}`);
  }
  if (model !== undefined && !MODELS.includes(model)) {
    throw new Error(`Unsupported model: ${model}`);
  }
  if (effort !== undefined && !EFFORTS.includes(effort)) {
    throw new Error(`Unsupported effort: ${effort}`);
  }
  // Claude Code would read a prompt like "--dangerously-skip-permissions" as an option.
  if (prompt?.startsWith('-')) throw new Error('A prompt cannot start with "-".');
  // Restricted and interactive: never -p, --print, --bare or --dangerously-skip-permissions.
  const args = [
    '--restricted',
    '--permission-mode',
    permissionMode,
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    '--no-chrome',
    '--plugin-dir',
    pluginDir,
    '--append-system-prompt-file',
    join(pluginDir, STANDING_RULES),
    // --mcp-config takes several values, so an option must follow it, never the prompt.
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--settings',
    settings,
  ];
  return prompt ? [...args, prompt] : args;
}

/**
 * Variables that would sign Claude Code in by themselves, whichever profile it runs for: a token,
 * a cloud provider in place of a Claude login, or where Claude Code keeps its sign-in.
 */
const CLAUDE_LOGINS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
]);

/** Anthropic's keys and tokens, for any of its services, such as ANTHROPIC_FOUNDRY_API_KEY. */
const ANTHROPIC_KEY = /^ANTHROPIC_(?:\w+_)?(?:API_KEY|AUTH_TOKEN|IDENTITY_TOKEN(?:_FILE)?)$/;

/**
 * The open profile's own Claude Code folder, for a profile added in Factwright: its login, plan,
 * settings and history. Null for the first profile, which uses the user's own setup.
 */
let profileFolder: string | null = null;

/**
 * Runs every Claude Code from now on with a profile's own folder, or with the user's own setup
 * for null. Set once, as the app opens a profile. The app's own environment stays as it was, so
 * nothing else it starts carries the folder, such as the app itself, opening another profile.
 */
export function useClaudeFolder(folder: string | null): void {
  profileFolder = folder;
}

/**
 * The folder Claude Code keeps its config in for the open profile: the profile's own, or for the
 * first profile, the one CLAUDE_CONFIG_DIR names in `base`. Null for Claude Code's own default,
 * the home folder.
 */
export function claudeConfigFolder(base: NodeJS.ProcessEnv): string | null {
  return profileFolder ?? (base.CLAUDE_CONFIG_DIR || null);
}

/**
 * A copy of `base` with PATH replaced and only a parent session's variables removed. For a
 * profile with its own Claude Code folder, it points there, and leaves out any login in the
 * environment, which would be someone else's.
 */
export function launchEnv(base: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
  // Windows spells it Path, and two spellings in one environment would clash. Its names ignore
  // case, so each is compared in capitals.
  const kept = Object.entries(base).filter(([name]) => {
    const upper = name.toUpperCase();
    if (upper === 'PATH' || PARENT_SESSION_VARIABLES.has(name)) return false;
    if (!profileFolder) return true;
    return upper !== 'CLAUDE_CONFIG_DIR' && !CLAUDE_LOGINS.has(upper) && !ANTHROPIC_KEY.test(upper);
  });
  return {
    ...Object.fromEntries(kept),
    PATH: path,
    ...(profileFolder && { CLAUDE_CONFIG_DIR: profileFolder }),
  };
}

/** A run's environment: launchEnv's, with what every run asks of Claude Code, unless set. */
export const runEnv = (base: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv => ({
  ...RUN_VARIABLES,
  ...launchEnv(base, path),
});
