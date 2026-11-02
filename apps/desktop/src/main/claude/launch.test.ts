import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLaunchArgs,
  type LaunchOptions,
  launchEnv,
  PERMISSION_MODES,
  type PermissionMode,
  RUN_TOOLS,
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
      `--tools=${RUN_TOOLS.join(',')}`,
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

  it('names the built-in tools a run keeps, and never one that runs code or fetches pages', () => {
    expect(RUN_TOOLS).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Edit',
      'Write',
      'AskUserQuestion',
      'Skill',
      'Agent',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskUpdate',
      'TaskStop',
      'TodoWrite',
      'WebSearch',
    ]);
    // Naming one of these would lift the deny rule --restricted gives it, which no setting lifts.
    for (const tool of ['Bash', 'PowerShell', 'REPL', 'WebFetch', 'Monitor', 'Workflow']) {
      expect(RUN_TOOLS).not.toContain(tool);
    }
    for (const options of [OPTIONS, { ...OPTIONS, prompt: '/factwright:analyze-job job acme' }]) {
      const args = buildLaunchArgs(options);
      expect(args[0]).toBe('--restricted');
      expect(args.filter((arg) => /^--(?:tools|allowed-?tools|allowedTools)\b/i.test(arg))).toEqual(
        [`--tools=${RUN_TOOLS.join(',')}`],
      );
    }
  });

  it('leaves nothing for an option that takes several values to read as one of them', () => {
    // --tools carries its list in its own argument. --mcp-config, the other such option, has
    // another option after it, so neither can take in the prompt or a path.
    const prompt = '/factwright:analyze-job job acme';
    const args = buildLaunchArgs({ ...OPTIONS, model: 'opus', effort: 'high', prompt });
    expect(args).not.toContain('--tools');
    expect(args[args.indexOf('--mcp-config') + 2]).toBe('--strict-mcp-config');
    expect(args.at(-1)).toBe(prompt);
    expect(args.at(-2)).toBe(OPTIONS.settings);
    expect(args.at(-3)).toBe('--settings');
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
  it('asks Claude Code for its to-do list, and for no session title or advisor', () => {
    expect(runEnv({ HOME: '/Users/someone' }, '/usr/bin')).toEqual({
      HOME: '/Users/someone',
      PATH: '/usr/bin',
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
      CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
    });
  });

  it('keeps the user’s own choice about each', () => {
    const own = {
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '0',
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0',
      CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '0',
    };
    expect(runEnv(own, '/usr/bin')).toEqual({ ...own, PATH: '/usr/bin' });
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

  it('removes what would turn prompt suggestions back on, however Windows spells it', () => {
    for (const name of [
      'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION',
      'claude_code_enable_prompt_suggestion',
    ]) {
      expect(runEnv({ [name]: '1' }, '/usr/bin')).not.toHaveProperty(name);
    }
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
