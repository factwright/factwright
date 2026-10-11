// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsPage, type JobsPageProps } from './JobsPage.tsx';
import { jobRows } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

afterEach(cleanup);

const TODAY = localDate();

function page(overrides: Partial<JobsPageProps> = {}) {
  const jobs = sampleJobs();
  const props: JobsPageProps = {
    jobs: { state: 'ready', list: { jobs, readAt: null } },
    rows: jobRows(jobs, TODAY),
    today: TODAY,
    filter: { view: 'active', query: '', needsYou: false },
    onFilter: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    canStartClaude: true,
    onStartClaude: vi.fn(),
    ...overrides,
  };
  render(<JobsPage {...props} />);
  return props;
}

describe('JobsPage', () => {
  it('shows the stats, the views and the jobs', async () => {
    const { container } = render(<div />);
    page();
    expect(screen.getByText('12 jobs')).toBeTruthy();
    expect(screen.getByText('In play')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Active 7' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Jobs' });
    expect(within(list).getAllByRole('button')).toHaveLength(7);
    expect(
      screen.getByRole('button', { name: /Fernway.*Overdue: Reply to the offer/ }),
    ).toBeTruthy();
    const results = await axe.run(container.parentElement ?? document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('picks a job, a view, and "Needs you"', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: /^Northwind Labs/ }));
    expect(props.onSelect).toHaveBeenCalledWith(
      'northwind-labs--senior-software-engineer-platform',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Closed 3' }));
    expect(props.onFilter).toHaveBeenCalledWith({ view: 'closed', query: '', needsYou: false });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Needs you' }));
    expect(props.onFilter).toHaveBeenCalledWith({ view: 'active', query: '', needsYou: true });
  });

  it('moves between jobs with the arrow keys', async () => {
    page();
    const rows = within(screen.getByRole('list', { name: 'Jobs' })).getAllByRole('button');
    rows[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(rows.at(-1));
  });

  it('says when nothing matches, with a way back', async () => {
    const props = page({ filter: { view: 'active', query: 'zebra', needsYou: false } });
    expect(screen.getByText('No jobs match “zebra”')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show all in Active' }));
    expect(props.onFilter).toHaveBeenCalledWith({ view: 'active', query: '', needsYou: false });
  });

  it('offers to start Claude before there are any jobs', async () => {
    const props = page({ jobs: { state: 'ready', list: { jobs: [], readAt: null } }, rows: [] });
    expect(screen.getByText('No jobs yet')).toBeTruthy();
    expect(screen.queryByText('0 jobs')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start Claude' }));
    expect(props.onStartClaude).toHaveBeenCalled();
  });

  it('shows loading, and a way to try again when loading fails', async () => {
    page({ jobs: { state: 'loading' }, rows: [] });
    expect(screen.getByRole('status').textContent).toBe('Loading your jobs…');
    cleanup();
    const props = page({ jobs: { state: 'failed' }, rows: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
