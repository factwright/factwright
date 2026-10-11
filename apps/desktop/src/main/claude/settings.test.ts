import { describe, expect, it } from 'vitest';
import { HOOK_TOKEN_VARIABLE, sessionSettings } from './settings.ts';

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

  it('sends every hook to the app, with the token read from the environment', () => {
    for (const groups of Object.values(settings.hooks)) {
      for (const group of groups) {
        expect(group.hooks).toEqual([
          {
            type: 'http',
            url: 'http://127.0.0.1:4000/hook',
            timeout: 5,
            headers: { Authorization: `Bearer $${HOOK_TOKEN_VARIABLE}` },
            allowedEnvVars: [HOOK_TOKEN_VARIABLE],
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
