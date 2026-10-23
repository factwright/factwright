// @vitest-environment jsdom
import { addDays, type Job, localDate } from '@factwright/core';
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
    jobExtras: vi.fn(async () => ({
      asked: {},
      shots: [],
      posting: null,
      calls: {},
      outreach: [],
    })),
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

describe('the reminder', () => {
  const ACME = 'acme-robotics--staff-engineer-developer-tools';

  it('adds a reminder for tomorrow, or the day picked, and shows it ahead in Progress', async () => {
    const job = byCompany('Acme Robotics');
    const { api, update } = panel(job);
    await userEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
    const form = screen.getByRole('form', { name: 'Add a reminder' });
    const what = within(form).getByRole('textbox', { name: 'What to do' });
    expect(document.activeElement).toBe(what);
    expect((within(form).getByLabelText('When') as HTMLInputElement).value).toBe(addDays(TODAY, 1));
    const save = within(form).getByRole('button', { name: 'Save reminder' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(what, 'Email the recruiter');
    await userEvent.click(save);
    expect(api.updateJob).toHaveBeenCalledWith(ACME, {
      nextAction: 'Email the recruiter',
      nextOn: addDays(TODAY, 1),
    });
    expect(screen.queryByRole('form', { name: 'Add a reminder' })).toBeNull();
    update({ ...job, nextAction: 'Email the recruiter', nextOn: addDays(TODAY, 1) });
    const track = screen.getByRole('list', { name: 'Where it’s been, and what’s ahead' });
    expect(within(track).getByText('Email the recruiter')).toBeTruthy();
    expect(within(track).getByRole('img', { name: 'Coming up' })).toBeTruthy();
    // One at a time: it's changed from here now.
    expect(screen.queryByRole('button', { name: 'Add a reminder' })).toBeNull();
  });

  it('changes the reminder, or clears it once it’s done', async () => {
    const job = { ...byCompany('Acme Robotics'), nextAction: 'Email Sam', nextOn: '2026-12-01' };
    const { api } = panel(job);
    await userEvent.click(screen.getByRole('button', { name: 'Change the reminder' }));
    const form = screen.getByRole('form', { name: 'Change the reminder' });
    const what = within(form).getByRole('textbox', { name: 'What to do' });
    expect((what as HTMLInputElement).value).toBe('Email Sam');
    await userEvent.type(what, ' again');
    fireEvent.change(within(form).getByLabelText('When'), { target: { value: '2026-12-03' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Save reminder' }));
    expect(api.updateJob).toHaveBeenCalledWith(ACME, {
      nextAction: 'Email Sam again',
      nextOn: '2026-12-03',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done: clear the reminder' }));
    expect(api.updateJob).toHaveBeenLastCalledWith(ACME, { nextAction: null, nextOn: null });
  });

  it('keeps the form open and says why when it can’t save', async () => {
    panel(byCompany('Acme Robotics'), { ok: false, message: 'That job isn’t in your tracker.' });
    await userEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'What to do' }), 'Email Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(screen.getByRole('form', { name: 'Add a reminder' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('That job isn’t in your tracker.');
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
    within(screen.getByRole('list', { name: 'Where it’s been, and what’s ahead' }))
      .getAllByRole('listitem')
      .map((step) => step.querySelector('[class*="label"]')?.firstChild?.textContent);

  it('shows each step the job took, where it is now, and the step ahead', () => {
    const northwind = byCompany('Northwind Labs');
    // With no call booked, the step after.
    panel({ ...northwind, calls: northwind.calls.filter((call) => call.onDate <= TODAY) });
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

  it('shows the calls booked and the reminder ahead, by their days, in place of the step after', () => {
    const northwind = byCompany('Northwind Labs');
    panel({ ...northwind, nextAction: 'Send the cost numbers', nextOn: addDays(TODAY, 1) });
    expect(steps()).toEqual([
      'Found',
      'Fit check',
      'Resume built',
      'Applied',
      'Screen',
      'Interview',
      'Send the cost numbers',
      'Panel interview',
    ]);
    expect(screen.getAllByRole('img', { name: 'Coming up' })).toHaveLength(2);
    expect(screen.queryByRole('img', { name: 'Not yet' })).toBeNull();
    expect(screen.getByText(/^\w+ at 2:00 PM with Dana Lee \(Hiring manager\)/)).toBeTruthy();
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
    const track = screen.getByRole('list', { name: 'Where it’s been, and what’s ahead' });
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
          minutes: null,
          mode: null,
          place: null,
          people: [],
          state: 'done',
          outcome: null,
          notes: null,
          debrief: null,
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

describe('history', () => {
  it('lists what happened with the company, newest first, and who the user met, once opened', async () => {
    panel(byCompany('Northwind Labs'));
    const toggle = screen.getByRole('button', { name: /^History/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('1 person met');
    await userEvent.click(toggle);
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByText('Marked Interview')).toBeTruthy();
    expect(within(history).getByText('Fit check: Strong 86')).toBeTruthy();
    expect(
      within(history).getByText('Recruiter screen with Priya Shah (Recruiter): moved forward'),
    ).toBeTruthy();
    // The user's notes are part of it, by their first line.
    expect(
      within(history).getByText(
        'Screen with Priya, the recruiter. Team of six, mostly Go. She liked the deploy pipeline story.',
      ),
    ).toBeTruthy();
    // A call still to come isn't history yet, and nor is anyone met only on it.
    expect(within(history).queryByText(/^Panel interview/)).toBeNull();
    const people = within(history)
      .getAllByRole('listitem')
      .filter((item) => item.closest('ul'));
    expect(people.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Priya ShahRecruiterRecruiter screen, /),
    ]);
  });

  it('adds the user’s other jobs at the company, each line with its role', async () => {
    const job = byCompany('Northwind Labs');
    const other: Job = {
      ...byCompany('Tidewater Analytics'),
      id: 'northwind-labs--staff-engineer',
      company: 'Northwind Labs',
      companyKey: job.companyKey,
      role: 'Staff Engineer',
      calls: [],
      notes: [],
      statusLog: [{ id: 'other-applied', status: 'applied', at: '2025-03-02' }],
      events: [],
    };
    render(
      <JobPanel
        row={jobRows([job], TODAY)[0] ?? null}
        api={{ jobDocs: vi.fn(async () => null), jobExtras: vi.fn(async () => null) } as never}
        today={TODAY}
        onClose={() => {}}
        related={[other]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^History/ }));
    const history = screen.getByRole('region', { name: 'History' });
    const last = within(history).getAllByRole('listitem').at(-1);
    expect(last?.textContent).toMatch(/Staff Engineer: Marked Applied$/);
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
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change the panel interview' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete the recruiter screen' }));
    await userEvent.click(screen.getByRole('button', { name: /^History/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
