import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunsView, TerminalSize } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ClaudeRuns, type ClaudeRunsDeps, type Prepared } from './runs.ts';
import type { OpenRun, RunEvents, RunOptions } from './session.ts';

/** A run the tests opened in place of Claude Code: what it was given, and how to drive it. */
interface Opened {
  id: string;
  size: TerminalSize;
  options: RunOptions;
  events: RunEvents;
  run: OpenRun & { written: string[]; sent: string[]; sizes: TerminalSize[] };
  /** Ends it, as Claude Code quitting would. */
  exit: (signal?: 'stopped' | 'failed') => void;
}

const resume = (jobId: string): RunTask => ({ skill: 'focused-resume', jobId });
const letter = (jobId: string): RunTask => ({ skill: 'cover-letter', jobId });

let opened: Opened[];
let views: RunsView[];
let stops: string[];

function openFake(...[id, size, options, events]: Parameters<ClaudeRunsDeps['open']>) {
  let exited = () => {};
  const done = new Promise<void>((resolve) => {
    exited = resolve;
  });
  let closed = false;
  let work = true;
  const exit = (signal: 'stopped' | 'failed' = 'stopped') => {
    if (closed) return;
    closed = true;
    events.exit(signal);
    exited();
  };
  const run: Opened['run'] = {
    written: [],
    sent: [],
    sizes: [],
    write: (data) => run.written.push(data),
    send: (prompt) => run.sent.push(prompt),
    resize: (next) => run.sizes.push(next),
    stop: () => {
      stops.push(id);
      exit('stopped');
    },
    hasWork: () => work,
    exited: done,
  };
  const original = events.signal;
  const tracked: RunEvents = {
    ...events,
    signal: (signal) => {
      work = signal === 'working' || signal === 'needs-answer';
      original(signal);
    },
  };
  opened.push({ id, size, options, events: tracked, run, exit });
  return Promise.resolve(run);
}

const prepared = (task: RunTask | null): Prepared => ({
  ok: true,
  options: task ? { prompt: `/factwright:${task.skill}` } : {},
  started: async () => {},
});

function runs(deps: Partial<ClaudeRunsDeps> = {}) {
  const claude = new ClaudeRuns({
    open: openFake,
    prepare: async (task) => prepared(task),
    onView: (view) => views.push(view),
    onOutput: () => {},
    now: () => 1000,
    sizeWaitMs: 50,
    ...deps,
  });
  // The panel's terminal says its size as it opens, as the window's does.
  claude.resize('run-0', { cols: 100, rows: 30 });
  return claude;
}

/** Lets the runs that had their turn get through their start. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The last view the window got: each run by ID, with its phase and what it waits for. */
const lastView = () =>
  (views.at(-1)?.runs ?? []).map(({ id, phase, waits }) =>
    waits ? `${id} ${phase} ${waits}` : `${id} ${phase}`,
  );

/** One of the runs the tests opened, by its ID. */
const run = (id: string) => {
  const found = opened.find((each) => each.id === id);
  if (!found) throw new Error(`${id} never opened`);
  return found;
};

beforeEach(() => {
  opened = [];
  views = [];
  stops = [];
});

describe('runs side by side', () => {
  it('starts one task at once, in a run of its own, named for its ID', async () => {
    const claude = runs();
    expect(claude.start(resume('acme'))).toBe('run-1');
    await settle();
    expect(lastView()).toEqual(['run-1 starting']);
    expect(run('run-1').size).toEqual({ cols: 100, rows: 30 });
    expect(run('run-1').options.prompt).toBe('/factwright:focused-resume');
    run('run-1').events.past();
    run('run-1').events.signal('working');
    expect(lastView()).toEqual(['run-1 working']);
    run('run-1').events.signal('done');
    expect(lastView()).toEqual(['run-1 done']);
    // Its tab stays until the user closes it, which quits its Claude Code.
    claude.close('run-1');
    expect(stops).toEqual(['run-1']);
    expect(lastView()).toEqual([]);
  });

  it('runs up to three at once, and a fourth waits its turn, then starts by itself', async () => {
    const claude = runs();
    for (const job of ['acme', 'globex', 'initech', 'umbrella']) claude.start(resume(job));
    await settle();
    run('run-1').events.past();
    await settle();
    expect(lastView()).toEqual([
      'run-1 starting',
      'run-2 starting',
      'run-3 starting',
      'run-4 in-line turn',
    ]);
    expect(opened.map((each) => each.id)).toEqual(['run-1', 'run-2', 'run-3']);
    // Waiting on the user still counts as one of the three.
    run('run-2').events.signal('needs-answer');
    run('run-3').events.signal('working');
    expect(lastView()[3]).toBe('run-4 in-line turn');
    run('run-1').events.signal('done');
    await settle();
    expect(lastView()).toEqual([
      'run-1 done',
      'run-2 needs-answer',
      'run-3 working',
      'run-4 starting',
    ]);
    expect(opened.map((each) => each.id)).toContain('run-4');
  });

  it('never runs two tasks on one job together: the second waits, and others go ahead of it', async () => {
    const claude = runs();
    claude.start(resume('acme'));
    await settle();
    run('run-1').events.past();
    claude.start(letter('acme'));
    claude.start(letter('globex'));
    await settle();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 in-line job', 'run-3 starting']);
    // A third task on the job waits behind the one ahead of it in line.
    claude.start({ skill: 'fit-check', jobId: 'acme' });
    run('run-1').events.signal('working');
    run('run-1').events.signal('done');
    await settle();
    expect(lastView()).toEqual([
      'run-1 done',
      'run-2 starting',
      'run-3 starting',
      'run-4 in-line job',
    ]);
    run('run-2').events.signal('working');
    run('run-2').events.signal('done');
    await settle();
    expect(lastView()[3]).toBe('run-4 starting');
  });

  it('keeps the user’s facts and Profile, and the job searches, to one task at a time', async () => {
    const claude = runs();
    claude.start({ skill: 'get-started' });
    await settle();
    run('run-1').events.past();
    claude.start({ skill: 'work-history' });
    claude.start({ skill: 'job-search' });
    claude.start({ skill: 'job-search' });
    await settle();
    expect(lastView()).toEqual([
      'run-1 starting',
      'run-2 in-line job',
      'run-3 starting',
      'run-4 in-line job',
    ]);
  });

  it('starts one at a time until a run is past Claude Code’s first screens, so they’re answered once', async () => {
    const claude = runs();
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    await settle();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 in-line setup']);
    run('run-1').events.screen('first-run');
    expect(views.at(-1)?.runs[0]?.screen).toBe('first-run');
    run('run-1').events.screen('trust');
    expect(views.at(-1)?.runs[0]?.screen).toBe('trust');
    expect(opened).toHaveLength(1);
    // Past them, the rest skip them, and start side by side.
    run('run-1').events.past();
    await settle();
    expect(views.at(-1)?.runs[0]?.screen).toBeNull();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 starting']);
    claude.start(resume('initech'));
    await settle();
    expect(lastView()[2]).toBe('run-3 starting');
  });

  it('tries the next one when the first never gets past them', async () => {
    const claude = runs();
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    await settle();
    run('run-1').exit('failed');
    await settle();
    expect(lastView()).toEqual(['run-1 failed', 'run-2 starting']);
  });

  it('takes a task out of line when its tab is closed, and stops a running one', async () => {
    const claude = runs({ atOnce: 1 });
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    claude.start(resume('initech'));
    await settle();
    run('run-1').events.past();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 in-line turn', 'run-3 in-line turn']);
    claude.close('run-2');
    expect(lastView()).toEqual(['run-1 starting', 'run-3 in-line turn']);
    expect(stops).toEqual([]);
    // Stopping the running one leaves its tab, saying so, and the next has its turn.
    claude.stop('run-1');
    await settle();
    expect(stops).toEqual(['run-1']);
    expect(lastView()).toEqual(['run-1 stopped', 'run-3 starting']);
  });

  it('says why a task couldn’t start, in its tab, and lets what was held for it go', async () => {
    const started = vi.fn(async () => {});
    const claude = runs({
      prepare: async (task) =>
        task && 'findings' in task
          ? { ok: false, problem: 'revision' }
          : { ok: true, options: {}, started },
      open: async (...args) => (args[0] === 'run-2' ? 'not-ready' : openFake(...args)),
    });
    claude.start({ skill: 'revise-resume', jobId: 'acme', resume: 'r.pdf', findings: ['term-1'] });
    claude.start(resume('globex'));
    await settle();
    await settle();
    expect(views.at(-1)?.runs.map(({ id, phase, problem }) => [id, phase, problem])).toEqual([
      ['run-1', 'failed', 'revision'],
      ['run-2', 'failed', 'not-ready'],
    ]);
    expect(started).toHaveBeenCalledWith(false);
  });

  it('starts more as soon as more may go at once', async () => {
    const claude = runs({ atOnce: 1 });
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    await settle();
    run('run-1').events.past();
    expect(lastView()[1]).toBe('run-2 in-line turn');
    claude.setAtOnce(2);
    await settle();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 starting']);
    expect(views.at(-1)?.atOnce).toBe(2);
  });

  it('opens Claude with no task at once, however many run', async () => {
    const claude = runs({ atOnce: 1 });
    claude.start(resume('acme'));
    await settle();
    run('run-1').events.past();
    claude.start(null);
    await settle();
    expect(lastView()).toEqual(['run-1 starting', 'run-2 starting']);
    run('run-2').events.signal('ready');
    // Ready with nothing to do takes no one's turn.
    claude.start(resume('globex'));
    expect(lastView()[2]).toBe('run-3 in-line turn');
  });

  it('holds updates while any run has work going or a task waits, and closes only idle ones', async () => {
    const claude = runs({ atOnce: 1 });
    expect(claude.working()).toBe(false);
    expect(claude.busy()).toBe(false);
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    await settle();
    run('run-1').events.past();
    run('run-1').events.signal('working');
    expect(claude.working()).toBe(true);
    run('run-1').events.signal('done');
    await settle();
    run('run-2').events.signal('working');
    expect(claude.working()).toBe(true);
    run('run-2').events.signal('done');
    expect(claude.working()).toBe(false);
    expect(claude.busy()).toBe(true);
    await claude.closeIdle();
    expect(stops).toEqual(['run-1', 'run-2']);
    expect(claude.busy()).toBe(false);
  });

  it('tells the app what each run says, by the run’s ID, until its tab closes', async () => {
    const output = vi.fn();
    const signal = vi.fn();
    const claude = runs({ onOutput: output, onSignal: signal });
    claude.start(resume('acme'));
    await settle();
    run('run-1').events.output('Working on it…');
    run('run-1').events.signal('working');
    expect(output).toHaveBeenCalledWith('run-1', 'Working on it…');
    expect(signal).toHaveBeenCalledWith({ id: 'run-1', task: resume('acme') }, 'working');
    claude.close('run-1');
    run('run-1').events.output('Gone');
    expect(output).not.toHaveBeenCalledWith('run-1', 'Gone');
    expect(claude.list()).toEqual([]);
  });

  it('keeps what the user types while a run starts, for its Claude Code once it’s open', async () => {
    let release: () => void = () => {};
    const claude = runs({
      prepare: (task) =>
        new Promise((resolve) => {
          release = () => resolve(prepared(task));
        }),
    });
    claude.start(resume('acme'));
    claude.write('run-1', 'save my');
    claude.write('run-1', ' notice\r');
    release();
    await settle();
    expect(run('run-1').run.written).toEqual(['save my notice\r']);
    claude.write('run-1', 'y');
    expect(run('run-1').run.written).toEqual(['save my notice\r', 'y']);
  });

  it('sends what the user types and replies to the run they’re for', async () => {
    const claude = runs();
    claude.start(resume('acme'));
    claude.start(resume('globex'));
    await settle();
    run('run-1').events.past();
    await settle();
    claude.write('run-2', 'y');
    claude.send('run-1', 'Make it shorter');
    claude.resize('run-2', { cols: 90, rows: 24 });
    expect(run('run-2').run.written).toEqual(['y']);
    expect(run('run-1').run.sent).toEqual(['Make it shorter']);
    expect(run('run-2').run.sizes).toEqual([{ cols: 90, rows: 24 }]);
    expect(run('run-1').run.written).toEqual([]);
  });
});

describe('the size a run starts at', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the first terminal to say its size, or starts at one of its own', async () => {
    const claude = new ClaudeRuns({
      open: openFake,
      prepare: async (task) => prepared(task),
      onView: (view) => views.push(view),
      onOutput: () => {},
      sizeWaitMs: 20,
    });
    claude.start(resume('acme'));
    await settle();
    expect(opened).toHaveLength(0);
    claude.resize('run-1', { cols: 80, rows: 22 });
    await settle();
    expect(run('run-1').size).toEqual({ cols: 80, rows: 22 });

    const alone = new ClaudeRuns({
      open: openFake,
      prepare: async (task) => prepared(task),
      onView: () => {},
      onOutput: () => {},
      sizeWaitMs: 5,
    });
    alone.start(resume('globex'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened.at(-1)?.size).toEqual({ cols: 120, rows: 20 });
  });

  it('stops a run asked to stop while it was starting', async () => {
    let release: (run: OpenRun) => void = () => {};
    const claude = runs({
      open: (...args) =>
        new Promise((resolve) => {
          release = (run) => resolve(run);
          void openFake(...args);
        }),
    });
    claude.start(resume('acme'));
    await settle();
    claude.stop('run-1');
    release(run('run-1').run);
    await settle();
    expect(stops).toEqual(['run-1']);
    expect(lastView()).toEqual(['run-1 stopped']);
  });
});
