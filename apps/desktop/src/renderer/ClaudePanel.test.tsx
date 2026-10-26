// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunStep } from '../shared/activity.ts';
import type { FactwrightApi, RunPhase, RunView } from '../shared/api.ts';
import {
  ClaudePanel,
  clock,
  doingLine,
  endsAsking,
  type PanelRun,
  QUIET_AFTER_MS,
  sceneOf,
  workingLines,
} from './ClaudePanel.tsx';
import type { RunActivity } from './useRunActivity.ts';

// The terminal itself needs a real browser, and these tests are about what's around it.
const { terminal } = vi.hoisted(() => ({
  terminal: vi.fn((_props: { runId: string; attention?: boolean; shown?: boolean }) => null),
}));
vi.mock('./TerminalView.tsx', () => ({ TerminalView: terminal }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  terminal.mockClear();
});

/** How a run's terminal was last drawn. */
const terminalOf = (runId = 'run-1') =>
  terminal.mock.calls.filter(([props]) => props.runId === runId).at(-1)?.[0];

/** Whether the run's terminal was last drawn outlined, as waiting on the user. */
const outlined = (runId = 'run-1') => terminalOf(runId)?.attention === true;

const NOTHING: RunActivity = { steps: [], lastAt: null, end: null, todos: [], helpers: [] };

/** A run as the app says it stands: a tailored resume, a minute and a half in. */
const view = (phase: RunPhase, changed: Partial<RunView> = {}): RunView => ({
  id: 'run-1',
  task: { skill: 'focused-resume', jobId: 'acme--staff' },
  phase,
  waits: null,
  screen: null,
  startedAt: Date.now() - 84_000,
  problem: null,
  ...changed,
});

/** A run as its tab and bar show it. */
const run = (
  phase: RunPhase,
  changed: Partial<PanelRun> = {},
  at: Partial<RunView> = {},
): PanelRun => ({
  view: view(phase, at),
  title: 'Acme · Tailored resume',
  state: 'working',
  activity: NOTHING,
  result: null,
  stoppedShort: false,
  filed: null,
  changes: null,
  asking: null,
  ...changed,
});

/** What the panel drives: the run shown, whether its work shows, and the user's ways in. */
const drive = (open: boolean, selected: RunView | null) => ({
  selected,
  select: vi.fn(),
  open,
  show: vi.fn(),
  showWork: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  reply: vi.fn(),
  atOnce: 3,
});

const api = () => ({}) as unknown as FactwrightApi;

/** Claude's panel, with its runs, and the first or the one given shown. */
function panel(runs: PanelRun[], { open = false, shown = runs[0]?.view ?? null } = {}) {
  const claude = drive(open, shown);
  const rendered = render(<ClaudePanel api={api()} runs={runs} claude={claude} plan="Max" />);
  return { ...rendered, claude };
}

const step = (
  tool: string,
  detail: string | null,
  state: RunStep['state'],
  id = tool,
): RunStep => ({
  id,
  tool,
  detail,
  state,
});

const bar = () => screen.getByRole('region', { name: 'Claude' });

describe('ClaudePanel', () => {
  it('shows nothing with no runs', () => {
    const { container } = panel([]);
    expect(container.textContent).toBe('');
  });

  it('keeps questions the user put aside waiting in the bar, with a way back to them', async () => {
    const onAnswer = vi.fn();
    panel([
      run('needs-answer', { asking: { what: 'questions', count: 2, open: false, onAnswer } }),
    ]);
    expect(bar().textContent).toContain('Claude is waiting for your answer to 2 questions.');
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalled();
    // Waiting in the app's dialog, it opens none of Claude's work.
    expect(outlined()).toBe(false);
  });

  it('says Claude has a question while its dialog is open, and keeps a permission prompt waiting too', async () => {
    const asking = { what: 'questions' as const, count: 1, open: true, onAnswer: vi.fn() };
    panel([run('needs-answer', { asking })]);
    expect(bar().textContent).toContain('Claude has a question for you.');
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    cleanup();
    const onAnswer = vi.fn();
    panel([
      run('needs-answer', { asking: { what: 'permission', count: 1, open: false, onAnswer } }),
    ]);
    expect(bar().textContent).toContain(
      'Claude Code is waiting for your OK before Claude carries on.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalled();
  });

  it('opens Claude’s work for what only the terminal can answer, once the app would have asked', async () => {
    vi.useFakeTimers();
    const { claude } = panel([run('needs-answer')]);
    expect(bar().textContent).toContain('Claude Code is asking you something in its work below.');
    expect(claude.show).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1200));
    expect(claude.show).toHaveBeenCalledWith('run-1');
    vi.useRealTimers();
    cleanup();
    // Shown, it points to the terminal, explaining it once to someone new.
    panel([run('needs-answer')], { open: true });
    expect(bar().textContent).toContain(
      'Claude Code is asking you something in the terminal below.',
    );
    expect(bar().textContent).toContain('This is your own Claude Code.');
    expect(outlined()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(bar().textContent).not.toContain('This is your own Claude Code.');
  });

  it('opens Claude’s work at once for Claude Code’s own screens', () => {
    vi.useFakeTimers();
    const { claude } = panel([run('starting', {}, { screen: 'trust' })]);
    act(() => vi.advanceTimersByTime(0));
    expect(claude.show).toHaveBeenCalledWith('run-1');
  });

  it('explains Claude Code’s first-run screens and its question about trust', () => {
    panel([run('starting', {}, { screen: 'first-run' })], { open: true });
    expect(screen.getByRole('note').textContent).toContain(
      'Claude Code shows a few screens the first time it opens',
    );
    expect(screen.getByRole('status').textContent).toBe('Needs your answer');
    expect(outlined()).toBe(true);
    cleanup();
    panel([run('starting', {}, { screen: 'trust' })], { open: true });
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByRole('note').textContent).toContain(
      'Claude Code asks once whether to trust your workspace',
    );
  });

  it('keeps Claude’s work folded away, and shows it on request', async () => {
    const { container, claude } = panel([run('working')]);
    expect(container.querySelector('[inert]')).not.toBeNull();
    expect(terminalOf()?.shown).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show Claude’s work' }));
    expect(claude.showWork).toHaveBeenCalledWith(true);
  });

  it('says what Claude is doing, a step at a time, and for how long', () => {
    const activity: RunActivity = {
      ...NOTHING,
      steps: [
        step('Read', 'facts/platform.md', 'done', 'a'),
        step('mcp__factwright__build_resume', null, 'running', 'b'),
      ],
      lastAt: Date.now(),
      end: null,
    };
    panel([run('working', { activity })]);
    expect(bar().textContent).toContain('Read your fact bank');
    expect(bar().textContent).toContain('Building the resume…');
    expect(bar().textContent).toContain('Running for 1:24');
  });

  it('points to Claude’s work when Claude has gone quiet for a while', () => {
    const activity: RunActivity = {
      ...NOTHING,
      steps: [step('Read', 'facts/platform.md', 'done')],
      lastAt: Date.now() - QUIET_AFTER_MS - 1000,
      end: null,
    };
    panel([run('working', { activity })]);
    expect(bar().textContent).toContain('No word from Claude for a few minutes.');
  });

  it('says what a finished task made, with a way to open it', async () => {
    const go = vi.fn();
    panel([
      run('done', {
        result: { text: 'Your tailored resume for Acme is ready.', open: { label: 'Open it', go } },
      }),
    ]);
    expect(screen.getAllByText('Your tailored resume for Acme is ready.')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(go).toHaveBeenCalled();
  });

  it('lists what a finished task changed, with Undo, but not while Claude works', () => {
    const changes = {
      changes: {
        id: '20261025-140311-123-a1b2c3',
        files: [
          {
            path: 'applications/acme/job.md',
            change: 'changed' as const,
            lines: { added: 3, removed: 1 },
            canUndo: true,
            undone: false,
          },
        ],
        pages: ['https://acme.com/careers'],
        morePages: 0,
      },
      undo: vi.fn(),
    };
    panel([run('working', { changes })]);
    expect(screen.queryByRole('region', { name: 'What Claude changed' })).toBeNull();
    cleanup();
    panel([run('done', { changes })]);
    const list = screen.getByRole('region', { name: 'What Claude changed' });
    expect(list.textContent).toContain('Claude changed 1 file and read 1 page.');
    expect(screen.getByRole('button', { name: 'Undo applications/acme/job.md' })).toBeTruthy();
  });

  it('shows what Claude said when it stopped to ask, and sends the user’s reply to its run', async () => {
    const activity: RunActivity = {
      ...NOTHING,
      steps: [],
      lastAt: null,
      end: { said: 'Which template would you like, Classic or Minimal?', error: null },
    };
    const { claude } = panel([run('done', { activity, stoppedShort: true })]);
    expect(bar().textContent).toContain('Claude has a question for you.');
    expect(bar().textContent).toContain('Which template would you like, Classic or Minimal?');
    expect(screen.getByRole('status').textContent).toBe('Needs your answer');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Reply to Claude' }),
      'Classic{Enter}',
    );
    expect(claude.reply).toHaveBeenCalledWith('run-1', 'Classic');
    expect(
      (screen.getByRole('textbox', { name: 'Reply to Claude' }) as HTMLInputElement).value,
    ).toBe('');
    // It waits on the user, so it offers Stop, not Close.
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(claude.stop).toHaveBeenCalledWith('run-1');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('offers Close once Claude is done, which closes the run’s tab', async () => {
    const { claude } = panel([run('done')]);
    expect(bar().textContent).toContain('Claude is done.');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(claude.close).toHaveBeenCalledWith('run-1');
  });

  it('says a task stopped short without saying it’s done', () => {
    const activity: RunActivity = {
      ...NOTHING,
      steps: [],
      lastAt: null,
      end: { said: 'I need the posting.', error: null },
    };
    panel([run('done', { activity, stoppedShort: true })]);
    expect(bar().textContent).toContain('Claude stopped before it was done.');
  });

  it('says a turn ended in an error, such as a rate limit, and tries the task again', async () => {
    const onRetry = vi.fn();
    const activity: RunActivity = {
      ...NOTHING,
      steps: [],
      lastAt: null,
      end: { said: null, error: { kind: 'rate_limit', message: 'API Error: Rate limit reached' } },
    };
    panel([run('done', { activity, onRetry })]);
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(bar().textContent).toContain(
      'Claude hit a rate limit, or your plan’s usage limit for now.',
    );
    expect(screen.queryByRole('textbox', { name: 'Reply to Claude' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says why a run couldn’t start', () => {
    panel([run('failed', {}, { problem: 'revision', startedAt: null })]);
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(bar().textContent).toContain('This revision needs sending again.');
  });
});

describe('runs side by side', () => {
  const tabs = [
    run('working'),
    run(
      'needs-answer',
      {
        title: 'Globex · Cover letter',
        state: 'waiting',
        asking: { what: 'questions', count: 1, open: false, onAnswer: vi.fn() },
      },
      { id: 'run-2', task: { skill: 'cover-letter', jobId: 'globex--pm' } },
    ),
    run(
      'in-line',
      { title: 'Acme · Cover letter', state: 'in-line' },
      {
        id: 'run-3',
        task: { skill: 'cover-letter', jobId: 'acme--staff' },
        waits: 'job',
        startedAt: null,
      },
    ),
  ];

  it('gives each run a tab, with a dot that says where it stands, and sums them up', async () => {
    const { container, claude } = panel(tabs);
    const strip = screen.getByRole('tablist', { name: 'Claude’s tasks' });
    expect(
      within(strip)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([
      'Acme · Tailored resume, working',
      'Globex · Cover letter, waiting on you',
      'Acme · Cover letter, in line',
    ]);
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain(
      'Acme · Tailored resume',
    );
    expect(bar().textContent).toContain('1 running · 1 waiting on you · 1 in line');
    // The bar is the shown run's, in the tab's panel.
    expect(screen.getByRole('tabpanel', { name: /Acme · Tailored resume/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /Globex · Cover letter/ }));
    expect(claude.select).toHaveBeenCalledWith('run-2');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('moves between tabs with the arrow keys, as tabs do', async () => {
    const { claude } = panel(tabs);
    screen.getByRole('tab', { selected: true }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(claude.select).toHaveBeenLastCalledWith('run-2');
    await userEvent.keyboard('{End}');
    expect(claude.select).toHaveBeenLastCalledWith('run-3');
    await userEvent.keyboard('{ArrowLeft}');
    expect(claude.select).toHaveBeenLastCalledWith('run-2');
  });

  it('keeps every run’s terminal, sized, with only the shown run’s in view', () => {
    panel(tabs, { open: true, shown: tabs[1]?.view ?? null });
    expect(terminalOf('run-1')?.shown).toBe(false);
    expect(terminalOf('run-2')?.shown).toBe(true);
    // A task in line has no Claude Code yet.
    expect(terminalOf('run-3')).toBeUndefined();
  });

  it('says what a task in line waits for, with Close to take it out of line', async () => {
    const { claude } = panel(tabs, { shown: tabs[2]?.view ?? null });
    expect(screen.getByRole('status').textContent).toBe('In line');
    expect(bar().textContent).toContain(
      'Waits for Claude’s other task on this job, then starts by itself.',
    );
    expect(screen.queryByRole('button', { name: 'Show Claude’s work' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(claude.close).toHaveBeenCalledWith('run-3');
  });

  it('has no tabs for one run alone, as before', () => {
    panel([run('working')]);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });
});

describe('endsAsking', () => {
  const ended = (said: string | null, error = false): RunActivity => ({
    ...NOTHING,
    steps: [],
    lastAt: null,
    end: { said, error: error ? { kind: 'rate_limit', message: 'Rate limit' } : null },
  });

  it('says a run that’s done waits on the user when Claude ended on a question', () => {
    expect(endsAsking('done', ended('Classic or Minimal?'), null)).toBe(true);
  });

  it('says it doesn’t for a statement, an error, something made, or a run still going', () => {
    expect(endsAsking('done', ended('Done. The job’s panel shows what changed.'), null)).toBe(
      false,
    );
    expect(endsAsking('done', ended('Classic or Minimal?', true), null)).toBe(false);
    expect(endsAsking('done', ended('Want a letter too?'), { text: 'Ready.', open: null })).toBe(
      false,
    );
    expect(endsAsking('working', ended('Classic or Minimal?'), null)).toBe(false);
    expect(endsAsking('done', NOTHING, null)).toBe(false);
  });
});

describe('doingLine', () => {
  it('says the step Claude is on after the last one done, or none while it thinks', () => {
    expect(doingLine([])).toEqual({ did: null, doing: null, kind: null });
    const read = step('Read', 'guide/writing.md', 'running', 'a');
    expect(doingLine([read])).toEqual({
      did: null,
      doing: 'Reading your writing guide…',
      kind: 'reading',
    });
    const done = { ...read, state: 'done' as const };
    expect(doingLine([done])).toEqual({ did: 'Read your writing guide', doing: null, kind: null });
    // A tick on its to-do list says nothing worth showing, and leaves the line as it was.
    const todo = step('TodoWrite', null, 'running', 'b');
    expect(doingLine([done, todo])).toMatchObject({ did: 'Read your writing guide', doing: null });
  });

  it('leaves its helpers’ steps to them', () => {
    const own = step('mcp__factwright__build_resume', null, 'running', 'a');
    const helpers = { ...step('Read', 'facts/a.md', 'running', 'b'), helper: 'agent-a1' };
    expect(doingLine([own, helpers])).toEqual({
      did: null,
      doing: 'Building the resume…',
      kind: 'building',
    });
    expect(doingLine([helpers]).doing).toBeNull();
  });
});

describe('the working strip', () => {
  const helper = (id: string, what: string | null = null) => ({ id, what });
  const list = (on: number, of: number) =>
    Array.from({ length: of }, (_, at) => ({
      text: `Do part ${at + 1}`,
      doing: `Doing part ${at + 1}`,
      state:
        at < on - 1
          ? ('completed' as const)
          : at === on - 1
            ? ('in_progress' as const)
            : ('pending' as const),
    }));
  const activity = (changed: Partial<RunActivity>): RunActivity => ({
    ...NOTHING,
    lastAt: Date.now(),
    ...changed,
  });

  it('says where Claude is on its to-do list, what it’s doing in that step, and the last step done', () => {
    const working = activity({
      steps: [
        step('Read', 'applications/acme--staff/posting.md', 'done', 'a'),
        step('Read', 'facts/platform.md', 'running', 'b'),
      ],
      todos: list(3, 7),
    });
    expect(workingLines(working, 'focused-resume')).toEqual({
      lead: 'Step 3 of 7: Doing part 3',
      also: ['Reading your fact bank…'],
      did: 'Read the posting',
    });
    const { container } = panel([run('working', { activity: working })]);
    expect(bar().textContent).toContain('Step 3 of 7: Doing part 3');
    expect(bar().textContent).toContain('Reading your fact bank…');
    expect(bar().textContent).toContain('Read the posting');
    expect(container.querySelector('[data-scene]')?.getAttribute('data-scene')).toBe('reading');
  });

  it('says what a run’s helpers do, and draws them side by side', () => {
    const helping = activity({
      steps: [step('Agent', 'Analyze Acme', 'done', 'a')],
      helpers: [helper('agent-1'), helper('agent-2'), helper('agent-3'), helper('agent-4')],
    });
    expect(workingLines(helping, 'analyze-job')).toEqual({
      lead: '4 helpers analyzing jobs…',
      also: [],
      did: 'Started a helper for “Analyze Acme”',
    });
    expect(sceneOf(helping, 'analyze-job')).toEqual({ kind: 'helpers', lanes: 4 });
    // With a to-do list, under the step it's on.
    expect(workingLines({ ...helping, todos: list(2, 3) }, 'job-search')).toMatchObject({
      lead: 'Step 2 of 3: Doing part 2',
      also: ['4 helpers going through the jobs'],
    });
  });

  it('draws a helper alone as its run’s skill says it works, or as the step it’s on', () => {
    const checking = activity({
      steps: [{ ...step('Read', 'facts/a.md', 'running', 'b'), helper: 'agent-1' }],
      helpers: [helper('agent-1', 'Fact-check the resume')],
    });
    expect(sceneOf(checking, 'focused-resume')).toEqual({ kind: 'checking', lanes: 1 });
    expect(workingLines(checking, 'focused-resume').lead).toBe('A helper is checking the facts…');
    expect(sceneOf(checking, 'salary-check')).toEqual({ kind: 'reading', lanes: 1 });
    expect(workingLines(checking, 'salary-check').lead).toBe(
      'A helper is on “Fact-check the resume”…',
    );
  });

  it('says a helper Claude waits for is at work, not that Claude is still starting it', () => {
    // A helper Claude waits for keeps the call that started it going until it's done.
    const waiting = activity({
      steps: [
        step('Agent', 'Fact-check the resume', 'running', 'a'),
        { ...step('Read', 'facts/a.md', 'running', 'b'), helper: 'agent-1' },
      ],
      helpers: [helper('agent-1', 'Fact-check the resume')],
    });
    expect(workingLines(waiting, 'focused-resume').lead).toBe('A helper is checking the facts…');
    expect(sceneOf(waiting, 'focused-resume')).toEqual({ kind: 'checking', lanes: 1 });
    // Once it's done, the call says it started one.
    const back = activity({ steps: [step('Agent', 'Fact-check the resume', 'done', 'a')] });
    expect(workingLines(back, 'focused-resume')).toMatchObject({
      lead: 'Thinking…',
      did: 'Started a helper for “Fact-check the resume”',
    });
  });

  it('draws drifting dots beside its words when Claude has gone quiet', () => {
    const quiet = activity({
      steps: [step('mcp__factwright__build_resume', null, 'running')],
      lastAt: Date.now() - QUIET_AFTER_MS - 1000,
    });
    const { container } = panel([run('working', { activity: quiet })]);
    expect(container.querySelector('[data-scene]')?.getAttribute('data-scene')).toBe('thinking');
    expect(bar().textContent).toContain('No word from Claude for a few minutes.');
  });

  it('keeps each part of its second line apart, for a screen reader too', () => {
    const working = activity({
      steps: [
        step('Read', 'applications/acme--staff/posting.md', 'done', 'a'),
        step('Read', 'facts/platform.md', 'running', 'b'),
      ],
      todos: list(3, 7),
    });
    panel([run('working', { activity: working })]);
    expect(bar().textContent).toContain('Reading your fact bank… Read the posting');
  });

  it('draws the step Claude itself is on, or drifting dots while it thinks', () => {
    const building = activity({ steps: [step('mcp__factwright__build_resume', null, 'running')] });
    expect(sceneOf(building, null)).toEqual({ kind: 'building', lanes: 0 });
    expect(sceneOf(activity({}), null)).toEqual({ kind: 'thinking', lanes: 0 });
    expect(workingLines(activity({}), null)).toEqual({ lead: 'Thinking…', also: [], did: null });
    // Claude both on a step and with a helper: the step first, its helper under it.
    const both = activity({ ...building, helpers: [helper('agent-1')] });
    expect(sceneOf(both, null)).toEqual({ kind: 'building', lanes: 1 });
    expect(workingLines(both, null)).toMatchObject({
      lead: 'Building the resume…',
      also: ['A helper is at work'],
    });
  });

  it('draws a run starting as drifting dots, and nothing once it’s done', () => {
    const { container } = panel([run('starting')]);
    expect(container.querySelector('[data-scene]')?.getAttribute('data-scene')).toBe('thinking');
    cleanup();
    const done = panel([run('done', { activity: activity({ todos: list(2, 3) }) })]);
    expect(done.container.querySelector('[data-scene]')).toBeNull();
    expect(bar().textContent).not.toContain('Step 2 of 3');
  });

  it('gives a run at work on a to-do list its step in its tab', () => {
    panel([
      run('working', { activity: activity({ todos: list(3, 7) }) }),
      run(
        'working',
        { title: 'Globex · Cover letter' },
        { id: 'run-2', task: { skill: 'cover-letter', jobId: 'globex--pm' } },
      ),
    ]);
    expect(
      screen.getByRole('tab', { name: /^Acme · Tailored resume, working, step 3 of 7$/ })
        .textContent,
    ).toContain('3/7');
    expect(screen.getByRole('tab', { name: /^Globex · Cover letter, working$/ })).toBeTruthy();
  });
});

describe('clock', () => {
  it('says how long it’s been as a clock does', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(42_000)).toBe('0:42');
    expect(clock(725_000)).toBe('12:05');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});
