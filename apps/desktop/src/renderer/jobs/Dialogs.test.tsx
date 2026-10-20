// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, SaveFocusResult } from '../../shared/api.ts';
import { AddJobDialog } from './AddJobDialog.tsx';
import { FiltersPanel } from './FiltersPanel.tsx';
import { FindJobsDialog } from './FindJobsDialog.tsx';
import { JourneyDialog } from './JourneyDialog.tsx';
import { MergeDialog } from './MergeDialog.tsx';
import { jobRows, type ListFilter, NO_FILTERS } from './rows.ts';
import { sampleDuplicate, sampleJobs } from './sample-jobs.ts';
import { WithdrawDialog } from './WithdrawDialog.tsx';

const TODAY = localDate();

const KINDS = [
  { id: 'developer', name: 'Developer' },
  { id: 'project-manager', name: 'Project manager' },
];

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

  it('keeps the kind of job picked when it clears the filters', async () => {
    const onFilter = vi.fn();
    render(
      <FiltersPanel
        filter={{
          view: 'all',
          query: '',
          needsYou: false,
          ...NO_FILTERS,
          kind: 'project-manager',
          hasResume: true,
        }}
        onFilter={onFilter}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filters · 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onFilter).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'project-manager', hasResume: false }),
    );
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
    expect(onAdded).toHaveBeenCalledWith('fernhill-labs--platform-engineer', 'applied', null);
    expect(onClose).toHaveBeenCalled();
    // With one kind of job, there's none to pick.
    expect(screen.queryByRole('combobox', { name: 'Kind of job' })).toBeNull();
  });

  it('puts the job under a kind of job, starting with the one the list shows', async () => {
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'fernhill-labs--tpm' }));
    const onAdded = vi.fn();
    const { container } = render(
      <AddJobDialog
        api={{ addJob } as unknown as FactwrightApi}
        kinds={KINDS}
        kind="project-manager"
        onAdded={onAdded}
        onClose={() => {}}
      />,
    );
    const menu = screen.getByRole('combobox', { name: 'Kind of job' }) as HTMLSelectElement;
    expect(menu.value).toBe('project-manager');
    await userEvent.keyboard('Fernhill Labs');
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'project-manager' }));
    expect(onAdded).toHaveBeenCalledWith('fernhill-labs--tpm', 'new', 'project-manager');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    cleanup();
    // With every kind showing, or one since removed, its fit check decides, unless the user picks.
    const addAgain = vi.fn(async () => ({ ok: true as const, jobId: 'kite--staff' }));
    const onAddedAgain = vi.fn();
    render(
      <AddJobDialog
        api={{ addJob: addAgain } as unknown as FactwrightApi}
        kinds={KINDS}
        kind="gone"
        onAdded={onAddedAgain}
        onClose={() => {}}
      />,
    );
    const open = screen.getByRole('combobox', { name: 'Kind of job' }) as HTMLSelectElement;
    expect(open.selectedOptions[0]?.textContent).toBe('Let its fit check decide');
    await userEvent.keyboard('Kite');
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addAgain.mock.calls[0]).toEqual([
      expect.not.objectContaining({ kind: expect.anything() }),
    ]);
    expect(onAddedAgain).toHaveBeenCalledWith('kite--staff', 'new', null);
  });

  it('starts a job at New, or wherever the user already is with it', () => {
    render(<AddJobDialog api={{} as FactwrightApi} onAdded={() => {}} onClose={() => {}} />);
    const menu = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement;
    expect(menu.value).toBe('new');
    expect([...menu.options].map((option) => option.textContent)).toEqual([
      'New',
      'To review',
      'To apply',
      'Applied',
      'Screen',
      'Interview',
    ]);
  });

  it('points to the browser extension, for a job found in the browser', () => {
    render(<AddJobDialog api={{} as FactwrightApi} onAdded={() => {}} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: 'Save to Factwright' });
    expect(link.getAttribute('href')).toBe('https://factwright.com/extension');
    // The window opens links in the browser, so it doesn't leave the app.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
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
      'Found19',
      'Checked14',
      'Resume built5',
      'Applied8',
      'Heard back4',
      'Interviewed2',
      'Offer1',
    ]);
    expect(screen.getByText('5 still in play')).toBeTruthy();
    expect(screen.getByText('1 rejected')).toBeTruthy();
    expect(screen.getByText('1 role closed')).toBeTruthy();
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
    expect(chart.textContent).toContain('Found19');
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

  it('shows one kind of job’s journey, or how each kind is going, for more than one', async () => {
    const split = jobRows(sampleJobs(), TODAY, KINDS);
    const saveFile = vi.fn(async () => ({ ok: true as const, saved: true }));
    const { container } = render(
      <JourneyDialog
        rows={split}
        kinds={KINDS}
        api={{ saveFile } as unknown as FactwrightApi}
        today={TODAY}
        onClose={() => {}}
      />,
    );
    const table = screen.getByRole('table', { name: 'By kind of job' });
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => [...row.children].map((cell) => cell.textContent)),
    ).toEqual([
      ['Kind of job', 'Found', 'Applied', 'Heard back', 'Interviewed', 'Offer'],
      ['Developer', '16', '7', '3 43%', '1', '0'],
      ['Project manager', '3', '1', '1 100%', '1', '1'],
    ]);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Kind of job' }),
      'Project manager',
    );
    const steps = screen.getByRole('list', { name: 'How far your jobs got' });
    expect(within(steps).getAllByRole('listitem')[0]?.textContent).toBe('Found3');
    expect(screen.queryByRole('table', { name: 'By kind of job' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download as a spreadsheet' }));
    expect(saveFile).toHaveBeenCalledWith(
      `job-search-journey-project-manager-${TODAY}.csv`,
      expect.stringContaining('Company,Role,Kind of job,Source'),
    );
  });

  it('starts on the kind of job the list shows', () => {
    render(
      <JourneyDialog
        rows={jobRows(sampleJobs(), TODAY, KINDS)}
        kinds={KINDS}
        kind="project-manager"
        api={{} as FactwrightApi}
        today={TODAY}
        onClose={() => {}}
      />,
    );
    const steps = screen.getByRole('list', { name: 'How far your jobs got' });
    expect(within(steps).getAllByRole('listitem')[0]?.textContent).toBe('Found3');
    cleanup();
    // With one kind, there's nothing to pick.
    render(
      <JourneyDialog
        rows={jobRows(sampleJobs(), TODAY)}
        api={{} as FactwrightApi}
        today={TODAY}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Kind of job' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
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

describe('WithdrawDialog', () => {
  const inPlay = jobRows(sampleJobs(), TODAY).filter((row) =>
    ['Northwind Labs', 'Tidewater Analytics', 'Lumen Health'].includes(row.job.company),
  );

  it('withdraws from every other job in play in one step, but those left out', async () => {
    const updateJobs = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    const { container } = render(
      <WithdrawDialog
        company="Fernway"
        rows={inPlay}
        api={{ updateJobs } as unknown as FactwrightApi}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Withdraw from your other jobs?' });
    expect(dialog.textContent).toContain('You accepted the offer from Fernway.');
    expect(dialog.textContent).toContain('let each company know yourself');
    const list = within(dialog).getByRole('list', { name: 'Jobs still in play' });
    const boxes = within(list).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true]);
    await userEvent.click(within(list).getByRole('checkbox', { name: /^Tidewater Analytics/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw from 2 jobs' }));
    expect(updateJobs).toHaveBeenCalledWith(
      [
        'northwind-labs--senior-software-engineer-platform',
        'lumen-health--senior-full-stack-engineer',
      ],
      { status: 'withdrawn' },
    );
    expect(onClose).toHaveBeenCalled();
    const results = await axe.run(container.parentElement ?? document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('can be left for later, withdrawing from nothing', async () => {
    const updateJobs = vi.fn();
    const onClose = vi.fn();
    render(
      <WithdrawDialog
        company="Fernway"
        rows={inPlay}
        api={{ updateJobs } as unknown as FactwrightApi}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(updateJobs).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

/** Keeps a focus, by an ID like the app's, or says why it couldn't. */
const focusApi = (saved: SaveFocusResult = { ok: true, id: '2026-10-12-a3f9' }) =>
  ({ saveSearchFocus: vi.fn(async () => saved) }) satisfies Pick<FactwrightApi, 'saveSearchFocus'>;

describe('FindJobsDialog', () => {
  it('starts on HN, and searches every place picked, with the month and a company', async () => {
    const onStart = vi.fn();
    const { container } = render(
      <FindJobsDialog api={focusApi()} today="2026-10-12" onStart={onStart} onClose={() => {}} />,
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
    render(
      <FindJobsDialog api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />,
    );
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

  it('looks for one kind of job, or every kind, when the user wants more than one', async () => {
    const kinds = [
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ];
    const onStart = vi.fn();
    const { container, unmount } = render(
      <FindJobsDialog
        api={focusApi()}
        today="2026-10-12"
        kinds={kinds}
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    const lookFor = screen.getByRole('group', { name: 'Look for' });
    expect(
      (within(lookFor).getByRole('radio', { name: 'Every kind' }) as HTMLInputElement).checked,
    ).toBe(true);
    await userEvent.click(within(lookFor).getByRole('radio', { name: 'Project manager' }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onStart).toHaveBeenCalledWith({ sites: ['hn'], kind: 'project-manager' });
    unmount();
    // Kept for next time, while the kind is still there.
    render(
      <FindJobsDialog
        api={focusApi()}
        today="2026-10-12"
        kinds={kinds}
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    expect(
      (screen.getByRole('radio', { name: 'Project manager' }) as HTMLInputElement).checked,
    ).toBe(true);
    cleanup();
    // With one kind of job, there's nothing to pick.
    render(
      <FindJobsDialog api={focusApi()} today="2026-10-12" onStart={onStart} onClose={() => {}} />,
    );
    expect(screen.queryByRole('group', { name: 'Look for' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onStart).toHaveBeenLastCalledWith({ sites: ['hn'] });
  });

  it('focuses this search alone, keeping the focus first and starting with its ID', async () => {
    const onStart = vi.fn();
    const api = focusApi();
    const { container } = render(
      <FindJobsDialog api={api} today="2026-10-12" onStart={onStart} onClose={() => {}} />,
    );
    const toggle = screen.getByRole('button', { name: /^Focus for this search/ });
    expect(toggle.textContent).toContain('Optional');
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Early startup' }));
    expect(screen.getByText('Up to Series A, under about 50 people')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Pay a year, from' }), '150k');
    await userEvent.type(screen.getByRole('textbox', { name: 'to' }), '200,000');
    await userEvent.click(screen.getByRole('button', { name: 'Remote' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Leave out' }), 'Crypto{Enter}');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Posted' }), 'Past week');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Anything else for this search' }),
      'Founding roles.',
    );
    expect(toggle.textContent).toContain('early startups, $150k–$200k, remote, past week');
    expect(container.textContent).toContain(
      'Found by names it HN October 2026 · early startups, $150k–$200k, remote, past week',
    );
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(api.saveSearchFocus).toHaveBeenCalledWith({
      stages: ['early'],
      payMin: 150_000,
      payMax: 200_000,
      workplaces: ['remote'],
      industries: [],
      avoid: ['Crypto'],
      posted: 7,
      notes: 'Founding roles.',
    });
    expect(onStart).toHaveBeenCalledWith({ sites: ['hn'], focus: '2026-10-12-a3f9' });
  });

  it('says when pay doesn’t read, and why a focus couldn’t be kept', async () => {
    const onStart = vi.fn();
    render(
      <FindJobsDialog
        api={focusApi({ ok: false, message: 'That change couldn’t be saved.' })}
        today="2026-10-12"
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Focus for this search/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Pay a year, from' }), '200k');
    await userEvent.type(screen.getByRole('textbox', { name: 'to' }), '150k');
    expect(screen.getByRole('alert').textContent).toBe(
      'Type pay as a yearly amount, such as 150,000 or 150k, with the lower one first.',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Search' }).disabled).toBe(true);
    await userEvent.clear(screen.getByRole('textbox', { name: 'to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('alert').textContent).toBe('That change couldn’t be saved.');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('remembers the places picked for next time', async () => {
    const { unmount } = render(
      <FindJobsDialog api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /^Indeed/ }));
    unmount();
    render(
      <FindJobsDialog api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByRole('checkbox', { name: /^Indeed/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Search 2 places' })).toBeTruthy();
  });
});

describe('MergeDialog', () => {
  const rows = jobRows([...sampleJobs(), sampleDuplicate()], TODAY);
  const quarry = rows.find((row) => row.job.company === 'Quarry')?.job;

  it('offers the jobs likely the same first, and merges the one picked into this one', async () => {
    const mergeJobs = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    if (!quarry) throw new Error('No sample job found twice');
    const { container } = render(
      <MergeDialog
        job={quarry}
        rows={rows}
        api={{ mergeJobs } as unknown as FactwrightApi}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Merge with another job' });
    expect(dialog.textContent).toContain(
      'its status, notes, calls and links move to Quarry, Senior Platform Engineer',
    );
    const list = within(dialog).getByRole('list', { name: 'Jobs to merge with' });
    // Quarry Labs is the company written longer: the same company, another title.
    expect(
      within(list)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Quarry LabsSenior Software Engineer · To apply']);
    const merge = screen.getByRole('button', { name: 'Merge' });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(list).getByRole('radio'));
    await userEvent.click(merge);
    expect(mergeJobs).toHaveBeenCalledWith(quarry.id, 'quarry-labs--senior-software-engineer');
    expect(onClose).toHaveBeenCalled();
    const results = await axe.run(container.parentElement ?? document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('finds any other job by its company or role, and says why a merge failed', async () => {
    const mergeJobs = vi.fn(async () => ({
      ok: false as const,
      message: 'That job isn’t in your tracker anymore.',
    }));
    if (!quarry) throw new Error('No sample job found twice');
    render(
      <MergeDialog
        job={quarry}
        rows={rows}
        api={{ mergeJobs } as unknown as FactwrightApi}
        onClose={vi.fn()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Find the other job' });
    await userEvent.type(search, 'tidewater');
    const list = screen.getByRole('list', { name: 'Jobs to merge with' });
    expect(within(list).getAllByRole('radio')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('radio', { name: /^Tidewater Analytics/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByRole('alert').textContent).toBe('That job isn’t in your tracker anymore.');
    await userEvent.clear(search);
    await userEvent.type(search, 'nothing like it');
    expect(screen.getByRole('status').textContent).toBe('No other job matches “nothing like it”.');
  });
});
