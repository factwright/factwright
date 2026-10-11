import { readFile, writeFile } from 'node:fs/promises';
import type { SetupCheck } from '../../shared/api.ts';
import type { RunServer } from './run-server.ts';
import type { Launch } from './session.ts';

/** What one check found, before it's dated and tied to a version. */
export type SetupFinding = Pick<SetupCheck, 'result' | 'problem'>;

/** A hidden Claude Code process, as node-pty gives it. Tests pass their own. */
export interface CheckProcess {
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: { exitCode: number }) => void): void;
  write(data: string): void;
  kill(): void;
}

export interface CheckDeps {
  /** Prepares Claude Code to start just as a run would. Null when it isn't ready. */
  launch: () => Promise<Launch | null>;
  start: (launch: Launch) => CheckProcess;
  server: Pick<RunServer, 'listen'>;
  /** Stops the check, such as when the app quits. It then finds nothing. */
  signal?: AbortSignal;
  /** How long Claude Code gets to start and reach Factwright's tools. */
  connectMs?: number;
  /** How long it gets to close once asked. */
  closeMs?: number;
}

/** The question Claude Code asks once, the first time it opens a folder. */
const TRUST_QUESTION = /trust this folder|one you trust|trust the files/i;
const CTRL_C = '\x03';

// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's title and link codes start with ESC
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's color and cursor codes start with ESC
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Terminal output as plain text, without its colors and cursor moves. */
const plain = (text: string) => text.replace(OSC, '').replace(CSI, ' ');

/** The last line of the screen with words on it, to say what Claude Code showed. */
function lastWords(screen: string): string {
  const line = plain(screen)
    .split(/[\r\n]+/)
    .map((each) => each.replace(/\s+/g, ' ').trim())
    .filter((each) => /[a-z]{3}/i.test(each))
    .at(-1);
  return line ? ` It last showed: “${line.slice(0, 160)}”.` : '';
}

/**
 * Starts the user's Claude Code hidden, exactly as a run starts but with no prompt, so it uses
 * none of their plan. It passes when Claude Code reaches Factwright's tools and, once closed the
 * way the user closes it, its session-end hook reaches the app: that covers the launch flags,
 * the tools' config and token, the settings and the hooks. Null when Claude Code isn't ready.
 */
export async function checkSetup(deps: CheckDeps): Promise<SetupFinding | null> {
  const launch = await deps.launch();
  if (!launch) return null;

  return new Promise((resolve) => {
    let connected = false;
    let ended = false;
    let closing = false;
    let finished = false;
    let screen = '';
    let child: CheckProcess | undefined;
    let stopListening = () => {};
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, work: () => void) => timers.push(setTimeout(work, ms));

    const finish = (finding: SetupFinding | null) => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      stopListening();
      try {
        child?.kill();
      } catch {
        // It had already closed.
      }
      resolve(finding);
    };

    // Closes Claude Code as the user would, with Ctrl-C twice, which ends the session.
    const close = () => {
      if (closing) return;
      closing = true;
      later(400, () => child?.write(CTRL_C));
      later(900, () => child?.write(CTRL_C));
      later(deps.closeMs ?? 10_000, () =>
        finish({
          result: 'failed',
          problem: `Claude Code reached Factwright’s tools, but didn’t close when asked.${lastWords(screen)}`,
        }),
      );
    };

    stopListening = deps.server.listen(
      launch.token,
      (event) => {
        if ((event as { hook_event_name?: unknown } | null)?.hook_event_name === 'SessionEnd') {
          ended = true;
        }
      },
      (method) => {
        if (method !== 'tools/list' || connected) return;
        connected = true;
        close();
      },
    );

    deps.signal?.addEventListener('abort', () => finish(null), { once: true });
    if (deps.signal?.aborted) {
      finish(null);
      return;
    }
    try {
      child = deps.start(launch);
    } catch (error) {
      finish({ result: 'failed', problem: `Claude Code didn’t start: ${String(error)}` });
      return;
    }
    child.onData((data) => {
      // Checked before trimming, so a big chunk can't push the question out unseen.
      const seen = screen + data;
      screen = seen.slice(-8000);
      // Until the user trusts the workspace once, in a run, Claude Code waits on this question.
      if (!connected && TRUST_QUESTION.test(plain(seen))) finish({ result: 'untrusted' });
    });
    child.onExit(() => {
      // A hook that's on its way gets a moment to land.
      later(300, () => {
        if (!connected) {
          finish({
            result: 'failed',
            problem: `Claude Code closed before it reached Factwright’s tools.${lastWords(screen)}`,
          });
        } else if (!ended) {
          finish({
            result: 'failed',
            problem: 'Claude Code reached Factwright’s tools, but its hooks didn’t reach the app.',
          });
        } else {
          finish({ result: 'passed' });
        }
      });
    });
    later(deps.connectMs ?? 60_000, () => {
      if (!connected) {
        finish({
          result: 'failed',
          problem: `Claude Code didn’t reach Factwright’s tools within a minute.${lastWords(screen)}`,
        });
      }
    });
  });
}

export interface SetupCheckerDeps {
  /** Where the latest check is kept between launches. */
  file: string;
  check: (signal: AbortSignal) => Promise<SetupFinding | null>;
  onChange: (check: SetupCheck) => void;
  /** Whether the user's own run is going. Checks wait for it, so they never slow it down. */
  busy?: () => boolean;
  /** How long a check waits for the app to settle, and between tries while a run is going. */
  waitMs?: number;
  now?: () => Date;
}

interface Running {
  promise: Promise<SetupCheck | null>;
  /** Stops this check, such as when the user starts a run. */
  controller: AbortController;
  /** Started by the app, rather than by the user's Check again. */
  automatic: boolean;
}

/**
 * Checks Factwright's setup once for each version of Claude Code, which updates itself, and
 * once a launch until a check passes. Keeps the latest check between launches. The app's own
 * checks wait for it to settle and for the user's run to end, and step aside when one starts,
 * so they never slow the user down.
 */
export class SetupChecker {
  private readonly deps: SetupCheckerDeps;
  private latest: SetupCheck | null = null;
  private running: Running | null = null;
  private planned: ReturnType<typeof setTimeout> | undefined;
  private readonly stopper = new AbortController();
  /** The versions checked since the app opened. */
  private readonly checked = new Set<string>();

  constructor(deps: SetupCheckerDeps) {
    this.deps = deps;
  }

  /** Reads the check kept from the last launch, if there is one. */
  async load(): Promise<void> {
    try {
      const kept: unknown = JSON.parse(await readFile(this.deps.file, 'utf8'));
      if (isSetupCheck(kept)) this.latest = kept;
    } catch {
      // None yet, or unreadable: the next check replaces it.
    }
  }

  current(): SetupCheck | null {
    return this.latest;
  }

  /**
   * Plans a check of this version of Claude Code, unless a check of it passed, or already ran
   * since the app opened. So a check that didn't pass runs once a launch, not each time the
   * window comes back.
   */
  checkIfNeeded(version: string): void {
    if (this.stopper.signal.aborted || this.planned || this.running) return;
    const known = this.latest?.version === version;
    if (known && (this.latest?.result === 'passed' || this.checked.has(version))) return;
    this.plan(version);
  }

  /** Checks now, as the user asked, or joins the check that's already running. */
  check(version: string): Promise<SetupCheck | null> {
    clearTimeout(this.planned);
    this.planned = undefined;
    return this.running?.promise ?? this.run(version, false);
  }

  /** The user is starting a run, so the app's own check steps aside, to try again later. */
  yieldToRun(): void {
    if (this.running?.automatic) this.running.controller.abort();
  }

  /** Stops a check that's running or planned, which then records nothing. */
  stop(): void {
    clearTimeout(this.planned);
    this.planned = undefined;
    this.stopper.abort();
  }

  private plan(version: string): void {
    this.planned = setTimeout(() => {
      this.planned = undefined;
      if (this.deps.busy?.()) this.plan(version);
      else void this.run(version, true);
    }, this.deps.waitMs ?? 20_000);
  }

  private run(version: string, automatic: boolean): Promise<SetupCheck | null> {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, this.stopper.signal]);
    let retry = false;
    const promise = (async () => {
      if (signal.aborted) return this.latest;
      const finding = await this.deps.check(signal);
      if (!finding) {
        retry = automatic && controller.signal.aborted && !this.stopper.signal.aborted;
        return this.latest;
      }
      return this.record(version, finding);
    })().finally(() => {
      this.running = null;
      // A check that stepped aside for the user's run tries again once it can.
      if (retry && !this.planned) this.plan(version);
    });
    this.running = { promise, controller, automatic };
    return promise;
  }

  private async record(version: string, finding: SetupFinding): Promise<SetupCheck> {
    this.checked.add(version);
    const check: SetupCheck = {
      version,
      ...finding,
      at: (this.deps.now?.() ?? new Date()).toISOString(),
    };
    this.latest = check;
    try {
      await writeFile(this.deps.file, JSON.stringify(check, null, 2));
    } catch {
      // Kept for this launch only, then.
    }
    this.deps.onChange(check);
    return check;
  }
}

function isSetupCheck(value: unknown): value is SetupCheck {
  if (typeof value !== 'object' || value === null) return false;
  const check = value as Record<string, unknown>;
  return (
    typeof check.version === 'string' &&
    typeof check.at === 'string' &&
    (check.result === 'passed' || check.result === 'failed' || check.result === 'untrusted') &&
    (check.problem === undefined || typeof check.problem === 'string')
  );
}
