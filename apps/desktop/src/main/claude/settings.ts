/** The environment variable that carries a run's hook token to Claude Code, never to disk. */
export const HOOK_TOKEN_VARIABLE = 'FACTWRIGHT_HOOK_TOKEN';

/**
 * The settings Factwright passes with `--settings` for one run:
 * - Claude Code's ANSI theme, so the panel's own colors are the only ones it shows
 * - no claude.ai connectors (such as the user's mail or drive), since job posts are untrusted
 * - hooks that tell the app, over HTTP on this computer, where the run stands
 */
export function sessionSettings({ hookUrl, dark }: { hookUrl: string; dark: boolean }) {
  const hook = [
    {
      type: 'http',
      url: hookUrl,
      timeout: 5,
      headers: { Authorization: `Bearer $${HOOK_TOKEN_VARIABLE}` },
      allowedEnvVars: [HOOK_TOKEN_VARIABLE],
    },
  ];
  return {
    theme: dark ? 'dark-ansi' : 'light-ansi',
    disableClaudeAiConnectors: true,
    hooks: {
      UserPromptSubmit: [{ hooks: hook }],
      PreToolUse: [{ matcher: 'AskUserQuestion', hooks: hook }],
      PostToolUse: [{ hooks: hook }],
      PermissionRequest: [{ hooks: hook }],
      Notification: [{ hooks: hook }],
      Stop: [{ hooks: hook }],
    },
  };
}

/** No MCP servers yet. Factwright's own tools come later, and --strict-mcp-config keeps out the rest. */
export const EMPTY_MCP_CONFIG = { mcpServers: {} };
