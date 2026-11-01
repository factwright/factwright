// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JustUpdated } from './JustUpdated.tsx';

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

const NOTES = '- **Find jobs** reaches further.\n- Choose a theme.';

describe('JustUpdated', () => {
  it('says what’s new in the version, as a few plain lines', async () => {
    const { container } = render(<JustUpdated version="0.19.0" notes={NOTES} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'What’s new in 0.19.0' })).toBeTruthy();
    const lines = screen.getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual([
      'Find jobs reaches further.',
      'Choose a theme.',
    ]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('links to the full notes for that version, in the browser', () => {
    render(<JustUpdated version="0.19.0" notes={NOTES} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: 'Read the full notes' });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/factwright/factwright/releases/tag/v0.19.0',
    );
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('starts on Got it, which closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<JustUpdated version="0.19.0" notes={NOTES} onClose={onClose} />);
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    expect(document.activeElement).toBe(gotIt);
    await user.click(gotIt);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
