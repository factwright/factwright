import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupCheck } from '../../shared/api.ts';
import type { HookListener, ListenOptions, ToolsListener } from './run-server.ts';
import { type CheckProcess, checkSetup, SetupChecker, type SetupFinding } from './self-test.ts';
import type { Launch } from './session.ts';

const LAUNCH: Launch = {
  file: 'claude',
  args: [],
  cwd: '/workspace',
  env: {},
  token: 'a'.repeat(64),
  files: [],
  levels: 'best',
  model: undefined,
  effort: undefined,
};
const CTRL_C = '\x03';

/** A run server that hands the check's listeners to the test, which plays Claude Code's calls. */
function fakeServer() {
  const heard: { hooks?: HookListener; tools?: ToolsListener | undefined; stopped: boolean } = {
    stopped: false,
  };
  return {
    heard,
    listen: vi.fn((_token: string, hooks: HookListener, options: ListenOptions = {}) => {
      heard.hooks = hooks;
      heard.tools = options.tools;
      return () => {
        heard.stopped = true;
      };
    }),
  };
}

/** A hidden Claude Code that shows, and does, what each test says. */
function fakeClaude() {
  let shown: (text: string) => void = () => {};
  let exited: (exit: { exitCode: number }) => void = () => {};
  const claude = {
    written: [] as string[],
    killed: false,
    onData: (listener: (text: string) => void) => {
      shown = listener;
    },
    onExit: (listener: (exit: { exitCode: number }) => void) => {
      exited = listener;
    },
    write: (text: string) => {
      claude.written.push(text);
    },
    kill: () => {
      claude.killed = true;
    },
    show: (text: string) => shown(text),
    exit: (exitCode = 0) => exited({ exitCode }),
  };
  return claude satisfies CheckProcess;
}

describe('checkSetup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function begin(signal?: AbortSignal) {
    const server = fakeServer();
    const claude = fakeClaude();
    const start = vi.fn(() => claude);
    const found = checkSetup({
      launch: async () => LAUNCH,
      start,
      server,
      ...(signal && { signal }),
    });
    await vi.advanceTimersByTimeAsync(0);
    return { server, claude, start, found };
  }

  it('passes when Claude Code reaches the tools, and its hook arrives as it closes', async () => {
    const { server, claude, start, found } = await begin();
    expect(start).toHaveBeenCalledWith(LAUNCH);
    expect(server.listen).toHaveBeenCalledWith(LAUNCH.token, expect.any(Function), {
      tools: expect.any(Function),
    });
    server.heard.tools?.('initialize');
    expect(claude.written).toEqual([]);
    server.heard.tools?.('tools/list');
    await vi.advanceTimersByTimeAsync(1000);
    // Closed the way the user closes it, which ends the session.
    expect(claude.written).toEqual([CTRL_C, CTRL_C]);
    server.heard.hooks?.({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    claude.exit();
    await vi.advanceTimersByTimeAsync(300);
    await expect(found).resolves.toEqual({ result: 'passed' });
    expect(server.heard.stopped).toBe(true);
  });

  it('stops at the question about trusting the workspace, which the first run answers', async () => {
    const { claude, found } = await begin();
    claude.show(
      '\x1b[1mQuick safety check:\x1b[22m Is this a project you created or one you trust?',
    );
    await expect(found).resolves.toEqual({ result: 'untrusted' });
    expect(claude.killed).toBe(true);
    // Even when the question comes in one big piece, with a long redraw after it.
    const big = await begin();
    big.claude.show(`Do you trust the files in this folder?${' '.repeat(20_000)}`);
    await expect(big.found).resolves.toEqual({ result: 'untrusted' });
  });

  it('stops at Claude Code’s first-run screens, which the user goes through in Claude’s panel', async () => {
    const { claude, found } = await begin();
    // As Claude Code 2.1.302 draws its first screen, in pieces, moving the cursor between words.
    claude.show("\x1b[2GLet's\x1b[8Gget\x1b[12Gstarted.\r\r\n\r\r\n\x1b[2G\x1b[1mChoose\x1b[9Gthe");
    claude.show('\x1b[13Gtext\x1b[18Gstyle\x1b[24Gthat\x1b[29Glooks\x1b[35Gbest');
    // At once, not after a minute.
    await expect(found).resolves.toEqual({ result: 'first-run' });
    expect(claude.killed).toBe(true);
    // Its security notes say to use it with code you trust, which isn't the question about trust.
    const notes = await begin();
    notes.claude.show(
      `\x1b[1mSecurity notes:\x1b[22m 1. Claude can make mistakes. 2. Due to prompt injection risks, only use it with code you trust${' '.repeat(20_000)}`,
    );
    await expect(notes.found).resolves.toEqual({ result: 'first-run' });
  });

  it('says what Claude Code showed when it closes before reaching the tools', async () => {
    const { claude, found } = await begin();
    claude.show("error: unknown option '--restricted'\r\n");
    claude.exit(1);
    await vi.advanceTimersByTimeAsync(300);
    await expect(found).resolves.toEqual({
      result: 'failed',
      problem:
        "Claude Code closed before it reached Factwright’s tools. It last showed: “error: unknown option '--restricted'”.",
    });
  });

  it('fails when the hooks never arrive', async () => {
    const { server, claude, found } = await begin();
    server.heard.tools?.('tools/list');
    await vi.advanceTimersByTimeAsync(1000);
    claude.exit();
    await vi.advanceTimersByTimeAsync(300);
    await expect(found).resolves.toEqual({
      result: 'failed',
      problem: 'Claude Code reached Factwright’s tools, but its hooks didn’t reach the app.',
    });
  });

  it('gives Claude Code a minute to reach the tools, and time to close', async () => {
    const slow = await begin();
    slow.claude.show('Select a theme');
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(slow.found).resolves.toEqual({
      result: 'failed',
      problem:
        'Claude Code didn’t reach Factwright’s tools within a minute. It last showed: “Select a theme”.',
    });
    expect(slow.claude.killed).toBe(true);
    const stuck = await begin();
    stuck.server.heard.tools?.('tools/list');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(stuck.found).resolves.toMatchObject({
      result: 'failed',
      problem: expect.stringMatching(/^Claude Code reached Factwright’s tools, but didn’t close/),
    });
  });

  it('finds nothing when Claude Code isn’t ready, or the app quits mid-check', async () => {
    const start = vi.fn();
    const server = fakeServer();
    await expect(checkSetup({ launch: async () => null, start, server })).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
    const stopper = new AbortController();
    const { claude, found } = await begin(stopper.signal);
    stopper.abort();
    await expect(found).resolves.toBeNull();
    expect(claude.killed).toBe(true);
  });

  it('says so when Claude Code can’t start at all', async () => {
    const server = fakeServer();
    const found = checkSetup({
      launch: async () => LAUNCH,
      start: () => {
        throw new Error('spawn claude ENOENT');
      },
      server,
    });
    await expect(found).resolves.toEqual({
      result: 'failed',
      problem: 'Claude Code didn’t start: Error: spawn claude ENOENT',
    });
    expect(server.heard.stopped).toBe(true);
  });
});

describe('SetupChecker', () => {
  let folder: string;
  let file: string;
  let check: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<SetupFinding | null>>>;
  let onChange: ReturnType<typeof vi.fn<(check: SetupCheck) => void>>;
  let busy = false;
  const NOW = () => new Date('2026-10-11T18:00:00.000Z');
  const PASSED = { version: '2.1.300', result: 'passed', at: '2026-10-11T18:00:00.000Z' };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'factwright-setup-'));
    file = join(folder, 'setup-check.json');
    check = vi.fn(async () => ({ result: 'passed' }) as const);
    onChange = vi.fn();
    busy = false;
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  const checker = () =>
    new SetupChecker({ file, check, onChange, now: NOW, busy: () => busy, waitMs: 20 });
  /** A check that runs until it's stopped, as a hidden Claude Code would. */
  const untilStopped = (signal: AbortSignal) =>
    new Promise<SetupFinding | null>((resolve) =>
      signal.addEventListener('abort', () => resolve(null), { once: true }),
    );

  it('checks a new version once the app settles, keeps what it found, and skips one that passed', async () => {
    const first = checker();
    await first.load();
    expect(first.current()).toBeNull();
    first.checkIfNeeded('2.1.300');
    first.checkIfNeeded('2.1.300');
    expect(check).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(PASSED));
    expect(check).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(PASSED));
    // The next launch remembers it, and checks only a newer version.
    const next = checker();
    await next.load();
    expect(next.current()).toEqual(PASSED);
    next.checkIfNeeded('2.1.300');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(check).toHaveBeenCalledOnce();
    next.checkIfNeeded('2.1.301');
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  });

  it('checks a version that didn’t pass once a launch, and again when asked', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: '2.1.300', result: 'untrusted', at: '2026-10-10T18:00:00.000Z' }),
    );
    check.mockResolvedValue({ result: 'failed', problem: 'No hooks.' });
    const setup = checker();
    await setup.load();
    setup.checkIfNeeded('2.1.300');
    await vi.waitFor(() => expect(setup.current()).toMatchObject({ problem: 'No hooks.' }));
    setup.checkIfNeeded('2.1.300');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(check).toHaveBeenCalledOnce();
    await setup.check('2.1.300');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('waits while the user’s run is going', async () => {
    busy = true;
    const setup = checker();
    setup.checkIfNeeded('2.1.300');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(check).not.toHaveBeenCalled();
    busy = false;
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
  });

  it('steps aside when the user starts a run, and tries again later', async () => {
    check.mockImplementationOnce(untilStopped);
    const setup = checker();
    setup.checkIfNeeded('2.1.300');
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    setup.yieldToRun();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(PASSED));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('runs Check again at once, without stepping aside, and one check at a time', async () => {
    let finish: (finding: SetupFinding | null) => void = () => {};
    check.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    busy = true;
    const setup = checker();
    const asked = setup.check('2.1.300');
    const again = setup.check('2.1.300');
    setup.yieldToRun();
    expect(check).toHaveBeenCalledOnce();
    finish({ result: 'passed' });
    await expect(asked).resolves.toEqual(PASSED);
    await expect(again).resolves.toEqual(PASSED);
  });

  it('records nothing when there was nothing to check', async () => {
    check.mockResolvedValue(null);
    const setup = checker();
    await expect(setup.check('2.1.300')).resolves.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops a check as the app quits, and plans no more', async () => {
    check.mockImplementationOnce(untilStopped);
    const setup = checker();
    const going = setup.check('2.1.300');
    setup.stop();
    await expect(going).resolves.toBeNull();
    setup.checkIfNeeded('2.1.301');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(check).toHaveBeenCalledOnce();
  });

  it('keeps a check that stopped on Claude Code’s first-run screens, and is busy while one runs', async () => {
    const kept = { version: '2.1.300', result: 'first-run', at: '2026-10-10T18:00:00.000Z' };
    writeFileSync(file, JSON.stringify(kept));
    let finish: (finding: SetupFinding | null) => void = () => {};
    check.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const setup = checker();
    await setup.load();
    expect(setup.current()).toEqual(kept);
    expect(setup.busy()).toBe(false);
    const going = setup.check('2.1.300');
    expect(setup.busy()).toBe(true);
    finish({ result: 'passed' });
    await going;
    expect(setup.busy()).toBe(false);
  });

  it('ignores a kept file that isn’t a check', async () => {
    writeFileSync(file, '{"version": 3}');
    const setup = checker();
    await setup.load();
    expect(setup.current()).toBeNull();
  });
});
