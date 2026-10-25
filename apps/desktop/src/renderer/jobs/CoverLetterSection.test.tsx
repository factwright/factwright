// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { CoverLetterPart } from './CoverLetterSection.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

const TODAY = localDate();

afterEach(cleanup);

const LETTER = JSON.stringify({
  name: 'Alex Rivera',
  date: 'October 14, 2026',
  recipient: ['Sam Lee', 'Engineering Manager', 'Acme'],
  greeting: 'Dear Sam Lee,',
  paragraphs: [
    'Acme wants deploys to be boring. I cut deploy time by **~40%** at Tidewater.',
    'Talk soon?',
  ],
  closing: 'Best regards,',
});

const file = (name: string, format: 'pdf' | 'docx') => ({
  path: `applications/acme/${name}`,
  name,
  format,
  size: 38_100,
  modified: `${TODAY}T16:00:00.000Z`,
});

const job = sampleJob({
  id: 'acme--staff-engineer',
  company: 'Acme',
  role: 'Staff Engineer',
  docKinds: ['letter'],
  letters: [
    file('AlexRiveraCoverLetter_Acme.pdf', 'pdf'),
    file('AlexRiveraCoverLetter_Acme.docx', 'docx'),
  ],
});

function apiStub(letter: string | undefined = LETTER) {
  return {
    jobDocs: vi.fn(async () => ({ letter })),
    copyText: vi.fn(async () => ({ ok: true }) as const),
    openFile: vi.fn(async () => ({ ok: true }) as const),
    downloadFile: vi.fn(async () => ({ ok: true, saved: true }) as const),
    showFile: vi.fn(async () => ({ ok: true }) as const),
    keepVersion: vi.fn(async () => ({ ok: true }) as const),
    platform: 'darwin',
  } as unknown as FactwrightApi & {
    copyText: Mock<FactwrightApi['copyText']>;
    openFile: Mock<FactwrightApi['openFile']>;
    downloadFile: Mock<FactwrightApi['downloadFile']>;
    showFile: Mock<FactwrightApi['showFile']>;
  };
}

/** The job panel's run controls, with Claude at work on a task, or on none. */
const controls = (task: RunTask | null = null): RunControls => ({
  ...runControlsFor(task ? [{ id: 'run-1', task, phase: 'working' }] : [], vi.fn(), vi.fn()),
  show: vi.fn(),
});

describe('CoverLetterPart', () => {
  it('shows the letter, folded, who it’s to, and its files', async () => {
    const { container } = render(
      <CoverLetterPart job={job} api={apiStub()} today={TODAY} run={controls()} />,
    );
    expect(screen.getByRole('heading', { name: 'Cover letter' })).toBeTruthy();
    const letter = await screen.findByRole('article', { name: 'Cover letter for Acme' });
    const folded = letter.closest('details');
    expect(folded?.open).toBe(false);
    await userEvent.click(screen.getByText('Read the letter'));
    expect(folded?.open).toBe(true);
    expect(within(letter).getByText('To Sam Lee · Engineering Manager · Acme')).toBeTruthy();
    expect(within(letter).getByText('Dear Sam Lee,')).toBeTruthy();
    // Its bold shows as bold, not as marks.
    expect(within(letter).getByText('~40%').tagName).toBe('STRONG');
    expect(letter.textContent).toContain('Best regards,Alex Rivera');
    expect(screen.getByText('16 words')).toBeTruthy();
    const files = screen.getByRole('list', { name: 'The cover letter’s files' });
    expect(within(files).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(files).getByRole('button', { name: 'Preview AlexRiveraCoverLetter_Acme.pdf' }),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('copies the letter as plain text, for a form’s cover letter box', async () => {
    const api = apiStub();
    render(<CoverLetterPart job={job} api={api} today={TODAY} run={controls()} />);
    await screen.findByRole('article', { name: 'Cover letter for Acme' });
    await userEvent.click(screen.getByRole('button', { name: 'Copy text of the cover letter' }));
    expect(api.copyText).toHaveBeenCalledWith(
      [
        'Dear Sam Lee,',
        'Acme wants deploys to be boring. I cut deploy time by ~40% at Tidewater.',
        'Talk soon?',
        'Best regards,\nAlex Rivera',
      ].join('\n\n'),
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    // A screen reader hears it too.
    expect(screen.getByRole('status').textContent).toBe('Copied the cover letter’s text');
  });

  it('says the letter isn’t checked yet while Claude is writing it', async () => {
    const run = controls({ skill: 'cover-letter', jobId: job.id });
    render(<CoverLetterPart job={job} api={apiStub()} today={TODAY} run={run} />);
    await screen.findByRole('article', { name: 'Cover letter for Acme' });
    expect(screen.getByText('Your Claude is still writing and checking this letter.')).toBeTruthy();
    expect(screen.getByText('Being written')).toBeTruthy();
    expect(screen.getByText('Claude is on it')).toBeTruthy();
  });

  it('keeps the letter as it is, then writes a new version', async () => {
    const run = controls();
    const api = apiStub();
    render(<CoverLetterPart job={job} api={api} today={TODAY} run={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    expect(api.keepVersion).toHaveBeenCalledWith(job.id, 'letter');
    await waitFor(() =>
      expect(run.start).toHaveBeenCalledWith({ skill: 'cover-letter', jobId: job.id, again: true }),
    );
  });

  it('opens a file in the user’s own app, and says when it can’t', async () => {
    const api = apiStub();
    api.openFile.mockResolvedValueOnce({ ok: false, message: 'That file isn’t there anymore.' });
    render(<CoverLetterPart job={job} api={api} today={TODAY} run={controls()} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open AlexRiveraCoverLetter_Acme.docx' }),
    );
    expect(api.openFile).toHaveBeenCalledWith('applications/acme/AlexRiveraCoverLetter_Acme.docx');
    expect(screen.getByRole('alert').textContent).toBe('That file isn’t there anymore.');
  });

  it('saves a copy of a file where the user picks, or shows it in Finder, and says when it can’t', async () => {
    const api = apiStub();
    render(<CoverLetterPart job={job} api={api} today={TODAY} run={controls()} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Download AlexRiveraCoverLetter_Acme.pdf' }),
    );
    expect(api.downloadFile).toHaveBeenCalledWith(
      job.id,
      'applications/acme/AlexRiveraCoverLetter_Acme.pdf',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Show AlexRiveraCoverLetter_Acme.docx in Finder' }),
    );
    expect(api.showFile).toHaveBeenCalledWith(
      job.id,
      'applications/acme/AlexRiveraCoverLetter_Acme.docx',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    api.downloadFile.mockResolvedValueOnce({
      ok: false,
      message: 'That folder can’t be written to. Pick another one.',
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Download AlexRiveraCoverLetter_Acme.docx' }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That folder can’t be written to. Pick another one.',
    );
  });

  it('shows the files alone for a letter the user made, and the button to write one without', async () => {
    const own = { ...job, docKinds: [] };
    render(<CoverLetterPart job={own} api={apiStub()} today={TODAY} run={controls()} />);
    expect(screen.getByText('PDF and Word')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy text/ })).toBeNull();
    cleanup();
    const none = { ...job, docKinds: [], letters: [] };
    const run = controls();
    render(<CoverLetterPart job={none} api={apiStub()} today={TODAY} run={run} />);
    expect(screen.getByText(/A letter for this job, from your facts/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Write a cover letter' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'cover-letter', jobId: job.id });
    cleanup();
    // A posting that asks for one says so.
    const asked = { ...none, apply: '- Attach a cover letter.' };
    render(<CoverLetterPart job={asked} api={apiStub()} today={TODAY} run={controls()} />);
    expect(screen.getByText(/The posting asks for one/)).toBeTruthy();
    cleanup();
    // A letter still being written, which won't read yet, waits as the button that writes one.
    const writing = { ...job, letters: [] };
    const api = apiStub('{"greeting": "Dear');
    render(
      <CoverLetterPart
        job={writing}
        api={api}
        today={TODAY}
        run={controls({ skill: 'cover-letter', jobId: job.id })}
      />,
    );
    await waitFor(() => expect(api.jobDocs).toHaveBeenCalled());
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText('Claude is on it')).toBeTruthy();
  });
});
