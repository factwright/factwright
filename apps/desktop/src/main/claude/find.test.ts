import { describe, expect, it, vi } from 'vitest';
import { type FindDeps, findClaude } from './find.ts';

/** A made-up computer where only `files` exist and the login shell finds nothing. */
function computer(
  platform: NodeJS.Platform,
  files: string[],
  overrides: Partial<FindDeps> = {},
): FindDeps {
  return {
    platform,
    env: {},
    home: platform === 'win32' ? 'C:\\Users\\someone' : '/Users/someone',
    isFile: async (path) => files.includes(path),
    runShell: vi.fn(async () => {
      throw new Error('claude not found');
    }),
    ...overrides,
  };
}

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
