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

  it('lets Claude search, run its skills, use the tools that stay here or read the job APIs, and save its work, without asking', () => {
    expect(settings.permissions.allow).toEqual([
      'WebSearch',
      'Skill(factwright *)',
      'mcp__factwright__find_job',
      'mcp__factwright__job_details',
      'mcp__factwright__build_resume',
      'mcp__factwright__about_you',
      'mcp__factwright__past_answers',
      'mcp__factwright__save_answer',
      'mcp__factwright__read_posting',
      'mcp__factwright__save_posting',
      'mcp__factwright__job_board',
      'mcp__factwright__hn_jobs',
      'Edit(./applications/**)',
      'Edit(./searches/**)',
      'Edit(./outreach/**)',
      'Edit(./guide/confidential-terms.txt)',
    ]);
  });

  it('lets Claude change any file, or read any site, once the user chooses to', () => {
    const allow = (anyFile: boolean, anySite: boolean) =>
      sessionSettings({
        hookUrl: 'http://127.0.0.1:4000/hook',
        dark: false,
        permissions: { anyFile, anySite },
      }).permissions.allow;
    expect(allow(true, false)).toContain('Edit(./**)');
    expect(allow(true, false)).not.toContain('Edit(./applications/**)');
    expect(allow(true, false)).not.toContain('mcp__factwright__read_page');
    expect(allow(false, true)).toContain('mcp__factwright__read_page');
    expect(allow(false, true)).not.toContain('Edit(./**)');
  });

  it('asks before saving to the user’s profile, like changing their facts, unless they chose otherwise', () => {
    const allow = (anyFile: boolean, scope: 'hunt' | 'profile' = 'hunt') =>
      sessionSettings({
        hookUrl: 'http://127.0.0.1:4000/hook',
        dark: false,
        permissions: { anyFile, anySite: false },
        scope,
      }).permissions.allow;
    expect(allow(false)).not.toContain('mcp__factwright__save_about_you');
    expect(allow(true)).toContain('mcp__factwright__save_about_you');
    expect(allow(false, 'profile')).toContain('mcp__factwright__save_about_you');
  });

  it('lets a run started to get to know the user save their facts, starting resumes and guide', () => {
    const allow = sessionSettings({
      hookUrl: 'http://127.0.0.1:4000/hook',
      dark: false,
      scope: 'profile',
    }).permissions.allow;
    expect(allow.slice(-8)).toEqual([
      'Edit(./applications/**)',
      'Edit(./searches/**)',
      'Edit(./outreach/**)',
      'Edit(./guide/confidential-terms.txt)',
      'Edit(./facts/**)',
      'Edit(./base/**)',
      'Edit(./guide/**)',
      'Edit(./about-me/read.md)',
    ]);
    // Every other run asks first, and none may change the user's answers file.
    expect(settings.permissions.allow).not.toContain('Edit(./facts/**)');
    expect(allow).not.toContain('Edit(./about-me/answers.json)');
  });

  it('keeps a run for getting to know the user off the web, whatever else the user allows', () => {
    const { allow, deny } = sessionSettings({
      hookUrl: 'http://127.0.0.1:4000/hook',
      dark: false,
      scope: 'profile',
      permissions: { anyFile: false, anySite: true },
    }).permissions;
    const web = [
      'WebSearch',
      'mcp__factwright__read_posting',
      'mcp__factwright__save_posting',
      'mcp__factwright__job_board',
      'mcp__factwright__hn_jobs',
      'mcp__factwright__read_page',
    ];
    for (const tool of web) {
      expect(allow).not.toContain(tool);
      expect(deny).toContain(tool);
    }
    expect(allow).toContain('mcp__factwright__build_resume');
    // A hunt run keeps the web.
    expect(settings.permissions.deny).not.toContain('WebSearch');
  });

  it('never lets Claude change its own settings or the instructions it loads', () => {
    for (const anyFile of [false, true]) {
      const { deny } = sessionSettings({
        hookUrl: 'http://127.0.0.1:4000/hook',
        dark: false,
        permissions: { anyFile, anySite: anyFile },
      }).permissions;
      expect(deny).toEqual([
        'Edit(./.claude/**)',
        'Edit(./**/.claude/**)',
        'Edit(./CLAUDE.md)',
        'Edit(./**/CLAUDE.md)',
        'Edit(./**/CLAUDE.local.md)',
      ]);
    }
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
      'SessionEnd',
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
