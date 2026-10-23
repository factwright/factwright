// @vitest-environment jsdom
import { NO_HISTORY, type WorkHistory } from '@factwright/core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryStep } from './HistoryStep.tsx';

afterEach(cleanup);

/** Three positions at one company, newest first, then one somewhere else, and a school. */
const HISTORY: WorkHistory = {
  jobs: [
    {
      company: 'Tidewater Analytics',
      location: 'Denver, CO',
      positions: [
        {
          title: 'Director of Product',
          start: '2023-02',
          end: 'present',
          summary: 'Leads the product team.',
        },
        { title: 'Senior Product Manager', start: '2020-08', end: '2023-02', summary: '' },
        { title: 'Product Manager', start: '2018-05', end: '2020-08', summary: '' },
      ],
    },
    {
      company: 'Fernway',
      location: 'Remote',
      positions: [{ title: 'Analyst', start: '2016', end: '2018', summary: '' }],
    },
  ],
  schools: [
    {
      school: 'CU Boulder',
      degree: 'B.S.',
      field: 'Computer Science',
      start: '2012',
      end: '2016',
    },
  ],
};

/** The window's API for the work history, which keeps what it's given. */
const historyApi = () => ({ saveHistory: vi.fn(async (history: WorkHistory) => history) });

const valuesOf = (boxes: HTMLElement[]) => boxes.map((box) => (box as HTMLInputElement).value);

/** What was saved last. */
const lastSaved = (api: ReturnType<typeof historyApi>) => api.saveHistory.mock.lastCall?.[0];

describe('Work history and education, in Profile', () => {
  it('keeps several positions at one company apart, each with its own title and dates', () => {
    render(<HistoryStep history={HISTORY} api={historyApi()} />);
    const tidewater = screen.getByRole('group', { name: 'Tidewater Analytics' });
    expect(valuesOf(within(tidewater).getAllByRole('textbox', { name: 'Title' }))).toEqual([
      'Director of Product',
      'Senior Product Manager',
      'Product Manager',
    ]);
    expect(valuesOf(within(tidewater).getAllByRole('textbox', { name: 'Started' }))).toEqual([
      '2023-02',
      '2020-08',
      '2018-05',
    ]);
    const now = within(tidewater).getAllByRole('checkbox', { name: 'I hold this position now' });
    expect(now.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, false]);
    // The one held now has no end to type.
    const ended = within(tidewater).getAllByRole('textbox', { name: 'Ended' });
    expect(ended.map((box) => (box as HTMLInputElement).disabled)).toEqual([true, false, false]);
    expect(
      within(screen.getByRole('group', { name: 'CU Boulder' })).getByRole('textbox', {
        name: 'Field of study',
      }),
    ).toHaveProperty('value', 'Computer Science');
  });

  it('saves a change a moment after typing stops', async () => {
    const api = historyApi();
    render(<HistoryStep history={HISTORY} api={api} />);
    const tidewater = screen.getByRole('group', { name: 'Tidewater Analytics' });
    const second = within(tidewater).getAllByRole('textbox', { name: 'Title' })[1] as HTMLElement;
    await userEvent.clear(second);
    await userEvent.type(second, 'Group Product Manager');
    expect(api.saveHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(api.saveHistory).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(lastSaved(api)?.jobs[0]?.positions.map((each) => each.title)).toEqual([
      'Director of Product',
      'Group Product Manager',
      'Product Manager',
    ]);
  });

  it('marks a position held now, and ends it again', async () => {
    const api = historyApi();
    render(<HistoryStep history={HISTORY} api={api} />);
    const fernway = screen.getByRole('group', { name: 'Fernway' });
    await userEvent.click(
      within(fernway).getByRole('checkbox', { name: 'I hold this position now' }),
    );
    const ended = within(fernway).getByRole('textbox', { name: 'Ended' }) as HTMLInputElement;
    expect(ended.disabled).toBe(true);
    expect(ended.value).toBe('');
    await waitFor(() => expect(lastSaved(api)?.jobs[1]?.positions[0]?.end).toBe('present'), {
      timeout: 2000,
    });
    await userEvent.click(
      within(fernway).getByRole('checkbox', { name: 'I hold this position now' }),
    );
    await userEvent.type(ended, '2019');
    await waitFor(() => expect(lastSaved(api)?.jobs[1]?.positions[0]?.end).toBe('2019'), {
      timeout: 2000,
    });
  });

  it('keeps a date as it’s typed, and saves it blank until it reads', async () => {
    const api = historyApi();
    render(<HistoryStep history={HISTORY} api={api} />);
    const fernway = screen.getByRole('group', { name: 'Fernway' });
    const started = within(fernway).getByRole('textbox', { name: 'Started' });
    await userEvent.clear(started);
    await userEvent.type(started, '2015-1');
    expect(started).toHaveProperty('value', '2015-1');
    expect(started.getAttribute('aria-invalid')).toBe('true');
    expect(within(fernway).getByText('Type it as 2021-03, or 2021.')).toBeTruthy();
    await waitFor(() => expect(api.saveHistory).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastSaved(api)?.jobs[1]?.positions[0]?.start).toBe('');
    await userEvent.type(started, '1');
    expect(started.getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(lastSaved(api)?.jobs[1]?.positions[0]?.start).toBe('2015-11'), {
      timeout: 2000,
    });
  });

  it('adds and removes positions, companies and schools', async () => {
    const api = historyApi();
    render(<HistoryStep history={HISTORY} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a position at Fernway' }));
    const fernway = screen.getByRole('group', { name: 'Fernway' });
    const titles = within(fernway).getAllByRole('textbox', { name: 'Title' });
    expect(titles).toHaveLength(2);
    await userEvent.type(titles[1] as HTMLElement, 'Junior Analyst');
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Senior Product Manager”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a company' }));
    const added = screen.getByRole('group', { name: 'Company 3' });
    await userEvent.type(within(added).getByRole('textbox', { name: 'Company' }), 'Acme');
    expect(screen.getByRole('group', { name: 'Acme' })).toBe(added);
    await userEvent.type(within(added).getByRole('textbox', { name: 'Title' }), 'Intern');
    await userEvent.click(screen.getByRole('button', { name: 'Add a school' }));
    expect(screen.getByRole('group', { name: 'School 2' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove CU Boulder' }));
    await waitFor(() => expect(api.saveHistory).toHaveBeenCalled(), { timeout: 2000 });
    const saved = lastSaved(api);
    expect(saved?.jobs.map((job) => job.positions.map((each) => each.title))).toEqual([
      ['Director of Product', 'Product Manager'],
      ['Analyst', 'Junior Analyst'],
      ['Intern'],
    ]);
    // A school with no name yet waits until it has one.
    expect(saved?.schools).toEqual([]);
    expect(screen.getByRole('group', { name: 'School 1' })).toBeTruthy();
  });

  it('saves what’s waiting as the dialog closes', async () => {
    const api = historyApi();
    const view = render(<HistoryStep history={NO_HISTORY} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a company' }));
    const company = screen.getByRole('group', { name: 'Company 1' });
    await userEvent.type(within(company).getByRole('textbox', { name: 'Company' }), 'Acme');
    await userEvent.type(within(company).getByRole('textbox', { name: 'Title' }), 'Engineer');
    act(() => view.unmount());
    expect(api.saveHistory).toHaveBeenLastCalledWith({
      jobs: [
        {
          company: 'Acme',
          location: '',
          positions: [{ title: 'Engineer', start: '', end: '', summary: '' }],
        },
      ],
      schools: [],
    });
  });

  it('has no accessibility problems', async () => {
    const { container } = render(<HistoryStep history={HISTORY} api={historyApi()} />);
    const { violations } = await axe.run(container);
    expect(violations).toEqual([]);
  });
});
