import type { RunStep, TurnEnd } from '../../shared/activity.ts';
import type {
  LineWait,
  RunPhase,
  RunSignal,
  RunsView,
  RunView,
  StartProblem,
  TerminalSize,
} from '../../shared/api.ts';
import type { FiledFacts } from '../../shared/facts.ts';
import type { RunChanges as RunChangesView } from '../../shared/run-changes.ts';
import { AT_ONCE, lanesOf, type RunTask } from '../../shared/runs.ts';
import type { OpenRun, RunEvents, RunOptions, RunScreen } from './session.ts';

/**
 * What a task needs to start: its prompt, its levels and what it may change, with anything the
 * app holds for it, such as a revision, which `started` keeps or lets go once it's known whether
 * the run started. Or why it can't start.
 */
export type Prepared =
  | { ok: true; options: RunOptions; started: (ok: boolean) => Promise<void> }
  | { ok: false; problem: StartProblem };

/** A run as the app hears of it: its ID, and what it's for. */
export interface RunHeard {
  id: string;
  task: RunTask | null;
}

export interface ClaudeRunsDeps {
  /** Starts one run of Claude Code, named for its ID, or says why it couldn't. */
  open: (
    id: string,
    size: TerminalSize,
    options: RunOptions,
    events: RunEvents,
  ) => Promise<OpenRun | 'not-ready' | 'failed'>;
  /** Gets a task ready to start, just before it does. */
  prepare: (task: RunTask | null) => Promise<Prepared>;
  /** How many runs may go at once, at first. */
  atOnce?: number;
  /** Hears every run, and every task in line, each time anything about them changes. */
  onView: (view: RunsView) => void;
  onOutput: (runId: string, data: string) => void;
  /** Hears where each run stands, as its signals say. */
  onSignal?: (run: RunHeard, signal: RunSignal) => void;
  /** Hears each run showing a screen of Claude Code's own, which waits on the user. */
  onScreen?: (run: RunHeard, screen: RunScreen) => void;
  onStep?: (runId: string, step: RunStep) => void;
  onTurnEnd?: (runId: string, end: TurnEnd) => void;
  onFiled?: (runId: string, filed: FiledFacts) => void;
  onChanges?: (runId: string, changes: RunChangesView) => void;
  now?: () => number;
  /**
   * How long the first run waits for its terminal to say its size, before it starts at a size
   * of its own. Every run after starts at the size the last terminal said.
   */
  sizeWaitMs?: number;
}

/** One of Claude's runs, or a task waiting in line for one. */
interface Entry {
  id: string;
  task: RunTask | null;
  /** What it works on, which no two runs going at once share. */
  lanes: string[];
  phase: RunPhase;
  waits: LineWait | null;
  screen: RunScreen | null;
  startedAt: number | null;
  problem: StartProblem | null;
  /** Its Claude Code, once it's open. */
  run: OpenRun | null;
  /** What the user typed in its terminal while it was starting, for Claude Code once it's open. */
  typed: string;
  /** Set when the user stops it, or closes its tab, while it's starting. */
  stopped: boolean;
  /** Set once its tab is closed, when it's no longer the app's. */
  closed: boolean;
}

/** The phases in which a run has work going, which count toward how many may go at once. */
const WORK: readonly RunPhase[] = ['starting', 'working', 'needs-answer'];

/** How long the app waits for Claude Code to close before it restarts anyway. */
const CLOSE_WAIT_MS = 5000;

/** How long the first run waits for its terminal's size. */
const SIZE_WAIT_MS = 3000;

/** As much as the user can type in a run's terminal before its Claude Code opens. */
const MAX_TYPED = 10_000;

/** The size a run starts at when no terminal has said its size. */
const FALLBACK_SIZE: TerminalSize = { cols: 120, rows: 20 };

/**
 * The user's Claude runs, side by side, each a Claude Code of its own in a tab of Claude's panel,
 * and the line of tasks waiting their turn. Up to a few run at once, three unless the user picks
 * otherwise, and the rest wait in line and start by themselves, in the order they were asked for.
 * Two tasks on the same job never run at once, nor two on the user's facts and Profile, nor two
 * job searches: the later one waits, and so does every task after it on the same. Until one run
 * is past Claude Code's first-run screens and its question about trust, which it shows only until
 * they're answered once, only one starts at a time, so the user answers them once. A run's tab
 * stays, done, stopped or failed, until the user closes it.
 */
export class ClaudeRuns {
  private readonly deps: ClaudeRunsDeps;
  private readonly entries: Entry[] = [];
  private atOnce: number;
  private count = 0;
  /** Whether a run got past Claude Code's first screens, so the rest skip them. */
  private pastScreens = false;
  /** The size the last terminal said, which each run starts at. */
  private size: TerminalSize | null = null;
  /** Runs waiting for a terminal to say its size. */
  private readonly sizeWaiters = new Set<(size: TerminalSize) => void>();

  constructor(deps: ClaudeRunsDeps) {
    this.deps = deps;
    this.atOnce = deps.atOnce ?? AT_ONCE.usual;
  }

  /** Every run, and every task in line, as the window shows them. */
  view(): RunsView {
    return { runs: this.entries.map(viewOf), atOnce: this.atOnce };
  }

  /**
   * Starts a run, maybe for a task, or puts the task in line, and answers with its ID. Claude
   * with no task, which waits for what the user types, never waits for its turn.
   */
  start(task: RunTask | null): string {
    this.count += 1;
    this.entries.push({
      id: `run-${this.count}`,
      task,
      lanes: lanesOf(task),
      phase: 'in-line',
      waits: 'turn',
      screen: null,
      startedAt: null,
      problem: null,
      run: null,
      typed: '',
      stopped: false,
      closed: false,
    });
    this.pump();
    return `run-${this.count}`;
  }

  /** Every run whose tab is open, and every task in line, and what each is for. */
  list(): RunHeard[] {
    return this.entries.map((entry) => ({ id: entry.id, task: entry.task }));
  }

  /** How many runs may go at once, from now on. */
  setAtOnce(count: number): void {
    this.atOnce = count;
    this.pump();
  }

  /** Whether a run is open or starting, or a task waits in line. */
  busy(): boolean {
    return this.entries.some(
      (entry) => entry.run !== null || entry.phase === 'starting' || entry.phase === 'in-line',
    );
  }

  /**
   * Whether work is going: a run is starting, Claude is working, or it waits on the user, or a
   * task waits in line. Restarting the app would stop that, so updates and switching profiles
   * wait for it. Claude Code that's done, or ready with nothing to do yet, has none.
   */
  working(): boolean {
    return this.entries.some((entry) => entry.phase === 'in-line' || hasWork(entry));
  }

  /**
   * Quits every Claude Code that has no work going, as before the app restarts, and settles once
   * they've closed, or after a few seconds whatever happens. Runs with work going are left as
   * they are.
   */
  async closeIdle(): Promise<void> {
    const idle = this.entries.filter((entry) => entry.run && !hasWork(entry));
    if (idle.length === 0) return;
    for (const entry of idle) this.stop(entry.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(idle.map((entry) => entry.run?.exited)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** Stops every run and empties the line, as when the window closes, which they belong to. */
  closeAll(): void {
    for (const entry of [...this.entries]) this.close(entry.id);
  }

  /**
   * Sends what the user types in a run's terminal. While it's starting, what they type waits for
   * its Claude Code to open.
   */
  write(id: string, data: string): void {
    const entry = this.entry(id);
    if (entry?.run) entry.run.write(data);
    else if (entry?.phase === 'starting') entry.typed = (entry.typed + data).slice(-MAX_TYPED);
  }

  /** Types a reply into a run and sends it, as the user would. */
  send(id: string, prompt: string): void {
    this.entry(id)?.run?.send(prompt);
  }

  /** A run's terminal says its size, which runs that start after it start at too. */
  resize(id: string, size: TerminalSize): void {
    this.size = size;
    for (const waiting of [...this.sizeWaiters]) waiting(size);
    this.entry(id)?.run?.resize(size);
  }

  /** Stops a run, whose tab stays, saying it stopped. A task in line leaves the line. */
  stop(id: string): void {
    const entry = this.entry(id);
    if (!entry) return;
    if (entry.phase === 'in-line') {
      this.close(id);
      return;
    }
    entry.stopped = true;
    entry.run?.stop();
  }

  /** Closes a run's tab: its Claude Code quits, if it's open, and a task in line leaves it. */
  close(id: string): void {
    const at = this.entries.findIndex((entry) => entry.id === id);
    const entry = this.entries[at];
    if (!entry) return;
    this.entries.splice(at, 1);
    entry.closed = true;
    entry.stopped = true;
    entry.run?.stop();
    this.pump();
  }

  private entry(id: string): Entry | undefined {
    return this.entries.find((each) => each.id === id);
  }

  /**
   * Starts what can start, in the order it was asked for: a task whose job, or part of the job
   * hunt, no other has going or waits for ahead of it, while fewer run than may at once, and
   * only one at a time until a run is past Claude Code's first screens. Then tells the window.
   */
  private pump(): void {
    let going = this.entries.filter(hasWork).length;
    const lanes = new Set(this.entries.filter(hasWork).flatMap((entry) => entry.lanes));
    let settingUp = !this.pastScreens && this.entries.some(isSettingUp);
    for (const entry of this.entries) {
      if (entry.phase !== 'in-line') continue;
      const waits: LineWait | null = entry.lanes.some((lane) => lanes.has(lane))
        ? 'job'
        : entry.task && going >= this.atOnce
          ? 'turn'
          : settingUp
            ? 'setup'
            : null;
      // A task in line keeps its job for itself, ahead of the ones after it.
      for (const lane of entry.lanes) lanes.add(lane);
      entry.waits = waits;
      if (waits) continue;
      if (entry.task) going += 1;
      settingUp = !this.pastScreens;
      void this.launch(entry);
    }
    this.deps.onView(this.view());
  }

  /** Starts a run that's had its turn: its task made ready, a size for it, then Claude Code. */
  private async launch(entry: Entry): Promise<void> {
    entry.phase = 'starting';
    entry.waits = null;
    entry.startedAt = this.now();
    let prepared: Prepared;
    try {
      prepared = await this.deps.prepare(entry.task);
    } catch {
      prepared = { ok: false, problem: 'failed' };
    }
    if (!prepared.ok) {
      this.failed(entry, prepared.problem);
      return;
    }
    const size = entry.stopped ? FALLBACK_SIZE : await this.sizeFor();
    let opened: OpenRun | 'not-ready' | 'failed' = 'failed';
    if (!entry.stopped) {
      try {
        opened = await this.deps.open(entry.id, size, prepared.options, this.eventsOf(entry));
      } catch {
        // It didn't start, so it failed.
      }
    }
    if (typeof opened === 'string') {
      await prepared.started(false).catch(() => {});
      if (entry.stopped) this.ended(entry, 'stopped');
      else this.failed(entry, opened);
      return;
    }
    // Its own from here on, before anything else is awaited, so its exit, whenever it comes,
    // finds it.
    entry.run = opened;
    // Closed or stopped while it started: it goes now.
    if (entry.stopped) opened.stop();
    else if (entry.typed) opened.write(entry.typed);
    entry.typed = '';
    await prepared.started(true).catch(() => {});
  }

  /** The size the last terminal said, or, before any has, whatever comes first. */
  private sizeFor(): Promise<TerminalSize> {
    if (this.size) return Promise.resolve(this.size);
    return new Promise((resolve) => {
      const done = (size: TerminalSize) => {
        clearTimeout(timer);
        this.sizeWaiters.delete(done);
        resolve(size);
      };
      const timer = setTimeout(() => done(FALLBACK_SIZE), this.deps.sizeWaitMs ?? SIZE_WAIT_MS);
      this.sizeWaiters.add(done);
    });
  }

  /** What a run tells the app, as its own, until its tab closes. */
  private eventsOf(entry: Entry): RunEvents {
    const live = () => !entry.closed;
    const heard = () => ({ id: entry.id, task: entry.task });
    return {
      output: (data) => {
        if (live()) this.deps.onOutput(entry.id, data);
      },
      signal: (signal) => {
        if (!live()) return;
        const changed = entry.phase !== signal || entry.screen !== null;
        entry.phase = signal;
        // Any signal means Claude Code is past its first-run screens and the question about trust.
        entry.screen = null;
        this.deps.onSignal?.(heard(), signal);
        // As each tool call finishes, the run says it's working again, which changes nothing.
        if (changed) this.pump();
      },
      screen: (screen) => {
        if (!live() || entry.screen === screen) return;
        entry.screen = screen;
        if (screen) this.deps.onScreen?.(heard(), screen);
        this.deps.onView(this.view());
      },
      past: () => {
        entry.screen = null;
        this.pastScreens = true;
        if (live()) this.pump();
      },
      step: (step) => {
        if (live()) this.deps.onStep?.(entry.id, step);
      },
      turnEnd: (end) => {
        if (live()) this.deps.onTurnEnd?.(entry.id, end);
      },
      filed: (filed) => {
        if (live()) this.deps.onFiled?.(entry.id, filed);
      },
      changes: (changes) => {
        if (live()) this.deps.onChanges?.(entry.id, changes);
      },
      exit: (signal) => this.ended(entry, signal),
    };
  }

  /** A run that closed: its tab says so, until the user closes it, and the next can start. */
  private ended(entry: Entry, signal: 'stopped' | 'failed'): void {
    entry.run = null;
    entry.screen = null;
    if (entry.closed) {
      this.pump();
      return;
    }
    entry.phase = signal;
    this.deps.onSignal?.({ id: entry.id, task: entry.task }, signal);
    this.pump();
  }

  /** A run that couldn't start, and why, which its tab says. */
  private failed(entry: Entry, problem: StartProblem): void {
    entry.run = null;
    if (entry.closed) {
      this.pump();
      return;
    }
    entry.phase = 'failed';
    entry.problem = problem;
    this.pump();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

/** Whether a run has work going: it's starting, Claude is working, or it waits on the user. */
const hasWork = (entry: Entry) => WORK.includes(entry.phase);

/** Whether a run is starting: until its first signal, Claude Code may still show its first screens. */
const isSettingUp = (entry: Entry) => entry.phase === 'starting';

function viewOf(entry: Entry): RunView {
  return {
    id: entry.id,
    task: entry.task,
    phase: entry.phase,
    waits: entry.waits,
    screen: entry.screen,
    startedAt: entry.startedAt,
    problem: entry.problem,
  };
}
