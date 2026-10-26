import type { RunScope } from '../../shared/runs.ts';
import { TEMPLATES_FOLDER } from '../resume/templates.ts';
import {
  FACT_TOOLS,
  LOCAL_TOOLS,
  PROFILE_TOOLS,
  PUBLIC_API_TOOLS,
  TEMPLATE_READS,
  TEMPLATE_TOOLS,
  WEB_TOOLS,
} from '../tools/index.ts';
import { LOGS } from '../tools/logs.ts';
import { FILING_TOOLS, hookToolName } from './questions.ts';

/** The environment variable that carries a run's token to Claude Code, never to disk. */
export const RUN_TOKEN_VARIABLE = 'FACTWRIGHT_RUN_TOKEN';

/** The name Claude Code knows Factwright's tools by, as in mcp__factwright__find_job. */
export const TOOLS_SERVER = 'factwright';

/** How long Claude Code waits on any other hook, in seconds: the app answers at once. */
const HOOK_SECONDS = 5;

/**
 * How long Claude Code waits for the user's answer in the app's dialogs, to Claude's questions or
 * a permission prompt, in seconds: a day, since they may step away while Claude works. Past it,
 * the terminal asks them.
 */
export const ANSWER_WAIT_SECONDS = 24 * 60 * 60;

/** The plugin's name in its plugin.json, which names its skills, as in /factwright:analyze-job. */
const PLUGIN = 'factwright';

/**
 * The user's fact bank, which every resume and answer is built from. Outside the runs that build
 * it with the user, getting started and adding facts, it changes only through Factwright's fact
 * tools, which take only what the user answered in the run.
 */
const FACTS = 'facts/**';

/** A rule for changing files in the workspace, which is where Claude runs. */
const edits = (path: string) => `Edit(./${path})`;

/**
 * Files Claude never changes: Claude Code's own settings and the instructions it loads, which a
 * job post could otherwise use to steer later runs. Where there's no CLAUDE.md, as in the
 * workspace, Claude Code loads AGENTS.md files in their place.
 */
const NEVER_CHANGED = [
  '.claude/**',
  '**/.claude/**',
  'CLAUDE.md',
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  'AGENTS.md',
  '**/AGENTS.md',
];

/**
 * The user's own words and Profile, which later runs read as theirs: their notes, the files they
 * shared, LinkedIn's export, and what Profile keeps, such as the contact details applications
 * get. Claude never edits them itself: what the user tells it goes in through Factwright's
 * tools, which check it. Claude keeps its own note of what it has read, about-me/read.md.
 */
const USERS_OWN = [
  'about-me/notes.md',
  'about-me/files/**',
  'about-me/answers.json',
  'about-me/history.json',
  'about-me/kinds-of-job.json',
  'about-me/beyond-work.json',
  'linkedin/**',
];

/**
 * The job hunt's logs, which runs side by side may add to at the same time: Factwright's
 * log_check tool writes their rows, one at a time, so Claude never edits them itself.
 */
const LOGS_THE_APP_WRITES = Object.values(LOGS).map((log) => log.path);

/**
 * What a run that isn't on the job hunt may never use: the web, and the tools that read job
 * posts. Getting started and adding facts change the user's facts, a run for their work history
 * their Profile, and a template run their templates, so nothing they read may come from a page
 * that could tell them what to write. A revision reads what an X-ray found in a posting already.
 * Job searches and analyzing jobs get runs of their own.
 */
const OFF_THE_WEB = [
  'WebSearch',
  ...[...PUBLIC_API_TOOLS, ...WEB_TOOLS].map((tool) => `mcp__${TOOLS_SERVER}__${tool}`),
];

/** What Claude may do without asking, from what the run is for. */
function allowed(scope: RunScope): string[] {
  const skills = `Skill(${PLUGIN} *)`;
  const named = (tools: readonly string[]) => tools.map((tool) => `mcp__${TOOLS_SERVER}__${tool}`);
  // A template run copies a resume from anywhere, so it reads and saves templates and nothing
  // else without asking: no files, no resume to build, no answer to save.
  if (scope === 'template') return [skills, ...named([...TEMPLATE_READS, ...TEMPLATE_TOOLS])];
  // Every other run changes any file in the workspace without asking, as its task needs, apart
  // from what the deny rules keep: the user sees each change on the task's card, with Undo. A run
  // on the job hunt files what the user answers it, since that files only what they answered.
  // Getting started and adding facts change the facts themselves, as the user confirms them. A
  // revision does what a run on the job hunt does on this computer, and nothing on the web, but
  // it reads what an X-ray found in a posting, so saving a template asks first.
  const tools =
    scope === 'profile' || scope === 'history'
      ? [...LOCAL_TOOLS, ...PROFILE_TOOLS, ...TEMPLATE_TOOLS]
      : scope === 'revise'
        ? [...LOCAL_TOOLS, ...FACT_TOOLS, ...PROFILE_TOOLS]
        : [
            ...LOCAL_TOOLS,
            ...FACT_TOOLS,
            ...PROFILE_TOOLS,
            ...TEMPLATE_TOOLS,
            ...PUBLIC_API_TOOLS,
            ...WEB_TOOLS,
          ];
  return [...(scope === 'hunt' ? ['WebSearch'] : []), skills, ...named(tools), edits('**')];
}

/**
 * The settings Factwright passes with `--settings` for one run:
 * - Claude Code's ANSI theme, so the panel's own colors are the only ones it shows
 * - no claude.ai connectors (such as the user's mail or drive), since job posts are untrusted
 * - without asking: web searches, reading web pages, Factwright's skills and tools, and changing
 *   any file in the workspace. Each task's card lists what it changed, with Undo, and the pages
 *   it read. Factwright's tools refuse LinkedIn's pages, and anything on this computer or the
 *   user's network. A run started to get to know the user, to add facts or to fill in their work
 *   history never reads the web, nor does a revision, which reads what a resume's X-ray found in
 *   a posting, and otherwise runs as a run on the job hunt does, apart from saving a template,
 *   which asks first. A run started to make a template copies a resume from anywhere, so it may
 *   read and save templates without asking, and nothing else, and never reads the web either.
 * - never: changing Claude Code's settings or the instructions it loads, the user's own notes,
 *   shared files and Profile other than through Factwright's tools, the job hunt's logs other
 *   than through log_check, and outside getting started and adding facts, the fact bank other
 *   than through Factwright's fact tools
 * - hooks that tell the app, over HTTP on this computer, where the run stands, what the user
 *   answers Claude's questions, which Claude calls the tools that file the answers, and when the
 *   session ends, which the self-test listens for. The ones for Claude's questions and Claude
 *   Code's permission prompts wait while the user answers them in the app's dialogs. Another
 *   hears each tool call as it starts, on a path of its own, so the window can say what Claude
 *   is doing, and the app keeps each file as it was before Claude changes it.
 */
export function sessionSettings({
  hookUrl,
  activityUrl,
  dark,
  scope = 'hunt',
}: {
  hookUrl: string;
  /**
   * Where each tool call says it's starting, so the window can say what Claude is doing, and a
   * file is kept as it was before Claude changes it.
   */
  activityUrl?: string;
  dark: boolean;
  scope?: RunScope;
}) {
  const http = (timeout: number, url = hookUrl) => [
    {
      type: 'http',
      url,
      timeout,
      headers: { Authorization: `Bearer $${RUN_TOKEN_VARIABLE}` },
      allowedEnvVars: [RUN_TOKEN_VARIABLE],
    },
  ];
  const hook = http(HOOK_SECONDS);
  return {
    theme: dark ? 'dark-ansi' : 'light-ansi',
    disableClaudeAiConnectors: true,
    permissions: {
      allow: allowed(scope),
      deny: [
        ...NEVER_CHANGED.map(edits),
        ...USERS_OWN.map(edits),
        ...LOGS_THE_APP_WRITES.map(edits),
        ...(scope === 'profile' ? [] : [edits(FACTS)]),
        ...(scope === 'hunt' ? [] : OFF_THE_WEB),
        // A revision changes a template only through save_template, which asks.
        ...(scope === 'revise' ? [edits(`${TEMPLATES_FOLDER}/**`)] : []),
      ],
    },
    hooks: {
      UserPromptSubmit: [{ hooks: hook }],
      // The questions Claude asks, which the user answers in the app's dialog, and its calls to
      // the tools that file the answers, which the app lets through only when they come from the
      // run's own Claude.
      PreToolUse: [
        { matcher: 'AskUserQuestion', hooks: http(ANSWER_WAIT_SECONDS) },
        { matcher: FILING_TOOLS.map(hookToolName).join('|'), hooks: hook },
        // Every call as it starts, to say what Claude is doing, and to keep a file as it was before
        // Claude changes it, apart from the hooks above.
        ...(activityUrl ? [{ hooks: http(HOOK_SECONDS, activityUrl) }] : []),
      ],
      PostToolUse: [{ hooks: hook }],
      PostToolUseFailure: [{ hooks: hook }],
      // Claude Code's permission prompts, which the user can answer in the app's dialog too.
      PermissionRequest: [{ hooks: http(ANSWER_WAIT_SECONDS) }],
      Notification: [{ hooks: hook }],
      Stop: [{ hooks: hook }],
      StopFailure: [{ hooks: hook }],
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
