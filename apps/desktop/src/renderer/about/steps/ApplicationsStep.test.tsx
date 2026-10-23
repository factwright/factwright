// @vitest-environment jsdom
import { type KeptPrivate, NO_APPLICATIONS, NO_PRIVATE } from '@factwright/core';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerChanges } from '../../../shared/about.ts';
import { ApplicationsStep } from './ApplicationsStep.tsx';

afterEach(cleanup);

/** The window's API for what's kept on this computer alone, which keeps what it's given. */
function keptApi(start: KeptPrivate = NO_PRIVATE) {
  let kept = start;
  return {
    privateAnswers: vi.fn(async () => kept),
    savePrivateAnswers: vi.fn(async (changes: Partial<KeptPrivate>) => {
      kept = { ...kept, ...changes };
      return kept;
    }),
    kept: () => kept,
  };
}

describe('For applications, in Profile', () => {
  it('changes what forms ask that a resume doesn’t say, with Profile’s other answers', async () => {
    const update = vi.fn((_: AnswerChanges) => {});
    const api = keptApi();
    render(<ApplicationsStep applications={NO_APPLICATIONS} update={update} api={api} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Pronouns' }), 's');
    expect(update).toHaveBeenLastCalledWith({ applications: { ...NO_APPLICATIONS, pronouns: 's' } });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Will you need a visa sponsored?' }),
      'Not now, but later',
    );
    expect(update).toHaveBeenLastCalledWith({
      applications: { ...NO_APPLICATIONS, sponsorship: 'later' },
    });
  });

  it('keeps the street and equal-opportunity answers apart, each left for you until you choose', async () => {
    const update = vi.fn();
    const api = keptApi();
    render(<ApplicationsStep applications={NO_APPLICATIONS} update={update} api={api} />);
    const gender = await screen.findByRole('combobox', { name: 'Gender' });
    expect(gender).toHaveProperty('value', '');
    expect((gender as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Leave it for me');
    await userEvent.selectOptions(gender, 'Woman');
    await userEvent.type(screen.getByRole('textbox', { name: 'Street address' }), '1420 Larimer St');
    // Saved a moment after the last change, never with Profile's other answers.
    await waitFor(() => expect(api.kept().street).toBe('1420 Larimer St'), { timeout: 2000 });
    expect(api.kept().equalOpportunity.gender).toBe('woman');
    expect(update).not.toHaveBeenCalled();
    expect(
      screen.getByText(/These never sync, and Claude never sees them/),
    ).toBeTruthy();
  });

  it('saves what’s waiting as the dialog closes', async () => {
    const api = keptApi();
    const view = render(
      <ApplicationsStep applications={NO_APPLICATIONS} update={vi.fn()} api={api} />,
    );
    await userEvent.type(await screen.findByRole('textbox', { name: 'Postal code' }), '80202');
    act(() => view.unmount());
    expect(api.savePrivateAnswers).toHaveBeenLastCalledWith({ postalCode: '80202' });
  });

  it('has no accessibility problems', async () => {
    const { container } = render(
      <ApplicationsStep applications={NO_APPLICATIONS} update={vi.fn()} api={keptApi()} />,
    );
    await screen.findByRole('combobox', { name: 'Gender' });
    const { violations } = await axe.run(container);
    expect(violations).toEqual([]);
  });
});
