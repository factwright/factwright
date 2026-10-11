import { describe, expect, it } from 'vitest';
import { claudeCommand } from './command.ts';

describe('claudeCommand', () => {
  it('starts claude directly on macOS', () => {
    expect(claudeCommand('/Users/someone/.local/bin/claude', ['--version'], 'darwin')).toEqual({
      file: '/Users/someone/.local/bin/claude',
      args: ['--version'],
      verbatim: false,
    });
  });

  it('starts claude.exe directly on Windows', () => {
    const claude = 'C:\\Users\\someone\\.local\\bin\\claude.exe';
    expect(claudeCommand(claude, ['auth', 'status', '--json'], 'win32')).toEqual({
      file: claude,
      args: ['auth', 'status', '--json'],
      verbatim: false,
    });
  });

  it('starts claude.cmd through cmd.exe, with every part quoted', () => {
    const claude = 'C:\\Users\\some one\\AppData\\Roaming\\npm\\claude.cmd';
    expect(claudeCommand(claude, ['--version'], 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${claude}" "--version""`],
      verbatim: true,
    });
  });
});
