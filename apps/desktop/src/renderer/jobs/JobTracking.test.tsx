// @vitest-environment jsdom
import { type Job, localDate } from '@factwright/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { longDate } from './DateEdit.tsx';
import { JobPanel } from './JobPanel.tsx';
import { jobRows } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

const TODAY = localDate();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Which sections the user closed, kept for next time.
  localStorage.clear();
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
    addNote: answer,
    updateNote: answer,
    deleteNote: answer,
    jobDocs: vi.fn(async () => null),
    jobExtras: vi.fn(async () => ({ asked: {}, shots: [] })),
    openFile: answer,
  } as unknown as FactwrightApi;
  const shown = (each: Job) => (
    <JobPanel row={jobRows([each], TODAY)[0] ?? null} api={api} today={TODAY} onClose={() => {}} />
  );
  const view = render(shown(job));
  /** Shows the job again as it changed, such as after a sync. */
  const update = (next: Job) => view.rerender(shown(next));
  return { api, update, ...view };
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
  it('adds a note, dated today, with the button or ⌘ Enter', async () => {
    const { api } = panel(byCompany('Lumen Health'));
    const box = screen.getByRole('textbox', { name: 'New note' });
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
    await userEvent.type(box, 'Kind managers');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(api.addNote).toHaveBeenCalledWith('lumen-health--senior-full-stack-engineer', {
      text: 'Kind managers',
    });
    expect((box as HTMLTextAreaElement).value).toBe('');
    await userEvent.type(box, 'Ask about on-call{Meta>}{Enter}{/Meta}');
    expect(api.addNote).toHaveBeenLastCalledWith('lumen-health--senior-full-stack-engineer', {
      text: 'Ask about on-call',
    });
  });

  it('dates a note for an earlier day, such as yesterday’s call', async () => {
    const { api } = panel(byCompany('Lumen Health'));
    await userEvent.type(screen.getByRole('textbox', { name: 'New note' }), 'Call went well');
    await userEvent.click(screen.getByRole('button', { name: /^The day this note is about/ }));
    const date = screen.getByLabelText('The day this note is about');
    fireEvent.change(date, { target: { value: '2026-10-09' } });
    fireEvent.blur(date);
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(api.addNote).toHaveBeenCalledWith('lumen-health--senior-full-stack-engineer', {
      text: 'Call went well',
      on: '2026-10-09',
    });
  });

  it('lists notes newest first, with the notes from before dates at the end', () => {
    const job = byCompany('Northwind Labs');
    panel({ ...job, earlierNotes: 'From the old notes box' });
    const notes = within(screen.getByRole('list', { name: 'Your notes' })).getAllByRole('listitem');
    expect(notes.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'Panel set for Friday: the hiring manager, a staff engineer and a PM. Bring the cost-tooling numbers.',
      'Screen with Priya, the recruiter. Team of six, mostly Go. She liked the deploy pipeline story.',
      'From the old notes box',
    ]);
    expect(within(notes[2] as HTMLElement).getByText('Earlier notes')).toBeTruthy();
  });

  it('changes a note’s words or day, and deletes one after asking', async () => {
    const { api } = panel(byCompany('Tidewater Analytics'));
    const [note] = byCompany('Tidewater Analytics').notes;
    const title = `the note from ${longDate(note?.on ?? '')}`;
    await userEvent.click(screen.getByRole('button', { name: `Change ${title}` }));
    const box = screen.getByRole('textbox', { name: `Change ${title}` });
    await userEvent.clear(box);
    await userEvent.type(box, 'Recruiter asked for my notice period. Two weeks.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateNote).toHaveBeenCalledWith('tidewater-note', {
      text: 'Recruiter asked for my notice period. Two weeks.',
    });
    await userEvent.click(screen.getByRole('button', { name: `Delete ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.deleteNote).not.toHaveBeenCalledWith('tidewater-note');
    await userEvent.click(screen.getByRole('button', { name: `Delete ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteNote).toHaveBeenCalledWith('tidewater-note');
  });

  it('gives the keyboard’s focus back where it was after a change or a deletion', async () => {
    const job = byCompany('Tidewater Analytics');
    const title = `the note from ${longDate(job.notes[0]?.on ?? '')}`;
    panel(job);
    await userEvent.click(screen.getByRole('button', { name: `Change ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Change ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: `Delete ${title}` }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Delete ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: `Delete ${title}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'New note' }));
  });

  it('changes or clears the notes from before dates', async () => {
    const job = byCompany('Harbor & Pine');
    const { api } = panel(job);
    await userEvent.click(screen.getByRole('button', { name: 'Change your earlier notes' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Change your earlier notes' }), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, {
      earlierNotes: 'Referred by a former teammate. Ask about the new payments team.!',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete your earlier notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.updateJob).toHaveBeenLastCalledWith(job.id, { earlierNotes: null });
  });

  it('keeps a note not added yet when the panel moves to another job and back', async () => {
    const lumen = byCompany('Lumen Health');
    const { update } = panel(lumen);
    await userEvent.type(screen.getByRole('textbox', { name: 'New note' }), 'Half a thought');
    update(byCompany('Tidewater Analytics'));
    expect((screen.getByRole('textbox', { name: 'New note' }) as HTMLTextAreaElement).value).toBe(
      '',
    );
    update(lumen);
    expect((screen.getByRole('textbox', { name: 'New note' }) as HTMLTextAreaElement).value).toBe(
      'Half a thought',
    );
  });
});

describe('progress', () => {
  const steps = () =>
    within(screen.getByRole('list', { name: 'Where it’s been' }))
      .getAllByRole('listitem')
      .map((step) => step.querySelector('[class*="label"]')?.firstChild?.textContent);

  it('shows each step the job took, where it is now, and the step ahead', () => {
    panel(byCompany('Northwind Labs'));
    expect(steps()).toEqual([
      'Found',
      'Fit check',
      'Resume built',
      'Applied',
      'Screen',
      'Interview',
      'Offer',
    ]);
    expect(screen.getAllByRole('img', { name: 'Where it is now' })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Not yet' })).toBeTruthy();
  });

  it('ends a closed job with how it ended', () => {
    panel(byCompany('Meridian Freight'));
    expect(steps()).toEqual(['Found', 'Fit check', 'Applied', 'Rejected']);
    cleanup();
    panel(byCompany('Kestrel Robotics'));
    expect(steps()).toEqual(['Found', 'Fit check', 'Applied', 'Role closed']);
  });

  it('shows what the user decided before applying, dated, to fix or undo', async () => {
    const { api } = panel(byCompany('Quarry Labs'));
    expect(steps()).toEqual(['Found', 'Fit check', 'To apply', 'Applied']);
    expect(screen.getByRole('button', { name: /^When it moved to To apply/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Undo “Marked To apply”' }));
    expect(api.undoStatusChange).toHaveBeenCalledWith('quarry-0');
    cleanup();
    // A job set aside says when it comes back.
    panel(byCompany('Ridgeline Analytics'));
    expect(steps()).toEqual(['Found', 'Later', 'Applied']);
    const track = screen.getByRole('list', { name: 'Where it’s been' });
    expect(within(track).getByText(/^Back \w{3} \d+$/)).toBeTruthy();
    cleanup();
    // Claude's work alone puts a job in To review, which isn't a step the user took.
    panel(byCompany('Acme Robotics'));
    expect(steps()).toEqual(['Found', 'Fit check', 'Applied']);
    cleanup();
    // Taken on by the user with no work of Claude's, it wasn't checked first.
    panel(byCompany('Wavelength Audio'));
    expect(steps()).toEqual(['Found', 'To review', 'Applied']);
  });

  it('fixes a step’s date once the whole date is in, and undoes the latest change', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: /^When it moved to Screen/ }));
    const date = screen.getByLabelText('When it moved to Screen');
    // Typing the year digit by digit passes through dates nobody means, like 0002.
    fireEvent.change(date, { target: { value: '0002-10-01' } });
    fireEvent.change(date, { target: { value: '2026-10-01' } });
    fireEvent.blur(date);
    expect(api.redateStatusChange).toHaveBeenCalledTimes(1);
    expect(api.redateStatusChange).toHaveBeenCalledWith('northwind-1', '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Undo “Marked Interview”' }));
    expect(api.undoStatusChange).toHaveBeenCalledWith('northwind-2');
  });

  it('adds an applied date that was never kept', async () => {
    const job = byCompany('Meridian Freight');
    const { api } = panel({ ...job, appliedOn: null, statusLog: job.statusLog.slice(1) });
    await userEvent.click(
      screen.getByRole('button', { name: 'When you applied: Add the date. Change it' }),
    );
    const date = screen.getByLabelText('When you applied');
    fireEvent.change(date, { target: { value: '2026-09-01' } });
    fireEvent.keyDown(date, { key: 'Enter' });
    expect(api.updateJob).toHaveBeenCalledWith(job.id, { appliedOn: '2026-09-01' });
    // Enter closed the box, so the keyboard's focus is back on the date.
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^When you applied/);
  });

  it('keeps a date that can’t be, such as one to come, open to fix', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: /^When it moved to Screen/ }));
    const date = screen.getByLabelText('When it moved to Screen');
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    fireEvent.keyDown(date, { key: 'Enter' });
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('When it moved to Screen')).toBe(date);
    fireEvent.keyDown(date, { key: 'Escape' });
    expect(api.redateStatusChange).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(
      /^When it moved to Screen: \w{3} \d+\. Change it$/,
    );
  });

  it('shows and fixes the date of the change that marked a step, not an earlier call’s', () => {
    const job = byCompany('Northwind Labs');
    const screenChange = job.statusLog.find((change) => change.status === 'screen');
    panel({
      ...job,
      calls: [
        ...job.calls,
        {
          id: 'early-screen',
          kind: 'screen',
          onDate: '2020-01-02',
          atTime: null,
          state: 'done',
          outcome: null,
          notes: null,
        },
      ],
    });
    const button = screen.getByRole('button', { name: /^When it moved to Screen/ });
    expect(button.getAttribute('title')).toBe(longDate(screenChange?.at ?? ''));
  });

  it('fixes an offer’s date only by the change that marked it', () => {
    const job = byCompany('Fernway');
    panel({
      ...job,
      status: 'accepted',
      statusOn: job.statusOn,
      statusLog: [
        ...job.statusLog.filter((change) => change.status !== 'offer'),
        { id: 'fernway-accepted', status: 'accepted', at: job.statusOn ?? '' },
      ],
    });
    expect(screen.queryByRole('button', { name: /^When it moved to Offer/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^When it moved to Accepted/ })).toBeTruthy();
  });
});

describe('activity', () => {
  it('lists what happened, newest first, once opened', async () => {
    panel(byCompany('Northwind Labs'));
    const toggle = screen.getByRole('button', { name: /^Activity/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(within(activity).getByText('Marked Interview')).toBeTruthy();
    expect(within(activity).getByText('Fit check: Strong 86')).toBeTruthy();
    // A call still to come isn't history yet.
    expect(within(activity).queryByText('Panel interview: scheduled')).toBeNull();
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
