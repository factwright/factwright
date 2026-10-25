// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
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
function apiWith(start: { models?: ModelChoices; effort?: EffortChoices } = {}) {
  let models = start.models ?? DEFAULT_MODELS;
  let effort = start.effort ?? DEFAULT_EFFORT;
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
  };
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;

describe('ClaudeSettingsDialog', () => {
  it('runs at the recommended levels until the user chooses otherwise, and says what needs no OK', async () => {
    const { container } = render(<ClaudeSettingsDialog api={apiWith()} onClose={vi.fn()} />);
    // The file's first dialog takes longest to draw: nearly half a second, with every package's
    // tests at once.
    await screen.findByRole('combobox', { name: 'Model for everything' }, { timeout: 5000 });
    expect(select('Model for everything').value).toBe('');
    expect(select('Effort for everything').value).toBe('');
    // Nothing to choose about asking: Claude changes files and reads pages, and lists them after.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/changes your job hunt’s files without asking/)).toBeTruthy();
    expect(screen.getByText(/lists each file it changed, with Undo/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('saves the model for everything, and goes back to recommended', async () => {
    const api = apiWith();
    const onSaved = vi.fn();
    render(<ClaudeSettingsDialog api={api} onSaved={onSaved} onClose={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Model for everything' }),
      'sonnet',
    );
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({ main: 'sonnet', tasks: {} });
    // Passed on once saved, for the levels under Your Claude.
    await waitFor(() =>
      expect(onSaved).toHaveBeenLastCalledWith({ models: { main: 'sonnet', tasks: {} } }),
    );
    await userEvent.selectOptions(select('Effort for everything'), 'high');
    await waitFor(() =>
      expect(onSaved).toHaveBeenLastCalledWith({ effort: { main: 'high', tasks: {} } }),
    );
    await userEvent.selectOptions(select('Model for everything'), '');
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({ main: null, tasks: {} });
  });

  it('gives a task its own model, and back to the one for everything', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    const resume = select('Model for Tailored resume');
    expect(resume.value).toBe('');
    expect(within(resume).getByRole('option', { name: 'Recommended (Opus)' })).toBeTruthy();
    await userEvent.selectOptions(resume, 'haiku');
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({
      main: null,
      tasks: { 'focused-resume': 'haiku' },
    });
    await userEvent.selectOptions(select('Model for Tailored resume'), '');
    expect(api.setClaudeModels).toHaveBeenLastCalledWith({ main: null, tasks: {} });
    await userEvent.selectOptions(select('Model for everything'), 'sonnet');
    expect(
      within(select('Model for Find jobs')).getByRole('option', {
        name: 'Same as everything (Sonnet)',
      }),
    ).toBeTruthy();
  });

  it('shows each task’s recommended effort for the plan, until the user chooses', async () => {
    const api = apiWith();
    render(<ClaudeSettingsDialog api={api} plan="max" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    const option = (label: string) =>
      within(select(`Effort for ${label}`)).getAllByRole('option')[0]?.textContent;
    expect(option('Tailored resume')).toBe('Recommended (Extra high)');
    expect(option('Salary check')).toBe('Recommended (Extra high)');
    expect(option('Find jobs')).toBe('Recommended (High)');
    cleanup();
    render(<ClaudeSettingsDialog api={api} plan="pro" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    expect(option('Tailored resume')).toBe('Recommended (High)');
    expect(option('Salary check')).toBe('Recommended (Medium)');
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

  it('passes on what’s really saved when a choice didn’t save', async () => {
    const api = apiWith();
    api.setClaudeModels.mockRejectedValueOnce(new Error('disk full'));
    const onSaved = vi.fn();
    render(<ClaudeSettingsDialog api={api} onSaved={onSaved} onClose={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Model for everything' }),
      'haiku',
    );
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t save. Try again.');
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ models: DEFAULT_MODELS }));
    expect(onSaved).not.toHaveBeenCalledWith({ models: { main: 'haiku', tasks: {} } });
    expect(select('Model for everything').value).toBe('');
  });

  it('says when a choice didn’t save, and shows what’s really saved', async () => {
    const api = apiWith();
    api.setClaudeEffort.mockRejectedValueOnce(new Error('disk full'));
    render(<ClaudeSettingsDialog api={api} onClose={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Effort for everything' }),
      'high',
    );
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t save. Try again.');
    await waitFor(() => expect(select('Effort for everything').value).toBe(''));
  });

  it('recommends Sonnet for the checks and searches on a Pro plan, and Opus for the writing', async () => {
    const api = apiWith();
    const { container } = render(<ClaudeSettingsDialog api={api} plan="pro" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    const option = (label: string) =>
      within(select(`Model for ${label}`)).getAllByRole('option')[0]?.textContent;
    expect(option('Fit check')).toBe('Recommended (Sonnet)');
    expect(option('Find jobs')).toBe('Recommended (Sonnet)');
    expect(option('Tailored resume')).toBe('Recommended (Opus)');
    expect(option('Getting started')).toBe('Recommended (Opus)');
    expect(screen.getByText(/On a Pro plan, limits are the tightest/)).toBeTruthy();
    // Nothing to do: it starts that way.
    expect(screen.queryByRole('button', { name: /Sonnet/ })).toBeNull();
    expect(api.setClaudeModels).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('recommends the same with an API key, since every token is billed', async () => {
    render(<ClaudeSettingsDialog api={apiWith()} method="api_key" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Choose by task'));
    expect(within(select('Model for Salary check')).getAllByRole('option')[0]?.textContent).toBe(
      'Recommended (Sonnet)',
    );
    expect(within(select('Effort for Salary check')).getAllByRole('option')[0]?.textContent).toBe(
      'Recommended (Medium)',
    );
    expect(screen.getByText(/Every token is billed with an API key/)).toBeTruthy();
  });

  it('says nothing about plans on Max', async () => {
    render(<ClaudeSettingsDialog api={apiWith()} plan="max" onClose={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Model for everything' });
    expect(screen.queryByText(/On a Pro plan/)).toBeNull();
    expect(screen.queryByText(/Every token is billed/)).toBeNull();
  });

  it('closes with Done', async () => {
    const onClose = vi.fn();
    render(<ClaudeSettingsDialog api={apiWith()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
