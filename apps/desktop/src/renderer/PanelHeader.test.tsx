// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelHeader } from './PanelHeader.tsx';
import type { RunPhase } from './useClaudeRun.ts';

afterEach(cleanup);

function renderHeader(
  phase: RunPhase,
  { problem, workShown = false, failed = false }: Partial<Record<string, unknown>> = {},
) {
  const actions = { onStop: vi.fn(), onShowWork: vi.fn(), onClose: vi.fn() };
  const result = render(
    <PanelHeader
      title="Tailored resume · Acme"
      phase={phase}
      plan="Max plan"
      problem={problem as string | undefined}
      text="Reading your fact bank…"
      elapsed="1:24"
      workShown={workShown as boolean}
      failed={failed as boolean}
      {...actions}
    />,
  );
  return { ...result, ...actions };
}

describe('PanelHeader', () => {
  it('says whose Claude it is, what it’s doing, and for how long', () => {
    renderHeader('working');
    expect(screen.getByText('Runs on your own Claude · Max plan')).toBeTruthy();
    expect(screen.getByText('Tailored resume · Acme')).toBeTruthy();
    expect(screen.getByText('Reading your fact bank…')).toBeTruthy();
    expect(screen.getByText('1:24').textContent).toBe('Running for 1:24');
  });

  it.each([
    ['starting', 'Starting'],
    ['working', 'Working'],
    ['needs-answer', 'Needs your answer'],
  ] as const)('while %s, shows the state and offers Stop and Claude’s work', (phase, chip) => {
    const { onStop, onShowWork, onClose } = renderHeader(phase);
    expect(screen.getByRole('status').textContent).toBe(chip);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    screen.getByRole('button', { name: 'Stop' }).click();
    screen.getByRole('button', { name: 'Show Claude’s work' }).click();
    expect(onStop).toHaveBeenCalledOnce();
    expect(onShowWork).toHaveBeenCalledWith(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['done', 'Done'],
    ['ready', 'Ready'],
  ] as const)(
    'while %s, offers Close in place of Stop, though Claude Code is still open',
    (phase, chip) => {
      const { onStop, onClose } = renderHeader(phase);
      expect(screen.getByRole('status').textContent).toBe(chip);
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
      screen.getByRole('button', { name: 'Close' }).click();
      expect(onClose).toHaveBeenCalledOnce();
      expect(onStop).not.toHaveBeenCalled();
    },
  );

  it('folds Claude’s work away again', () => {
    const { onShowWork } = renderHeader('working', { workShown: true });
    const hide = screen.getByRole('button', { name: 'Hide Claude’s work' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    hide.click();
    expect(onShowWork).toHaveBeenCalledWith(false);
  });

  it('says a turn that ended in an error didn’t finish, and offers Close', () => {
    renderHeader('done', { failed: true });
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('once Claude Code has closed, offers Close in place of Stop', () => {
    const { onClose } = renderHeader('stopped');
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("explains a run that couldn't start", () => {
    renderHeader('idle', { problem: 'Claude Code couldn’t start.' });
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(screen.getByText('Claude Code couldn’t start.')).toBeTruthy();
  });

  it('finds no accessibility problems', async () => {
    const { container } = renderHeader('needs-answer');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
