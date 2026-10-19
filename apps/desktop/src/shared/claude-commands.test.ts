import { describe, expect, it } from 'vitest';
import { claudeByPath, signInCommand } from './claude-commands.ts';

describe('starting Claude Code by its whole path', () => {
  it('writes the native install as Anthropic’s guide does, the same for everyone', () => {
    expect(claudeByPath('win32', 'C:\\Users\\Sam\\.local\\bin\\claude.exe', 'C:\\Users\\Sam')).toBe(
      '& "$env:USERPROFILE\\.local\\bin\\claude.exe"',
    );
    expect(claudeByPath('darwin', '/Users/sam/.local/bin/claude', '/Users/sam')).toBe(
      '~/.local/bin/claude',
    );
  });

  it('matches the home folder as Windows does, whatever the case', () => {
    expect(
      claudeByPath(
        'win32',
        'c:\\users\\sam\\AppData\\Roaming\\npm\\claude.cmd',
        'C:\\Users\\Sam\\',
      ),
    ).toBe('& "$env:USERPROFILE\\AppData\\Roaming\\npm\\claude.cmd"');
  });

  it('quotes a path outside the home folder, for PowerShell after its call operator', () => {
    expect(claudeByPath('win32', 'D:\\Tools\\Claude Code\\claude.exe', 'C:\\Users\\Sam')).toBe(
      "& 'D:\\Tools\\Claude Code\\claude.exe'",
    );
    expect(claudeByPath('darwin', '/opt/homebrew/bin/claude', '/Users/sam')).toBe(
      "'/opt/homebrew/bin/claude'",
    );
    // A folder whose name starts like the home folder's is another folder.
    expect(claudeByPath('darwin', '/Users/samantha/.local/bin/claude', '/Users/sam')).toBe(
      "'/Users/samantha/.local/bin/claude'",
    );
  });

  it('quotes the whole path when the part in the home folder would need quoting', () => {
    expect(
      claudeByPath('win32', 'C:\\Users\\Sam\\O’Neil’s $tools\\claude.exe', 'C:\\Users\\Sam'),
    ).toBe("& 'C:\\Users\\Sam\\O’’Neil’’s $tools\\claude.exe'");
    expect(claudeByPath('darwin', "/Users/sam/Sam's tools/claude", '/Users/sam')).toBe(
      "'/Users/sam/Sam'\\''s tools/claude'",
    );
  });
});

describe('the command that signs Claude Code in', () => {
  it('is Claude Code’s own, for the first profile', () => {
    expect(signInCommand('darwin', null, 'claude')).toBe('claude auth login');
    expect(signInCommand('win32', null, 'claude')).toBe('claude auth login');
    expect(signInCommand('win32', null, '& "$env:USERPROFILE\\.local\\bin\\claude.exe"')).toBe(
      '& "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login',
    );
  });

  it('names an added profile’s own folder, quoted for its terminal', () => {
    expect(
      signInCommand(
        'darwin',
        "/Users/o'neil/Library/Application Support/Factwright/claude",
        'claude',
      ),
    ).toBe(
      "CLAUDE_CONFIG_DIR='/Users/o'\\''neil/Library/Application Support/Factwright/claude' claude auth login",
    );
    expect(signInCommand('darwin', '/Users/sam/Factwright/claude', '~/.local/bin/claude')).toBe(
      "CLAUDE_CONFIG_DIR='/Users/sam/Factwright/claude' ~/.local/bin/claude auth login",
    );
  });

  it('puts PowerShell’s folder back afterward, which it would otherwise keep for the window', () => {
    const folder = 'C:\\Users\\O’Neil\\AppData\\Roaming\\Factwright\\claude';
    expect(signInCommand('win32', folder, 'claude')).toBe(
      "$saved = $env:CLAUDE_CONFIG_DIR; try { $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\O’’Neil\\AppData\\Roaming\\Factwright\\claude'; claude auth login } finally { $env:CLAUDE_CONFIG_DIR = $saved }",
    );
    expect(signInCommand('win32', folder, '& "$env:USERPROFILE\\.local\\bin\\claude.exe"')).toBe(
      '$saved = $env:CLAUDE_CONFIG_DIR; try { $env:CLAUDE_CONFIG_DIR = \'C:\\Users\\O’’Neil\\AppData\\Roaming\\Factwright\\claude\'; & "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login } finally { $env:CLAUDE_CONFIG_DIR = $saved }',
    );
  });
});
