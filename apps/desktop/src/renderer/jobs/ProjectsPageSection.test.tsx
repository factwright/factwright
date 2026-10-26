// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ProjectsPagePart, readPageOutline } from './ProjectsPageSection.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

const TODAY = localDate();

afterEach(cleanup);

const PAGE = JSON.stringify({
  name: 'Alex Rivera',
  heading: 'Selected Projects',
  shape: 'cards',
  projects: [{ name: 'Trailhead' }, { name: 'Code Club' }, { name: ' ' }],
});

const job = sampleJob({
  id: 'acme--staff-engineer',
  company: 'Acme',
  role: 'Staff Engineer',
  docKinds: ['projects'],
  projectPages: [
    {
      path: 'applications/acme/AlexRiveraProjects10202026_Acme.pdf',
      name: 'AlexRiveraProjects10202026_Acme.pdf',
      format: 'pdf',
      size: 41_200,
      modified: `${TODAY}T16:00:00.000Z`,
    },
  ],
});

function apiStub(projects: string | undefined = PAGE) {
  return {
    jobDocs: vi.fn(async () => ({ projects })),
    openFile: vi.fn(async () => ({ ok: true }) as const),
    downloadFile: vi.fn(async () => ({ ok: true, saved: true }) as const),
    showFile: vi.fn(async () => ({ ok: true }) as const),
    platform: 'win32',
  } as unknown as FactwrightApi & {
    openFile: Mock<FactwrightApi['openFile']>;
    downloadFile: Mock<FactwrightApi['downloadFile']>;
    showFile: Mock<FactwrightApi['showFile']>;
  };
}

describe('readPageOutline', () => {
  it('reads what a page shows, and nothing from one that won’t read', () => {
    expect(readPageOutline(PAGE)).toEqual({
      heading: 'Selected Projects',
      shape: 'cards',
      projects: ['Trailhead', 'Code Club'],
    });
    expect(readPageOutline('{"projects":[{"name":"One"}],"shape":"constructor"}')).toEqual({
      heading: 'Projects',
      shape: 'list',
      projects: ['One'],
    });
    for (const json of [null, '', 'not json', '[]', '{"projects":[]}']) {
      expect(readPageOutline(json)).toBeNull();
    }
  });
});

/** The job panel's run controls, with Claude at work on a task, or on none. */
const controls = (task: RunTask | null = null): RunControls => ({
  ...runControlsFor(task ? [{ id: 'run-1', task, phase: 'working' }] : [], vi.fn(), vi.fn()),
  show: vi.fn(),
});

describe('ProjectsPagePart', () => {
  it('shows what’s on the page and its files, to preview and open', async () => {
    const api = apiStub();
    const { container } = render(
      <ProjectsPagePart job={job} api={api} today={TODAY} run={controls()} />,
    );
    expect(screen.getByRole('heading', { name: 'Projects page' })).toBeTruthy();
    expect(await screen.findByText('2 projects, as cards')).toBeTruthy();
    expect(screen.getByText('Trailhead · Code Club')).toBeTruthy();
    expect(screen.getByText(/It goes only where you send it/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /Open/ }));
    await waitFor(() =>
      expect(api.openFile).toHaveBeenCalledWith(
        'applications/acme/AlexRiveraProjects10202026_Acme.pdf',
      ),
    );
    // On Windows, a file shows in its folder.
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Show AlexRiveraProjects10202026_Acme.pdf in its folder',
      }),
    );
    expect(api.showFile).toHaveBeenCalledWith(
      job.id,
      'applications/acme/AlexRiveraProjects10202026_Acme.pdf',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Download AlexRiveraProjects10202026_Acme.pdf' }),
    );
    expect(api.downloadFile).toHaveBeenCalledWith(
      job.id,
      'applications/acme/AlexRiveraProjects10202026_Acme.pdf',
    );
  });

  it('says when Claude is still making it, and offers to make one for a job without', async () => {
    const making = controls({ skill: 'projects-page', jobId: job.id });
    render(<ProjectsPagePart job={job} api={apiStub()} today={TODAY} run={making} />);
    expect(await screen.findByText('Being made')).toBeTruthy();
    expect(screen.getByText('Your Claude is still making and checking this page.')).toBeTruthy();
    cleanup();
    const run = controls();
    render(
      <ProjectsPagePart
        job={{ ...job, docKinds: [], projectPages: [] }}
        api={apiStub()}
        today={TODAY}
        run={run}
      />,
    );
    expect(screen.getByText(/The posting asks for samples of your work/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Make a Projects page' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'projects-page', jobId: job.id });
  });
});
