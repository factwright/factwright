import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard.tsx';
import { job, vaultOf } from './testing.ts';

const TODAY = '2026-10-10';

const VAULT = vaultOf([
  job({
    id: 'acme--staff',
    company: 'Acme Robotics',
    status: 'applied',
    statusOn: '2026-10-09',
    appliedOn: '2026-10-09',
    pay: { text: '$185k–$215k', min: 185_000, max: 215_000, source: 'listed' },
    notes: [{ id: 'n1', on: '2026-10-09', text: 'Recruiter: Sam Lee', at: '2026-10-09T17:00Z' }],
  }),
  job({
    id: 'birch--lead',
    company: 'Birch Health',
    role: 'Engineering Lead',
    status: 'screen',
    statusOn: '2026-10-08',
    appliedOn: '2026-10-01',
    nextAction: 'Send references',
    nextOn: '2026-10-07',
  }),
  job({ id: 'cobalt--senior', company: 'Cobalt', role: 'Senior Engineer' }),
]);

afterEach(() => {
  // The kind of job picked, kept until the tab closes.
  sessionStorage.clear();
});

const shownCompanies = () =>
  within(screen.getByRole('list', { name: 'Jobs' }))
    .getAllByRole('link')
    .map((link) => link.querySelector('span span')?.textContent);

describe('the jobs page on the phone', () => {
  it('shows the numbers that matter, then the jobs furthest along, most pressing first', async () => {
    const { container } = render(
      <Dashboard vault={VAULT} today={TODAY} refreshing={false} onRefresh={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeTruthy();
    expect(screen.getByText('Needs you')).toBeTruthy();
    expect(screen.getByText('1 overdue')).toBeTruthy();
    expect(
      (screen.getByRole('radio', { name: 'Interviewing 1' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(shownCompanies()).toEqual(['Birch Health']);
    expect(screen.getByText('Overdue: Send references')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('switches views, and searches', async () => {
    render(<Dashboard vault={VAULT} today={TODAY} refreshing={false} onRefresh={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Applied 1' }));
    expect(shownCompanies()).toEqual(['Acme Robotics']);
    expect(screen.getByText('$185k–$215k')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'New 1' }));
    expect(shownCompanies()).toEqual(['Cobalt']);

    await userEvent.click(screen.getByRole('radio', { name: 'All 3' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'sam lee');
    expect(shownCompanies()).toEqual(['Acme Robotics']);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), ' nobody');
    expect(screen.getByText('No jobs here match that search.')).toBeTruthy();
  });

  it('folds the jobs set aside at the bottom of To review', async () => {
    const vault = vaultOf([
      job({ id: 'kite--staff', company: 'Kite', role: 'Staff Engineer', status: 'review' }),
      job({ id: 'lark--staff', company: 'Lark', role: 'Staff Engineer', status: 'later' }),
    ]);
    render(<Dashboard vault={vault} today={TODAY} refreshing={false} onRefresh={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'To review 1' }));
    expect(shownCompanies()).toEqual(['Kite']);
    const later = screen.getByText('Later', { selector: 'summary' }).closest('details');
    if (!later) throw new Error('No folded group');
    expect(later.open).toBe(false);
    expect(within(later).getByRole('list', { name: 'Set aside for later' }).textContent).toContain(
      'Lark',
    );
  });

  it('narrows to one kind of job, numbers and all, and keeps it on coming back', async () => {
    const vault = {
      ...VAULT,
      kinds: [
        { id: 'developer', name: 'Developer' },
        { id: 'project-manager', name: 'Project manager' },
      ],
      jobs: VAULT.jobs.map((each) =>
        each.id === 'birch--lead' ? { ...each, kindFound: 'project-manager' } : each,
      ),
    };
    const { container, unmount } = render(
      <Dashboard vault={vault} today={TODAY} refreshing={false} onRefresh={vi.fn()} />,
    );
    const menu = screen.getByRole('combobox', { name: 'Kind of job' }) as HTMLSelectElement;
    expect([...menu.options].map((option) => option.textContent)).toEqual([
      'Every kind of job',
      'Developer (2)',
      'Project manager (1)',
    ]);
    // While every kind shows, each job says which it's under.
    expect(screen.getByRole('link', { name: /Birch Health/ }).textContent).toContain(
      'Project manager',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.selectOptions(menu, 'Developer (2)');
    expect(screen.getByRole('radio', { name: 'Interviewing 0' })).toBeTruthy();
    expect(screen.getByText('All caught up')).toBeTruthy();
    unmount();
    render(<Dashboard vault={vault} today={TODAY} refreshing={false} onRefresh={vi.fn()} />);
    expect((screen.getByRole('combobox', { name: 'Kind of job' }) as HTMLSelectElement).value).toBe(
      'developer',
    );
    // It opens on the furthest view that kind has jobs in.
    expect((screen.getByRole('radio', { name: 'Applied 1' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(shownCompanies()).toEqual(['Acme Robotics']);
  });

  it('shows no kinds of job with one', () => {
    render(<Dashboard vault={VAULT} today={TODAY} refreshing={false} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Kind of job' })).toBeNull();
  });

  it('opens a job on its own page', async () => {
    render(<Dashboard vault={VAULT} today={TODAY} refreshing={false} onRefresh={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Applied 1' }));
    await userEvent.click(screen.getByRole('link', { name: /Acme Robotics/ }));
    // The address names the job by a code, never by its company and role.
    expect(location.pathname).toBe(`/jobs/${VAULT.pages.get('acme--staff')}`);
    expect(location.pathname).not.toContain('acme');
  });

  it('updates when asked, and says so while it does', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <Dashboard vault={VAULT} today={TODAY} refreshing={false} onRefresh={onRefresh} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<Dashboard vault={VAULT} today={TODAY} refreshing onRefresh={onRefresh} />);
    expect((screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('says when nothing has synced yet', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <Dashboard vault={vaultOf([])} today={TODAY} refreshing={false} onRefresh={onRefresh} />,
    );
    expect(screen.getByText('No jobs yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
