import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLaunchArgs,
  type LaunchOptions,
  launchEnv,
  PERMISSION_MODES,
  type PermissionMode,
  runEnv,
  useClaudeFolder,
} from './launch.ts';

const OPTIONS: LaunchOptions = {
  pluginDir: '/Applications/Factwright.app/Contents/Resources/plugin',
  mcpConfig: '/Users/someone/Library/Application Support/Factwright/mcp.json',
  settings: '/Users/someone/Library/Application Support/Factwright/settings.json',
  permissionMode: 'default',
};

describe('buildLaunchArgs', () => {
  it("loads only Factwright's plugin, standing rules, MCP servers and settings, restricted", () => {
    expect(buildLaunchArgs(OPTIONS)).toEqual([
      '--restricted',
      '--permission-mode',
      'default',
      '--no-chrome',
      '--plugin-dir',
      '/Applications/Factwright.app/Contents/Resources/plugin',
      '--append-system-prompt-file',
      join('/Applications/Factwright.app/Contents/Resources/plugin', 'standing-rules.md'),
      '--mcp-config',
      '/Users/someone/Library/Application Support/Factwright/mcp.json',
      '--strict-mcp-config',
      '--settings',
      '/Users/someone/Library/Application Support/Factwright/settings.json',
    ]);
  });

  it('never names the tools to keep, so restricted mode keeps WebFetch and the shell off', () => {
    // Without --tools, --restricted gives Claude Code's own page fetching (WebFetch), Bash,
    // PowerShell and the other tools that run code a deny rule of its own, which no setting lifts.
    for (const options of [OPTIONS, { ...OPTIONS, prompt: '/factwright:analyze-job job acme' }]) {
      const args = buildLaunchArgs(options);
      expect(args[0]).toBe('--restricted');
      expect(args.filter((arg) => /^--(?:tools|allowed-?tools|allowedTools)\b/i.test(arg))).toEqual(
        [],
      );
    }
  });

  it('runs on the model chosen, and only a model Claude Code knows', () => {
    const args = buildLaunchArgs({ ...OPTIONS, model: 'sonnet' });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'sonnet',
    ]);
    expect(buildLaunchArgs(OPTIONS)).not.toContain('--model');
    for (const model of ['--dangerously-skip-permissions', 'gpt-5', '']) {
      expect(() => buildLaunchArgs({ ...OPTIONS, model: model as 'opus' })).toThrow(
        'Unsupported model',
      );
    }
  });

  it('thinks as hard as chosen, and only at a level Claude Code knows', () => {
    const args = buildLaunchArgs({ ...OPTIONS, model: 'opus', effort: 'xhigh' });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4)).toEqual([
      '--model',
      'opus',
      '--effort',
      'xhigh',
    ]);
    expect(buildLaunchArgs(OPTIONS)).not.toContain('--effort');
    for (const effort of ['--dangerously-skip-permissions', 'ultra', '']) {
      expect(() => buildLaunchArgs({ ...OPTIONS, effort: effort as 'high' })).toThrow(
        'Unsupported effort',
      );
    }
  });

  it('passes acceptEdits as the permission mode', () => {
    const args = buildLaunchArgs({ ...OPTIONS, permissionMode: 'acceptEdits' });
    expect(args.slice(0, 3)).toEqual(['--restricted', '--permission-mode', 'acceptEdits']);
  });

  it('adds the prompt as the last argument', () => {
    const prompt = 'Check the fit for applications/acme-engineer';
    expect(buildLaunchArgs({ ...OPTIONS, prompt })).toEqual([...buildLaunchArgs(OPTIONS), prompt]);
  });

  it('never asks for print mode, bare mode or skipped permissions', () => {
    for (const permissionMode of PERMISSION_MODES) {
      const args = buildLaunchArgs({ ...OPTIONS, permissionMode, prompt: 'Check the fit' });
      for (const flag of ['-p', '--print', '--bare', '--dangerously-skip-permissions']) {
        expect(args).not.toContain(flag);
      }
    }
  });

  it.each(['bypassPermissions', 'plan'])('refuses the %s permission mode', (mode) => {
    const options = { ...OPTIONS, permissionMode: mode as PermissionMode };
    expect(() => buildLaunchArgs(options)).toThrow('Unsupported permission mode');
  });

  it.each(['-p', '--dangerously-skip-permissions'])('refuses %j as a prompt', (prompt) => {
    expect(() => buildLaunchArgs({ ...OPTIONS, prompt })).toThrow('cannot start with "-"');
  });
});

describe('runEnv', () => {
  it('asks Claude Code for its to-do list, which its newest models leave out', () => {
    expect(runEnv({ HOME: '/Users/someone' }, '/usr/bin')).toEqual({
      HOME: '/Users/someone',
      PATH: '/usr/bin',
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
    });
  });

  it('keeps the user’s own choice about it', () => {
    expect(runEnv({ CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' }, '/usr/bin')).toEqual({
      PATH: '/usr/bin',
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '0',
    });
  });
});

describe('launchEnv', () => {
  it('replaces PATH', () => {
    const base = { PATH: '/usr/bin:/bin', HOME: '/Users/someone' };
    expect(launchEnv(base, '/opt/homebrew/bin:/usr/bin:/bin')).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      HOME: '/Users/someone',
    });
  });

  it("replaces Windows' Path, leaving a single PATH", () => {
    const path = 'C:\\Users\\someone\\.local\\bin;C:\\Windows';
    expect(launchEnv({ Path: 'C:\\Windows' }, path)).toEqual({ PATH: path });
  });

  it('removes what a parent Claude Code session sets for its children, and agent teams', () => {
    const base = {
      HOME: '/Users/someone',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SIMPLE: '1',
      CLAUDE_AGENT_SDK_VERSION: '0.1.0',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    };
    expect(launchEnv(base, '/usr/bin')).toEqual({ HOME: '/Users/someone', PATH: '/usr/bin' });
  });

  it("passes the user's own Claude Code setup through untouched", () => {
    const base = {
      ANTHROPIC_BASE_URL: 'https://llm.example.com',
      CLAUDE_CONFIG_DIR: '/Users/someone/.claude-work',
      LANG: 'en_US.UTF-8',
    };
    expect(launchEnv(base, '/usr/bin')).toEqual({ ...base, PATH: '/usr/bin' });
  });

  it('never adds an API key or OAuth token', () => {
    const env = launchEnv({ HOME: '/Users/someone' }, '/usr/bin');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('leaves the given environment as it was', () => {
    const base = { PATH: '/usr/bin', CLAUDECODE: '1' };
    launchEnv(base, '/opt/homebrew/bin');
    expect(base).toEqual({ PATH: '/usr/bin', CLAUDECODE: '1' });
  });

  describe('for a profile with its own Claude Code folder', () => {
    afterEach(() => useClaudeFolder(null));

    it('points Claude Code there, and leaves out any login in the environment', () => {
      useClaudeFolder('/profiles/sam/claude');
      const base = {
        HOME: '/Users/someone',
        CLAUDE_CONFIG_DIR: '/Users/someone/.claude-work',
        ANTHROPIC_API_KEY: 'key',
        ANTHROPIC_AUTH_TOKEN: 'token',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_ANTHROPIC_AWS: '1',
        ANTHROPIC_AWS_API_KEY: 'aws',
        ANTHROPIC_FOUNDRY_AUTH_TOKEN: 'foundry',
        ANTHROPIC_IDENTITY_TOKEN_FILE: '/Users/someone/token',
        AWS_BEARER_TOKEN_BEDROCK: 'bedrock',
        CLAUDE_SECURESTORAGE_CONFIG_DIR: '/Users/someone/.claude',
        ANTHROPIC_BASE_URL: 'https://llm.example.com',
        // Settings that don't sign anyone in stay.
        ANTHROPIC_MODEL: 'opus',
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
      };
      expect(launchEnv(base, '/usr/bin')).toEqual({
        HOME: '/Users/someone',
        ANTHROPIC_BASE_URL: 'https://llm.example.com',
        ANTHROPIC_MODEL: 'opus',
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
        PATH: '/usr/bin',
        CLAUDE_CONFIG_DIR: '/profiles/sam/claude',
      });
      // The app's own environment keeps them, for whatever else it starts.
      expect(base.ANTHROPIC_API_KEY).toBe('key');
    });

    it('leaves them out whatever their case, as Windows reads them', () => {
      useClaudeFolder('C:\\Profiles\\sam\\claude');
      expect(
        launchEnv({ Anthropic_Api_Key: 'key', claude_config_dir: 'C:\\other' }, 'C:\\Windows'),
      ).toEqual({ PATH: 'C:\\Windows', CLAUDE_CONFIG_DIR: 'C:\\Profiles\\sam\\claude' });
    });

    it('goes back to the user’s own setup when the first profile is open', () => {
      useClaudeFolder('/profiles/sam/claude');
      useClaudeFolder(null);
      const base = { CLAUDE_CONFIG_DIR: '/Users/someone/.claude-work', ANTHROPIC_API_KEY: 'key' };
      expect(launchEnv(base, '/usr/bin')).toEqual({ ...base, PATH: '/usr/bin' });
    });
  });
});
