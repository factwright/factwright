import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signInCommand } from '../../shared/claude-commands.ts';
import { type FindDeps, installedClaude } from './find.ts';

// The commands the window shows for a Claude Code that's off PATH, run as the user runs them: in
// a new terminal window, after Claude Code's own installer put it in .local/bin in a home folder
// of the test's own, which isn't on PATH. A stand-in answers for Claude Code, noting what it was
// asked and which Claude Code folder it had. The terminal's PATH has no Claude Code on it, so
// none is ever reached.

const WINDOWS = process.platform === 'win32';

interface Terminal {
  name: string;
  /** The system whose commands it takes: PowerShell's, or a Mac's shell's. */
  platform: NodeJS.Platform;
  file: string;
  /** Its arguments for running a command as if pasted in. */
  args: (command: string) => string[];
}

/** A program on the PATH the tests run with. */
const onPath = (name: string) =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((folder) => join(folder, name))
    .find((path) => existsSync(path));

const POWERSHELLS = [
  WINDOWS
    ? join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : undefined,
  onPath(WINDOWS ? 'pwsh.exe' : 'pwsh'),
].filter((file): file is string => file !== undefined && existsSync(file));

const TERMINALS: Terminal[] = [
  ...['/bin/zsh', '/bin/bash', '/bin/sh']
    .filter((file) => !WINDOWS && existsSync(file))
    .map((file) => ({
      name: file,
      platform: 'darwin' as const,
      file,
      args: (command: string) => ['-c', command],
    })),
  // PowerShell reads the command as typed, with no command line to quote it through.
  ...POWERSHELLS.map((file) => ({
    name: basename(file),
    platform: 'win32' as const,
    file,
    args: (command: string) => [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
  })),
];

/** Notes each start of the stand-in, one line of JSON each, then stops. */
const STAND_IN = `const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
// Started as a copy of Node on Windows, which takes the first word for its script's path.
const args = process.env.STAND_IN_AS_NODE
  ? [basename(process.argv[1]), ...process.argv.slice(2)]
  : process.argv.slice(2);
const folder = process.env.CLAUDE_CONFIG_DIR ?? null;
appendFileSync(process.env.STAND_IN_LOG, JSON.stringify({ args, folder }) + '\\n');
process.exit(0);
`;

let root: string;
let home: string;
let standIn: string;
let log: string;
/** The terminal's PATH: an empty folder, and on Windows the system's own. */
let path: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-terminal-'));
  home = join(root, 'home');
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, 'empty'));
  standIn = join(root, 'stand-in.cjs');
  writeFileSync(standIn, STAND_IN);
  log = join(root, 'starts.jsonl');
  if (WINDOWS) {
    // claude.exe where the installer leaves it: a copy of Node, which runs the stand-in first.
    copyFileSync(process.execPath, join(bin, 'claude.exe'));
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    path = [join(root, 'empty'), join(system, 'System32'), system].join(delimiter);
    // PowerShell's first start can take half a minute on a busy computer, which would use up a
    // test's own time, so each one starts once first.
    for (const file of POWERSHELLS) {
      spawnSync(file, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeout: 120_000 });
    }
  } else {
    // claude for the Mac's shells, and claude.exe for PowerShell's name for it.
    for (const name of ['claude', 'claude.exe']) {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${standIn}' "$@"\n`);
      chmodSync(join(bin, name), 0o755);
    }
    path = join(root, 'empty');
  }
}, 300_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs a command in a new window of the terminal, as if pasted in. */
function run(terminal: Terminal, command: string): SpawnSyncReturns<string> {
  // Windows' environment ignores case, so its own spellings of these go first.
  const replaced = new Set(['PATH', 'HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'NODE_OPTIONS']);
  const kept = Object.entries(process.env).filter(([name]) => !replaced.has(name.toUpperCase()));
  return spawnSync(terminal.file, terminal.args(command), {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...(WINDOWS ? Object.fromEntries(kept) : {}),
      PATH: path,
      HOME: home,
      USERPROFILE: home,
      STAND_IN_LOG: log,
      POWERSHELL_TELEMETRY_OPTOUT: '1',
      POWERSHELL_UPDATECHECK: 'Off',
      ...(WINDOWS && {
        NODE_OPTIONS: `--require ${standIn.replaceAll('\\', '/')}`,
        STAND_IN_AS_NODE: '1',
      }),
    },
  });
}

/** What the stand-in noted since the last look. */
function starts(): { args: string[]; folder: string | null }[] {
  if (!existsSync(log)) return [];
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  rmSync(log);
  return lines.map((line) => JSON.parse(line));
}

/** FindDeps with only what installedClaude reads. */
const system = (platform: NodeJS.Platform): FindDeps => ({
  platform,
  env: {},
  home: platform === 'win32' ? 'C:\\Users\\someone' : '/Users/someone',
  isFile: async () => false,
  runShell: async () => '',
});

describe.each(TERMINALS.map((terminal) => [terminal.name, terminal] as const))(
  'in a new %s window',
  (_, terminal) => {
    // The same for everyone, as the shell fills in the home folder.
    const claude = installedClaude(system(terminal.platform));

    it('finds no claude by name, as after Claude Code’s installer', () => {
      expect(claude).toBe(
        terminal.platform === 'win32'
          ? '& "$env:USERPROFILE\\.local\\bin\\claude.exe"'
          : '~/.local/bin/claude',
      );
      const result = run(terminal, 'claude auth login');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not recognized|not found/);
      expect(starts()).toEqual([]);
    });

    it.each([
      ['signs in', signInCommand(terminal.platform, null, claude), ['auth', 'login']],
      ['updates', `${claude} update`, ['update']],
    ])('%s with the command the window shows', (_, command, args) => {
      const result = run(terminal, command);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(starts()).toEqual([{ args, folder: null }]);
    });

    it('prints its version with the command the window shows', () => {
      const result = run(terminal, `${claude} --version`);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      // A copy of Node answers this itself, before the stand-in starts.
      if (WINDOWS) expect(result.stdout.trim()).toBe(process.version);
      else expect(starts()).toEqual([{ args: ['--version'], folder: null }]);
    });

    it('signs in an added profile with its own folder, quoted for the terminal', () => {
      const folder = join(root, 'Profiles', "Sam O'Neil’s $HOME", 'claude');
      const command = signInCommand(terminal.platform, folder, claude);
      // PowerShell keeps a setting for the rest of the window, so the command puts it back.
      const result =
        terminal.platform === 'win32'
          ? run(
              terminal,
              `$env:CLAUDE_CONFIG_DIR = 'before'; ${command}; "after: $env:CLAUDE_CONFIG_DIR"`,
            )
          : run(terminal, command);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(starts()).toEqual([{ args: ['auth', 'login'], folder }]);
      if (terminal.platform === 'win32') expect(result.stdout.trim()).toBe('after: before');
    });
  },
  60_000,
);
