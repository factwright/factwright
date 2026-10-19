// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelHeader } from './PanelHeader.tsx';
import type { RunPhase } from './useClaudeRun.ts';

afterEach(cleanup);

function renderHeader(phase: RunPhase, problem?: string) {
  const actions = { onStop: vi.fn(), onHide: vi.fn(), onClose: vi.fn() };
  const result = render(
    <PanelHeader phase={phase} plan="Max plan" problem={problem} {...actions} />,
  );
  return { ...result, ...actions };
}

describe('PanelHeader', () => {
  it('says whose Claude it is', () => {
    renderHeader('working');
    expect(screen.getByText('Runs on your own Claude · Max plan')).toBeTruthy();
  });

  it.each([
    ['ready', 'Ready', 'Claude Code is ready. Type what you’d like.'],
    ['working', 'Working', 'Keep working. You’ll hear when Claude needs you.'],
    ['needs-answer', 'Needs your answer', 'Claude has a question. Answer it in the panel below.'],
    ['done', 'Done', 'Claude is done. Type to keep going, or close the panel.'],
  ] as const)('while %s, shows the state and offers Stop and Hide', (phase, chip, hint) => {
    const { onStop, onHide } = renderHeader(phase);
    expect(screen.getByRole('status').textContent).toBe(chip);
    expect(screen.getByText(hint)).toBeTruthy();
    screen.getByRole('button', { name: 'Stop' }).click();
    screen.getByRole('button', { name: 'Hide' }).click();
    expect(onStop).toHaveBeenCalledOnce();
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('once Claude Code has closed, offers only Close', () => {
    const { onClose } = renderHeader('stopped');
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("explains a run that couldn't start", () => {
    renderHeader('idle', 'Claude Code couldn’t start.');
    expect(screen.getByRole('status').textContent).toBe('Didn’t finish');
    expect(screen.getByText('Claude Code couldn’t start.')).toBeTruthy();
  });

  it('finds no accessibility problems', async () => {
    const { container } = renderHeader('needs-answer');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
