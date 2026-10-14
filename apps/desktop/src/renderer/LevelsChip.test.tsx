// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT } from '../shared/effort.ts';
import { DEFAULT_MODELS } from '../shared/models.ts';
import { LevelsChip } from './LevelsChip.tsx';

afterEach(cleanup);

function renderChip(plan: string | undefined, method = plan ? 'subscription' : undefined) {
  const onOpen = vi.fn();
  const { container } = render(
    <LevelsChip
      plan={plan}
      method={method}
      models={DEFAULT_MODELS}
      effort={DEFAULT_EFFORT}
      onOpen={onOpen}
    />,
  );
  const chip = screen.getByRole('button', { name: /^Claude’s levels/ });
  const help = document.getElementById(chip.getAttribute('aria-describedby') ?? '')?.textContent;
  return { chip, help, onOpen, container };
}

describe('LevelsChip', () => {
  it('shows what most tasks run at on Max, and the one that differs', () => {
    const { chip, help } = renderChip('max');
    expect(chip.getAttribute('aria-label')).toBe(
      'Claude’s levels: Opus · Extra high. Job searches at High.',
    );
    expect(chip.textContent).toBe('Opus · Extra highJob searches at High');
    expect(help).toContain('Best overall: Opus at Extra high');
    expect(help).toContain('Best on your Max plan: the same.');
    expect(help).toContain('Results can vary with the level.');
  });

  it('shows Pro’s levels on a Pro plan, and says what’s best overall too', () => {
    const { chip, help } = renderChip('pro');
    expect(chip.textContent).toBe('Opus · HighLighter for 4 tasks');
    expect(help).toContain('Best overall: Opus at Extra high');
    expect(help).toContain(
      'Best on your Pro plan, whose limits are the tightest: Sonnet for fit checks, salary checks, job searches and who to message, and Opus at High for the writing.',
    );
    expect(help).toContain('Lower levels are quicker and use less');
  });

  it('suggests Pro’s levels with an API key, where every token is billed', () => {
    const { chip, help } = renderChip(undefined, 'api_key');
    expect(chip.textContent).toBe('Opus · HighLighter for 4 tasks');
    expect(help).toContain('Best when every token is billed, as with an API key');
  });

  it('says only what’s best overall when Claude Code doesn’t name the plan', () => {
    const { help } = renderChip(undefined, 'oauth_token');
    expect(help).toContain('Best overall');
    expect(help).not.toContain('your');
  });

  it('tells screen readers what its tooltip says, and opens Claude’s settings', async () => {
    const { chip, onOpen, container } = renderChip('pro');
    expect(screen.getByRole('button', { description: /^Best overall/ })).toBe(chip);
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
    await userEvent.click(chip);
    expect(onOpen).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('shows its tooltip on keyboard focus', async () => {
    renderChip('max');
    await userEvent.tab();
    expect(screen.getByRole('tooltip').textContent).toContain('Best overall');
  });
});
