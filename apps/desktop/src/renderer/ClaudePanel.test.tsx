// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../shared/api.ts';
import { ClaudePanel } from './ClaudePanel.tsx';
import type { ClaudeRun } from './useClaudeRun.ts';

// The terminal itself needs a real browser, and these tests are about what's around it.
vi.mock('./TerminalView.tsx', () => ({ TerminalView: () => null }));

afterEach(cleanup);

const run = (open: boolean) =>
  ({
    phase: 'needs-answer',
    open,
    problem: undefined,
    runId: 1,
    task: null,
    trustAsked: false,
    typed: vi.fn(),
    requestStart: vi.fn(),
    onTerminalSize: vi.fn(),
    stop: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  }) satisfies ClaudeRun;

describe('ClaudePanel', () => {
  it('keeps questions the user put aside waiting, with a way back to them', async () => {
    const onAnswer = vi.fn();
    render(
      <ClaudePanel
        api={{} as FactwrightApi}
        run={run(true)}
        plan="Max"
        asking={{ count: 2, open: false, onAnswer }}
      />,
    );
    const panel = screen.getByRole('region', { name: 'Claude' });
    expect(panel.textContent).toContain('Claude is waiting for your answer to 2 questions.');
    // The header says Claude has a question, not that it's in the terminal.
    expect(panel.textContent).toContain('Claude has a question for you.');
    expect(panel.textContent).not.toContain('Answer it in the panel below');
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalled();
  });

  it('offers them from the slim bar too, while the panel is tucked away', async () => {
    const onAnswer = vi.fn();
    render(
      <ClaudePanel
        api={{} as FactwrightApi}
        run={run(false)}
        plan="Max"
        asking={{ count: 1, open: false, onAnswer }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Answer Claude' }));
    expect(onAnswer).toHaveBeenCalled();
  });

  it('says nothing more of questions while their dialog is open, or when none wait', () => {
    const { rerender } = render(
      <ClaudePanel
        api={{} as FactwrightApi}
        run={run(true)}
        plan="Max"
        asking={{ count: 1, open: true, onAnswer: vi.fn() }}
      />,
    );
    expect(screen.queryByText(/waiting for your answer/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(screen.getByText('Claude has a question for you.')).toBeTruthy();
    // A question in the terminal, such as one sent there, is answered in the panel.
    rerender(<ClaudePanel api={{} as FactwrightApi} run={run(true)} plan="Max" />);
    expect(screen.queryByText(/waiting for your answer/)).toBeNull();
    expect(screen.getByText('Claude has a question. Answer it in the panel below.')).toBeTruthy();
  });
});
