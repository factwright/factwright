// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
  it('shows nothing until an update has downloaded', () => {
    const { container, rerender } = render(
      <UpdateCard status={{ state: 'none' }} busy={false} onRestart={() => {}} />,
    );
    expect(container.textContent).toBe('');
    rerender(
      <UpdateCard
        status={{ state: 'downloading', version: '0.2.0', percent: 40 }}
        busy={false}
        onRestart={() => {}}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('offers to restart into a downloaded update', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    const { container } = render(<UpdateCard status={READY} busy={false} onRestart={onRestart} />);
    expect(screen.getByRole('heading', { name: 'Update ready' })).toBeTruthy();
    expect(container.textContent).toContain('Factwright 0.2.0');
    expect(container.textContent).toContain(
      'It installs when you restart, or the next time you quit.',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('shows what’s new', async () => {
    const user = userEvent.setup();
    render(<UpdateCard status={READY} busy={false} onRestart={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    const dialog = screen.getByRole('dialog', { name: 'What’s new in Factwright 0.2.0' });
    expect(dialog.textContent).toContain('Faster resumes.');
  });

  it('waits for quitting while Claude is working, which a restart would stop', () => {
    const { container } = render(<UpdateCard status={READY} busy onRestart={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(container.textContent).toContain('once your Claude is done');
  });

  it('leaves out what’s new when there are no notes', () => {
    render(<UpdateCard status={{ ...READY, notes: null }} busy={false} onRestart={() => {}} />);
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
  });
});
