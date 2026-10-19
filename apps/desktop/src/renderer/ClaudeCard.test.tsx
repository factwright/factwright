// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

  it('starts Claude Code by its whole path when the terminal doesn’t find it by name', async () => {
    const claude = '& "$env:USERPROFILE\\.local\\bin\\claude.exe"';
    const copy = vi.fn(async () => ({ ok: true as const }));
    const { container, rerender } = render(
      <ClaudeCard
        status={{ state: 'signed-out', version: '2.1.303', claude }}
        onRecheck={vi.fn()}
        copy={copy}
        terminal="PowerShell"
      />,
    );
    expect(container.textContent).toContain(
      `In PowerShell, run ${claude} auth login, then come back.`,
    );
    // It's long to type, so the card copies it.
    screen.getByRole('button', { name: 'Copy the command' }).click();
    await waitFor(() => expect(copy).toHaveBeenCalledWith(`${claude} auth login`));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    for (const [status, command] of [
      [{ state: 'too-old', version: '2.0.12', minimum: '2.1.270', claude }, `${claude} update`],
      [{ state: 'unknown', claude }, `${claude} --version`],
    ] as [ClaudeStatusView, string][]) {
      copy.mockClear();
      rerender(
        <ClaudeCard status={status} onRecheck={vi.fn()} copy={copy} terminal="PowerShell" />,
      );
      expect(container.textContent).toContain(command);
      screen.getByRole('button', { name: 'Copy the command' }).click();
      await waitFor(() => expect(copy).toHaveBeenCalledWith(command));
    }
  });

  it('offers no copy for plain claude, which is short to type', () => {
    render(
      <ClaudeCard
        status={{ state: 'signed-out', version: '2.1.303' }}
        onRecheck={vi.fn()}
        copy={vi.fn()}
      />,
    );
    expect(screen.getByText('claude auth login')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy the command' })).toBeNull();
  });

  it('opens Claude’s settings, once Claude is ready', () => {
    const onSettings = vi.fn();
    const { rerender } = render(
      <ClaudeCard
        status={{ state: 'ready', version: '2.1.296', plan: 'max' }}
        onRecheck={vi.fn()}
        onSettings={onSettings}
      />,
    );
    screen.getByRole('button', { name: 'Settings' }).click();
    expect(onSettings).toHaveBeenCalledOnce();
    rerender(
      <ClaudeCard
        status={{ state: 'signed-out', version: '2.1.296' }}
        onRecheck={vi.fn()}
        onSettings={onSettings}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('says it is checking while the first answer is on its way', () => {
    render(<ClaudeCard status="checking" onRecheck={vi.fn()} />);
    expect(screen.getByText('Checking…')).toBeTruthy();
  });

  it('finds no accessibility problems', async () => {
    const { container } = render(<ClaudeCard status={{ state: 'missing' }} onRecheck={vi.fn()} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('says when Factwright’s setup failed with the Claude Code installed now, and checks again', () => {
    const ready = { state: 'ready', version: '2.1.300', plan: 'max' } as const;
    const failed = {
      version: '2.1.300',
      result: 'failed',
      problem: 'Claude Code closed before it reached Factwright’s tools.',
      at: '2026-10-11T18:00:00.000Z',
    } as const;
    const onCheckSetup = vi.fn();
    const { rerender } = render(
      <ClaudeCard status={ready} onRecheck={vi.fn()} setup={failed} onCheckSetup={onCheckSetup} />,
    );
    expect(screen.getByText('Setup check failed')).toBeTruthy();
    expect(
      screen.getByText(
        'Claude Code closed before it reached Factwright’s tools. Factwright may need an update to work with Claude Code 2.1.300.',
      ),
    ).toBeTruthy();
    screen.getByRole('button', { name: 'Check again' }).click();
    expect(onCheckSetup).toHaveBeenCalledOnce();
    rerender(
      <ClaudeCard
        status={ready}
        onRecheck={vi.fn()}
        setup={failed}
        checkingSetup
        onCheckSetup={onCheckSetup}
      />,
    );
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // A check of an older version, or one still waiting on the user, says nothing.
    for (const setup of [
      { ...failed, version: '2.1.299' },
      { ...failed, result: 'untrusted' as const, problem: undefined },
    ]) {
      rerender(
        <ClaudeCard status={ready} onRecheck={vi.fn()} setup={setup} onCheckSetup={onCheckSetup} />,
      );
      expect(screen.getByText('Signed in · Max plan')).toBeTruthy();
    }
  });
  it('says what to do when the setup check stops on Claude Code’s first-run screens', async () => {
    const ready = { state: 'ready', version: '2.1.303', plan: 'pro' } as const;
    const firstRun = {
      version: '2.1.303',
      result: 'first-run',
      at: '2026-10-19T15:00:00.000Z',
    } as const;
    const onCheckSetup = vi.fn();
    const onOpenClaude = vi.fn();
    const { container, rerender } = render(
      <ClaudeCard
        status={ready}
        onRecheck={vi.fn()}
        setup={firstRun}
        onCheckSetup={onCheckSetup}
        onOpenClaude={onOpenClaude}
      />,
    );
    expect(screen.getByText('Claude Code’s first screens')).toBeTruthy();
    const help = screen.getByText(/Claude Code shows a few screens the first time it opens/);
    expect(help.textContent).toBe(
      'Claude Code shows a few screens the first time it opens. In Claude’s panel, press Enter through them, then check again. Open Claude’s panel',
    );
    // It isn't Factwright's to fix, so there's no word of an update.
    expect(screen.queryByText(/may need an update/)).toBeNull();
    screen.getByRole('button', { name: 'Open Claude’s panel' }).click();
    expect(onOpenClaude).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: 'Check again' }).click();
    expect(onCheckSetup).toHaveBeenCalledOnce();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    // With Claude's panel open already, it has nothing to open.
    rerender(
      <ClaudeCard
        status={ready}
        onRecheck={vi.fn()}
        setup={firstRun}
        onCheckSetup={onCheckSetup}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open Claude’s panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    // A check of the version before an update says nothing.
    rerender(
      <ClaudeCard
        status={ready}
        onRecheck={vi.fn()}
        setup={{ ...firstRun, version: '2.1.302' }}
        onCheckSetup={onCheckSetup}
      />,
    );
    expect(screen.getByText('Signed in · Pro plan')).toBeTruthy();
  });
});
