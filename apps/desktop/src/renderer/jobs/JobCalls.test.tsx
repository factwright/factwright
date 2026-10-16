// @vitest-environment jsdom
import { type Call, type Job, localDate, shortDate } from '@factwright/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { thanksNotes } from './JobCalls.tsx';
import { JobPanel } from './JobPanel.tsx';
import type { RunControls } from './RunActions.tsx';
import { jobRows } from './rows.ts';
import { sampleCallDocs, sampleJobs } from './sample-jobs.ts';

const TODAY = localDate();

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

const NORTHWIND = 'northwind-labs--senior-software-engineer-platform';

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

function panel(
  job: Job,
  { result = { ok: true }, run = controls() } = {} as {
    result?: EditResult;
    run?: RunControls;
  },
) {
  const answer = vi.fn(async () => result);
  const api = {
    updateJob: answer,
    addCall: answer,
    updateCall: answer,
    deleteCall: answer,
    addNote: answer,
    updateNote: answer,
    deleteNote: answer,
    redateStatusChange: answer,
    undoStatusChange: answer,
    jobDocs: vi.fn(async () => null),
    jobExtras: vi.fn(async () => ({
      asked: {},
      shots: [],
      posting: null,
      calls: sampleCallDocs(job),
    })),
    copyText: vi.fn(async () => ({ ok: true })),
    openFile: answer,
  } as unknown as FactwrightApi;
  const view = render(
    <JobPanel
      row={jobRows([job], TODAY)[0] ?? null}
      api={api}
      today={TODAY}
      onClose={() => {}}
      run={run}
    />,
  );
  return { api, run, ...view };
}

const callCard = (name: string) =>
  screen
    .getAllByRole('listitem')
    .find((item) => item.querySelector('span')?.textContent?.startsWith(name)) as HTMLElement;

describe('calls and interviews', () => {
  it('lists a job’s calls in the order they happen, each with who, how long, how and where', () => {
    panel(byCompany('Northwind Labs'));
    const list = screen.getByRole('list', { name: 'Calls and interviews with Northwind Labs' });
    const calls = within(list).getAllByRole('listitem');
    expect(calls.map((call) => call.querySelector('span')?.textContent)).toEqual([
      'Recruiter screen',
      'Panel interviewNext',
    ]);
    const next = calls[1] as HTMLElement;
    expect(within(next).getByText(/^Tuesday|^\w+day at 2:00 PM · 1 hour · Video$/)).toBeTruthy();
    expect(
      within(next).getByText(
        'With Dana Lee (Hiring manager), Sam Ortiz (Staff engineer) and Ana Ruiz (Product manager)',
      ),
    ).toBeTruthy();
    expect(
      within(next).getByText('System design and team fit. Bring the cost-tooling numbers.'),
    ).toBeTruthy();
    const join = within(next).getByRole('link', { name: /^Join at meet\.example\.com/ });
    expect(join.getAttribute('href')).toBe('https://meet.example.com/northwind-panel');
    expect(screen.getByRole('button', { name: /^Calls and interviews/ }).textContent).toContain(
      'Panel interview',
    );
    expect(screen.getByRole('button', { name: /^Calls and interviews/ }).textContent).toContain(
      'prep ready',
    );
  });

  it('shows a place that isn’t an https link as plain text, never as a link', () => {
    const job = byCompany('Northwind Labs');
    const calls = job.calls.map((call) =>
      call.id === 'northwind-panel' ? { ...call, place: 'javascript:alert(1)' } : call,
    );
    panel({ ...job, calls });
    const next = callCard('Panel interview');
    expect(within(next).queryByRole('link')).toBeNull();
    expect(within(next).getByText('javascript:alert(1)')).toBeTruthy();
  });

  it('adds a call with everything known about it, saying where it moves the job', async () => {
    const { api } = panel(byCompany('Harbor & Pine'));
    expect(screen.getByText(/When a company sets up a call, add it here/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    expect(within(form).getByText('Adding it moves the job to Screen.')).toBeTruthy();
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'Panel interview');
    expect(within(form).getByText('Adding it moves the job to Interview.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Time, if you know it'), {
      target: { value: '14:00' },
    });
    await userEvent.selectOptions(within(form).getByLabelText('How long'), '1 hour');
    await userEvent.selectOptions(within(form).getByLabelText('How'), 'Video');
    await userEvent.type(within(form).getByLabelText('Meeting link'), 'https://meet.example.com/x');
    await userEvent.type(within(form).getByLabelText('Name of person 1'), 'Dana Lee');
    await userEvent.type(within(form).getByLabelText('Role of person 1'), 'Hiring manager');
    await userEvent.click(within(form).getByRole('button', { name: 'Add a person' }));
    await userEvent.type(within(form).getByLabelText('Name of person 2'), 'Sam Ortiz');
    // A row left empty is left out.
    await userEvent.click(within(form).getByRole('button', { name: 'Add a person' }));
    await userEvent.type(within(form).getByLabelText('What it’s about'), 'System design');
    await userEvent.click(within(form).getByRole('button', { name: 'Add call' }));
    expect(api.addCall).toHaveBeenCalledWith('harbor-and-pine--senior-engineer-payments', {
      kind: 'panel',
      onDate: TODAY,
      atTime: '14:00',
      minutes: 60,
      mode: 'video',
      place: 'https://meet.example.com/x',
      people: [
        { name: 'Dana Lee', role: 'Hiring manager' },
        { name: 'Sam Ortiz', role: null },
      ],
      notes: 'System design',
    });
    expect(screen.queryByRole('form', { name: 'Add a call' })).toBeNull();
  });

  it('starts the form on the round after the last one, and says when the status stays', async () => {
    panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    expect((within(form).getByLabelText('Kind') as HTMLSelectElement).value).toBe('final');
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'Recruiter screen');
    expect(within(form).getByText('The job stays at Interview.')).toBeTruthy();
  });

  it('fills in the role of someone met already, and asks for a name beside a role', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    await userEvent.type(within(form).getByLabelText('Name of person 1'), 'Priya Shah');
    expect((within(form).getByLabelText('Role of person 1') as HTMLInputElement).value).toBe(
      'Recruiter',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Add a person' }));
    await userEvent.type(within(form).getByLabelText('Role of person 2'), 'CTO');
    await userEvent.click(within(form).getByRole('button', { name: 'Add call' }));
    expect(within(form).getByRole('alert').textContent).toBe(
      'Add a name for each person, or remove the row.',
    );
    expect(api.addCall).not.toHaveBeenCalled();
  });

  it('changes a call, and can cancel it', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Change the panel interview' }));
    const form = screen.getByRole('form', { name: 'Change the panel interview' });
    expect((within(form).getByLabelText('Name of person 3') as HTMLInputElement).value).toBe(
      'Ana Ruiz',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Remove person 3' }));
    await userEvent.selectOptions(within(form).getByLabelText('Where it stands'), 'Canceled');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(api.updateCall).toHaveBeenCalledWith('northwind-panel', {
      kind: 'panel',
      onDate: expect.any(String),
      atTime: '14:00',
      minutes: 60,
      mode: 'video',
      place: 'https://meet.example.com/northwind-panel',
      people: [
        { name: 'Dana Lee', role: 'Hiring manager' },
        { name: 'Sam Ortiz', role: 'Staff engineer' },
      ],
      notes: 'System design and team fit. Bring the cost-tooling numbers.',
      state: 'canceled',
    });
  });

  it('deletes a call only after asking', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete the recruiter screen' }));
    expect(
      screen.getByText('Delete the recruiter screen, with how it went and Claude’s work for it?'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.deleteCall).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete the recruiter screen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteCall).toHaveBeenCalledWith('northwind-screen');
  });

  it('says why a call couldn’t be saved, and keeps the form', async () => {
    panel(byCompany('Harbor & Pine'), {
      result: { ok: false, message: 'That job isn’t here anymore.' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add call' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That job isn’t here anymore.');
    expect(screen.getByRole('form', { name: 'Add a call' })).toBeTruthy();
  });
});

describe('before a call', () => {
  it('starts Claude on prep and practice for that call', async () => {
    const run = controls();
    panel(byCompany('Tidewater Analytics'), { run });
    // No prep sheet yet, so prepping is the main thing to do.
    const prep = screen.getByRole('button', { name: 'Call prep for the recruiter screen' });
    expect(prep.className).toMatch(/primary/);
    await userEvent.click(prep);
    expect(run.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: 'tidewater-analytics--senior-backend-engineer',
      callId: 'tidewater-screen',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Practice the recruiter screen' }));
    expect(run.start).toHaveBeenLastCalledWith({
      skill: 'interview-prep',
      jobId: 'tidewater-analytics--senior-backend-engineer',
      callId: 'tidewater-screen',
      practice: true,
    });
  });

  it('shows a run for the call as it goes, and waits while Claude works on something else', async () => {
    const task: RunTask = { skill: 'interview-prep', jobId: NORTHWIND, callId: 'northwind-panel' };
    const run = controls('working', task);
    panel(byCompany('Northwind Labs'), { run });
    const prepping = screen.getByRole('button', {
      name: 'Preparing for the panel interview: show Claude',
    });
    expect(prepping.textContent).toBe('Preparing…');
    await userEvent.click(prepping);
    expect(run.show).toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Practice the panel interview' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('opens the call’s prep sheet', async () => {
    panel(byCompany('Northwind Labs'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Open the prep sheet for the panel interview' }),
    );
    const panelCall = byCompany('Northwind Labs').calls.find(
      (call) => call.id === 'northwind-panel',
    ) as Call;
    const dialog = await screen.findByRole('dialog', {
      name: `Prep sheet: Panel interview, ${shortDate(panelCall.onDate, TODAY)}`,
    });
    expect(within(dialog).getByRole('heading', { name: 'Five minutes before' })).toBeTruthy();
  });

  it('switches a call today from prep to how it went once its time comes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
    const job = byCompany('Tidewater Analytics');
    const today = (call: Call): Call => ({ ...call, onDate: TODAY, atTime: '10:30' });
    panel({ ...job, calls: job.calls.map(today) });
    expect(screen.getByRole('button', { name: 'Call prep for the recruiter screen' })).toBeTruthy();
    expect(screen.queryByLabelText('How it went')).toBeNull();
    cleanup();
    vi.setSystemTime(new Date(`${TODAY}T11:00:00`));
    panel({ ...job, calls: job.calls.map(today) });
    expect(screen.queryByRole('button', { name: 'Call prep for the recruiter screen' })).toBeNull();
    expect(screen.getByLabelText('How it went')).toBeTruthy();
    // With no time given, it's both all day.
    cleanup();
    panel({ ...job, calls: job.calls.map((call) => ({ ...today(call), atTime: null })) });
    expect(screen.getByRole('button', { name: 'Call prep for the recruiter screen' })).toBeTruthy();
    expect(screen.getByLabelText('How it went')).toBeTruthy();
  });
});

describe('after a call', () => {
  it('saves how it went and what came of it', async () => {
    const job = byCompany('Northwind Labs');
    const calls = job.calls.map((call) =>
      call.id === 'northwind-screen' ? { ...call, outcome: null, debrief: null } : call,
    );
    const { api } = panel({ ...job, calls });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How the recruiter screen went' }),
      'Moved forward',
    );
    expect(api.updateCall).toHaveBeenCalledWith('northwind-screen', { outcome: 'advanced' });
    const box = screen.getByLabelText('How it went');
    await userEvent.type(box, 'They asked about on-call.');
    expect(api.updateCall).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    expect(api.updateCall).toHaveBeenLastCalledWith('northwind-screen', {
      debrief: 'They asked about on-call.',
    });
  });

  it('writes thank-you notes, and shows them with each one to copy', async () => {
    const run = controls();
    const { api } = panel(byCompany('Northwind Labs'), { run });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Write the thank-you notes for the recruiter screen again',
      }),
    );
    expect(run.start).toHaveBeenCalledWith({
      skill: 'thank-you',
      jobId: NORTHWIND,
      callId: 'northwind-screen',
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Open the thank-you notes for the recruiter screen' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: /^Thank-you notes: Recruiter screen/,
    });
    const note = within(dialog).getByRole('region', { name: 'Note to Priya Shah' });
    expect(within(note).getByText('Subject: Thank you: today’s call about the platform role'));
    await userEvent.click(
      within(note).getByRole('button', { name: 'Copy the note to Priya Shah' }),
    );
    expect(api.copyText).toHaveBeenCalledWith(expect.stringMatching(/^Hi Priya,\n\nThank you/));
    expect(
      within(note).getByRole('button', { name: 'Copy the note to Priya Shah' }).textContent,
    ).toBe('Copied');
  });

  it('offers the next round once the latest call moved forward', async () => {
    const job = byCompany('Northwind Labs');
    const screenOnly = {
      ...job,
      calls: job.calls.filter((call) => call.id === 'northwind-screen'),
    };
    panel(screenOnly);
    await userEvent.click(screen.getByRole('button', { name: 'Add the next round' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    expect((within(form).getByLabelText('Kind') as HTMLSelectElement).value).toBe('manager');
    cleanup();
    // An earlier call doesn't offer it: the round after it is booked already.
    panel(job);
    expect(screen.queryByRole('button', { name: 'Add the next round' })).toBeNull();
  });
});

describe('thanksNotes', () => {
  it('reads one note for each person, with its subject, and none without headings', () => {
    expect(
      thanksNotes(
        '## Dana Lee\n\n**Subject:** Thanks, Dana\n\nHi Dana,\n\nThank you.\n\n## Sam Ortiz\n\nHi Sam.',
      ),
    ).toEqual([
      { name: 'Dana Lee', subject: 'Thanks, Dana', body: 'Hi Dana,\n\nThank you.' },
      { name: 'Sam Ortiz', subject: null, body: 'Hi Sam.' },
    ]);
    expect(thanksNotes('Hi Dana, thanks!')).toEqual([]);
  });
});

describe('the calls section’s accessibility', () => {
  it('finds no problems with a call being changed, one being added, and a note open', async () => {
    const { container } = panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change the panel interview' }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open the thank-you notes for the recruiter screen' }),
    );
    const dialog = await screen.findByRole('dialog');
    const inDialog = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } });
    expect(inDialog.violations).toEqual([]);
  });
});
