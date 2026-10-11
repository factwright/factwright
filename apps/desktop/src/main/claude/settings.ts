import { READ_ONLY_TOOLS } from '../tools/index.ts';

/** The environment variable that carries a run's token to Claude Code, never to disk. */
export const RUN_TOKEN_VARIABLE = 'FACTWRIGHT_RUN_TOKEN';

/** The name Claude Code knows Factwright's tools by, as in mcp__factwright__find_job. */
export const TOOLS_SERVER = 'factwright';

/**
 * The settings Factwright passes with `--settings` for one run:
 * - Claude Code's ANSI theme, so the panel's own colors are the only ones it shows
 * - no claude.ai connectors (such as the user's mail or drive), since job posts are untrusted
 * - Factwright's tools that only read what's on file, without asking. The user OKs each link
 *   save_posting fetches, since a job post could steer Claude to send their details to a site.
 * - hooks that tell the app, over HTTP on this computer, where the run stands
 */
export function sessionSettings({ hookUrl, dark }: { hookUrl: string; dark: boolean }) {
  const hook = [
    {
      type: 'http',
      url: hookUrl,
      timeout: 5,
      headers: { Authorization: `Bearer $${RUN_TOKEN_VARIABLE}` },
      allowedEnvVars: [RUN_TOKEN_VARIABLE],
    },
  ];
  return {
    theme: dark ? 'dark-ansi' : 'light-ansi',
    disableClaudeAiConnectors: true,
    permissions: { allow: READ_ONLY_TOOLS.map((tool) => `mcp__${TOOLS_SERVER}__${tool}`) },
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

/**
 * The MCP servers Factwright passes with `--mcp-config` for one run: only its own tools, over
 * HTTP on this computer, since --strict-mcp-config keeps out the rest. Claude Code fills in the
 * token from its environment.
 */
export function toolsConfig(toolsUrl: string) {
  return {
    mcpServers: {
      [TOOLS_SERVER]: {
        type: 'http',
        url: toolsUrl,
        headers: { Authorization: `Bearer \${${RUN_TOKEN_VARIABLE}}` },
        // A few small tools, there from the first prompt rather than behind a tool search.
        alwaysLoad: true,
      },
    },
  };
}
