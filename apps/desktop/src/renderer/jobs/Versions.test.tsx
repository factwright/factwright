// @vitest-environment jsdom
import { type Job, localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { DocVersion } from '../../shared/versions.ts';
import { ResumesSection } from './ResumesSection.tsx';
import type { RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';
import { EarlierVersions, NewVersionButton, RequestChanges } from './Versions.tsx';

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
  localStorage.clear();
});

const FOLDER = 'applications/2026-10-07-acme';
const pdf = (folder: string, modified: string) => ({
  path: `${folder}/AlexRiveraResume10072026_Acme.pdf`,
  name: 'AlexRiveraResume10072026_Acme.pdf',
  format: 'pdf' as const,
  size: 1,
  modified,
});

const job: Job = sampleJob({
  id: 'acme--staff-engineer',
  company: 'Acme',
  role: 'Staff Engineer',
  status: 'apply',
  files: [pdf(FOLDER, '2026-10-09T15:00:00.000Z')],
});

const earlier = (stamp: string, fields: Partial<DocVersion>): DocVersion => ({
  folder: `${FOLDER}/previous/${stamp}`,
  kind: 'resume',
  at: '2026-10-09T15:00:00.000Z',
  why: 'new',
  changes: null,
  files: [pdf(`${FOLDER}/previous/${stamp}`, '2026-10-08T15:00:00.000Z')],
  usable: true,
  ...fields,
});

const VERSIONS = [
  earlier('2026-10-09-100000', {
    why: 'changes',
    changes: 'Lead with the platform work',
    files: [pdf(`${FOLDER}/previous/2026-10-09-100000`, '2026-10-08T15:00:00.000Z')],
  }),
  earlier('2026-10-08-100000', {
    why: 'revision',
    files: [pdf(`${FOLDER}/previous/2026-10-08-100000`, '2026-10-07T15:00:00.000Z')],
  }),
];

function apiStub() {
  return {
    keepVersion: vi.fn(async () => ({ ok: true }) as const),
    useVersion: vi.fn(async () => ({ ok: true }) as const),
    removeVersion: vi.fn(async () => ({ ok: true }) as const),
    requestChanges: vi.fn(async () => ({ ok: true }) as const),
    jobExtras: vi.fn(async () => ({
      asked: {},
      shots: [],
      posting: null,
      calls: {},
      outreach: [],
      versions: VERSIONS,
    })),
    jobDocs: vi.fn(async () => null),
    openFile: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as FactwrightApi & {
    keepVersion: Mock<FactwrightApi['keepVersion']>;
    useVersion: Mock<FactwrightApi['useVersion']>;
    removeVersion: Mock<FactwrightApi['removeVersion']>;
    requestChanges: Mock<FactwrightApi['requestChanges']>;
  };
}

const controls = (task: RunTask | null = null): RunControls => ({
  phase: task ? 'working' : 'idle',
  task,
  start: vi.fn(),
  show: vi.fn(),
});

describe('EarlierVersions', () => {
  it('lists a kind’s earlier versions, newest first, folded, with why each was put aside', async () => {
    const api = apiStub();
    const onPreview = vi.fn();
    const { container } = render(
      <EarlierVersions
        job={job}
        kind="resume"
        versions={VERSIONS}
        api={api}
        today={TODAY}
        onPreview={onPreview}
        onProblem={vi.fn()}
      />,
    );
    const list = screen.getByRole('list', { name: 'Earlier versions of the resume' });
    expect(list.closest('details')?.open).toBe(false);
    await userEvent.click(screen.getByText('Earlier versions'));
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span span')?.textContent)).toEqual([
      'Built Oct 8',
      'Built Oct 7',
    ]);
    expect(rows[0]?.textContent).toContain('Before your changes: “Lead with the platform work”');
    expect(rows[1]?.textContent).toContain('Before its ATS X-ray revision');
    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: /^Preview/ }));
    expect(onPreview).toHaveBeenCalledWith(VERSIONS[0]?.files[0]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('uses one again, or moves one to the Trash once the user says so', async () => {
    const api = apiStub();
    render(
      <EarlierVersions
        job={job}
        kind="resume"
        versions={VERSIONS}
        api={api}
        today={TODAY}
        onPreview={vi.fn()}
        onProblem={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use the version built Oct 8' }));
    expect(api.useVersion).toHaveBeenCalledWith(job.id, `${FOLDER}/previous/2026-10-09-100000`);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the version built Oct 7' }));
    expect(screen.getByRole('status').textContent).toBe('Move it to the Trash?');
    expect(document.activeElement?.textContent).toBe('Keep');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeVersion).toHaveBeenCalledWith(job.id, `${FOLDER}/previous/2026-10-08-100000`);
  });

  it('says why a version couldn’t be used, and keeps one the user applied with', async () => {
    const api = apiStub();
    api.useVersion.mockResolvedValueOnce({ ok: false, message: 'That version isn’t there.' });
    const onProblem = vi.fn();
    render(
      <EarlierVersions
        job={job}
        kind="resume"
        versions={VERSIONS}
        api={api}
        today={TODAY}
        onPreview={vi.fn()}
        onProblem={onProblem}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use the version built Oct 8' }));
    expect(onProblem).toHaveBeenCalledWith('That version isn’t there.');
    cleanup();
    const sent = { ...job, status: 'applied' as const, appliedOn: '2026-10-10' };
    render(
      <EarlierVersions
        job={sent}
        kind="resume"
        versions={VERSIONS}
        api={api}
        today={TODAY}
        onPreview={vi.fn()}
        onProblem={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Use the version/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Remove the version/ })).toHaveLength(2);
  });

  it('shows nothing without an earlier version of the kind', () => {
    const { container } = render(
      <EarlierVersions
        job={job}
        kind="letter"
        versions={VERSIONS}
        api={apiStub()}
        today={TODAY}
        onPreview={vi.fn()}
        onProblem={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('New version', () => {
  it('keeps the current one, then starts Claude on another', async () => {
    const api = apiStub();
    const run = controls();
    render(<NewVersionButton job={job} kind="resume" api={api} run={run} onProblem={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    expect(api.keepVersion).toHaveBeenCalledWith(job.id, 'resume');
    await waitFor(() =>
      expect(run.start).toHaveBeenCalledWith({
        skill: 'focused-resume',
        jobId: job.id,
        again: true,
      }),
    );
  });

  it('says why, and starts nothing, when it can’t keep the current one', async () => {
    const api = apiStub();
    api.keepVersion.mockResolvedValueOnce({ ok: false, message: 'Couldn’t keep it.' });
    const run = controls();
    const onProblem = vi.fn();
    render(<NewVersionButton job={job} kind="letter" api={api} run={run} onProblem={onProblem} />);
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    await waitFor(() => expect(onProblem).toHaveBeenCalledWith('Couldn’t keep it.'));
    expect(run.start).not.toHaveBeenCalled();
  });

  it('isn’t offered for a resume or letter the user applied with', () => {
    const sent = { ...job, status: 'applied' as const, appliedOn: '2026-10-10' };
    const { container } = render(
      <NewVersionButton
        job={sent}
        kind="resume"
        api={apiStub()}
        run={controls()}
        onProblem={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('Request changes', () => {
  it('asks what to change, keeps it for the run, then starts it', async () => {
    const api = apiStub();
    const run = controls();
    render(<RequestChanges job={job} kind="resume" api={api} run={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Changes to your resume' });
    const make = within(dialog).getByRole('button', { name: 'Make the changes' });
    expect((make as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'What to change' }),
      'Keep it to one page',
    );
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(make);
    expect(api.requestChanges).toHaveBeenCalledWith({
      jobId: job.id,
      kind: 'resume',
      changes: 'Keep it to one page',
    });
    expect(run.start).toHaveBeenCalledWith({
      skill: 'revise-resume',
      jobId: job.id,
      changes: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open and says why when the changes can’t be kept', async () => {
    const api = apiStub();
    api.requestChanges.mockResolvedValueOnce({ ok: false, message: 'There’s no letter yet.' });
    const run = controls();
    render(<RequestChanges job={job} kind="letter" api={api} run={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'What to change' }), 'Shorter');
    await userEvent.click(screen.getByRole('button', { name: 'Make the changes' }));
    expect(screen.getByRole('alert').textContent).toBe('There’s no letter yet.');
    expect(run.start).not.toHaveBeenCalled();
  });

  it('says Claude is on it while it makes them, and steps aside for a new letter', () => {
    render(
      <RequestChanges
        job={job}
        kind="resume"
        api={apiStub()}
        run={controls({ skill: 'revise-resume', jobId: job.id, changes: true })}
      />,
    );
    expect(screen.getByText('Claude is on it')).toBeTruthy();
    cleanup();
    // A letter's changes and its new version are the same skill: New version says it, once.
    const { container } = render(
      <RequestChanges
        job={job}
        kind="letter"
        api={apiStub()}
        run={controls({ skill: 'cover-letter', jobId: job.id, changes: true })}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('the resume’s versions in its area', () => {
  it('shows the job’s earlier versions under its resume, with New version and Request changes', async () => {
    render(<ResumesSection job={job} api={apiStub()} today={TODAY} run={controls()} />);
    const resume = screen.getByRole('region', { name: 'Resume' });
    expect(await within(resume).findByText('Earlier versions')).toBeTruthy();
    expect(within(resume).getByRole('button', { name: 'New version' })).toBeTruthy();
    expect(within(resume).getByRole('button', { name: 'Request changes' })).toBeTruthy();
    cleanup();
    // Once applied, the resume that went out says so, and stays.
    const sent = { ...job, status: 'applied' as const, appliedOn: '2026-10-10' };
    render(<ResumesSection job={sent} api={apiStub()} today={TODAY} run={controls()} />);
    const kept = screen.getByRole('region', { name: 'Resume' });
    expect(within(kept).getByText('Sent')).toBeTruthy();
    expect(within(kept).queryByRole('button', { name: 'New version' })).toBeNull();
    expect(within(kept).queryByRole('button', { name: 'Request changes' })).toBeNull();
  });
});
