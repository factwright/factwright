// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsPage, type JobsPageProps } from './JobsPage.tsx';
import { jobRows, NO_FILTERS } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

afterEach(cleanup);

const TODAY = localDate();

function page(overrides: Partial<JobsPageProps> = {}) {
  const jobs = sampleJobs();
  const props: JobsPageProps = {
    jobs: { state: 'ready', list: { jobs, readAt: null } },
    rows: jobRows(jobs, TODAY),
    today: TODAY,
    filter: { view: 'interviewing', query: '', needsYou: false, ...NO_FILTERS },
    onFilter: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    canStartClaude: true,
    onStartClaude: vi.fn(),
    canFindJobs: true,
    onFindJobs: vi.fn(),
    onOpenJourney: vi.fn(),
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
    expect(
      screen
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent?.replace(/\s+/g, ' ')),
    ).toEqual(['To review 2', 'To apply 2', 'Applied 2', 'Interviewing 3', 'Closed 3', 'All 12']);
    const list = screen.getByRole('list', { name: 'Jobs' });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
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
    expect(props.onFilter).toHaveBeenCalledWith(expect.objectContaining({ view: 'closed' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Needs you' }));
    expect(props.onFilter).toHaveBeenCalledWith(expect.objectContaining({ needsYou: true }));
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
    const props = page({
      filter: { view: 'applied', query: 'zebra', needsYou: false, ...NO_FILTERS },
    });
    expect(screen.getByText('No jobs match “zebra”')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show all in Applied' }));
    expect(props.onFilter).toHaveBeenCalledWith({
      view: 'applied',
      query: '',
      needsYou: false,
      ...NO_FILTERS,
    });
  });

  it('shows each interview’s calls so far, and which search found each job to review', () => {
    page();
    const northwind = screen.getByRole('button', { name: /^Northwind Labs/ });
    expect(northwind.textContent).toContain('Screen (done)');
    expect(northwind.textContent).toContain('Panel');
    cleanup();
    page({ filter: { view: 'review', query: '', needsYou: false, ...NO_FILTERS } });
    expect(screen.getByRole('button', { name: /^Copperleaf Energy/ }).textContent).toContain(
      'HN October 2026',
    );
    expect(screen.getByRole('button', { name: /^Bluewave Staffing/ }).textContent).toMatch(
      /LinkedIn \w{3} \d+/,
    );
  });

  it('keeps showing a search that’s picked once nothing is left in it, to clear it', async () => {
    const props = page({
      filter: { view: 'all', query: '', needsYou: false, ...NO_FILTERS, found: 'search:gone-run' },
    });
    const menu = screen.getByRole('combobox', { name: 'Found by' }) as HTMLSelectElement;
    expect(menu.selectedOptions[0]?.textContent).toBe('gone-run (0)');
    await userEvent.selectOptions(menu, 'Found anywhere');
    expect(props.onFilter).toHaveBeenCalledWith(expect.objectContaining({ found: null }));
  });

  it('narrows the list to one search’s jobs', async () => {
    const props = page({ filter: { view: 'all', query: '', needsYou: false, ...NO_FILTERS } });
    const menu = screen.getByRole('combobox', { name: 'Found by' });
    const options = within(menu)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options[0]).toBe('Found anywhere');
    expect(options).toContain('HN October 2026 (10)');
    expect(options.some((option) => /^LinkedIn \w{3} \d+ \(2\)$/.test(option ?? ''))).toBe(true);
    await userEvent.selectOptions(menu, 'HN October 2026 (10)');
    expect(props.onFilter).toHaveBeenCalledWith(
      expect.objectContaining({ found: 'search:2026-10-hn-whos-hiring' }),
    );
  });

  it('offers to start Claude before there are any jobs', async () => {
    const props = page({ jobs: { state: 'ready', list: { jobs: [], readAt: null } }, rows: [] });
    expect(screen.getByText('No jobs yet')).toBeTruthy();
    expect(screen.queryByText('0 jobs')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start Claude' }));
    expect(props.onStartClaude).toHaveBeenCalled();
  });

  it('points a new user to getting started before there are any jobs', async () => {
    const onGetStarted = vi.fn();
    page({ jobs: { state: 'ready', list: { jobs: [], readAt: null } }, rows: [], onGetStarted });
    expect(screen.getByText(/Tell Factwright about yourself first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start Claude' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onGetStarted).toHaveBeenCalledOnce();
  });

  it('starts a job search when Claude can take one', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: 'Find jobs' }));
    expect(props.onFindJobs).toHaveBeenCalledOnce();
    cleanup();
    page({
      canFindJobs: false,
      jobs: { state: 'ready', list: { jobs: [], readAt: null } },
      rows: [],
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Find jobs' }).disabled).toBe(
      true,
    );
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
