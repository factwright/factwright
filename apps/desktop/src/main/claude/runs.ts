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
import { AT_ONCE, lanesOf, type RunTask, startedOnItsOwn, taskJobs } from '../../shared/runs.ts';
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
  /**
   * Hears a run that started on its own end: done, stopped, failed, closed, or stepping aside for
   * a task of the user's, with the jobs it finished analyzing.
   */
  onOwnEnded?: (run: RunHeard, end: OwnEnd, analyzed: readonly string[]) => void;
  now?: () => number;
  /**
   * How long the first run waits for its terminal to say its size, before it starts at a size
   * of its own. Every run after starts at the size the last terminal said.
   */
  sizeWaitMs?: number;
}

/**
 * How a run that started on its own ended: it stepped aside for a task the user started, which
 * would have waited for it, or it was done, stopped by the user, closed, or failed.
 */
export type OwnEnd = 'stepped-aside' | 'ended';

/** One of Claude's runs, or a task waiting in line for one. */
interface Entry {
  id: string;
  task: RunTask | null;
  /** What it works on, which no two runs going at once share. */
  lanes: string[];
  /** Whether it started on its own, so it steps aside for any task the user starts. */
  own: boolean;
  /** The jobs of its task it has finished analyzing, by their IDs. */
  analyzed: Set<string>;
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
  /**
   * Whether a run of Claude's own met one of those screens, which only the user answers, at any
   * time: none starts again until a run of the user's is past them.
   */
  private screened = false;
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
    return { runs: this.entries.map(viewOf), atOnce: this.atOnce, setUp: this.pastScreens };
  }

  /**
   * Starts a run, maybe for a task, or puts the task in line, and answers with its ID. Claude
   * with no task, which waits for what the user types, never waits for its turn.
   */
  start(task: RunTask | null): string {
    const entry = this.entryFor(task);
    this.entries.push(entry);
    this.pump();
    return entry.id;
  }

  /**
   * Starts a run on a task of Claude's own, such as analyzing the jobs saved since it was last
   * free, only if it can start now: with fewer going than may at once, nothing in line, none of its
   * jobs taken, and no run getting past Claude Code's first screens. It never waits in line, and it
   * steps aside for any task the user starts that would otherwise wait for it, and as soon as
   * Claude Code shows it a screen of its own, which only the user answers: then none starts until
   * a run of the user's is past them. Answers with its ID, or null when it can't start now.
   */
  startOwn(task: RunTask): string | null {
    const going = this.entries.filter(hasWork);
    const taken = new Set(going.flatMap((entry) => entry.lanes));
    const free =
      !this.screened &&
      (this.pastScreens || !this.entries.some(isSettingUp)) &&
      !this.entries.some((entry) => entry.phase === 'in-line') &&
      going.length < this.atOnce &&
      !lanesOf(task).some((lane) => taken.has(lane));
    if (!free) return null;
    // The tab of one it started before, which is done, makes way for this one's, so they don't
    // pile up, each with its Claude Code open. What it did shows in the jobs.
    for (const done of this.entries.filter(
      (entry) => startedOnItsOwn(entry.task) && entry.phase !== 'in-line' && !hasWork(entry),
    )) {
      this.closeEntry(done, 'ended');
    }
    const entry = { ...this.entryFor(task), own: true };
    this.entries.push(entry);
    this.pump();
    return entry.id;
  }

  private entryFor(task: RunTask | null): Entry {
    this.count += 1;
    return {
      id: `run-${this.count}`,
      task,
      lanes: lanesOf(task),
      own: false,
      analyzed: new Set(),
      phase: 'in-line',
      waits: 'turn',
      screen: null,
      startedAt: null,
      problem: null,
      run: null,
      typed: '',
      stopped: false,
      closed: false,
    };
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

  /** Whether a task is going, or waits in line, on a job, by its ID. */
  holds(jobId: string): boolean {
    return this.entries.some(
      (entry) =>
        (entry.phase === 'in-line' || hasWork(entry)) && entry.lanes.includes(`job:${jobId}`),
    );
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
   * wait for it. Claude Code that's done, or ready with nothing to do yet, has none, and nor does
   * a run of Claude's own, which steps aside for them.
   */
  working(): boolean {
    return this.entries.some(
      (entry) => entry.phase === 'in-line' || (hasWork(entry) && !entry.own),
    );
  }

  /**
   * Quits every Claude Code that has no work going, as before the app restarts, and settles once
   * they've closed, or after a few seconds whatever happens. A run of Claude's own steps aside
   * too, leaving the jobs it didn't finish for the next. Runs with work going are left as they
   * are.
   */
  async closeIdle(): Promise<void> {
    const idle = this.entries.filter((entry) => entry.run && (!hasWork(entry) || entry.own));
    if (idle.length === 0) return;
    const exits = idle.map((entry) => entry.run?.exited);
    for (const entry of idle) {
      if (entry.own) this.closeEntry(entry, 'stepped-aside');
      else this.stop(entry.id);
    }
    this.pump();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(exits),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Stops every run and empties the line, as when the window closes, which they belong to. The
   * line goes first, so nothing in it starts as the runs ahead of it stop.
   */
  closeAll(): void {
    for (const entry of this.entries.splice(0)) {
      entry.closed = true;
      entry.stopped = true;
      entry.run?.stop();
    }
    this.deps.onView(this.view());
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
    const entry = this.entry(id);
    if (!entry) return;
    this.closeEntry(entry, 'ended');
    this.pump();
  }

  /** Takes a run off the tabs, quitting its Claude Code, as its tab closes, or as it steps aside. */
  private closeEntry(entry: Entry, end: OwnEnd): void {
    const at = this.entries.indexOf(entry);
    if (at >= 0) this.entries.splice(at, 1);
    entry.closed = true;
    entry.stopped = true;
    entry.run?.stop();
    this.ownEnded(entry, end);
  }

  /**
   * Tells the app a run that started on its own ended, and how, once: as it's done, stops,
   * fails, closes or steps aside, whichever comes first. From then on it's like any other run.
   */
  private ownEnded(entry: Entry, end: OwnEnd): void {
    if (!entry.own) return;
    entry.own = false;
    this.deps.onOwnEnded?.(heardOf(entry), end, [...entry.analyzed]);
  }

  private entry(id: string): Entry | undefined {
    return this.entries.find((each) => each.id === id);
  }

  /**
   * Starts what can start, in the order it was asked for: a task whose job, or part of the job
   * hunt, no other has going or waits for ahead of it, while fewer run than may at once, and
   * only one at a time until a run is past Claude Code's first screens. A run that started on its
   * own steps aside first for a task in line that would start without it. Then tells the window.
   */
  private pump(): void {
    for (const own of this.entries.filter((entry) => entry.own && entry.phase !== 'in-line')) {
      const without = this.entries.filter((entry) => entry !== own);
      if (this.starts(without).length > this.starts(this.entries).length) {
        this.closeEntry(own, 'stepped-aside');
      }
    }
    for (const entry of this.starts(this.entries, true)) void this.launch(entry);
    this.deps.onView(this.view());
  }

  /**
   * The tasks in line that would start now, of some runs, in order. Marking them says what each
   * of the rest waits for.
   */
  private starts(entries: readonly Entry[], mark = false): Entry[] {
    let going = entries.filter(hasWork).length;
    const lanes = new Set(entries.filter(hasWork).flatMap((entry) => entry.lanes));
    let settingUp = !this.pastScreens && entries.some(isSettingUp);
    const starting: Entry[] = [];
    for (const entry of entries) {
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
      if (mark) entry.waits = waits;
      if (waits) continue;
      if (entry.task) going += 1;
      settingUp = !this.pastScreens;
      starting.push(entry);
    }
    return starting;
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
    const heard = () => heardOf(entry);
    return {
      output: (data) => {
        if (live()) this.deps.onOutput(entry.id, data);
      },
      signal: (signal) => {
        if (!live()) return;
        const changed = entry.phase !== signal || entry.screen !== null;
        entry.phase = signal;
        // Claude finished the task it started on its own.
        if (signal === 'done') this.ownEnded(entry, 'ended');
        // Any signal means Claude Code is past its first-run screens and the question about trust.
        entry.screen = null;
        this.deps.onSignal?.(heard(), signal);
        // As each tool call finishes, the run says it's working again, which changes nothing.
        if (changed) this.pump();
      },
      screen: (screen) => {
        if (!live() || entry.screen === screen) return;
        // A run of Claude's own leaves the user's answer to a run of their own.
        if (screen && entry.own) {
          this.screened = true;
          this.closeEntry(entry, 'stepped-aside');
          this.pump();
          return;
        }
        entry.screen = screen;
        if (screen) this.deps.onScreen?.(heard(), screen);
        this.deps.onView(this.view());
      },
      past: () => {
        entry.screen = null;
        this.pastScreens = true;
        // A run of the user's past them: Claude's own may try again.
        if (live() && !entry.own) this.screened = false;
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
      // A job of its own task it finished, which its tab counts.
      analyzed: (jobId) => {
        if (!live() || !taskJobs(entry.task).includes(jobId) || entry.analyzed.has(jobId)) return;
        entry.analyzed.add(jobId);
        this.deps.onView(this.view());
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
    this.ownEnded(entry, 'ended');
    this.deps.onSignal?.(heardOf(entry), signal);
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
    this.ownEnded(entry, 'ended');
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

/** A run as the app hears of it. */
const heardOf = (entry: Entry): RunHeard => ({ id: entry.id, task: entry.task });

function viewOf(entry: Entry): RunView {
  return {
    id: entry.id,
    task: entry.task,
    phase: entry.phase,
    waits: entry.waits,
    screen: entry.screen,
    startedAt: entry.startedAt,
    problem: entry.problem,
    analyzed: [...entry.analyzed],
  };
}
