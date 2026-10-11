import { describe, expect, it } from 'vitest';
import { RUN_TOKEN_VARIABLE, sessionSettings, toolsConfig } from './settings.ts';

const settings = sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: false });

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

  it('allows searches, its skills, the tools that stay on this computer and the job APIs, but not fetching pages', () => {
    expect(settings.permissions.allow).toEqual([
      'WebSearch',
      'Skill(factwright *)',
      'mcp__factwright__find_job',
      'mcp__factwright__job_details',
      'mcp__factwright__build_resume',
      'mcp__factwright__job_board',
      'mcp__factwright__hn_jobs',
    ]);
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
    ]);
  });

  it('sends every hook to the app, with the token read from the environment', () => {
    for (const groups of Object.values(settings.hooks)) {
      for (const group of groups) {
        expect(group.hooks).toEqual([
          {
            type: 'http',
            url: 'http://127.0.0.1:4000/hook',
            timeout: 5,
            headers: { Authorization: `Bearer $${RUN_TOKEN_VARIABLE}` },
            allowedEnvVars: [RUN_TOKEN_VARIABLE],
          },
        ]);
      }
    }
  });

  it('only hears about AskUserQuestion before a tool runs', () => {
    expect(settings.hooks.PreToolUse).toEqual([
      expect.objectContaining({ matcher: 'AskUserQuestion' }),
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
