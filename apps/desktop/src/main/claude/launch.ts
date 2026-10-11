/** The only permission modes the app launches Claude Code with. */
export const PERMISSION_MODES = ['default', 'acceptEdits'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Paths to Factwright's plugin, MCP config and settings, the permission mode, and a prompt. */
export interface LaunchOptions {
  pluginDir: string;
  mcpConfig: string;
  settings: string;
  permissionMode: PermissionMode;
  prompt?: string;
}

// Set by a Claude Code session for its own children. Left in, they'd change how this one starts.
const PARENT_SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_AGENT_SDK_VERSION',
]);

/** Arguments for a session that loads only Factwright's plugin, MCP servers and settings. */
export function buildLaunchArgs(options: LaunchOptions): string[] {
  const { pluginDir, mcpConfig, settings, permissionMode, prompt } = options;
  // Types vanish at runtime, and the mode may arrive in a message from the app's window.
  if (!PERMISSION_MODES.includes(permissionMode)) {
    throw new Error(`Unsupported permission mode: ${permissionMode}`);
  }
  // Claude Code would read a prompt like "--dangerously-skip-permissions" as an option.
  if (prompt?.startsWith('-')) throw new Error('A prompt cannot start with "-".');
  // Restricted and interactive: never -p, --print, --bare or --dangerously-skip-permissions.
  const args = [
    '--restricted',
    '--permission-mode',
    permissionMode,
    '--no-chrome',
    '--plugin-dir',
    pluginDir,
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--settings',
    settings,
  ];
  return prompt ? [...args, prompt] : args;
}

/** A copy of `base` with PATH replaced and only a parent session's variables removed. */
export function launchEnv(base: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
  // Windows spells it Path, and two spellings in one environment would clash.
  const kept = Object.entries(base).filter(
    ([name]) => name.toUpperCase() !== 'PATH' && !PARENT_SESSION_VARIABLES.has(name),
  );
  return { ...Object.fromEntries(kept), PATH: path };
}
