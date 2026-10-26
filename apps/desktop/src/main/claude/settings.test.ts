import { describe, expect, it } from 'vitest';
import { type RunScope, scopeOf } from '../../shared/runs.ts';
import { factwrightTools } from '../tools/index.ts';
import {
  ANSWER_WAIT_SECONDS,
  RUN_TOKEN_VARIABLE,
  sessionSettings,
  TOOLS_SERVER,
  toolsConfig,
} from './settings.ts';

const settings = sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: false });
const scoped = (scope: RunScope) =>
  sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: false, scope });

describe('sessionSettings', () => {
  it("uses Claude Code's ANSI theme that matches the app", () => {
    expect(settings.theme).toBe('light-ansi');
    expect(sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: true }).theme).toBe(
      'dark-ansi',
    );
  });

  it("turns off the user's claude.ai connectors", () => {
    expect(settings.disableClaudeAiConnectors).toBe(true);
  });

  it('lets a run on the job hunt search, read pages, run its skills, use every tool and change any file, without asking', () => {
    expect(settings.permissions.allow).toEqual([
      'WebSearch',
      'Skill(factwright *)',
      'mcp__factwright__find_job',
      'mcp__factwright__job_details',
      'mcp__factwright__search_focus',
      'mcp__factwright__revision_findings',
      'mcp__factwright__requested_changes',
      'mcp__factwright__build_resume',
      'mcp__factwright__build_cover_letter',
      'mcp__factwright__build_projects_page',
      'mcp__factwright__about_you',
      'mcp__factwright__past_answers',
      'mcp__factwright__save_answer',
      'mcp__factwright__log_check',
      'mcp__factwright__merge_job',
      'mcp__factwright__save_call_prep',
      'mcp__factwright__save_thank_you',
      'mcp__factwright__list_templates',
      'mcp__factwright__read_template',
      'mcp__factwright__save_fact',
      'mcp__factwright__save_gap',
      'mcp__factwright__verify_fact',
      'mcp__factwright__correct_fact',
      'mcp__factwright__save_about_you',
      'mcp__factwright__save_work_history',
      'mcp__factwright__save_template',
      'mcp__factwright__read_posting',
      'mcp__factwright__save_posting',
      'mcp__factwright__job_board',
      'mcp__factwright__hn_jobs',
      'mcp__factwright__read_page',
      'Edit(./**)',
    ]);
    // Every one of Factwright's tools.
    const named = factwrightTools({
      jobs: {} as never,
      about: {} as never,
      facts: {} as never,
      workspace: '',
      printer: {} as never,
      templates: {} as never,
    }).map((tool) => `mcp__factwright__${tool.name}`);
    expect(named.filter((tool) => !settings.permissions.allow.includes(tool))).toEqual([]);
  });

  it('changes the fact bank only through the fact tools, outside getting started and adding facts', () => {
    for (const scope of ['hunt', 'history', 'revise', 'template'] as const) {
      const { allow, deny } = scoped(scope).permissions;
      expect(deny, scope).toContain('Edit(./facts/**)');
      expect(allow, scope).not.toContain('Edit(./facts/**)');
    }
    // Getting started and adding facts change the facts themselves, as the user confirms them.
    const profile = scoped('profile').permissions;
    expect(profile.allow).toContain('Edit(./**)');
    expect(profile.deny).not.toContain('Edit(./facts/**)');
    expect(scopeOf({ skill: 'get-started' })).toBe('profile');
    expect(scopeOf({ skill: 'add-facts', mode: 'interview' })).toBe('profile');
    expect(scopeOf({ skill: 'work-history' })).toBe('history');
  });

  it('files what the user answers without asking, in a run on the job hunt or a revision', () => {
    const filing = [
      'mcp__factwright__save_fact',
      'mcp__factwright__save_gap',
      'mcp__factwright__verify_fact',
      'mcp__factwright__correct_fact',
    ];
    for (const tool of filing) {
      expect(scoped('hunt').permissions.allow).toContain(tool);
      expect(scoped('revise').permissions.allow).toContain(tool);
      // Getting started and adding facts change the facts themselves, as the user confirms them.
      for (const scope of ['profile', 'history', 'template'] as const) {
        expect(scoped(scope).permissions.allow, scope).not.toContain(tool);
      }
    }
  });

  it('saves to the user’s profile without asking, in every run but one making a template', () => {
    for (const tool of ['mcp__factwright__save_about_you', 'mcp__factwright__save_work_history']) {
      for (const scope of ['hunt', 'profile', 'history', 'revise'] as const) {
        expect(scoped(scope).permissions.allow, scope).toContain(tool);
      }
      expect(scoped('template').permissions.allow).not.toContain(tool);
    }
  });

  it('keeps every run but one on the job hunt off the web, reading no page and no job API', () => {
    const web = [
      'WebSearch',
      'mcp__factwright__read_posting',
      'mcp__factwright__save_posting',
      'mcp__factwright__job_board',
      'mcp__factwright__hn_jobs',
      'mcp__factwright__read_page',
    ];
    for (const scope of ['profile', 'history', 'revise', 'template'] as const) {
      const { allow, deny } = scoped(scope).permissions;
      for (const tool of web) {
        expect(allow, scope).not.toContain(tool);
        expect(deny, scope).toContain(tool);
      }
    }
    // A hunt run reads the web, any page without asking.
    for (const tool of web) {
      expect(settings.permissions.allow).toContain(tool);
      expect(settings.permissions.deny).not.toContain(tool);
    }
  });

  it('lets a run for making a template read and save templates without asking, and nothing else', () => {
    const { allow, deny } = scoped('template').permissions;
    // Not building a resume or saving an answer, and no files: the resume it copies came from anywhere.
    expect(allow).toEqual([
      'Skill(factwright *)',
      'mcp__factwright__list_templates',
      'mcp__factwright__read_template',
      'mcp__factwright__save_template',
    ]);
    for (const tool of ['WebSearch', 'mcp__factwright__read_page', 'mcp__factwright__job_board']) {
      expect(deny).toContain(tool);
    }
  });

  it('lets a revision do what a run on the job hunt does on this computer, asking before it saves a template', () => {
    const { allow, deny } = scoped('revise').permissions;
    for (const tool of [
      'mcp__factwright__revision_findings',
      'mcp__factwright__requested_changes',
      'mcp__factwright__build_resume',
      'mcp__factwright__save_fact',
      'mcp__factwright__save_gap',
      'Edit(./**)',
    ]) {
      expect(allow).toContain(tool);
    }
    // It reads what the X-ray found in a posting: changing a template asks first, and never by
    // editing the template's file itself.
    expect(allow).not.toContain('mcp__factwright__save_template');
    expect(deny).toContain('Edit(./templates/**)');
    expect(deny).not.toContain('mcp__factwright__save_template');
  });

  it('never lets Claude change its own settings, the instructions it loads, the user’s own files, or the logs', () => {
    const never = [
      'Edit(./.claude/**)',
      'Edit(./**/.claude/**)',
      'Edit(./CLAUDE.md)',
      'Edit(./**/CLAUDE.md)',
      'Edit(./**/CLAUDE.local.md)',
      // Claude Code loads these where there's no CLAUDE.md, as in the workspace.
      'Edit(./AGENTS.md)',
      'Edit(./**/AGENTS.md)',
      // The user's own notes, shared files and Profile, which go in through Factwright's tools.
      'Edit(./about-me/notes.md)',
      'Edit(./about-me/files/**)',
      'Edit(./about-me/answers.json)',
      'Edit(./about-me/history.json)',
      'Edit(./about-me/kinds-of-job.json)',
      'Edit(./about-me/beyond-work.json)',
      'Edit(./linkedin/**)',
      // The job hunt's logs, which runs side by side add to through log_check, one row at a time.
      'Edit(./searches/fit-checks.md)',
      'Edit(./searches/salary-checks.md)',
      'Edit(./searches/unmask-checks.md)',
    ];
    for (const scope of ['hunt', 'profile', 'history', 'revise', 'template'] as const) {
      expect(scoped(scope).permissions.deny.slice(0, never.length)).toEqual(never);
    }
    expect(settings.permissions.deny).toEqual([...never, 'Edit(./facts/**)']);
    // Claude still keeps its own note of what it has read.
    expect(scoped('profile').permissions.deny).not.toContain('Edit(./about-me/read.md)');
  });

  it('hears when Claude starts, uses tools, needs the user, and stops', () => {
    expect(Object.keys(settings.hooks)).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Notification',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ]);
  });

  it('hears every tool call as it starts on a path of its own, apart from the hooks that wait', () => {
    const heard = sessionSettings({
      hookUrl: 'http://127.0.0.1:4000/hook',
      activityUrl: 'http://127.0.0.1:4000/activity',
      dark: false,
    });
    expect(heard.hooks.PreToolUse).toHaveLength(3);
    expect(heard.hooks.PreToolUse[2]).toEqual({
      hooks: [
        {
          type: 'http',
          url: 'http://127.0.0.1:4000/activity',
          timeout: 5,
          headers: { Authorization: `Bearer $${RUN_TOKEN_VARIABLE}` },
          allowedEnvVars: [RUN_TOKEN_VARIABLE],
        },
      ],
    });
    // The hooks that wait on the user are as they were.
    expect(heard.hooks.PreToolUse.slice(0, 2)).toEqual(settings.hooks.PreToolUse);
  });

  it('sends every hook to the app, with the token read from the environment', () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      for (const group of groups) {
        const asks =
          event === 'PermissionRequest' ||
          (event === 'PreToolUse' && 'matcher' in group && group.matcher === 'AskUserQuestion');
        expect(group.hooks).toEqual([
          {
            type: 'http',
            url: 'http://127.0.0.1:4000/hook',
            timeout: asks ? ANSWER_WAIT_SECONDS : 5,
            headers: { Authorization: `Bearer $${RUN_TOKEN_VARIABLE}` },
            allowedEnvVars: [RUN_TOKEN_VARIABLE],
          },
        ]);
      }
    }
  });

  it('waits a day for the user’s answer in the app, to Claude’s questions and permission prompts alone', () => {
    expect(ANSWER_WAIT_SECONDS).toBe(24 * 60 * 60);
    const waits = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.filter((hook) => hook.timeout > 5)),
    );
    expect(waits).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0]).toMatchObject({
      matcher: 'AskUserQuestion',
      hooks: [{ timeout: ANSWER_WAIT_SECONDS }],
    });
    expect(settings.hooks.PermissionRequest).toEqual([
      { hooks: [expect.objectContaining({ timeout: ANSWER_WAIT_SECONDS })] },
    ]);
  });

  it('hears before a tool runs only about AskUserQuestion and the tools that file answers', () => {
    expect(settings.hooks.PreToolUse).toEqual([
      expect.objectContaining({ matcher: 'AskUserQuestion' }),
      expect.objectContaining({
        matcher: `mcp__${TOOLS_SERVER}__save_fact|mcp__${TOOLS_SERVER}__save_gap|mcp__${TOOLS_SERVER}__verify_fact|mcp__${TOOLS_SERVER}__correct_fact`,
      }),
    ]);
  });
});

describe('toolsConfig', () => {
  it("gives the run Factwright's tools, with the token read from the environment", () => {
    expect(toolsConfig('http://127.0.0.1:4000/mcp')).toEqual({
      mcpServers: {
        factwright: {
          type: 'http',
          url: 'http://127.0.0.1:4000/mcp',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code fills this in, not JavaScript.
          headers: { Authorization: 'Bearer ${FACTWRIGHT_RUN_TOKEN}' },
          alwaysLoad: true,
        },
      },
    });
  });
});
