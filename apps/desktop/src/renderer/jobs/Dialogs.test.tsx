// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import { AddJobDialog } from './AddJobDialog.tsx';
import { FiltersPanel } from './FiltersPanel.tsx';
import { FindJobsDialog } from './FindJobsDialog.tsx';
import { JourneyDialog } from './JourneyDialog.tsx';
import { jobRows, type ListFilter, NO_FILTERS } from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

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
  // What the dialogs remember for next time, such as the places a search looked.
  localStorage.clear();
});

describe('FiltersPanel', () => {
  function Harness({ onFilter }: { onFilter: (filter: ListFilter) => void }) {
    const [filter, setFilter] = useState<ListFilter>({
      view: 'applied',
      query: '',
      needsYou: false,
      ...NO_FILTERS,
    });
    return (
      <FiltersPanel
        filter={filter}
        onFilter={(next) => {
          setFilter(next);
          onFilter(next);
        }}
      />
    );
  }

  it('opens, filters, counts, and clears', async () => {
    const onFilter = vi.fn();
    const { container } = render(<Harness onFilter={onFilter} />);
    const button = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Filters' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Strong' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Not scored' }));
    fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Pays at least' }), {
      target: { value: '150' },
    });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Has a resume' }));
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Show archived jobs' }));
    expect(onFilter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tiers: ['strong', 'none'],
        minPay: 150_000,
        hasResume: true,
        showArchived: true,
      }),
    );
    expect(screen.getByRole('button', { name: 'Filters · 5' })).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear filters' }));
    expect(onFilter).toHaveBeenLastCalledWith(expect.objectContaining(NO_FILTERS));
  });

  it('closes with Escape, Done, or a click elsewhere', async () => {
    render(
      <>
        <Harness onFilter={() => {}} />
        <p>Elsewhere</p>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Filters' })).toBeNull();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: 'Filters' })).toBeNull();
    await userEvent.click(button);
    await userEvent.click(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('region', { name: 'Filters' })).toBeNull();
  });
});

describe('AddJobDialog', () => {
  it('adds a job, starting in the company field', async () => {
    const addJob = vi.fn(async () => ({
      ok: true as const,
      jobId: 'fernhill-labs--platform-engineer',
    }));
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddJobDialog
        api={{ addJob } as unknown as FactwrightApi}
        onAdded={onAdded}
        onClose={onClose}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Company' }));
    await userEvent.keyboard('Fernhill Labs');
    await userEvent.type(screen.getByRole('textbox', { name: 'Role' }), 'Platform Engineer');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Applied');
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith({
      company: 'Fernhill Labs',
      role: 'Platform Engineer',
      link: '',
      pay: '',
      status: 'applied',
      notes: '',
    });
    expect(onAdded).toHaveBeenCalledWith('fernhill-labs--platform-engineer', 'applied');
    expect(onClose).toHaveBeenCalled();
  });

  it('says why a job couldn’t be added, and stays open', async () => {
    const addJob = vi.fn(async () => ({
      ok: false as const,
      message: 'Links start with https:// or http://.',
    }));
    const onClose = vi.fn();
    render(
      <AddJobDialog
        api={{ addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={onClose}
      />,
    );
    await userEvent.keyboard('Fernhill Labs');
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Links start with https:// or http://.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('JourneyDialog', () => {
  const rows = jobRows(sampleJobs(), TODAY);

  it('shows how far jobs got and how they ended', async () => {
    const { container } = render(
      <JourneyDialog rows={rows} api={{} as FactwrightApi} today={TODAY} onClose={() => {}} />,
    );
    const steps = screen.getByRole('list', { name: 'How far your jobs got' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Found12',
      'Checked10',
      'Resume built5',
      'Applied7',
      'Heard back4',
      'Interviewed2',
      'Offer1',
    ]);
    expect(screen.getByText('5 still in play')).toBeTruthy();
    expect(screen.getByText('1 rejected')).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('copies the flow chart and saves the spreadsheet', async () => {
    const copyText = vi.fn(async () => ({ ok: true as const }));
    const saveFile = vi.fn(async () => ({ ok: true as const, saved: true }));
    render(
      <JourneyDialog
        rows={rows}
        api={{ copyText, saveFile } as unknown as FactwrightApi}
        today={TODAY}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy for SankeyMATIC' }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Jobs found ['));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download as a spreadsheet' }));
    expect(saveFile).toHaveBeenCalledWith(
      `job-search-journey-${TODAY}.csv`,
      expect.stringContaining('Company,Role,Source'),
    );
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('draws every path the jobs took as a flow chart, and remembers that view', async () => {
    const { container, unmount } = render(
      <JourneyDialog rows={rows} api={{} as FactwrightApi} today={TODAY} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Flow chart' }));
    const chart = screen.getByRole('img', {
      name: 'How your jobs moved, from finding them to how they ended',
    });
    // Each step and ending a bar with its count, each path a band that says how many went.
    expect(chart.textContent).toContain('Found12');
    expect(chart.textContent).toContain('Not applied');
    expect(chart.querySelector('desc')?.textContent).toContain('Applied to Rejected: 1 job.');
    expect(chart.querySelectorAll('path').length).toBeGreaterThan(8);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    unmount();
    render(
      <JourneyDialog rows={rows} api={{} as FactwrightApi} today={TODAY} onClose={() => {}} />,
    );
    expect((screen.getByRole('radio', { name: 'Flow chart' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('keeps the button as it was when the user cancels saving', async () => {
    const saveFile = vi.fn(async () => ({ ok: true as const, saved: false }));
    render(
      <JourneyDialog
        rows={rows}
        api={{ saveFile } as unknown as FactwrightApi}
        today={TODAY}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download as a spreadsheet' }));
    expect(screen.getByRole('button', { name: 'Download as a spreadsheet' })).toBeTruthy();
  });
});

describe('FindJobsDialog', () => {
  it('starts on HN, and searches every place picked, with the month and a company', async () => {
    const onStart = vi.fn();
    const { container } = render(
      <FindJobsDialog today="2026-10-12" onStart={onStart} onClose={() => {}} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Find jobs' });
    expect(
      (within(dialog).getByRole('checkbox', { name: /^Hacker News/ }) as HTMLInputElement).checked,
    ).toBe(true);
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Which month’s thread' }),
      'September 2026',
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^LinkedIn/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Company job boards/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^A company/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'The company' }), 'Acme');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Search 4 places' }));
    expect(onStart).toHaveBeenCalledWith({
      sites: ['hn', 'linkedin', 'boards'],
      month: '2026-09',
      company: 'Acme',
    });
  });

  it('says how to name a company, and won’t search until it can', async () => {
    render(<FindJobsDialog today="2026-10-12" onStart={() => {}} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Hacker News/ }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Search' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /^A company/ }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'The company' }),
      'http://acme.example',
    );
    expect(
      screen.getByText('Type a company’s name, or a link that starts with https://.'),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Search' }).disabled).toBe(true);
    // Windows' command line would fill in what's between two % marks.
    const box = screen.getByRole('textbox', { name: 'The company' });
    await userEvent.clear(box);
    await userEvent.type(box, 'https://acme.example/jobs?team=a%20b');
    expect(
      screen.getByText(
        'A link with % or ! in it can’t be passed on. Type the company’s name instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Search' }).disabled).toBe(true);
  });

  it('remembers the places picked for next time', async () => {
    const { unmount } = render(
      <FindJobsDialog today="2026-10-12" onStart={() => {}} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /^Indeed/ }));
    unmount();
    render(<FindJobsDialog today="2026-10-12" onStart={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('checkbox', { name: /^Indeed/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Search 2 places' })).toBeTruthy();
  });
});
