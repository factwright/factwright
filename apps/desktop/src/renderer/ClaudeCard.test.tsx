// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCard } from './ClaudeCard.tsx';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

afterEach(cleanup);

describe('ClaudeCard', () => {
  it('shows the plan when Claude is ready, and that Factwright never sees the login', () => {
    render(
      <ClaudeCard
        status={{ state: 'ready', version: '2.1.296', plan: 'max' }}
        onRecheck={vi.fn()}
      />,
    );
    expect(screen.getByText('Signed in · Max plan')).toBeTruthy();
    expect(screen.getByText('Factwright never sees your login.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it.each([
    [{ state: 'signed-out', version: '2.1.296' }, 'Not signed in', 'claude auth login'],
    [
      { state: 'too-old', version: '2.0.12', minimum: '2.1.270' },
      'Needs an update',
      'claude update',
    ],
    [{ state: 'missing' }, 'Claude Code isn’t installed', 'How to install it'],
    [{ state: 'unknown' }, 'Couldn’t check Claude Code', 'Make sure it opens in Terminal'],
  ] as [ClaudeStatusView, string, string][])(
    'explains the fix and offers to check again (%o)',
    (status, line, fix) => {
      const onRecheck = vi.fn();
      render(<ClaudeCard status={status} onRecheck={onRecheck} />);
      expect(screen.getByText(line)).toBeTruthy();
      expect(screen.getByText(fix, { exact: false })).toBeTruthy();
      screen.getByRole('button', { name: 'Check again' }).click();
      expect(onRecheck).toHaveBeenCalledOnce();
    },
  );

  it('says it is checking while the first answer is on its way', () => {
    render(<ClaudeCard status="checking" onRecheck={vi.fn()} />);
    expect(screen.getByText('Checking…')).toBeTruthy();
  });

  it('finds no accessibility problems', async () => {
    const { container } = render(<ClaudeCard status={{ state: 'missing' }} onRecheck={vi.fn()} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
