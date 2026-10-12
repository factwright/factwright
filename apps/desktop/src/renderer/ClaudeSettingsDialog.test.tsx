// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
import { ASK_FIRST, type ClaudePermissions } from '../shared/permissions.ts';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog.tsx';

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

/** The window's API for these settings, keeping what's chosen. */
function apiWith(
  start: { models?: ModelChoices; effort?: EffortChoices; permissions?: ClaudePermissions } = {},
) {
  let models = start.models ?? DEFAULT_MODELS;
  let effort = start.effort ?? DEFAULT_EFFORT;
  let permissions = start.permissions ?? ASK_FIRST;
  return {
    claudeModels: vi.fn(async () => models),
    setClaudeModels: vi.fn(async (chosen: ModelChoices) => {
      models = chosen;
      return chosen;
    }),
    claudeEffort: vi.fn(async () => effort),
    setClaudeEffort: vi.fn(async (chosen: EffortChoices) => {
      effort = chosen;
      return chosen;
    }),
    claudePermissions: vi.fn(async () => permissions),
    setClaudePermissions: vi.fn(async (chosen: ClaudePermissions) => {
      permissions = chosen;
      return chosen;
    }),
  };
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;

describe('ClaudeSettingsDialog', () => {
  it('runs on Opus and asks first, until the user chooses otherwise', async () => {
    const { container } = render(<ClaudeSettingsDialog api={apiWith()} onClose={vi.fn()} />);
    await waitFor(() => expect(select('Model for everything').value).toBe('opus'));
    expect(select('Effort for everything').value).toBe('');
    expect(box('Change any file in your job hunt').checked).toBe(false);
    expect(box('Read any website').checked).toBe(false);
    expect(screen.getByText(/reads postings on Greenhouse, Lever, Ashby and Gem/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('saves the model for everything', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Model for everything' }),
      'sonnet',
    );
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({ main: 'sonnet', tasks: {} });
  });

  it('gives a task its own model, and back to the one for everything', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    const resume = select('Model for Tailored resume');
    expect(resume.value).toBe('');
    expect(within(resume).getByRole('option', { name: 'Same as everything (Opus)' })).toBeTruthy();
    await userEvent.selectOptions(resume, 'haiku');
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({
      main: 'opus',
      tasks: { 'focused-resume': 'haiku' },
    });
    await userEvent.selectOptions(select('Model for Tailored resume'), '');
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({ main: 'opus', tasks: {} });
    expect(select('Model for Find jobs')).toBeTruthy();
  });

  it('shows each task’s recommended effort, mostly high, until the user chooses', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    const option = (label: string) =>
      within(select(`Effort for ${label}`)).getAllByRole('option')[0]?.textContent;
    expect(option('Tailored resume')).toBe('Recommended (High)');
    expect(option('Salary check')).toBe('Recommended (Medium)');
    expect(option('Find jobs')).toBe('Recommended (Medium)');
    await userEvent.selectOptions(select('Effort for Salary check'), 'xhigh');
    expect(api.setClaudeEffort).toHaveBeenLastCalledWith({
      main: null,
      tasks: { 'salary-check': 'xhigh' },
    });
    await userEvent.selectOptions(select('Effort for Salary check'), '');
    expect(api.setClaudeEffort).toHaveBeenLastCalledWith({ main: null, tasks: {} });
  });

  it('sets one effort for everything, which each task follows unless it has its own', async () => {
    const api = apiWith({ effort: { main: null, tasks: { 'fit-check': 'low' } } });
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Effort for everything' }),
      'max',
    );
    expect(api.setClaudeEffort).toHaveBeenLastCalledWith({
      main: 'max',
      tasks: { 'fit-check': 'low' },
    });
    expect(screen.getByText('Choose by task').closest('details')?.open).toBe(true);
    expect(within(select('Effort for Salary check')).getAllByRole('option')[0]?.textContent).toBe(
      'Same as everything (Max)',
    );
    expect(select('Effort for Fit check').value).toBe('low');
    await userEvent.selectOptions(select('Effort for everything'), '');
    expect(api.setClaudeEffort).toHaveBeenLastCalledWith({
      main: null,
      tasks: { 'fit-check': 'low' },
    });
  });

  it('opens the tasks when one already has its own model', async () => {
    render(
      <ClaudeSettingsDialog
        api={apiWith({ models: { main: 'opus', tasks: { 'job-search': 'sonnet' } } })}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(select('Model for Find jobs').value).toBe('sonnet'));
    expect(screen.getByText('Choose by task').closest('details')?.open).toBe(true);
  });

  it('saves each permission as it’s chosen, and explains it for screen readers too', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    const files = await screen.findByRole('checkbox', { name: 'Change any file in your job hunt' });
    expect(
      document.getElementById(files.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('facts, guide and base resumes');
    await userEvent.click(files);
    expect(api.setClaudePermissions).toHaveBeenLastCalledWith({ anyFile: true, anySite: false });
    await userEvent.click(box('Read any website'));
    expect(api.setClaudePermissions).toHaveBeenLastCalledWith({ anyFile: true, anySite: true });
  });

  it('says when a choice didn’t save, and shows what’s really saved', async () => {
    const api = apiWith();
    api.setClaudePermissions.mockRejectedValueOnce(new Error('disk full'));
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Read any website' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t save. Try again.');
    await waitFor(() => expect(box('Read any website').checked).toBe(false));
  });

  it('offers Sonnet for routine tasks on a Pro plan, and keeps Opus for the writing', async () => {
    const api = apiWith();
    const { container } = render(<ClaudeSettingsDialog api={api} plan="pro" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use Sonnet for those' }));
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({
      main: 'opus',
      tasks: {
        'fit-check': 'sonnet',
        'salary-check': 'sonnet',
        'job-search': 'sonnet',
        'who-to-message': 'sonnet',
      },
    });
    expect(select('Model for Tailored resume').value).toBe('');
    expect(select('Model for Getting started').value).toBe('');
    // Done, so it says no more.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Use Sonnet for those' })).toBeNull(),
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says nothing about plans on Max', async () => {
    render(<ClaudeSettingsDialog api={apiWith()} plan="max" onClose={vi.fn()} />);
    await waitFor(() => expect(select('Model for everything').value).toBe('opus'));
    expect(screen.queryByText(/On a Pro plan/)).toBeNull();
  });

  it('closes with Done', async () => {
    const onClose = vi.fn();
    render(<ClaudeSettingsDialog api={apiWith()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
