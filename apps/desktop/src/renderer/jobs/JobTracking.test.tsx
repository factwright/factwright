// @vitest-environment jsdom
import { type Job, localDate } from '@factwright/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { JobPanel } from './JobPanel.tsx';
import { jobRows } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

const TODAY = localDate();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const byCompany = (company: string): Job => {
  const job = sampleJobs().find((each) => each.company === company);
  if (!job) throw new Error(`No sample job for ${company}`);
  return job;
};

function panel(job: Job, result: EditResult = { ok: true }) {
  const answer = vi.fn(async () => result);
  const api = {
    updateJob: answer,
    addCall: answer,
    updateCall: answer,
    deleteCall: answer,
    redateStatusChange: answer,
    undoStatusChange: answer,
    jobDocs: vi.fn(async () => null),
    openFile: answer,
  } as unknown as FactwrightApi;
  const row = jobRows([job], TODAY)[0] ?? null;
  const view = render(<JobPanel row={row} api={api} today={TODAY} onClose={() => {}} />);
  return { api, ...view };
}

describe('the next step', () => {
  it('saves the step when the box loses focus, and the date as soon as it’s picked', async () => {
    const { api } = panel(byCompany('Acme Robotics'));
    const step = screen.getByRole('textbox', { name: 'Next step' });
    await userEvent.type(step, 'Email the recruiter{Enter}');
    expect(api.updateJob).toHaveBeenCalledWith('acme-robotics--staff-engineer-developer-tools', {
      nextAction: 'Email the recruiter',
    });
    const date = screen.getByLabelText('Next step by');
    await userEvent.type(date, '2026-10-20');
    expect(api.updateJob).toHaveBeenLastCalledWith(
      'acme-robotics--staff-engineer-developer-tools',
      { nextOn: '2026-10-20' },
    );
  });

  it('doesn’t save when nothing changed', async () => {
    const { api } = panel(byCompany('Acme Robotics'));
    await userEvent.click(screen.getByRole('textbox', { name: 'Next step' }));
    await userEvent.tab();
    expect(api.updateJob).not.toHaveBeenCalled();
  });
});

describe('calls and interviews', () => {
  it('logs a call, saying where it moves the job', async () => {
    const { api } = panel(byCompany('Harbor & Pine'));
    await userEvent.click(screen.getByRole('button', { name: 'Log a call' }));
    const form = screen.getByRole('form', { name: 'Log a call' });
    expect(within(form).getByText('Logging it moves the job to Screen.')).toBeTruthy();
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Kind' }),
      'Final round',
    );
    expect(within(form).getByText('Logging it moves the job to Interview.')).toBeTruthy();
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Notes, if any' }),
      'With the CTO',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Log call' }));
    expect(api.addCall).toHaveBeenCalledWith('harbor-and-pine--senior-engineer-payments', {
      kind: 'final',
      onDate: TODAY,
      atTime: null,
      notes: 'With the CTO',
    });
    expect(screen.queryByRole('form', { name: 'Log a call' })).toBeNull();
  });

  it('says when a call won’t change the status', async () => {
    panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Log a call' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Kind' }),
      'Recruiter screen',
    );
    expect(screen.getByText('The job stays at Interview.')).toBeTruthy();
  });

  it('changes and deletes a logged call', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How the panel interview went' }),
      'Moved forward',
    );
    expect(api.updateCall).toHaveBeenCalledWith('northwind-panel', { outcome: 'advanced' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Where the panel interview stands' }),
      'Done',
    );
    expect(api.updateCall).toHaveBeenLastCalledWith('northwind-panel', { state: 'done' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete the panel interview' }));
    expect(api.deleteCall).toHaveBeenCalledWith('northwind-panel');
  });

  it('says why a call couldn’t be saved', async () => {
    panel(byCompany('Harbor & Pine'), { ok: false, message: 'That job isn’t here anymore.' });
    await userEvent.click(screen.getByRole('button', { name: 'Log a call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log call' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That job isn’t here anymore.');
    expect(screen.getByRole('form', { name: 'Log a call' })).toBeTruthy();
  });
});

describe('notes', () => {
  it('save a moment after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = panel(byCompany('Lumen Health'));
    const notes = screen.getByRole('textbox', { name: 'Your notes' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(notes, 'Kind managers');
    expect(api.updateJob).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(api.updateJob).toHaveBeenCalledWith('lumen-health--senior-full-stack-engineer', {
      notes: 'Kind managers',
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('save right away when the box loses focus', async () => {
    const { api } = panel(byCompany('Lumen Health'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Your notes' }), 'Ask about on-call');
    await userEvent.tab();
    expect(api.updateJob).toHaveBeenCalledWith('lumen-health--senior-full-stack-engineer', {
      notes: 'Ask about on-call',
    });
  });

  it('save what’s waiting when the panel closes', async () => {
    const { api, unmount } = panel(byCompany('Lumen Health'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Your notes' }), 'Half a thought');
    unmount();
    expect(api.updateJob).toHaveBeenCalledWith('lumen-health--senior-full-stack-engineer', {
      notes: 'Half a thought',
    });
  });
});

describe('history', () => {
  it('fixes a change’s date, and undoes the latest change', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    const undo = screen.getAllByRole('button', { name: /^Undo/ });
    expect(undo.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Undo “Marked Interview”',
    ]);
    await userEvent.click(undo[0] as HTMLElement);
    expect(api.undoStatusChange).toHaveBeenCalledWith('northwind-2');
    // A date picker sets a whole date at once.
    fireEvent.change(screen.getByLabelText('When it was marked applied'), {
      target: { value: '2026-09-01' },
    });
    expect(api.redateStatusChange).toHaveBeenLastCalledWith('northwind-0', '2026-09-01');
  });
});

describe('archiving', () => {
  it('archives and unarchives', async () => {
    const job = byCompany('Orchard Health');
    const { api } = panel(job);
    await userEvent.click(screen.getByRole('button', { name: 'Archive this job' }));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, { archived: true });
    cleanup();
    panel({ ...job, archived: true });
    expect(
      screen.getByText('Archived. It’s out of your lists until you unarchive it.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('finds no problems in the panel with every tracking part open', async () => {
    const { container } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Log a call' }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
