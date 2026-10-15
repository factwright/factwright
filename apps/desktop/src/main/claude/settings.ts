import { WORKSPACE_PATHS } from '@factwright/core';
import { ASK_FIRST, type ClaudePermissions } from '../../shared/permissions.ts';
import type { RunScope } from '../../shared/runs.ts';
import {
  FACT_TOOLS,
  LOCAL_TOOLS,
  PROFILE_TOOLS,
  PUBLIC_API_TOOLS,
  TEMPLATE_READS,
  TEMPLATE_TOOLS,
  WEB_TOOLS,
} from '../tools/index.ts';

/** The environment variable that carries a run's token to Claude Code, never to disk. */
export const RUN_TOKEN_VARIABLE = 'FACTWRIGHT_RUN_TOKEN';

/** The name Claude Code knows Factwright's tools by, as in mcp__factwright__find_job. */
export const TOOLS_SERVER = 'factwright';

/** The plugin's name in its plugin.json, which names its skills, as in /factwright:fit-check. */
const PLUGIN = 'factwright';

/** Where the skills save their work, which Claude may change without asking. */
const WORK_FOLDERS = [WORKSPACE_PATHS.jobs, WORKSPACE_PATHS.searches, WORKSPACE_PATHS.outreach];

/**
 * The list of words that must never appear on a resume, which Claude adds to as the user names
 * them. Adding to it only makes the resume check stricter, so it needs no OK either.
 */
const CONFIDENTIAL_TERMS = 'guide/confidential-terms.txt';

/**
 * What a run started to get to know the user, or to add facts, may change without asking too:
 * their fact bank, starting resumes and guide, and the note of what it has read. That's the work
 * the user started it for, and it reads only their own files, not job posts.
 */
const PROFILE_FILES = ['facts/**', 'base/**', 'guide/**', 'about-me/read.md'];

/** A rule for changing files in the workspace, which is where Claude runs. */
const edits = (path: string) => `Edit(./${path})`;

/**
 * Files Claude never changes, whatever the user allows: Claude Code's own settings and the
 * instructions it loads, which a job post could otherwise use to steer later runs.
 */
const NEVER_CHANGED = [
  '.claude/**',
  '**/.claude/**',
  'CLAUDE.md',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
];

/**
 * What a run for getting to know the user, or for making a template, may never use: the web,
 * and the tools that read job posts. The first may change the user's facts and guide without
 * asking, and the second their templates, so nothing it reads may come from a page that could
 * tell it what to write. Job searches and fit checks get runs of their own.
 */
const OFF_THE_WEB = [
  'WebSearch',
  ...[...PUBLIC_API_TOOLS, ...WEB_TOOLS].map((tool) => `mcp__${TOOLS_SERVER}__${tool}`),
];

/** What Claude may do without asking, from the user's choices and what the run is for. */
function allowed(permissions: ClaudePermissions, scope: RunScope): string[] {
  // Saving to the user's profile is like changing their facts: allowed when those are.
  const profile = scope === 'profile' || permissions.anyFile ? PROFILE_TOOLS : [];
  // Saving a template is the point of a template run. Otherwise it's like changing a file.
  const templates = scope === 'template' || permissions.anyFile ? TEMPLATE_TOOLS : [];
  // A template run copies a resume from anywhere, so it reads and saves templates and nothing
  // else without asking: not building a resume or saving an answer, either. Every other run
  // files what the user answers it without asking, since that files only what they answered.
  const tools =
    scope === 'template'
      ? [...TEMPLATE_READS, ...templates, ...profile]
      : scope === 'profile'
        ? [...LOCAL_TOOLS, ...FACT_TOOLS, ...profile, ...templates]
        : [
            ...LOCAL_TOOLS,
            ...FACT_TOOLS,
            ...profile,
            ...templates,
            ...PUBLIC_API_TOOLS,
            ...(permissions.anySite ? WEB_TOOLS : []),
          ];
  // A template run copies a resume from anywhere, so it changes no file without asking.
  const files =
    scope === 'template'
      ? []
      : [
          ...WORK_FOLDERS.map((folder) => `${folder}/**`),
          CONFIDENTIAL_TERMS,
          ...(scope === 'profile' ? PROFILE_FILES : []),
        ];
  return [
    ...(scope === 'hunt' ? ['WebSearch'] : []),
    `Skill(${PLUGIN} *)`,
    ...tools.map((tool) => `mcp__${TOOLS_SERVER}__${tool}`),
    ...(permissions.anyFile ? [edits('**')] : files.map(edits)),
  ];
}

/**
 * The settings Factwright passes with `--settings` for one run:
 * - Claude Code's ANSI theme, so the panel's own colors are the only ones it shows
 * - no claude.ai connectors (such as the user's mail or drive), since job posts are untrusted
 * - without asking: web searches, Factwright's skills, its tools that stay on this computer,
 *   such as reading what's on file, building resumes and filing what the user answers Claude as
 *   facts that wait for them to verify, its tools that read only fixed public
 *   job APIs (the applicant systems' postings and boards, and Hacker News's hiring thread), and
 *   saving work in the job, search and outreach folders. Searches and those APIs never reach a
 *   site a post names.
 * - asking first, unless the user chose otherwise: changing any other file, such as the facts,
 *   and reading any other page, since a job post could steer Claude to send the user's details
 *   to a site in a link. A run started to get to know the user, or to add facts, may change their
 *   facts, starting resumes and guide without asking too, and in return never reads the web. A
 *   run started to make a template may read and save templates without asking, and nothing
 *   else, and never reads the web either.
 * - never: changing Claude Code's settings or the instructions it loads
 * - hooks that tell the app, over HTTP on this computer, where the run stands, and when the
 *   session ends, which the self-test listens for
 */
export function sessionSettings({
  hookUrl,
  dark,
  permissions = ASK_FIRST,
  scope = 'hunt',
}: {
  hookUrl: string;
  dark: boolean;
  permissions?: ClaudePermissions;
  scope?: RunScope;
}) {
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
      allow: allowed(permissions, scope),
      deny: [...NEVER_CHANGED.map(edits), ...(scope === 'hunt' ? [] : OFF_THE_WEB)],
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
