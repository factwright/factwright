// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import { ProjectsPageSection, readPageOutline } from './ProjectsPageSection.tsx';
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
  } as unknown as FactwrightApi & { openFile: Mock<FactwrightApi['openFile']> };
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

describe('ProjectsPageSection', () => {
  it('shows what’s on the page and its files, to preview and open', async () => {
    const api = apiStub();
    const { container } = render(<ProjectsPageSection job={job} api={api} today={TODAY} />);
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
  });

  it('says when Claude is still making it, and shows nothing for a job without one', async () => {
    render(<ProjectsPageSection job={job} api={apiStub()} today={TODAY} making />);
    expect(await screen.findByText('Being made')).toBeTruthy();
    expect(screen.getByText('Your Claude is still making and checking this page.')).toBeTruthy();
    cleanup();
    const { container } = render(
      <ProjectsPageSection
        job={{ ...job, docKinds: [], projectPages: [] }}
        api={apiStub()}
        today={TODAY}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
