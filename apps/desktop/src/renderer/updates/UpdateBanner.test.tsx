// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../shared/updates.ts';
import { UpdateBanner } from './UpdateBanner.tsx';

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

/** The strip as given, quiet otherwise. */
function renderBanner({
  status = READY,
  busy = false,
  unsaved = () => false,
  onRestart = vi.fn(async () => true),
  onPutOff = vi.fn(),
}: {
  status?: UpdateStatus;
  busy?: boolean;
  unsaved?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onPutOff?: () => void;
} = {}) {
  const props = { status, busy, unsaved, onRestart, onPutOff };
  const view = render(<UpdateBanner {...props} />);
  return {
    ...view,
    rerender: (changed: Partial<typeof props>) =>
      view.rerender(<UpdateBanner {...props} {...changed} />),
  };
}

describe('UpdateBanner', () => {
  it('shows nothing until an update has downloaded', () => {
    const { container, rerender } = renderBanner({ status: { state: 'none' } });
    expect(container.textContent).toBe('');
    rerender({ status: { state: 'downloading', version: '0.2.0', percent: 40 } });
    expect(container.textContent).toBe('');
  });

  it('asks the user to update, and restarts into the update', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn(async () => true);
    const { container } = renderBanner({ onRestart });
    const banner = screen.getByRole('region', { name: 'Update' });
    expect(banner.textContent).toContain('Please update Factwright.');
    expect(banner.textContent).toContain(
      'Version 0.2.0 is ready to install, and your job hunt stays as it is.',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('puts itself off until tomorrow', async () => {
    const user = userEvent.setup();
    const onPutOff = vi.fn();
    renderBanner({ onPutOff });
    await user.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
    expect(onPutOff).toHaveBeenCalledTimes(1);
  });

  it('says it’s restarting while Claude Code that’s done closes, and when it didn’t restart', async () => {
    const user = userEvent.setup();
    let answer: (restarted: boolean) => void = () => {};
    const onRestart = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { container } = renderBanner({ onRestart });
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

  it('shows what’s new, and leaves it out when there are no notes', async () => {
    const user = userEvent.setup();
    const { rerender } = renderBanner();
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    const dialog = screen.getByRole('dialog', { name: 'What’s new in Factwright 0.2.0' });
    expect(dialog.textContent).toContain('Faster resumes.');
    rerender({ status: { ...READY, notes: null } });
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
  });

  it('offers Restart now only once Claude is done, as a restart would stop its work', () => {
    const { container, rerender } = renderBanner({ busy: true });
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(container.textContent).toContain(
      'Version 0.2.0 is ready. You can restart into it once Claude is done, or it installs the next time you quit.',
    );
    // It can still be put off meanwhile.
    expect(screen.getByRole('button', { name: 'Remind me tomorrow' })).toBeTruthy();
    rerender({ busy: false });
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });

  it('asks before restarting over something the user is writing', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn(async () => true);
    const { container } = renderBanner({ unsaved: () => true, onRestart });
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Something you’re writing isn’t saved.');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    await user.click(screen.getByRole('button', { name: 'Restart anyway' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
