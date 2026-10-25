// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunStep } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';
import { ClaudePanel, clock, doingLine, endsAsking, QUIET_AFTER_MS } from './ClaudePanel.tsx';
import type { ClaudeRun, RunPhase } from './useClaudeRun.ts';
import type { RunActivity } from './useRunActivity.ts';

// The terminal itself needs a real browser, and these tests are about what's around it.
const { terminal } = vi.hoisted(() => ({
  terminal: vi.fn((_props: { attention?: boolean; shown?: boolean }) => null),
}));
vi.mock('./TerminalView.tsx', () => ({ TerminalView: terminal }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

/** Whether the terminal was last drawn outlined, as waiting on the user. */
const outlined = () => terminal.mock.lastCall?.[0]?.attention === true;

const run = (
  open: boolean,
  trustAsked = false,
  firstRun = false,
  phase: RunPhase = 'needs-answer',
) =>
  ({
    phase,
    open,
    problem: undefined,
    runId: 1,
    task: { skill: 'focused-resume', jobId: 'acme--staff' },
    taskId: 1,
    startedAt: Date.now() - 84_000,
    trustAsked,
    firstRun,
    typed: vi.fn(),
    requestStart: vi.fn(),
    onTerminalSize: vi.fn(),
    stop: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    showWork: vi.fn(),
    close: vi.fn(),
  }) satisfies ClaudeRun;

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

const api = () =>
  ({ replyToClaude: vi.fn() }) as unknown as FactwrightApi & {
    replyToClaude: ReturnType<typeof vi.fn>;
  };

const bar = () => screen.getByRole('region', { name: 'Claude' });

describe('ClaudePanel', () => {
  it('keeps questions the user put aside waiting in the bar, with a way back to them', async () => {
    const onAnswer = vi.fn();
    render(
      <ClaudePanel
        api={api()}
        run={run(false)}
        plan="Max"
        asking={{ what: 'questions', count: 2, open: false, onAnswer }}
      />,
    );
    expect(bar().textContent).toContain('Claude is waiting for your answer to 2 questions.');
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalled();
    // Waiting in the app's dialog, it opens none of Claude's work.
    expect(outlined()).toBe(false);
  });

  it('says Claude has a question while its dialog is open, and keeps a permission prompt waiting too', async () => {
    const { rerender } = render(
      <ClaudePanel
        api={api()}
        run={run(false)}
        plan="Max"
        asking={{ what: 'questions', count: 1, open: true, onAnswer: vi.fn() }}
      />,
    );
    expect(bar().textContent).toContain('Claude has a question for you.');
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    const onAnswer = vi.fn();
    rerender(
      <ClaudePanel
        api={api()}
        run={run(false)}
        plan="Max"
        asking={{ what: 'permission', count: 1, open: false, onAnswer }}
      />,
    );
    expect(bar().textContent).toContain(
      'Claude Code is waiting for your OK before Claude carries on.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalled();
  });

  it('opens Claude’s work for what only the terminal can answer, once the app would have asked', async () => {
    vi.useFakeTimers();
    const folded = run(false);
    render(<ClaudePanel api={api()} run={folded} plan="Max" />);
    expect(bar().textContent).toContain('Claude Code is asking you something in its work below.');
    expect(folded.show).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1200));
    expect(folded.show).toHaveBeenCalledOnce();
    vi.useRealTimers();
    cleanup();
    // Shown, it points to the terminal, explaining it once to someone new.
    render(<ClaudePanel api={api()} run={run(true)} plan="Max" />);
    expect(bar().textContent).toContain(
      'Claude Code is asking you something in the terminal below.',
    );
    expect(bar().textContent).toContain('This is your own Claude Code.');
    expect(outlined()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(bar().textContent).not.toContain('This is your own Claude Code.');
  });

  it('explains Claude Code’s first-run screens and its question about trust', () => {
    const starting = run(true, false, true, 'starting');
    const { rerender } = render(<ClaudePanel api={api()} run={starting} plan="Max" />);
    expect(screen.getByRole('note').textContent).toContain(
      'Claude Code shows a few screens the first time it opens',
    );
    expect(screen.getByRole('status').textContent).toBe('Needs your answer');
    expect(outlined()).toBe(true);
    rerender(
      <ClaudePanel
        api={api()}
        run={{ ...starting, trustAsked: true, firstRun: false }}
        plan="Max"
      />,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByRole('note').textContent).toContain(
      'Claude Code asks once whether to trust your workspace',
    );
  });

  it('keeps Claude’s work folded away, and shows it on request', async () => {
    const folded = run(false, false, false, 'working');
    const { container } = render(<ClaudePanel api={api()} run={folded} plan="Max" />);
    expect(container.querySelector('[inert]')).not.toBeNull();
    expect(terminal.mock.lastCall?.[0]?.shown).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show Claude’s work' }));
    expect(folded.showWork).toHaveBeenCalledWith(true);
  });

  it('says what Claude is doing, a step at a time, and for how long', () => {
    const activity: RunActivity = {
      steps: [
        step('Read', 'facts/platform.md', 'done', 'a'),
        step('mcp__factwright__build_resume', null, 'running', 'b'),
      ],
      lastAt: Date.now(),
      end: null,
    };
    render(
      <ClaudePanel
        api={api()}
        run={run(false, false, false, 'working')}
        plan="Max"
        activity={activity}
      />,
    );
    expect(bar().textContent).toContain('Read your fact bank');
    expect(bar().textContent).toContain('Building the resume…');
    expect(bar().textContent).toContain('Running for 1:24');
  });

  it('points to Claude’s work when Claude has gone quiet for a while', () => {
    const activity: RunActivity = {
      steps: [step('Read', 'facts/platform.md', 'done')],
      lastAt: Date.now() - QUIET_AFTER_MS - 1000,
      end: null,
    };
    render(
      <ClaudePanel
        api={api()}
        run={run(false, false, false, 'working')}
        plan="Max"
        activity={activity}
      />,
    );
    expect(bar().textContent).toContain('No word from Claude for a few minutes.');
  });

  it('says what a finished task made, with a way to open it', async () => {
    const go = vi.fn();
    render(
      <ClaudePanel
        api={api()}
        run={run(false, false, false, 'done')}
        plan="Max"
        result={{ text: 'Your tailored resume for Acme is ready.', open: { label: 'Open it', go } }}
      />,
    );
    expect(screen.getAllByText('Your tailored resume for Acme is ready.')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(go).toHaveBeenCalled();
  });

  it('shows what Claude said when it stopped to ask, and sends the user’s reply', async () => {
    const replying = api();
    const activity: RunActivity = {
      steps: [],
      lastAt: null,
      end: { said: 'Which template would you like, Classic or Minimal?', error: null },
    };
    render(
      <ClaudePanel
        api={replying}
        run={run(false, false, false, 'done')}
        plan="Max"
        activity={activity}
        stoppedShort
      />,
    );
    expect(bar().textContent).toContain('Claude has a question for you.');
    expect(bar().textContent).toContain('Which template would you like, Classic or Minimal?');
    expect(screen.getByRole('status').textContent).toBe('Needs your answer');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Reply to Claude' }),
      'Classic{Enter}',
    );
    expect(replying.replyToClaude).toHaveBeenCalledWith('Classic');
    expect(
      (screen.getByRole('textbox', { name: 'Reply to Claude' }) as HTMLInputElement).value,
    ).toBe('');
    // It waits on the user, so it offers Stop, not Close.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('offers Close once Claude is done, which quits Claude Code and puts the bar away', async () => {
    const done = run(false, false, false, 'done');
    render(<ClaudePanel api={api()} run={done} plan="Max" />);
    expect(bar().textContent).toContain('Claude is done.');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(done.close).toHaveBeenCalled();
  });

  it('says a task stopped short without saying it’s done', () => {
    const activity: RunActivity = {
      steps: [],
      lastAt: null,
      end: { said: 'I need the posting.', error: null },
    };
    render(
      <ClaudePanel
        api={api()}
        run={run(false, false, false, 'done')}
        plan="Max"
        activity={activity}
        stoppedShort
      />,
    );
    expect(bar().textContent).toContain('Claude stopped before it was done.');
  });

  it('says a turn ended in an error, such as a rate limit, and tries the task again', async () => {
    const onRetry = vi.fn();
    const activity: RunActivity = {
      steps: [],
      lastAt: null,
      end: { said: null, error: { kind: 'rate_limit', message: 'API Error: Rate limit reached' } },
    };
    render(
      <ClaudePanel
        api={api()}
        run={run(false, false, false, 'done')}
        plan="Max"
        activity={activity}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(bar().textContent).toContain(
      'Claude hit a rate limit, or your plan’s usage limit for now.',
    );
    expect(screen.queryByRole('textbox', { name: 'Reply to Claude' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('endsAsking', () => {
  const ended = (said: string | null, error = false): RunActivity => ({
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
    expect(endsAsking('done', { steps: [], lastAt: null, end: null }, null)).toBe(false);
  });
});

describe('doingLine', () => {
  it('says the step Claude is on after the last one done, or that it’s thinking', () => {
    expect(doingLine([])).toEqual({ did: null, doing: 'Thinking…' });
    const read = step('Read', 'guide/writing.md', 'running', 'a');
    expect(doingLine([read])).toEqual({ did: null, doing: 'Reading your writing guide…' });
    const done = { ...read, state: 'done' as const };
    expect(doingLine([done])).toEqual({ did: 'Read your writing guide', doing: 'Thinking…' });
    // Its to-do list says nothing worth showing, and leaves the line as it was.
    const todo = step('TodoWrite', null, 'running', 'b');
    expect(doingLine([done, todo])).toEqual({ did: 'Read your writing guide', doing: 'Thinking…' });
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
