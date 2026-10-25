// @vitest-environment jsdom
import { type Job, localDate } from '@factwright/core';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import { JobsPage, type JobsPageProps } from './JobsPage.tsx';
import { jobRows, type ListFilter, NO_FILTERS } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';
import { sampleTracker } from './sample-tracker.ts';

afterEach(() => {
  cleanup();
  // Whether the jobs set aside were open, kept for next time.
  localStorage.clear();
});

const TODAY = localDate();

const apiStub = () =>
  ({
    updateJobs: vi.fn(async () => ({ ok: true as const })),
    undoStatusChange: vi.fn(async () => ({ ok: true as const })),
  }) as unknown as FactwrightApi;

const view = (name: ListFilter['view']): ListFilter => ({
  view: name,
  query: '',
  needsYou: false,
  ...NO_FILTERS,
});

/** The jobs page on the sample tracker, which keeps what's changed, as the real one does. */
function Live({ start }: { start: ListFilter['view'] }) {
  const [api] = useState(() => sampleTracker(null) as unknown as FactwrightApi);
  const [jobs, setJobs] = useState<Job[]>(() => sampleJobs());
  useEffect(() => api.onJobsChanged((list) => setJobs(list.jobs)), [api]);
  const [filter, setFilter] = useState(view(start));
  return (
    <JobsPage
      jobs={{ state: 'ready', list: { jobs, readAt: null } }}
      api={api}
      rows={jobRows(jobs, TODAY)}
      today={TODAY}
      filter={filter}
      onFilter={setFilter}
      selectedId={null}
      onSelect={() => {}}
      onRetry={() => {}}
      canStartClaude
      onStartClaude={() => {}}
      canFindJobs
      onFindJobs={() => {}}
      onOpenJourney={() => {}}
    />
  );
}

function page(overrides: Partial<JobsPageProps> = {}) {
  const jobs = sampleJobs();
  const props: JobsPageProps = {
    jobs: { state: 'ready', list: { jobs, readAt: null } },
    api: apiStub(),
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
    expect(screen.getByText('19 jobs')).toBeTruthy();
    expect(screen.getByText('In play')).toBeTruthy();
    expect(
      screen
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent?.replace(/\s+/g, ' ')),
    ).toEqual([
      'New 3',
      'To review 3',
      'To apply 2',
      'Applied 2',
      'Interviewing 3',
      'Closed 4',
      'All 19',
    ]);
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
    await userEvent.click(screen.getByRole('radio', { name: 'Closed 4' }));
    expect(props.onFilter).toHaveBeenCalledWith(expect.objectContaining({ view: 'closed' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Needs you' }));
    expect(props.onFilter).toHaveBeenCalledWith(expect.objectContaining({ needsYou: true }));
  });

  it('sorts by a column’s heading: its own way, the other way, then back', async () => {
    const onSort = vi.fn();
    const names = () =>
      within(screen.getByRole('list', { name: 'Jobs' }))
        .getAllByRole('button')
        .map((row) => row.textContent);
    page({ onSort });
    await userEvent.click(screen.getByRole('button', { name: 'Sort by fit' }));
    expect(onSort).toHaveBeenLastCalledWith({ by: 'fit', reversed: false });
    cleanup();
    page({ onSort, sort: { by: 'fit', reversed: false } });
    const sorted = names();
    await userEvent.click(screen.getByRole('button', { name: 'Fit, sorted best fit first' }));
    expect(onSort).toHaveBeenLastCalledWith({ by: 'fit', reversed: true });
    cleanup();
    page({ onSort, sort: { by: 'fit', reversed: true } });
    expect(names()).toEqual([...sorted].reverse());
    await userEvent.click(screen.getByRole('button', { name: 'Fit, sorted lowest fit first' }));
    expect(onSort).toHaveBeenLastCalledWith(null);
  });

  it('keeps a heading for every column, with the day each job was found or saved', async () => {
    const onSort = vi.fn();
    page({ onSort, filter: view('new') });
    expect(
      screen
        .getAllByRole('button', { name: /^Sort by/ })
        .map((heading) => heading.getAttribute('aria-label')),
    ).toEqual([
      'Sort by job',
      'Sort by status',
      'Sort by fit',
      'Sort by pay',
      'Sort by next step',
      'Sort by added',
    ]);
    const added = screen.getByRole('button', { name: /^Bluewave Staffing/ });
    expect(added.textContent).toMatch(/Added [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
    await userEvent.click(screen.getByRole('button', { name: 'Sort by added' }));
    expect(onSort).toHaveBeenLastCalledWith({ by: 'added', reversed: false });
    cleanup();
    page({ onSort, filter: view('new'), sort: { by: 'added', reversed: false } });
    expect(screen.getByRole('button', { name: 'Added, sorted newest first' })).toBeTruthy();
    // The newest saved first: Bluewave a day ago, Copperleaf two, Granite three.
    expect(
      within(screen.getByRole('list', { name: 'Jobs' }))
        .getAllByRole('button')
        .map((row) => row.textContent?.split('Added ')[0]?.slice(0, 10)),
    ).toEqual(['Bluewave S', 'Copperleaf', 'Granite He']);
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

  it('shows each interview’s calls so far, and which search found each new job', () => {
    page();
    const northwind = screen.getByRole('button', { name: /^Northwind Labs/ });
    expect(northwind.textContent).toContain('Screen (done)');
    expect(northwind.textContent).toContain('Panel');
    cleanup();
    page({ filter: view('new') });
    expect(screen.getByRole('button', { name: /^Copperleaf Energy/ }).textContent).toContain(
      'HN October 2026',
    );
    expect(screen.getByRole('button', { name: /^Bluewave Staffing/ }).textContent).toMatch(
      /LinkedIn \w{3} \d+/,
    );
    cleanup();
    // A job passed on that a later search found again says so, in any view.
    page({ filter: view('closed') });
    expect(screen.getByRole('button', { name: /^Orchard Health/ }).textContent).toMatch(
      /Found again · LinkedIn \w{3} \d+/,
    );
    expect(screen.getByRole('button', { name: /^Meridian Freight/ }).textContent).not.toContain(
      'HN October 2026',
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

  it('narrows to one kind of job, with its numbers, for a user who wants more than one', async () => {
    const kinds = [
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ];
    const rows = jobRows(sampleJobs(), TODAY, kinds);
    const props = page({ rows, kinds, filter: view('all') });
    const menu = screen.getByRole('combobox', { name: 'Kind of job' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every kind of job', 'Developer (16)', 'Project manager (3)']);
    // While every kind shows, each job says which it's under.
    expect(screen.getByRole('button', { name: /^Fernway/ }).textContent).toContain(
      'Project manager',
    );
    await userEvent.selectOptions(menu, 'Project manager (3)');
    expect(props.onFilter).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'project-manager' }),
    );
    cleanup();
    page({ rows, kinds, filter: { ...view('all'), kind: 'project-manager' } });
    expect(screen.getByText('3 of 19 jobs')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Jobs' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent?.includes('Project manager')),
    ).toEqual([false, false, false]);
    // The numbers above are that kind's, and so is where its jobs came from.
    // Fernway's offer is the one project manager job in play.
    expect(screen.getByText('In play').parentElement?.textContent).toBe(
      'In play11 interviewing · 0 calls ahead',
    );
    expect(
      within(screen.getByRole('combobox', { name: 'Found by' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toContain('HN October 2026 (3)');
  });

  it('keeps the name of a search picked for another kind of job, to clear it', () => {
    const kinds = [
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ];
    const run = {
      folder: '2026-10-12-hn-project-manager',
      source: 'HN · Project manager',
      date: null,
    };
    const jobs = sampleJobs().map((job) =>
      job.company === 'Fernway' ? { ...job, searches: [run] } : job,
    );
    page({
      rows: jobRows(jobs, TODAY, kinds),
      kinds,
      filter: { ...view('all'), kind: 'developer', found: `search:${run.folder}` },
    });
    const menu = screen.getByRole('combobox', { name: 'Found by' }) as HTMLSelectElement;
    expect(menu.selectedOptions[0]?.textContent).toBe('HN · Project manager (0)');
  });

  it('shows no kinds of job with one', () => {
    page({ filter: view('all') });
    expect(screen.queryByRole('combobox', { name: 'Kind of job' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Fernway/ }).textContent).not.toContain(
      'Project manager',
    );
  });

  it('narrows the list to one search’s jobs', async () => {
    const props = page({ filter: { view: 'all', query: '', needsYou: false, ...NO_FILTERS } });
    const menu = screen.getByRole('combobox', { name: 'Found by' });
    const options = within(menu)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options[0]).toBe('Found anywhere');
    expect(options).toContain('HN October 2026 (16)');
    expect(options.some((option) => /^LinkedIn \w{3} \d+ \(4\)$/.test(option ?? ''))).toBe(true);
    await userEvent.selectOptions(menu, 'HN October 2026 (16)');
    expect(props.onFilter).toHaveBeenCalledWith(
      expect.objectContaining({ found: 'search:2026-10-hn-whos-hiring' }),
    );
  });

  it('folds the jobs set aside at the bottom of To review, outside its count', async () => {
    page({ filter: view('review') });
    const list = screen.getByRole('list', { name: 'Jobs' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((row) => row.textContent),
    ).toEqual([
      // Back from later today, so up at the top.
      expect.stringMatching(/^Pinecrest Software.*Back from Later/),
      expect.stringMatching(/^Acme Robotics/),
      expect.stringMatching(/^Wavelength Audio/),
    ]);
    const later = screen.getByRole('button', { name: /^Later 2/ });
    expect(later.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Set aside for later' })).toBeNull();
    await userEvent.click(later);
    const aside = screen.getByRole('list', { name: 'Set aside for later' });
    expect(
      within(aside)
        .getAllByRole('button')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringMatching(/^Ridgeline Analytics.*Back /),
      expect.stringMatching(/^Saltmarsh Games/),
    ]);
  });

  it('says To review is done when only jobs set aside are left', () => {
    const jobs = sampleJobs().filter(
      (job) => job.status === 'later' && job.company !== 'Pinecrest Software',
    );
    page({
      jobs: { state: 'ready', list: { jobs, readAt: null } },
      rows: jobRows(jobs, TODAY),
      filter: view('review'),
    });
    expect(screen.getByRole('radio', { name: 'To review 0' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Jobs' })).toBeNull();
    expect(screen.getByText('Nothing to review. The rest are set aside.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Later 2/ })).toBeTruthy();
  });

  it('selects jobs, one or a run with Shift, and moves them all at once', async () => {
    const props = page({ filter: view('new') });
    const box = (name: RegExp) => screen.getByRole('checkbox', { name });
    await userEvent.click(box(/^Select Bluewave Staffing/));
    expect(screen.getByRole('region', { name: 'Selected jobs' }).textContent).toContain(
      '1 job selected',
    );
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(box(/^Select Granite Health/));
    await user.keyboard('{/Shift}');
    const bar = screen.getByRole('region', { name: 'Selected jobs' });
    expect(bar.textContent).toContain('3 jobs selected');
    // The count is a live region from the start, so what a move did is read aloud.
    const live = within(bar).getByRole('status');
    expect(live.textContent).toBe('3 jobs selected');
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['To review', 'To apply', 'Later', 'Pass', 'Clear']);
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    await userEvent.click(within(bar).getByRole('button', { name: 'To review' }));
    expect(props.api.updateJobs).toHaveBeenCalledWith(
      [
        'bluewave-staffing--senior-engineer',
        'copperleaf-energy--principal-engineer',
        'granite-health--staff-software-engineer',
      ],
      { status: 'review' },
    );
    expect(screen.getByRole('status').textContent).toBe('Moved 3 jobs to To review.');
    expect(screen.getByRole('status')).toBe(live);
    expect(screen.queryByRole('region', { name: 'Selected jobs' })).toBeNull();
  });

  it('selects every job in the view at once, and moves them anywhere', async () => {
    const props = page({ filter: view('applied') });
    const all = screen.getByRole('checkbox', { name: 'Select every job in Applied' });
    await userEvent.click(all);
    const bar = screen.getByRole('region', { name: 'Selected jobs' });
    expect(bar.textContent).toContain('2 jobs selected');
    // After applying, the quick choices give way to the menu of every status.
    expect(within(bar).queryByRole('button', { name: 'Pass' })).toBeNull();
    await userEvent.selectOptions(
      within(bar).getByRole('combobox', { name: 'Move the selected jobs to' }),
      'No reply',
    );
    expect(props.api.updateJobs).toHaveBeenCalledWith(
      ['lumen-health--senior-full-stack-engineer', 'harbor-and-pine--senior-engineer-payments'],
      { status: 'ghosted' },
    );
    cleanup();
    page({ filter: view('applied') });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every job in Applied' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Selected jobs' })).toBeNull();
  });

  it('moves only the selected jobs not there already, so Undo leaves the others be', async () => {
    const props = page({ filter: view('all') });
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Lumen Health/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Acme Robotics/ }));
    const menu = screen.getByRole('combobox', { name: 'Move the selected jobs to' });
    await userEvent.selectOptions(menu, 'Applied');
    expect(props.api.updateJobs).toHaveBeenCalledWith(
      ['acme-robotics--staff-engineer-developer-tools'],
      { status: 'applied' },
    );
    expect(screen.getByRole('status').textContent).toBe('Moved 1 job to Applied.');
    // With every one there already, nothing moves.
    vi.mocked(props.api.updateJobs).mockClear();
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Lumen Health/ }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Move the selected jobs to' }),
      'Applied',
    );
    expect(props.api.updateJobs).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Selected jobs' })).toBeNull();
  });

  it('passes on several jobs, asks why, and undoes it', async () => {
    render(<Live start="new" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every job in New' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pass' }));
    // They've left New, and the bar asks why, with the keyboard's focus on the first reason.
    expect(await screen.findByText('Passed on 3 jobs.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'New 0' })).toBeTruthy();
    const why = screen.getByRole('group', { name: 'Why you passed' });
    expect(document.activeElement).toBe(within(why).getByRole('button', { name: 'Pay' }));
    await userEvent.click(within(why).getByRole('button', { name: 'Pay' }));
    expect(within(why).getByRole('button', { name: 'Pay' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(screen.getByRole('radio', { name: 'New 3' })).toBeTruthy();
    expect(screen.queryByText('Passed on 3 jobs.')).toBeNull();
  });

  it('sets aside again the jobs back from later, and Undo brings back their day', async () => {
    render(<Live start="review" />);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Pinecrest Software/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Acme Robotics/ }));
    const bar = screen.getByRole('region', { name: 'Selected jobs' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Later' }));
    expect(await screen.findByText('Set 2 jobs aside.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'To review 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Later 4/ })).toBeTruthy();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(screen.getByRole('radio', { name: 'To review 3' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Pinecrest Software.*Back from Later/ }),
    ).toBeTruthy();
    // Undo closed the bar, and the keyboard's focus went back to the list.
    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: 'Select every job in To review' }),
    );
  });

  it('keeps what a bulk move did when part of it fails, with Undo', async () => {
    const api = {
      updateJobs: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, message: 'That job isn’t in your tracker anymore.' }),
      undoStatusChange: vi.fn(async () => ({ ok: true as const })),
    } as unknown as FactwrightApi;
    page({ filter: view('review'), api });
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Pinecrest Software/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Acme Robotics/ }));
    const bar = screen.getByRole('region', { name: 'Selected jobs' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Later' }));
    expect(screen.getByRole('status').textContent).toBe('Set 1 job aside.');
    expect(screen.getByRole('alert').textContent).toBe('That job isn’t in your tracker anymore.');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('forgets what was picked once the view changes, even on coming back', async () => {
    const props = (name: ListFilter['view']): JobsPageProps => ({
      jobs: { state: 'ready', list: { jobs: sampleJobs(), readAt: null } },
      api: apiStub(),
      rows: jobRows(sampleJobs(), TODAY),
      today: TODAY,
      filter: view(name),
      onFilter: () => {},
      selectedId: null,
      onSelect: () => {},
      onRetry: () => {},
      canStartClaude: true,
      onStartClaude: () => {},
      canFindJobs: true,
      onFindJobs: () => {},
      onOpenJourney: () => {},
    });
    const { rerender } = render(<JobsPage {...props('new')} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Bluewave Staffing/ }));
    expect(screen.getByRole('region', { name: 'Selected jobs' })).toBeTruthy();
    rerender(<JobsPage {...props('review')} />);
    expect(screen.queryByRole('region', { name: 'Selected jobs' })).toBeNull();
    rerender(<JobsPage {...props('new')} />);
    expect(screen.queryByRole('region', { name: 'Selected jobs' })).toBeNull();
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
