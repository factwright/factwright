// @vitest-environment jsdom
import { addDays, type Call, type Job, localDate, shortDate } from '@factwright/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditResult, FactwrightApi, RunPhase, SaveFileResult } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { type InviteMe, plainNote, requestAddCall, thanksNotes } from './JobCalls.tsx';
import { JobPanel } from './JobPanel.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
import { jobRows } from './rows.ts';
import { sampleCallDocs, sampleJobs } from './sample-jobs.ts';
import type { ReminderSwitch } from './useCallReminders.ts';

const TODAY = localDate();

// Each test draws the whole job panel, which CI's runners, busy with every package's tests at
// once, take five times longer for or more: two of them ran past vitest's usual 5 seconds there.
vi.setConfig({ testTimeout: 20_000 });

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

/** The job panel's run controls, with a run of a task in a phase, or none. */
function controls(phase: RunPhase | null = null, task: RunTask | null = null): RunControls {
  const runs = phase && task ? [{ id: 'run-1', task, phase }] : [];
  return { ...runControlsFor(runs, vi.fn(), vi.fn()), show: vi.fn() };
}

function panel(
  job: Job,
  {
    result = { ok: true },
    run = controls(),
    saved = { ok: true, saved: true },
    reminders,
    me,
  } = {} as {
    result?: EditResult;
    run?: RunControls;
    saved?: SaveFileResult;
    reminders?: ReminderSwitch;
    me?: InviteMe;
  },
) {
  const answer = vi.fn(async () => result);
  const api = {
    saveFile: vi.fn(async () => saved),
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
      outreach: [],
      versions: [],
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
      me={me}
      reminders={reminders}
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

  it('keeps a passcode after a meeting link to read, beside Join', () => {
    const job = byCompany('Northwind Labs');
    const place = 'https://zoom.us/j/8812345678 passcode 4321';
    const calls = job.calls.map((call) =>
      call.id === 'northwind-panel' ? { ...call, place } : call,
    );
    panel({ ...job, calls });
    const next = callCard('Panel interview');
    const join = within(next).getByRole('link', { name: /^Join at zoom\.us\/j\/8812345678/ });
    expect(join.getAttribute('href')).toBe('https://zoom.us/j/8812345678');
    expect(within(next).getByText(place)).toBeTruthy();
  });

  it('says how many were canceled when every call was', () => {
    const job = byCompany('Tidewater Analytics');
    panel({ ...job, calls: job.calls.map((call) => ({ ...call, state: 'canceled' as const })) });
    expect(screen.getByRole('button', { name: /^Calls and interviews/ }).textContent).toContain(
      '1 canceled',
    );
  });

  it('gives the keyboard’s focus back where it was once a form or a question closes', async () => {
    panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Kind'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a call' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change the panel interview' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Change the panel interview' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete the panel interview' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Delete the panel interview' }),
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

describe('before there’s a call', () => {
  it('says what goes here, and opens the form to add one, here or from Up next', async () => {
    const job = byCompany('Lumen Health');
    panel(job);
    const calls = screen.getByRole('region', { name: 'Calls and interviews' });
    expect(within(calls).getByText(/When a company sets up a call/)).toBeTruthy();
    // Nothing to close while it's empty.
    expect(screen.queryByRole('button', { name: /^Calls and interviews/ })).toBeNull();
    await userEvent.click(within(calls).getByRole('button', { name: 'Add a call' }));
    expect(within(calls).getByRole('form', { name: 'Add a call' })).toBeTruthy();
    await userEvent.click(within(calls).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(within(calls).getByRole('button', { name: 'Add a call' }));
    // Up next asks for it too, such as once the user hears back.
    act(() => requestAddCall());
    const form = within(calls).getByRole('form', { name: 'Add a call' });
    expect(form.contains(document.activeElement)).toBe(true);
  });

  it('offers interview prep for the calls once the user has applied, and opens it', async () => {
    const run = controls();
    const job = byCompany('Lumen Health');
    panel(job, { run });
    await userEvent.click(screen.getByRole('button', { name: 'Interview prep' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'interview-prep', jobId: job.id });
    cleanup();
    const prepped: Job = { ...job, docKinds: [...job.docKinds, 'prep'] };
    const { api } = panel(prepped);
    vi.mocked(api.jobDocs).mockResolvedValue({ prep: '# Prep\n\nAsk about on-call.' });
    await userEvent.click(screen.getByRole('button', { name: 'Open Interview prep' }));
    const dialog = await screen.findByRole('dialog', { name: 'Interview prep: Lumen Health' });
    expect(within(dialog).getByText('Ask about on-call.')).toBeTruthy();
    cleanup();
    // Not before applying.
    panel(byCompany('Copperleaf Energy'));
    expect(screen.queryByRole('button', { name: 'Interview prep' })).toBeNull();
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

  it('shows a run for the call as it goes, and starts the call’s others beside it', async () => {
    const task: RunTask = { skill: 'interview-prep', jobId: NORTHWIND, callId: 'northwind-panel' };
    const run = controls('working', task);
    panel(byCompany('Northwind Labs'), { run });
    const prepping = screen.getByRole('button', {
      name: 'Preparing for the panel interview: show Claude',
    });
    expect(prepping.textContent).toBe('Preparing…');
    await userEvent.click(prepping);
    expect(run.show).toHaveBeenCalledWith(task);
    expect(run.start).not.toHaveBeenCalled();
    // Practice is a task of its own, which waits in line behind the prep.
    const practice = screen.getByRole('button', { name: 'Practice the panel interview' });
    expect((practice as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(practice);
    expect(run.start).toHaveBeenCalledWith({ ...task, practice: true });
    cleanup();
    panel(byCompany('Northwind Labs'), { run: controls('in-line', task) });
    const waiting = screen.getByRole('button', {
      name: 'Call prep for the panel interview, in line: show Claude',
    });
    expect(waiting.textContent).toBe('In line');
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

describe('a call today', () => {
  it('turns to how it went when its time comes, while the panel stays open', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(`${TODAY}T10:29:30`));
    const job = byCompany('Tidewater Analytics');
    panel({
      ...job,
      calls: job.calls.map((call) => ({ ...call, onDate: TODAY, atTime: '10:30' })),
    });
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByLabelText('How it went')).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByLabelText('How it went')).toBeTruthy();
    // Underway, it isn't the next call any more.
    expect(screen.queryByText('Next')).toBeNull();
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

  it('keeps how it went from another computer, saved while this one was typing', async () => {
    const job = byCompany('Northwind Labs');
    const without = job.calls.map((call) =>
      call.id === 'northwind-screen' ? { ...call, debrief: null } : call,
    );
    const answer = vi.fn(async () => ({ ok: true }));
    const api = {
      updateCall: answer,
      jobDocs: vi.fn(async () => null),
      jobExtras: vi.fn(async () => null),
    } as unknown as FactwrightApi;
    const shown = (calls: Call[]) => (
      <JobPanel
        row={jobRows([{ ...job, calls }], TODAY)[0] ?? null}
        api={api}
        today={TODAY}
        onClose={() => {}}
      />
    );
    const { rerender } = render(shown(without));
    await userEvent.type(screen.getByLabelText('How it went'), 'Asked about on-call.');
    // Meanwhile a sync brings the Mac's words in.
    rerender(
      shown(
        without.map((call) =>
          call.id === 'northwind-screen'
            ? { ...call, debrief: 'Priya liked the deploy story.' }
            : call,
        ),
      ),
    );
    await userEvent.tab();
    expect(answer).toHaveBeenCalledWith('northwind-screen', {
      debrief: 'Asked about on-call.\n\nPriya liked the deploy story.',
    });
  });

  it('writes thank-you notes, and shows them with each one to copy', async () => {
    const run = controls();
    const { api } = panel(byCompany('Northwind Labs'), { run });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Write again: the thank-you notes for the recruiter screen',
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
    await userEvent.click(within(note).getByRole('button', { name: 'Copy note to Priya Shah' }));
    expect(api.copyText).toHaveBeenCalledWith(expect.stringMatching(/^Hi Priya,\n\nThank you/));
    expect(
      within(note).getByRole('button', { name: 'Copied the note to Priya Shah' }).textContent,
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

/** The Northwind panel interview, as the sample jobs have it. */
const northwindPanel = () =>
  byCompany('Northwind Labs').calls.find((call) => call.id === 'northwind-panel') as Call;

describe('adding a call to a calendar', () => {
  it('saves a calendar file for a call coming up, named for it, and says what to do next', async () => {
    const { api } = panel(byCompany('Northwind Labs'));
    // Only a call still to come has it.
    expect(
      screen.queryByRole('button', { name: 'Add to calendar: the recruiter screen' }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add to calendar: the panel interview' }),
    );
    const { onDate } = northwindPanel();
    expect(api.saveFile).toHaveBeenCalledWith(
      `Panel interview - Northwind Labs - ${onDate}.ics`,
      expect.stringMatching(/^BEGIN:VCALENDAR\r\n/),
    );
    const text = vi.mocked(api.saveFile).mock.calls[0]?.[1] ?? '';
    expect(text).toContain(`DTSTART:${onDate.replaceAll('-', '')}T140000\r\n`);
    expect(text).toContain(`DTEND:${onDate.replaceAll('-', '')}T150000\r\n`);
    expect(text).toContain('SUMMARY:Panel interview with Northwind Labs\r\n');
    expect(text).toContain('LOCATION:https://meet.example.com/northwind-panel\r\n');
    expect(text).not.toContain('ATTENDEE');
    expect(
      await screen.findByText('Saved. Open the file to add the call to your calendar.'),
    ).toBeTruthy();
  });

  it('stops saying the file was saved once the call changes', async () => {
    const job = byCompany('Northwind Labs');
    const { api, rerender } = panel(job);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add to calendar: the panel interview' }),
    );
    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    const moved = job.calls.map((call) =>
      call.id === 'northwind-panel' ? { ...call, atTime: '15:00' } : call,
    );
    rerender(
      <JobPanel
        row={jobRows([{ ...job, calls: moved }], TODAY)[0] ?? null}
        api={api}
        today={TODAY}
        onClose={() => {}}
        run={controls()}
      />,
    );
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it('says nothing when saving is canceled, and why when it can’t be saved', async () => {
    panel(byCompany('Northwind Labs'), { saved: { ok: true, saved: false } });
    const add = { name: 'Add to calendar: the panel interview' };
    await userEvent.click(screen.getByRole('button', add));
    expect(screen.queryByText(/^Saved\./)).toBeNull();
    cleanup();
    const message = 'That folder can’t be written to. Pick another one.';
    panel(byCompany('Northwind Labs'), { saved: { ok: false, message } });
    await userEvent.click(screen.getByRole('button', add));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});

/** An invite's file, as the user drops it on the form or picks it. */
const inviteFile = (lines: string[], name = 'invite.ics', type = 'text/calendar') =>
  new File([`${lines.join('\r\n')}\r\n`], name, { type });

/** An invite for Northwind's final round, with the user, the recruiter and the hiring manager. */
const FINAL_ROUND = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261105T093000',
  'DURATION:PT50M',
  'SUMMARY:Final round',
  'LOCATION:Zoom',
  'DESCRIPTION:Join: https://northwind.zoom.us/j/555?pwd=x',
  'ORGANIZER;CN=Priya Shah:mailto:priya@northwind.example',
  'ATTENDEE;CN=Steve Hillyer:mailto:steve@example.com',
  'ATTENDEE;CN=Dana Lee:mailto:dana@northwind.example',
  'ATTENDEE;CN=Kim Wu;PARTSTAT=DECLINED:mailto:kim@northwind.example',
  'END:VEVENT',
  'END:VCALENDAR',
];

const ME = { name: 'Steve Hillyer', email: 'steve@example.com' };

/** Drops files on a form, as the user drags them from their mail. */
const drop = (form: HTMLElement, ...files: File[]) =>
  fireEvent.drop(form, { dataTransfer: { files, types: ['Files'] } });

const fieldValue = (form: HTMLElement, label: string) =>
  (within(form).getByLabelText(label) as HTMLInputElement).value;

describe('filling in a call from an invite', () => {
  it('fills in the form from an invite dropped on it, with the people met before', async () => {
    const { api } = panel(byCompany('Northwind Labs'), { me: ME });
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    fireEvent.dragOver(form, { dataTransfer: { types: ['Files'] } });
    expect(form.className).toMatch(/over/);
    drop(form, inviteFile(FINAL_ROUND));
    expect(
      await within(form).findByText(
        'Filled in the date, time, length, meeting link and 2 people from the invite. Check them before you add it.',
      ),
    ).toBeTruthy();
    expect(form.className).not.toMatch(/over/);
    expect(fieldValue(form, 'Date')).toBe('2026-11-05');
    expect(fieldValue(form, 'Time, if you know it')).toBe('09:30');
    // A length the form doesn't usually offer is offered too.
    expect(fieldValue(form, 'How long')).toBe('50');
    expect(within(form).getByRole('option', { name: '50 min' })).toBeTruthy();
    expect(fieldValue(form, 'How')).toBe('video');
    expect(fieldValue(form, 'Meeting link')).toBe('https://northwind.zoom.us/j/555?pwd=x');
    // Not the user, nor Kim, who said no. The others bring the parts they played before.
    expect(fieldValue(form, 'Name of person 1')).toBe('Priya Shah');
    expect(fieldValue(form, 'Role of person 1')).toBe('Recruiter');
    expect(fieldValue(form, 'Name of person 2')).toBe('Dana Lee');
    expect(fieldValue(form, 'Role of person 2')).toBe('Hiring manager');
    expect(within(form).queryByLabelText('Name of person 3')).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: 'Add call' }));
    expect(api.addCall).toHaveBeenCalledWith(NORTHWIND, {
      kind: 'final',
      onDate: '2026-11-05',
      atTime: '09:30',
      minutes: 50,
      mode: 'video',
      place: 'https://northwind.zoom.us/j/555?pwd=x',
      people: [
        { name: 'Priya Shah', role: 'Recruiter' },
        { name: 'Dana Lee', role: 'Hiring manager' },
      ],
      notes: null,
    });
  });

  it('fills it in from an invite picked with the button, keeping people typed already', async () => {
    panel(byCompany('Harbor & Pine'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    await userEvent.type(within(form).getByLabelText('Name of person 1'), 'Ana Ruiz');
    await userEvent.selectOptions(within(form).getByLabelText('How'), 'Phone');
    const picker = form.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).toBe('.ics,text/calendar');
    await userEvent.upload(picker, inviteFile(FINAL_ROUND));
    expect(await within(form).findByText(/^Filled in the date, time/)).toBeTruthy();
    expect(fieldValue(form, 'Name of person 1')).toBe('Ana Ruiz');
    expect(fieldValue(form, 'Name of person 2')).toBe('Priya Shah');
    // Steve's name isn't on file here, so the invite's Steve stays, to remove.
    expect(fieldValue(form, 'Name of person 3')).toBe('Steve Hillyer');
    expect(fieldValue(form, 'Name of person 4')).toBe('Dana Lee');
    // How the user said the call happens stays.
    expect(fieldValue(form, 'Number')).toBe('https://northwind.zoom.us/j/555?pwd=x');
  });

  it('says why a file couldn’t fill it in, and changes nothing', async () => {
    panel(byCompany('Harbor & Pine'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    const cases: [File, string][] = [
      [
        new File(['png'], 'invite.png', { type: 'image/png' }),
        'That isn’t a calendar invite. Use the .ics file attached to the invite’s email.',
      ],
      [
        inviteFile(['Dear Steve, see you Thursday.']),
        'Factwright couldn’t find a call in that invite. Fill it in yourself instead.',
      ],
      [
        inviteFile(FINAL_ROUND.map((line) => line.replace('METHOD:REQUEST', 'METHOD:CANCEL'))),
        'That invite calls the meeting off, so nothing was filled in.',
      ],
    ];
    for (const [file, message] of cases) {
      drop(form, file);
      await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe(message));
      expect(fieldValue(form, 'Time, if you know it')).toBe('');
    }
    const huge = inviteFile(FINAL_ROUND);
    Object.defineProperty(huge, 'size', { value: 6_000_000 });
    drop(form, huge);
    await waitFor(() =>
      expect(within(form).getByRole('alert').textContent).toBe(
        'That file is too big to be an invite.',
      ),
    );
    expect(fieldValue(form, 'Date')).toBe(TODAY);
  });

  it('keeps only plain words and an https link from an invite meant to trick it', async () => {
    panel(byCompany('Harbor & Pine'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    drop(
      form,
      inviteFile([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;TZID=Mars/Olympus_Mons:20261105T093000',
        'URL:javascript:alert(document.cookie)',
        'LOCATION:javascript:alert(document.cookie)',
        'DESCRIPTION:<img src=x onerror=alert(1)> http://zoom.us/j/1',
        'ORGANIZER;CN="Dana\u202e Lee\u200b":mailto:dana@example.com',
        `ATTENDEE;CN=${'A'.repeat(500)}:mailto:a@example.com`,
        'END:VEVENT',
        'END:VCALENDAR',
      ]),
    );
    expect(
      await within(form).findByText(
        'Filled in the date, time and 2 people from the invite. Its time zone wasn’t clear, so check the time.',
      ),
    ).toBeTruthy();
    expect(fieldValue(form, 'Where')).toBe('');
    expect(fieldValue(form, 'How')).toBe('');
    expect(fieldValue(form, 'Name of person 1')).toBe('Dana Lee');
    expect(fieldValue(form, 'Name of person 2')).toHaveLength(120);
  });

  it('is offered only when adding a call, not when changing one', async () => {
    panel(byCompany('Northwind Labs'));
    await userEvent.click(screen.getByRole('button', { name: 'Change the panel interview' }));
    const form = screen.getByRole('form', { name: 'Change the panel interview' });
    expect(within(form).queryByRole('button', { name: 'Fill in from an invite' })).toBeNull();
    drop(form, inviteFile(FINAL_ROUND));
    await act(async () => {});
    expect(fieldValue(form, 'Time, if you know it')).toBe('14:00');
  });
});

describe('a reminder before the next call', () => {
  it('says one comes an hour before, with a switch to turn reminders off and on', async () => {
    const turn = vi.fn();
    panel(byCompany('Northwind Labs'), { reminders: { on: true, turn } });
    const next = callCard('Panel interview');
    expect(
      within(next).getByText('Factwright reminds you an hour before, while it’s open.'),
    ).toBeTruthy();
    await userEvent.click(
      within(next).getByRole('button', { name: 'Turn off reminders before calls' }),
    );
    expect(turn).toHaveBeenCalledWith(false);
    // The past call says nothing about it.
    expect(within(callCard('Recruiter screen')).queryByText(/remind/i)).toBeNull();
    cleanup();
    panel(byCompany('Northwind Labs'), { reminders: { on: false, turn } });
    expect(within(callCard('Panel interview')).getByText('Reminders before calls are off.'));
    await userEvent.click(screen.getByRole('button', { name: 'Turn on reminders before calls' }));
    expect(turn).toHaveBeenLastCalledWith(true);
  });

  it('says nothing for an archived job’s call, or once a call past midnight had its reminder', () => {
    const reminders = { on: true, turn: vi.fn() };
    const job = byCompany('Northwind Labs');
    panel({ ...job, archived: true }, { reminders });
    expect(screen.queryByText(/reminds you/)).toBeNull();
    cleanup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T23:40:00`));
    const late = job.calls.map((call) =>
      call.id === 'northwind-panel'
        ? { ...call, onDate: addDays(TODAY, 1), atTime: '00:30' }
        : call,
    );
    panel({ ...job, calls: late }, { reminders });
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByText(/reminds you/)).toBeNull();
  });

  it('says nothing once the reminder’s time has come, or for a call with no time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T13:30:00`));
    const job = byCompany('Northwind Labs');
    const reminders = { on: true, turn: vi.fn() };
    const today = (atTime: string | null) =>
      job.calls.map((call) =>
        call.id === 'northwind-panel' ? { ...call, onDate: TODAY, atTime } : call,
      );
    panel({ ...job, calls: today('14:00') }, { reminders });
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByText(/reminds you/)).toBeNull();
    cleanup();
    panel({ ...job, calls: today('14:31') }, { reminders });
    expect(screen.getByText(/reminds you/)).toBeTruthy();
    cleanup();
    panel({ ...job, calls: today(null) }, { reminders });
    expect(screen.queryByText(/reminds you/)).toBeNull();
  });
});

describe('thanksNotes', () => {
  it('reads one note for each person, with its subject, and what’s said before them', () => {
    expect(
      thanksNotes(
        'Send Sam’s through the recruiter.\n\n## Dana Lee\n\n**Subject:** Thanks, Dana\n\nHi Dana,\n\nThank you.\n\n## Sam Ortiz\n\n**Subject**: Thanks, Sam\n\nHi Sam.\n\n## Sam Ortiz\n\nAgain.',
      ),
    ).toEqual({
      intro: 'Send Sam’s through the recruiter.',
      notes: [
        { name: 'Dana Lee', subject: 'Thanks, Dana', body: 'Hi Dana,\n\nThank you.' },
        { name: 'Sam Ortiz', subject: 'Thanks, Sam', body: 'Hi Sam.' },
        { name: 'Sam Ortiz', subject: null, body: 'Again.' },
      ],
    });
    expect(thanksNotes('Hi Dana, thanks!')).toEqual({ intro: 'Hi Dana, thanks!', notes: [] });
  });
});

describe('plainNote', () => {
  it('copies a note as plain words, keeping underscores and spelling out links', () => {
    expect(
      plainNote(
        'See [my rate limiter](https://github.com/dana_lee/rate_limiter), or https://github.com/dana_lee. It reads **user_id**.',
      ),
    ).toBe(
      'See my rate limiter (https://github.com/dana_lee/rate_limiter), or https://github.com/dana_lee. It reads user_id.',
    );
    expect(plainNote('[https://a.example/x](https://a.example/x)')).toBe('https://a.example/x');
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
  it('finds no problems with an invite filled in, a calendar file saved and a reminder', async () => {
    const reminders = { on: true, turn: vi.fn() };
    const { container } = panel(byCompany('Northwind Labs'), { reminders, me: ME });
    await userEvent.click(
      screen.getByRole('button', { name: 'Add to calendar: the panel interview' }),
    );
    await screen.findByText(/^Saved\./);
    await userEvent.click(screen.getByRole('button', { name: 'Add a call' }));
    const form = screen.getByRole('form', { name: 'Add a call' });
    drop(form, inviteFile(FINAL_ROUND));
    await within(form).findByText(/^Filled in/);
    const filled = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(filled.violations).toEqual([]);
    drop(form, new File(['png'], 'invite.png', { type: 'image/png' }));
    await within(form).findByRole('alert');
    const refused = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(refused.violations).toEqual([]);
  });
});
