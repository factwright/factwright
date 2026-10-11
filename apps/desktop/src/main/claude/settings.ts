import { LOCAL_TOOLS, PUBLIC_API_TOOLS } from '../tools/index.ts';

/** The environment variable that carries a run's token to Claude Code, never to disk. */
export const RUN_TOKEN_VARIABLE = 'FACTWRIGHT_RUN_TOKEN';

/** The name Claude Code knows Factwright's tools by, as in mcp__factwright__find_job. */
export const TOOLS_SERVER = 'factwright';

/** The plugin's name in its plugin.json, which names its skills, as in /factwright:fit-check. */
const PLUGIN = 'factwright';

/**
 * The settings Factwright passes with `--settings` for one run:
 * - Claude Code's ANSI theme, so the panel's own colors are the only ones it shows
 * - no claude.ai connectors (such as the user's mail or drive), since job posts are untrusted
 * - without asking: web searches, Factwright's skills, its tools that stay on this computer,
 *   such as reading what's on file and building resumes, and its tools that read only fixed
 *   public job APIs: the applicant systems' boards and Hacker News's hiring thread. The user OKs
 *   each page Factwright's tools fetch, since a job post could steer Claude to send the user's
 *   details to a site in a link. Searches and those APIs never reach a site the post names.
 * - hooks that tell the app, over HTTP on this computer, where the run stands, and when the
 *   session ends, which the self-test listens for
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
    permissions: {
      allow: [
        'WebSearch',
        `Skill(${PLUGIN} *)`,
        ...[...LOCAL_TOOLS, ...PUBLIC_API_TOOLS].map((tool) => `mcp__${TOOLS_SERVER}__${tool}`),
      ],
    },
    hooks: {
      UserPromptSubmit: [{ hooks: hook }],
      PreToolUse: [{ matcher: 'AskUserQuestion', hooks: hook }],
      PostToolUse: [{ hooks: hook }],
      PostToolUseFailure: [{ hooks: hook }],
      PermissionRequest: [{ hooks: hook }],
      Notification: [{ hooks: hook }],
      Stop: [{ hooks: hook }],
      SessionEnd: [{ hooks: hook }],
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
