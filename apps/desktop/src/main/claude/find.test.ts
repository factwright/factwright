import { posix, win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  claudeInTerminal,
  type FindDeps,
  findClaude,
  installedClaude,
  packageManagerUpdate,
} from './find.ts';

/** A made-up computer where only `files` exist and the login shell finds nothing. */
function computer(
  platform: NodeJS.Platform,
  files: string[],
  overrides: Partial<FindDeps> = {},
): FindDeps {
  // A file is found as the system finds it, however its path is written: on Windows, in any case.
  const key = (path: string) =>
    platform === 'win32' ? win32.normalize(path).toLowerCase() : posix.normalize(path);
  return {
    platform,
    env: {},
    home: platform === 'win32' ? 'C:\\Users\\someone' : '/Users/someone',
    isFile: async (path) => files.some((file) => key(file) === key(path)),
    realPath: async (path) => path,
    runShell: vi.fn(async () => {
      throw new Error('claude not found');
    }),
    ...overrides,
  };
}

describe('packageManagerUpdate', () => {
  /** A computer where the claude found is really at `real`. */
  const leadingTo = (platform: NodeJS.Platform, real: string) =>
    computer(platform, [], { realPath: async () => real });

  it.each([
    ['/opt/homebrew/Caskroom/claude-code/2.1.309/claude', 'brew upgrade claude-code'],
    ['/opt/homebrew/Caskroom/claude-code@latest/2.1.316/claude', 'brew upgrade claude-code@latest'],
    ['/usr/local/Caskroom/claude-code/2.1.309/claude', 'brew upgrade claude-code'],
  ])('names the cask at %s', async (real, command) => {
    const deps = leadingTo('darwin', real);
    expect(await packageManagerUpdate('/opt/homebrew/bin/claude', true, deps)).toBe(command);
  });

  it('gives brew by its whole path when a new terminal doesn’t find claude by name', async () => {
    const real = '/opt/homebrew/Caskroom/claude-code/2.1.309/claude';
    const deps = leadingTo('darwin', real);
    expect(await packageManagerUpdate('/opt/homebrew/bin/claude', false, deps)).toBe(
      "'/opt/homebrew/bin/brew' upgrade claude-code",
    );
    expect(
      await packageManagerUpdate(
        '/Users/someone/brew/bin/claude',
        false,
        leadingTo('darwin', '/Users/someone/brew/Caskroom/claude-code/2.1.309/claude'),
      ),
    ).toBe('~/brew/bin/brew upgrade claude-code');
  });

  it.each([
    'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe',
    'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe',
    'C:\\Program Files\\microsoft\\winget\\packages\\Anthropic.ClaudeCode\\claude.exe',
  ])('gives WinGet’s command for %s', async (real) => {
    const deps = leadingTo('win32', real);
    expect(await packageManagerUpdate(real, true, deps)).toBe(
      'winget upgrade Anthropic.ClaudeCode',
    );
  });

  it.each([
    ['darwin', '/Users/someone/.local/share/claude/versions/2.1.314'],
    ['darwin', '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js'],
    ['darwin', '/Users/someone/Caskroom-notes/claude'],
    ['win32', 'C:\\Users\\someone\\.local\\bin\\claude.exe'],
    ['win32', 'C:\\Users\\someone\\AppData\\Roaming\\npm\\claude.cmd'],
  ] as const)('leaves %s %s to `claude update`', async (platform, real) => {
    expect(await packageManagerUpdate(real, true, leadingTo(platform, real))).toBeNull();
  });

  it('puts only a plain cask name into a command', async () => {
    for (const name of ['claude code', '--force', 'claude;rm', "claude'code"]) {
      const real = `/opt/homebrew/Caskroom/${name}/2.1.309/claude`;
      expect(await packageManagerUpdate(real, true, leadingTo('darwin', real))).toBeNull();
    }
  });

  it('goes by the path found when the system can’t say where it leads', async () => {
    const links = 'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe';
    const deps = computer('win32', [], {
      realPath: async () => {
        throw new Error('EPERM');
      },
    });
    expect(await packageManagerUpdate(links, true, deps)).toBe(
      'winget upgrade Anthropic.ClaudeCode',
    );
  });
});

describe('findClaude on macOS', () => {
  it('takes the first PATH folder that has claude', async () => {
    const files = ['/Users/someone/.volta/bin/claude', '/Users/someone/.bun/bin/claude'];
    const env = { PATH: '/usr/bin:/Users/someone/.volta/bin:/Users/someone/.bun/bin' };
    const deps = computer('darwin', files, { env });
    expect(await findClaude(deps)).toBe('/Users/someone/.volta/bin/claude');
  });

  it('looks on PATH before the install spots', async () => {
    const files = ['/Users/someone/.local/bin/claude', '/opt/homebrew/bin/claude'];
    const env = { PATH: '/usr/bin:/opt/homebrew/bin' };
    expect(await findClaude(computer('darwin', files, { env }))).toBe('/opt/homebrew/bin/claude');
  });

  it('skips PATH folders that are empty or relative', async () => {
    const env = { PATH: ':.:node_modules/.bin' };
    const deps = computer('darwin', ['claude', 'node_modules/.bin/claude'], { env });
    expect(await findClaude(deps)).toBeNull();
  });

  it.each([
    '/Users/someone/.local/bin/claude',
    '/Users/someone/.claude/local/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/Users/someone/.npm-global/bin/claude',
  ])('falls back to %s without asking the shell', async (path) => {
    const deps = computer('darwin', [path], { env: { PATH: '/usr/bin:/bin' } });
    expect(await findClaude(deps)).toBe(path);
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('prefers the native install to an npm one', async () => {
    const files = ['/Users/someone/.npm-global/bin/claude', '/Users/someone/.local/bin/claude'];
    expect(await findClaude(computer('darwin', files))).toBe('/Users/someone/.local/bin/claude');
  });

  it('asks the login shell last, taking the last path it prints', async () => {
    const runShell = vi.fn(async () => 'Welcome back!\n/Users/someone/work\n/opt/tools/claude\n');
    const deps = computer('darwin', ['/opt/tools/claude'], { runShell });
    expect(await findClaude(deps)).toBe('/opt/tools/claude');
    expect(runShell).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'command -v claude']);
  });

  it('asks the shell named in SHELL', async () => {
    const deps = computer('darwin', [], { env: { SHELL: '/bin/bash' } });
    await findClaude(deps);
    expect(deps.runShell).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'command -v claude']);
  });

  it('returns null when the shell fails or times out', async () => {
    expect(await findClaude(computer('darwin', []))).toBeNull();
  });

  it.each([
    ['no path', "alias claude='claude --verbose'\n"],
    ['a path to no file', '/Users/someone/work\n'],
  ])('returns null when the shell prints %s', async (_, output) => {
    const deps = computer('darwin', [], { runShell: async () => output });
    expect(await findClaude(deps)).toBeNull();
  });
});

describe('findClaude on Windows', () => {
  const PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.JS';

  it('finds claude.exe on PATH', async () => {
    const links = 'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WinGet\\Links';
    const env = { PATH: `C:\\Windows\\System32;${links}`, PATHEXT };
    const deps = computer('win32', [`${links}\\claude.exe`], { env });
    expect(await findClaude(deps)).toBe(`${links}\\claude.exe`);
  });

  it("finds claude.cmd on PATH, never npm's extensionless script", async () => {
    const files = ['D:\\tools\\npm\\claude', 'D:\\tools\\npm\\claude.cmd'];
    const deps = computer('win32', files, { env: { PATH: 'D:\\tools\\npm', PATHEXT } });
    expect(await findClaude(deps)).toBe('D:\\tools\\npm\\claude.cmd');
  });

  it('tries the PATHEXT extensions in order', async () => {
    const files = ['D:\\tools\\claude.cmd', 'D:\\tools\\claude.exe'];
    const exeFirst = computer('win32', files, { env: { PATH: 'D:\\tools', PATHEXT } });
    const cmdFirst = computer('win32', files, { env: { PATH: 'D:\\tools', PATHEXT: '.CMD;.EXE' } });
    expect(await findClaude(exeFirst)).toBe('D:\\tools\\claude.exe');
    expect(await findClaude(cmdFirst)).toBe('D:\\tools\\claude.cmd');
  });

  it("uses Windows' default extensions when PATHEXT isn't set", async () => {
    const deps = computer('win32', ['D:\\tools\\claude.cmd'], { env: { PATH: 'D:\\tools' } });
    expect(await findClaude(deps)).toBe('D:\\tools\\claude.cmd');
  });

  it.each([
    'C:\\Users\\someone\\.local\\bin\\claude.exe',
    'C:\\Users\\someone\\AppData\\Roaming\\npm\\claude.cmd',
  ])('falls back to %s', async (path) => {
    const env = {
      PATH: 'C:\\Windows\\System32',
      PATHEXT,
      APPDATA: 'C:\\Users\\someone\\AppData\\Roaming',
    };
    expect(await findClaude(computer('win32', [path], { env }))).toBe(path);
  });

  it('skips the Claude.exe an older Claude Desktop puts among Windows’ app aliases', async () => {
    // Running it opens the desktop app, not Claude Code.
    const aliases = 'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps\\';
    const native = 'C:\\Users\\someone\\.local\\bin\\claude.exe';
    const env = { PATH: `C:\\Windows\\System32;${aliases}`, PATHEXT };
    const deps = computer('win32', [`${aliases}Claude.exe`, native], { env });
    expect(await findClaude(deps)).toBe(native);
    expect(await findClaude(computer('win32', [`${aliases}Claude.exe`], { env }))).toBeNull();
  });

  it("skips relative paths, such as npm's when APPDATA is missing", async () => {
    const env = { PATH: '.', PATHEXT };
    const deps = computer('win32', ['claude.exe', 'npm\\claude.cmd'], { env });
    expect(await findClaude(deps)).toBeNull();
  });

  it('never asks a shell', async () => {
    const deps = computer('win32', [], { env: { PATHEXT } });
    expect(await findClaude(deps)).toBeNull();
    expect(deps.runShell).not.toHaveBeenCalled();
  });
});

describe('what the user types to start claude in a new terminal window', () => {
  const PATHEXT = '.COM;.EXE;.BAT;.CMD';
  const NATIVE_WINDOWS = 'C:\\Users\\someone\\.local\\bin\\claude.exe';
  const NATIVE_MAC = '/Users/someone/.local/bin/claude';

  it('is just claude on PATH, which a new PowerShell window has too', async () => {
    const env = { PATH: 'C:\\Windows\\System32;C:\\Users\\someone\\.local\\bin', PATHEXT };
    const deps = computer('win32', [NATIVE_WINDOWS], { env });
    expect(await findClaude(deps)).toBe(NATIVE_WINDOWS);
    expect(await claudeInTerminal(NATIVE_WINDOWS, deps)).toBeNull();
    // PATH's folders, as Windows reads them, whatever their case or a last backslash.
    const spelled = { PATH: 'c:\\users\\SOMEONE\\.local\\bin\\', PATHEXT };
    expect(
      await claudeInTerminal(NATIVE_WINDOWS, computer('win32', [NATIVE_WINDOWS], { env: spelled })),
    ).toBeNull();
  });

  it('is its whole path for the native install on Windows, whose installer never adds it to PATH', async () => {
    const deps = computer('win32', [NATIVE_WINDOWS], {
      env: { PATH: 'C:\\Windows\\System32', PATHEXT },
    });
    expect(await findClaude(deps)).toBe(NATIVE_WINDOWS);
    expect(await claudeInTerminal(NATIVE_WINDOWS, deps)).toBe(
      '& "$env:USERPROFILE\\.local\\bin\\claude.exe"',
    );
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('is its whole path when claude in a new PowerShell window would open Claude Desktop', async () => {
    const aliases = 'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps';
    const env = { PATH: `${aliases};C:\\Users\\someone\\.local\\bin`, PATHEXT };
    const deps = computer('win32', [`${aliases}\\Claude.exe`, NATIVE_WINDOWS], { env });
    expect(await findClaude(deps)).toBe(NATIVE_WINDOWS);
    expect(await claudeInTerminal(NATIVE_WINDOWS, deps)).toBe(
      '& "$env:USERPROFILE\\.local\\bin\\claude.exe"',
    );
  });

  it('is its whole path for npm’s claude.cmd off PATH', async () => {
    const npm = 'C:\\Users\\someone\\AppData\\Roaming\\npm\\claude.cmd';
    const env = { PATH: '', PATHEXT, APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' };
    const deps = computer('win32', [npm], { env });
    expect(await findClaude(deps)).toBe(npm);
    expect(await claudeInTerminal(npm, deps)).toBe(
      '& "$env:USERPROFILE\\AppData\\Roaming\\npm\\claude.cmd"',
    );
  });

  it('is just claude on the PATH of a Mac app started from a terminal, without asking the shell', async () => {
    const deps = computer('darwin', [NATIVE_MAC], {
      env: { PATH: '/usr/bin:/Users/someone/.local/bin' },
    });
    expect(await claudeInTerminal(NATIVE_MAC, deps)).toBeNull();
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('asks the login shell on a Mac, as an app opened from Finder has a shorter PATH', async () => {
    // A PATH folder written with a last slash still finds the same claude.
    const runShell = vi.fn(async () => 'Welcome back!\n/Users/someone/.local/bin//claude\n');
    const deps = computer('darwin', [NATIVE_MAC], { env: { PATH: '/usr/bin:/bin' }, runShell });
    expect(await findClaude(deps)).toBe(NATIVE_MAC);
    expect(await claudeInTerminal(NATIVE_MAC, deps)).toBeNull();
    expect(runShell).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'command -v claude']);
  });

  it('is its whole path on a Mac whose Terminal doesn’t have ~/.local/bin on PATH', async () => {
    const deps = computer('darwin', [NATIVE_MAC], { env: { PATH: '/usr/bin:/bin' } });
    expect(await findClaude(deps)).toBe(NATIVE_MAC);
    expect(await claudeInTerminal(NATIVE_MAC, deps)).toBe('~/.local/bin/claude');
  });

  it('is its whole path when a new terminal would start another claude', async () => {
    const runShell = vi.fn(async () => '/opt/homebrew/bin/claude\n');
    const files = [NATIVE_MAC, '/opt/homebrew/bin/claude'];
    const deps = computer('darwin', files, { env: { PATH: '/usr/bin:/bin' }, runShell });
    expect(await findClaude(deps)).toBe(NATIVE_MAC);
    expect(await claudeInTerminal(NATIVE_MAC, deps)).toBe('~/.local/bin/claude');
  });

  it('is where the native installer puts it, while it isn’t installed', () => {
    expect(installedClaude(computer('win32', []))).toBe(
      '& "$env:USERPROFILE\\.local\\bin\\claude.exe"',
    );
    expect(installedClaude(computer('darwin', []))).toBe('~/.local/bin/claude');
  });
});
