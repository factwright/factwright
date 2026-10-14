import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeTooltip, Tooltip } from './Tooltip.tsx';

const TEXT = 'Opus at Extra high is the best overall.';

function renderTooltip() {
  const onClick = vi.fn();
  render(
    <main>
      <Tooltip content={TEXT}>
        {(trigger) => (
          <button type="button" onClick={onClick} {...trigger}>
            Opus · Extra high
          </button>
        )}
      </Tooltip>
      <button type="button">Elsewhere</button>
    </main>,
  );
  const user = userEvent.setup({ delay: null });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return {
    user,
    wait,
    onClick,
    trigger: screen.getByRole('button', { name: 'Opus · Extra high' }),
  };
}

const shown = () => screen.queryByRole('tooltip');

beforeEach(() => {
  // Only the tooltip's own waits, so React and Testing Library keep their real timing.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows once the pointer rests on its trigger, and hides once it leaves', async () => {
    const { user, wait, trigger } = renderTooltip();
    await user.hover(trigger);
    expect(shown()).toBeNull();
    await wait(400);
    expect(shown()?.textContent).toBe(TEXT);
    await user.unhover(trigger);
    expect(shown()).not.toBeNull();
    await wait(200);
    expect(shown()).toBeNull();
  });

  it('doesn’t show for a pointer that only passes over', async () => {
    const { user, wait, trigger } = renderTooltip();
    await user.hover(trigger);
    await wait(150);
    await user.unhover(trigger);
    await wait(1000);
    expect(shown()).toBeNull();
  });

  it('stays while the pointer moves onto it, and hides once it leaves that too', async () => {
    const { user, wait, trigger } = renderTooltip();
    await user.hover(trigger);
    await wait(400);
    const tooltip = screen.getByRole('tooltip');
    await user.unhover(trigger);
    await wait(100);
    await user.hover(tooltip);
    await wait(1000);
    expect(shown()).not.toBeNull();
    await user.unhover(tooltip);
    await wait(200);
    expect(shown()).toBeNull();
  });

  it('shows on keyboard focus, and Escape hides it without doing anything else', async () => {
    const { user, trigger } = renderTooltip();
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    expect(shown()?.textContent).toBe(TEXT);
    const elsewhere = vi.fn();
    document.addEventListener('keydown', elsewhere);
    await user.keyboard('{Escape}');
    expect(shown()).toBeNull();
    expect(elsewhere).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    // Once focus leaves and comes back, it shows again.
    await user.tab();
    expect(shown()).toBeNull();
    await user.tab({ shift: true });
    expect(shown()).not.toBeNull();
    document.removeEventListener('keydown', elsewhere);
  });

  it('hides with Escape while the pointer rests on it, until the pointer comes back', async () => {
    const { user, wait, trigger } = renderTooltip();
    // Escape pressed where focus is still does what it's for there, such as in a terminal.
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    const elsewhere = vi.fn();
    document.addEventListener('keydown', elsewhere);
    await user.hover(trigger);
    await wait(400);
    await user.keyboard('{Escape}');
    expect(shown()).toBeNull();
    expect(elsewhere).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', elsewhere);
    await wait(1000);
    expect(shown()).toBeNull();
    await user.unhover(trigger);
    await wait(200);
    await user.hover(trigger);
    await wait(400);
    expect(shown()).not.toBeNull();
  });

  it('makes way for a click, which does what the trigger is for', async () => {
    const { user, wait, trigger, onClick } = renderTooltip();
    await user.hover(trigger);
    await wait(400);
    await user.click(trigger);
    expect(onClick).toHaveBeenCalledOnce();
    expect(shown()).toBeNull();
  });

  it('describes its trigger to screen readers, even while it’s hidden', async () => {
    renderTooltip();
    expect(
      screen.getByRole('button', { name: 'Opus · Extra high', description: TEXT }),
    ).toBeTruthy();
  });

  it('has no accessibility problems while it shows', async () => {
    vi.useRealTimers();
    const { user } = renderTooltip();
    await user.tab();
    expect(shown()).not.toBeNull();
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('placeTooltip', () => {
  const view = { width: 1000, height: 700 };
  const tip = { width: 280, height: 120 };

  it('opens on the side asked for, centered on the trigger', () => {
    const trigger = { top: 300, left: 400, width: 200, height: 40 };
    expect(placeTooltip(trigger, tip, view, 'top')).toEqual({ top: 172, left: 360 });
    expect(placeTooltip(trigger, tip, view, 'bottom')).toEqual({ top: 348, left: 360 });
    expect(placeTooltip(trigger, tip, view, 'right')).toEqual({ top: 260, left: 608 });
    expect(placeTooltip(trigger, tip, view, 'left')).toEqual({ top: 260, left: 112 });
  });

  it('opens on the opposite side when the one asked for has no room', () => {
    const nearTop = { top: 20, left: 400, width: 200, height: 40 };
    expect(placeTooltip(nearTop, tip, view, 'top')).toEqual({ top: 68, left: 360 });
    const nearRight = { top: 300, left: 800, width: 180, height: 40 };
    expect(placeTooltip(nearRight, tip, view, 'right').left).toBe(512);
  });

  it('sits farther from its trigger when asked', () => {
    const trigger = { top: 300, left: 400, width: 200, height: 40 };
    expect(placeTooltip(trigger, tip, view, 'right', 21).left).toBe(621);
  });

  it('stays inside the window, along the side it opens on', () => {
    // A sidebar's last card, at the bottom left: beside it on the right, moved up to fit.
    const card = { top: 640, left: 12, width: 192, height: 50 };
    expect(placeTooltip(card, tip, view, 'right')).toEqual({ top: 572, left: 212 });
    const corner = { top: 300, left: 0, width: 40, height: 40 };
    expect(placeTooltip(corner, tip, view, 'top').left).toBe(8);
  });
});
