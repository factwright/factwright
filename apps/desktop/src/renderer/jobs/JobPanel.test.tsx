// @vitest-environment jsdom
import { type Job, localDate } from '@factwright/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import { JobPanel } from './JobPanel.tsx';
import { jobRows } from './rows.ts';
import { sampleDocs, sampleJobs } from './sample-jobs.ts';

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
  // Which sections the user closed, kept for next time.
  localStorage.clear();
});

const byCompany = (company: string): Job => {
  const job = sampleJobs().find((each) => each.company === company);
  if (!job) throw new Error(`No sample job for ${company}`);
  return job;
};

function panel(
  job: Job | null,
  api: Partial<FactwrightApi> = {},
  props: Partial<Parameters<typeof JobPanel>[0]> = {},
) {
  const fullApi = {
    updateJob: vi.fn(async () => ({ ok: true as const })),
    jobDocs: vi.fn(async () => (job ? sampleDocs(job) : null)),
    jobExtras: vi.fn(async () => ({ asked: {}, shots: [] })),
    openFile: vi.fn(async () => ({ ok: true as const })),
    ...api,
  } as unknown as FactwrightApi;
  const onClose = vi.fn();
  const row = job ? (jobRows([job], TODAY)[0] ?? null) : null;
  const view = render(
    <JobPanel row={row} api={fullApi} today={TODAY} onClose={onClose} {...props} />,
  );
  return { api: fullApi, onClose, ...view };
}

describe('JobPanel', () => {
  it('asks the user to pick a job until one is picked', () => {
    panel(null);
    expect(screen.getByText('Pick a job to see everything on file for it.')).toBeTruthy();
  });

  it('shows the job, why it scored, what people say, files, calls and history', async () => {
    const { container } = panel(byCompany('Northwind Labs'));
    const details = screen.getByRole('complementary', { name: 'Job details' });
    expect(
      within(details).getByRole('heading', { name: 'Senior Software Engineer, Platform' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Posting' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('heading', { name: 'Why it scored 86' })).toBeTruthy();
    expect(screen.getByText('34 of 40')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Proven' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Missing' })).toBeTruthy();
    expect(screen.getByText('People like it')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Resume - Northwind Labs.pdf' })).toBeTruthy();
    // PDFs can be previewed in the app; documents open as text.
    expect(
      screen.getByRole('button', { name: 'Preview Resume - Northwind Labs.pdf' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Preview (?!Resume)/ })).toBeNull();
    expect(screen.getByText('Recruiter was friendly. Team of six.')).toBeTruthy();
    expect(screen.getByText('Marked Interview')).toBeTruthy();
    // A call still to come isn't history yet.
    expect(screen.queryByText('Panel interview: scheduled')).toBeNull();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('changes the status', async () => {
    const { api } = panel(byCompany('Acme Robotics'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Status for Acme Robotics' }),
      'Applied',
    );
    expect(api.updateJob).toHaveBeenCalledWith('acme-robotics--staff-engineer-developer-tools', {
      status: 'applied',
    });
  });

  it('says why a change didn’t save', async () => {
    panel(byCompany('Acme Robotics'), {
      updateJob: vi.fn(async () => ({ ok: false as const, message: 'That job isn’t here.' })),
    });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Passed');
    expect((await screen.findByRole('alert')).textContent).toBe('That job isn’t here.');
  });

  it('shows how to apply, with the email to write to', () => {
    panel(byCompany('Acme Robotics'));
    const note = screen.getByRole('note');
    expect(within(note).getByText('How to apply')).toBeTruthy();
    expect(within(note).getByRole('link', { name: 'jobs@acme.example' }).getAttribute('href')).toBe(
      'mailto:jobs@acme.example?subject=Staff%20Engineer%2C%20Developer%20Tools',
    );
    expect(within(note).getByText('Attach the resume as a PDF.')).toBeTruthy();
  });

  it('scores from the job search when there’s no fit check', () => {
    panel(byCompany('Copperleaf Energy'));
    expect(screen.getByRole('heading', { name: 'Why it scored 71' })).toBeTruthy();
    expect(screen.getByText(/^From the job search · /)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'From the job search' })).toBeTruthy();
    expect(screen.getByText('Grid software with a small, senior team')).toBeTruthy();
  });

  it('says when a job isn’t scored yet', () => {
    panel(byCompany('Bluewave Staffing'));
    expect(screen.getByRole('heading', { name: 'Not scored yet' })).toBeTruthy();
    expect(screen.getByText('No files yet.')).toBeTruthy();
  });

  it('opens documents in the app, and resumes in the user’s own app', async () => {
    const job = byCompany('Northwind Labs');
    const { api } = panel(job);
    await userEvent.click(screen.getByRole('button', { name: 'Open Posting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Posting: Northwind Labs' });
    expect(within(dialog).getByRole('heading', { name: 'What you’ll do' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open Resume - Northwind Labs.pdf' }));
    expect(api.openFile).toHaveBeenCalledWith(job.files[0]?.path);
  });

  it('closes with Escape or the close button', async () => {
    const { onClose } = panel(byCompany('Lumen Health'));
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens and closes each section, and keeps it as left for the next job', async () => {
    panel(byCompany('Northwind Labs'));
    const fit = screen.getByRole('button', { name: /^Fit/ });
    expect(fit.getAttribute('aria-expanded')).toBe('true');
    expect(fit.textContent).toContain('Strong 86');
    await userEvent.click(fit);
    expect(fit.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Why it scored 86' })).toBeNull();
    cleanup();
    panel(byCompany('Acme Robotics'));
    expect(screen.getByRole('button', { name: /^Fit/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    // A heading still names each section for screen readers.
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
  });

  it('gives the job the window, moves through the list, and Escape puts it back', async () => {
    const onExpand = vi.fn();
    panel(byCompany('Northwind Labs'), {}, { onExpand });
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(onExpand).toHaveBeenCalledWith(true);
    cleanup();
    const onStep = vi.fn();
    const { onClose } = panel(
      byCompany('Northwind Labs'),
      {},
      { onExpand, expanded: true, navigation: { index: 2, count: 3, onStep } },
    );
    expect(screen.getByText('2 of 3')).toBeTruthy();
    // No pressed state on top of the label that says what the button does.
    expect(
      screen.getByRole('button', { name: 'Show beside the list' }).getAttribute('aria-pressed'),
    ).toBeNull();
    // Its Progress and Notes sit beside what's known about the job.
    expect(screen.getByRole('complementary', { name: 'Job details' }).className).toMatch(
      /expanded/,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next job' }));
    expect(onStep).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Previous job' }));
    expect(onStep).toHaveBeenCalledWith(-1);
    // Focus moved into the job when it took the window, so Escape works right away.
    await userEvent.keyboard('{Escape}');
    expect(onExpand).toHaveBeenLastCalledWith(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps what’s open and typed when the job takes the window, and when it goes back', async () => {
    const job = byCompany('Harbor & Pine');
    const row = jobRows([job], TODAY)[0] ?? null;
    const api = {
      jobDocs: vi.fn(async () => sampleDocs(job)),
      jobExtras: vi.fn(async () => ({ asked: {}, shots: [] })),
    } as unknown as FactwrightApi;
    const shown = (expanded: boolean) => (
      <JobPanel
        row={row}
        api={api}
        today={TODAY}
        onClose={() => {}}
        expanded={expanded}
        onExpand={() => {}}
      />
    );
    const { rerender } = render(shown(false));
    await userEvent.click(screen.getByRole('button', { name: 'Log a call' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Notes, if any' }), 'With the CTO');
    rerender(shown(true));
    expect((screen.getByRole('textbox', { name: 'Notes, if any' }) as HTMLInputElement).value).toBe(
      'With the CTO',
    );
    rerender(shown(false));
    expect((screen.getByRole('textbox', { name: 'Notes, if any' }) as HTMLInputElement).value).toBe(
      'With the CTO',
    );
  });

  it('keeps the keyboard’s focus on an arrow at the list’s end', async () => {
    const onStep = vi.fn();
    panel(
      byCompany('Northwind Labs'),
      {},
      { expanded: true, onExpand: () => {}, navigation: { index: 3, count: 3, onStep } },
    );
    const next = screen.getByRole('button', { name: 'Next job' });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    next.focus();
    await userEvent.click(next);
    expect(onStep).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(next);
  });
});
