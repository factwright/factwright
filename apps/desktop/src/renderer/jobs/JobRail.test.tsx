// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobRail } from './JobRail.tsx';
import { jobRows, type ListFilter, type ListSort, NO_FILTERS } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

afterEach(cleanup);

const TODAY = localDate();
const rows = jobRows(sampleJobs(), TODAY);

function rail(
  view: ListFilter['view'],
  sort: ListSort | null = null,
  selectedId: string | null = null,
) {
  const onFilter = vi.fn();
  const onSelect = vi.fn();
  const filter: ListFilter = { view, query: '', needsYou: false, ...NO_FILTERS };
  const shown = render(
    <JobRail
      rows={rows}
      kinds={[]}
      today={TODAY}
      filter={filter}
      onFilter={onFilter}
      sort={sort}
      selectedId={selectedId}
      onSelect={onSelect}
    />,
  );
  return { ...shown, filter, onFilter, onSelect };
}

const listed = (name = 'Jobs') =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('button')
    .map((row) => row.querySelector('span')?.textContent);

describe('JobRail', () => {
  it('lists the view’s jobs, each with its next step, and picks one', async () => {
    const fernway = rows.find((row) => row.job.company === 'Fernway');
    const { container, onSelect } = rail('interviewing', null, fernway?.job.id);
    expect(screen.getByRole('navigation', { name: 'Job list' })).toBeTruthy();
    expect(listed()).toEqual(['Fernway', 'Northwind Labs', 'Tidewater Analytics']);
    const picked = screen.getByRole('button', { current: true });
    expect(picked.textContent).toContain('Overdue: Reply to the offer');
    await userEvent.click(screen.getByRole('button', { name: /^Tidewater Analytics/ }));
    expect(onSelect).toHaveBeenCalledWith(
      rows.find((row) => row.job.company === 'Tidewater Analytics')?.job.id,
    );
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it('follows the list’s sort, and moves between jobs with the arrow keys', async () => {
    rail('interviewing', { by: 'job', reversed: true });
    expect(listed()).toEqual(['Tidewater Analytics', 'Northwind Labs', 'Fernway']);
    const buttons = within(screen.getByRole('list', { name: 'Jobs' })).getAllByRole('button');
    buttons[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('picks another view, with how many jobs each holds', async () => {
    const { onFilter, filter } = rail('interviewing');
    const views = screen.getByRole('combobox', { name: 'View' }) as HTMLSelectElement;
    expect([...views.options].map((option) => option.textContent)).toEqual([
      'New (3)',
      'To review (3)',
      'To apply (2)',
      'Applied (2)',
      'Interviewing (3)',
      'Closed (4)',
      'All (19)',
    ]);
    await userEvent.selectOptions(views, 'closed');
    expect(onFilter).toHaveBeenCalledWith({ ...filter, view: 'closed' });
  });

  it('keeps every other choice behind Filters, “Needs you” among them', async () => {
    const { onFilter, filter } = rail('all');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('region', { name: 'Filters' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Needs you' }));
    expect(onFilter).toHaveBeenCalledWith({ ...filter, needsYou: true });
    cleanup();
    render(
      <JobRail
        rows={rows}
        kinds={[]}
        today={TODAY}
        filter={{ ...filter, needsYou: true, tiers: ['strong'] }}
        onFilter={onFilter}
        sort={null}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeTruthy();
  });

  it('ends To review with the jobs set aside', () => {
    rail('review');
    expect(listed('Set aside for later').length).toBeGreaterThan(0);
    expect(screen.getByText('Set aside for later', { selector: 'p' })).toBeTruthy();
  });
});
