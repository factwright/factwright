// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../shared/updates.ts';
import { UpdateCard } from './UpdateCard.tsx';

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

const READY: UpdateStatus = {
  state: 'ready',
  version: '0.2.0',
  notes: '- **Fact bank:** search reads tags.\n- Faster resumes.',
};

describe('UpdateCard', () => {
  it('shows nothing while there’s no update', () => {
    const { container } = render(
      <UpdateCard
        inBanner={false}
        status={{ state: 'none' }}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('says how far an update’s download has got, with nothing to do yet', async () => {
    const { container, rerender } = render(
      <UpdateCard
        inBanner={false}
        status={{ state: 'downloading', version: '0.2.0', percent: 40 }}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Downloading an update' })).toBeTruthy();
    expect(container.textContent).toContain('Factwright 0.2.0 · 40%');
    expect(screen.queryByRole('button')).toBeNull();
    // Screen readers don't read out each percent.
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
    // The Mac checks it once it's all there.
    rerender(
      <UpdateCard
        inBanner={false}
        status={{ state: 'downloading', version: '0.2.0', percent: 100 }}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(container.textContent).toContain('Factwright 0.2.0 · almost ready');
  });

  it('stays out of the way while the strip across the window shows the update', () => {
    const { container } = render(
      <UpdateCard
        inBanner
        status={READY}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('offers to restart into a downloaded update', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn(async () => true);
    const { container } = render(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy={false}
        unsaved={() => false}
        onRestart={onRestart}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Update ready' })).toBeTruthy();
    expect(container.textContent).toContain('Factwright 0.2.0');
    expect(container.textContent).toContain(
      'It installs when you restart, or the next time you quit.',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('says it’s restarting while Claude Code that’s done closes, and when it didn’t restart', async () => {
    const user = userEvent.setup();
    let answer: (restarted: boolean) => void = () => {};
    const onRestart = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { container } = render(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy={false}
        unsaved={() => false}
        onRestart={onRestart}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    const restarting = screen.getByRole('button', { name: 'Restarting…' }) as HTMLButtonElement;
    expect(restarting.disabled).toBe(true);
    // Claude started working meanwhile, so the app didn't restart.
    await act(async () => answer(false));
    expect(container.textContent).toContain(
      'Factwright didn’t restart. Try again once Claude is done.',
    );
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalledTimes(2);
  });

  it('shows what’s new', async () => {
    const user = userEvent.setup();
    render(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    const dialog = screen.getByRole('dialog', { name: 'What’s new in Factwright 0.2.0' });
    expect(dialog.textContent).toContain('Faster resumes.');
  });

  it('offers Restart now only once Claude is done, as a restart would stop its work', () => {
    const { container, rerender } = render(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(container.textContent).toContain(
      'You can restart into it once Claude is done, or it installs the next time you quit.',
    );
    rerender(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });

  it('leaves out what’s new when there are no notes', () => {
    render(
      <UpdateCard
        inBanner={false}
        status={{ ...READY, notes: null }}
        busy={false}
        unsaved={() => false}
        onRestart={async () => true}
      />,
    );
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
  });

  it('asks before restarting over something the user is writing', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn(async () => true);
    const { container } = render(
      <UpdateCard
        inBanner={false}
        status={READY}
        busy={false}
        unsaved={() => true}
        onRestart={onRestart}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Something you’re writing isn’t saved');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    await user.click(screen.getByRole('button', { name: 'Restart anyway' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
