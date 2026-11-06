// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { type ComponentProps, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAnswers } from '../../shared/about.ts';
import type { FactwrightApi, PostingRead, SaveFocusResult } from '../../shared/api.ts';
import { browserSearches } from '../../shared/browser-searches.ts';
import { kindsOf } from '../../shared/kinds.ts';
import { AddJobDialog } from './AddJobDialog.tsx';
import { FiltersPanel } from './FiltersPanel.tsx';
import { FindJobsDialog } from './FindJobsDialog.tsx';
import { JourneyDialog } from './JourneyDialog.tsx';
import { MergeDialog } from './MergeDialog.tsx';
import { jobRows, type ListFilter, NO_FILTERS } from './rows.ts';
import { KEELSON, sampleDuplicate, sampleJobs, sampleSaved } from './sample-jobs.ts';
import { WithdrawDialog } from './WithdrawDialog.tsx';

const TODAY = localDate();

// With every package's tests at once, the first test here took 3.3 of vitest's usual 5 seconds.
vi.setConfig({ testTimeout: 20_000 });

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
  // Nor does it scroll anything.
  Element.prototype.scrollIntoView ??= () => {};
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
    await userEvent.click(within(panel).getByRole('button', { name: 'Not checked yet' }));
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

  const WORKDAY =
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Product-Manager_JR2016992';

  it('reads the posting’s link, fills in what the user left empty, and keeps the posting with the job', async () => {
    const readPosting = vi.fn(async () => ({
      ok: true as const,
      via: 'the page’s JobPosting data',
      characters: 4692,
      title: 'Product Manager, AI Platform',
      company: 'NVIDIA',
    }));
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'nvidia--product-manager' }));
    const onAdded = vi.fn();
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={onAdded}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.tab();
    expect(
      await screen.findByText(
        'Read the posting: Product Manager, AI Platform, 4,692 characters. It’s kept with the job.',
      ),
    ).toBeTruthy();
    expect(readPosting.mock.calls).toEqual([[WORKDAY]]);
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', 'NVIDIA');
    expect(screen.getByRole('textbox', { name: 'Role' })).toHaveProperty(
      'value',
      'Product Manager, AI Platform',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    // The main process keeps what it read, so the job is added with its link alone.
    expect(addJob).toHaveBeenCalledWith({
      company: 'NVIDIA',
      role: 'Product Manager, AI Platform',
      link: WORKDAY,
      pay: '',
      status: 'new',
      notes: '',
    });
    expect(readPosting).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith('nvidia--product-manager', 'new', null);
  });

  it('never changes a company or role the user typed', async () => {
    const readPosting = vi.fn(async () => ({
      ok: true as const,
      via: 'Greenhouse API',
      characters: 900,
      title: 'Staff Engineer',
      company: 'Acme Robotics',
    }));
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Acme');
    await userEvent.type(screen.getByRole('textbox', { name: 'Role' }), 'Platform lead');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://job-boards.greenhouse.io/acme/jobs/4012345',
    );
    await userEvent.tab();
    await screen.findByText(/^Read the posting: Staff Engineer/);
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', 'Acme');
    expect(screen.getByRole('textbox', { name: 'Role' })).toHaveProperty('value', 'Platform lead');
  });

  it('asks for the posting of a link it can’t read, plainly, and adds the job without it only when told', async () => {
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi.fn(
      () =>
        new Promise<PostingRead>((resolve) => {
          answer = resolve;
        }),
    );
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'kite--staff-engineer' }));
    const onAdded = vi.fn();
    const { container } = render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={onAdded}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Kite');
    const linkedIn = 'https://www.linkedin.com/jobs/view/4012345678/';
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), linkedIn);
    // Add waits while the link is read, without adding yet.
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(await screen.findByText('Reading the posting…')).toBeTruthy();
    // It keeps the keyboard's focus, as a disabled button would lose it.
    expect(screen.getByRole('button', { name: 'Add job' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    answer({
      ok: false,
      why: 'linkedin',
      message: 'LinkedIn doesn’t let apps read its pages, so Factwright never does.',
    });
    // The dialog turns to asking for the posting, with the box for it ready to paste into.
    expect(await screen.findByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Job posting' });
    expect(document.activeElement).toBe(box);
    const why = screen.getByRole('status');
    expect(why.textContent).toContain(
      'LinkedIn doesn’t let apps read its pages, so Factwright never does.',
    );
    expect(why.textContent).toContain(
      'Paste the posting below. Or open it in your browser and click Save to Factwright, which saves the whole posting with its link in one click.',
    );
    expect(within(why).getByRole('link', { name: 'Save to Factwright' }).getAttribute('href')).toBe(
      'https://factwright.com/extension',
    );
    expect(screen.getByText(/^On LinkedIn, click “… more” under About the job first/)).toBeTruthy();
    // What the user typed is there to finish.
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', 'Kite');
    expect(addJob).not.toHaveBeenCalled();
    const results = await axe.run(container.ownerDocument.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    // Add job wants the posting first. Add without the posting adds the job with its link alone.
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Paste the job’s posting first, or choose Add without the posting.',
    );
    expect(document.activeElement).toBe(box);
    expect(addJob).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Add without the posting' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.not.objectContaining({ posting: expect.anything() }),
    );
    expect(readPosting).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalled();
  });

  const BLOCKED: PostingRead = {
    ok: false,
    why: 'blocked',
    message:
      'careers.acme.example turned Factwright away (403): it blocks apps, or wants you signed in.',
  };

  it('ticks off what a pasted posting has, says when it looks like part of one, and adds the job with it', async () => {
    const readPosting = vi.fn(async () => BLOCKED);
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'acme--program-manager' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Acme');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    await userEvent.tab();
    const box = await screen.findByRole('textbox', { name: 'Job posting' });
    const parts = () =>
      within(screen.getByRole('region', { name: 'What to paste' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(parts()).toEqual([
      'All of it, from the job’s title down to the end',
      'What you’d do: the work, the team, who it reports to',
      'What they want: years, skills, degrees, certifications',
      'Pay and benefits, if it says',
      'Where: the place, and remote, hybrid or on-site',
    ]);
    expect(screen.getByText(/^On the posting’s page, select from the job’s title/)).toBeTruthy();
    await userEvent.click(box);
    const start = 'Program Manager\n\nWhat you’ll do: run the roadmap.\nRemote in the US.';
    await userEvent.paste(start);
    expect(parts()).toEqual([
      'All of it, from the job’s title down to the end',
      'What you’d do: the work, the team, who it reports to: it’s there',
      'What they want: years, skills, degrees, certifications',
      'Pay and benefits, if it says',
      'Where: the place, and remote, hybrid or on-site: it’s there',
    ]);
    expect(
      screen.getByText(
        `${start.length} characters. That may be only part of the posting: paste all of it, from the top.`,
      ),
    ).toBeTruthy();
    await userEvent.paste(
      `\n\nWhat you’ll need: 5 years of program management.\nPay: $150,000–$180,000 a year, with benefits.\n${'More about the team and its work. '.repeat(40)}`,
    );
    expect(parts().every((part) => part?.endsWith(': it’s there'))).toBe(true);
    expect(screen.queryByText(/That may be only part of the posting/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme',
        link: 'https://careers.acme.example/jobs/1',
        posting: expect.stringMatching(/^Program Manager\n\nWhat you’ll do/),
      }),
    );
  });

  it('goes back to the link, and asks for the posting again before adding the job without it', async () => {
    const readPosting = vi.fn(async () => BLOCKED);
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'acme' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    await userEvent.tab();
    await screen.findByRole('heading', { name: 'Paste the posting' });
    // Without a company, the job can't be added either way.
    await userEvent.click(screen.getByRole('button', { name: 'Add without the posting' }));
    expect(screen.getByRole('alert').textContent).toBe('Add the company’s name first.');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Company' }));
    await userEvent.keyboard('Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
    );
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', 'Acme');
    expect(screen.queryByRole('alert')).toBeNull();
    // Add job, with the link still unread and nothing pasted, asks for the posting again.
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(await screen.findByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    expect(addJob).not.toHaveBeenCalled();
    expect(readPosting).toHaveBeenCalledTimes(1);
  });

  it('asks for the posting only at Add job when a slow read ends while the user types elsewhere', async () => {
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi.fn(
      () =>
        new Promise<PostingRead>((resolve) => {
          answer = resolve;
        }),
    );
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Acme');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await userEvent.type(notes, 'Recruiter ');
    answer(BLOCKED);
    await screen.findByText(/^careers\.acme\.example turned Factwright away/);
    // Nothing moves under the user's hands: what they type stays where they type it.
    await userEvent.type(notes, 'said hi');
    expect(screen.queryByRole('heading', { name: 'Paste the posting' })).toBeNull();
    expect(notes).toHaveProperty('value', 'Recruiter said hi');
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(await screen.findByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Job posting' })).toHaveProperty('value', '');
  });

  it('adds the job without the posting when told, whatever is in the box', async () => {
    const readPosting = vi.fn(async () => BLOCKED);
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'acme' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Acme');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    await userEvent.tab();
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Job posting' }),
      'About the job',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add without the posting' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.not.objectContaining({ posting: expect.anything() }),
    );
  });

  it('keeps asking for the posting while the link is read again, and keeps what was pasted meanwhile', async () => {
    const unreachable: PostingRead = {
      ok: false,
      why: 'unreachable',
      message: 'Factwright couldn’t reach careers.acme.example. Check the connection.',
    };
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi
      .fn<() => Promise<PostingRead>>()
      .mockResolvedValueOnce(unreachable)
      .mockImplementation(
        () =>
          new Promise<PostingRead>((resolve) => {
            answer = resolve;
          }),
      );
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    await userEvent.tab();
    const why = await screen.findByRole('status');
    await userEvent.click(within(why).getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    expect(screen.getByText('Reading it again…')).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Job posting' });
    await userEvent.type(box, 'Program Manager');
    answer(unreachable);
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('Reading it again…')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Job posting' })).toHaveProperty(
      'value',
      'Program Manager',
    );
  });

  it('heeds only the newest read of a link the user changed and put back', async () => {
    const answers: ((read: PostingRead) => void)[] = [];
    const readPosting = vi.fn(
      () =>
        new Promise<PostingRead>((resolve) => {
          answers.push(resolve);
        }),
    );
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    const link = screen.getByRole('textbox', { name: 'Link to the posting' });
    await userEvent.type(link, WORKDAY);
    await userEvent.tab();
    await userEvent.type(link, 'x');
    await userEvent.type(link, '{Backspace}');
    await userEvent.tab();
    expect(readPosting).toHaveBeenCalledTimes(2);
    // The first read's answer comes after the second read began, and says nothing.
    answers[0]?.(BLOCKED);
    await new Promise((settled) => setTimeout(settled, 50));
    expect(screen.queryByRole('heading', { name: 'Paste the posting' })).toBeNull();
    expect(screen.getByText('Reading the posting…')).toBeTruthy();
    answers[1]?.(READ);
    await screen.findByText(/^Read the posting: Product Manager, AI Platform/);
  });

  it('keeps a description pasted before over a posting read later, and says how to keep the read one', async () => {
    const readPosting = vi.fn(async () => READ);
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'nvidia--product-manager' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Job description' }),
      'The posting, as the user pasted it.',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.tab();
    expect(
      await screen.findByText(
        'Read the posting: Product Manager, AI Platform, 4,692 characters. The description you pasted is kept with the job instead. Empty its box to keep this one.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ posting: 'The posting, as the user pasted it.' }),
    );
  });

  it('keeps the keyboard in the box the user is in when the step changes under it', async () => {
    const unreachable: PostingRead = {
      ok: false,
      why: 'unreachable',
      message: 'Factwright couldn’t reach careers.acme.example. Check the connection.',
    };
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi
      .fn<() => Promise<PostingRead>>()
      .mockResolvedValueOnce(unreachable)
      .mockImplementation(
        () =>
          new Promise<PostingRead>((resolve) => {
            answer = resolve;
          }),
      );
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Acme');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    await userEvent.tab();
    await userEvent.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Try again' }),
    );
    // While the link is read again, Add job with nothing pasted says what it wants.
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Paste the job’s posting first, or choose Add without the posting.',
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Role' }));
    await userEvent.keyboard('Senior ');
    answer(READ);
    await screen.findByText(/^Read the posting: Product Manager, AI Platform/);
    // The details show again, and what the user goes on typing goes where they were typing.
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeTruthy();
    const role = screen.getByRole('textbox', { name: 'Role' });
    expect(document.activeElement).toBe(role);
    await userEvent.keyboard('PM');
    expect(role).toHaveProperty('value', 'Senior PM');
    expect(screen.getByRole('textbox', { name: 'Link to the posting' })).toHaveProperty(
      'value',
      'https://careers.acme.example/jobs/1',
    );
    expect(readPosting).toHaveBeenCalledTimes(2);
  });

  it('waits for Add job to ask for the posting while the keyboard is in a box the asking step hasn’t', async () => {
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi.fn(
      () =>
        new Promise<PostingRead>((resolve) => {
          answer = resolve;
        }),
    );
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://careers.acme.example/jobs/1',
    );
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await userEvent.click(notes);
    answer(BLOCKED);
    await screen.findByText(/^careers\.acme\.example turned Factwright away/);
    expect(screen.queryByRole('heading', { name: 'Paste the posting' })).toBeNull();
    expect(document.activeElement).toBe(notes);
  });

  /** A read of the link that answers only when the test says. */
  function slowRead() {
    let answer: (read: PostingRead) => void = () => {};
    const readPosting = vi.fn(
      () =>
        new Promise<PostingRead>((resolve) => {
          answer = resolve;
        }),
    );
    return { readPosting, answer: (read: PostingRead) => answer(read) };
  }
  const READ: PostingRead = {
    ok: true,
    via: 'the page’s JobPosting data',
    characters: 4692,
    title: 'Product Manager, AI Platform',
    company: 'NVIDIA',
  };

  it('adds the job with what the read filled in, once the link is read', async () => {
    const { readPosting, answer } = slowRead();
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'nvidia--product-manager' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).not.toHaveBeenCalled();
    answer(READ);
    await screen.findByText(/^Read the posting: Product Manager, AI Platform/);
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'NVIDIA', role: 'Product Manager, AI Platform' }),
    );
  });

  it('never adds a job when it’s cancelled while its link is read', async () => {
    const { readPosting, answer } = slowRead();
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'nvidia--product-manager' }));
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={onAdded}
        onClose={onClose}
      />,
    );
    await userEvent.keyboard('NVIDIA');
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    answer(READ);
    await new Promise((settled) => setTimeout(settled, 50));
    expect(addJob).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('fills in nothing from a link the user changed while it was read', async () => {
    const { readPosting, answer } = slowRead();
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    const link = screen.getByRole('textbox', { name: 'Link to the posting' });
    await userEvent.type(link, WORKDAY);
    await userEvent.tab();
    await userEvent.clear(link);
    answer(READ);
    await new Promise((settled) => setTimeout(settled, 50));
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', '');
    expect(screen.getByRole('textbox', { name: 'Role' })).toHaveProperty('value', '');
    expect(screen.queryByText(/^Read the posting/)).toBeNull();
  });

  it('tries a site again that couldn’t be reached', async () => {
    const readPosting = vi
      .fn<() => Promise<PostingRead>>()
      .mockResolvedValueOnce({
        ok: false,
        why: 'unreachable',
        message:
          'careers.acme.example is busy, and asked Factwright to wait (429). Try again in a minute.',
      })
      .mockResolvedValueOnce(READ);
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.tab();
    await screen.findByText(/^careers\.acme\.example is busy/);
    expect(screen.getByRole('heading', { name: 'Paste the posting' })).toBeTruthy();
    // Back at the link, leaving the box again asks nothing more: Try again does.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.tab();
    expect(readPosting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Read the posting: Product Manager, AI Platform/);
    expect(readPosting).toHaveBeenCalledTimes(2);
  });

  it('tries again from the step that asks for the posting, and goes on once it’s read', async () => {
    const readPosting = vi
      .fn<() => Promise<PostingRead>>()
      .mockResolvedValueOnce({
        ok: false,
        why: 'unreachable',
        message: 'Factwright couldn’t reach careers.acme.example. Check the connection.',
      })
      .mockResolvedValueOnce(READ);
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.tab();
    const why = await screen.findByRole('status');
    await userEvent.click(within(why).getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Read the posting: Product Manager, AI Platform/);
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveProperty('value', 'NVIDIA');
  });

  it('says what works for a page of several jobs, or a file', async () => {
    let read: PostingRead = {
      ok: false,
      why: 'list',
      message: 'That page looks like a list of jobs or a careers page, not one job’s posting.',
    };
    const readPosting = vi.fn(async () => read);
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    const link = () => screen.getByRole('textbox', { name: 'Link to the posting' });
    await userEvent.type(link(), 'https://job-boards.greenhouse.io/acme');
    await userEvent.tab();
    expect(
      await screen.findByText(
        'That page looks like a list of jobs or a careers page, not one job’s posting.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Go back and use the job’s own link, or paste its posting below.'),
    ).toBeTruthy();
    read = {
      ok: false,
      why: 'file',
      message: 'That link is a file, such as a PDF, not a web page, so Factwright doesn’t read it.',
    };
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    // Back at the link, the note under it says the same.
    expect(
      screen.getByText(
        'That page looks like a list of jobs or a careers page, not one job’s posting. Use the job’s own link, or paste its description below.',
      ),
    ).toBeTruthy();
    await userEvent.clear(link());
    await userEvent.type(link(), 'https://careers.acme.example/jobs/pm.pdf');
    await userEvent.tab();
    expect(
      await screen.findByText(
        'That link is a file, such as a PDF, not a web page, so Factwright doesn’t read it.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Open the file, and paste the posting below.')).toBeTruthy();
  });

  it('adds the job at once with the description the user pasted', async () => {
    const readPosting = vi.fn(async () => ({
      ok: false as const,
      why: 'browser' as const,
      message:
        'jobs.apple.com shows the posting only in a web browser, or once you’re signed in, so Factwright found nothing to read.',
    }));
    const addJob = vi.fn(async () => ({ ok: true as const, jobId: 'apple--engineering-pm' }));
    render(
      <AddJobDialog
        api={{ readPosting, addJob } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.keyboard('Apple');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Job description' }),
      'Engineering Project Manager. Lead the work.',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link to the posting' }),
      'https://jobs.apple.com/en-us/details/200626630-0836/engineering-project-manager',
    );
    await userEvent.tab();
    await screen.findByText(/^jobs\.apple\.com shows the posting only in a web browser/);
    // What the user pasted is the posting: there's nothing more to ask for.
    expect(screen.queryByRole('heading', { name: 'Paste the posting' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ posting: 'Engineering Project Manager. Lead the work.' }),
    );
  });

  it('says a closed posting has closed, and that a description can still be pasted', async () => {
    const readPosting = vi.fn(async () => ({
      ok: false as const,
      why: 'closed' as const,
      message: 'Workday says this posting has closed.',
    }));
    render(
      <AddJobDialog
        api={{ readPosting } as unknown as FactwrightApi}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to the posting' }), WORKDAY);
    await userEvent.tab();
    expect(await screen.findByText('Workday says this posting has closed.')).toBeTruthy();
    expect(screen.getByText('If you still have the posting, paste it below.')).toBeTruthy();
  });

  it('points to the browser extension, for a job found in the browser', () => {
    render(<AddJobDialog api={{} as FactwrightApi} onAdded={() => {}} onClose={() => {}} />);
    const link = screen.getByRole('link', { name: 'Our extension for Chrome and Firefox' });
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

/** Find jobs, with its ways to other windows doing nothing unless a test gives its own. */
const FindJobs = (
  props: Omit<ComponentProps<typeof FindJobsDialog>, 'onOpenExtension' | 'onOpenProfile'> &
    Partial<ComponentProps<typeof FindJobsDialog>>,
) => <FindJobsDialog onOpenExtension={() => {}} onOpenProfile={() => {}} {...props} />;

describe('FindJobsDialog', () => {
  // Most of these start from someone who last searched HN. Where a first search starts is below.
  beforeEach(() => {
    localStorage.setItem('factwright.search.sites', '["hn"]');
  });

  it('starts a first search on company job boards alone for a field HN has few jobs for', () => {
    localStorage.removeItem('factwright.search.sites');
    render(
      <FindJobs
        api={focusApi()}
        fields={['healthcare']}
        today="2026-10-12"
        onStart={() => {}}
        onClose={() => {}}
      />,
    );
    const picked = (name: RegExp) =>
      screen.getByRole<HTMLInputElement>('checkbox', { name }).checked;
    expect(picked(/^Company job boards/)).toBe(true);
    expect(picked(/^Hacker News/)).toBe(false);
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    // It offers them first, since they reach every field, and says what HN is mostly for.
    expect(screen.getAllByRole('checkbox')[0]).toBe(
      screen.getByRole('checkbox', { name: /^Company job boards/ }),
    );
    expect(
      screen.getByRole('checkbox', { name: /^Hacker News/ }).closest('label')?.textContent,
    ).toContain('mostly for software jobs');
  });

  it('adds HN to a first search for software, data and product', () => {
    localStorage.removeItem('factwright.search.sites');
    render(
      <FindJobs
        api={focusApi()}
        fields={['software']}
        today="2026-10-12"
        onStart={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search 2 places' })).toBeTruthy();
  });

  it('searches every place picked, with the month and a company', async () => {
    const onStart = vi.fn();
    const { container } = render(
      <FindJobs api={focusApi()} today="2026-10-12" onStart={onStart} onClose={() => {}} />,
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
      sites: ['boards', 'linkedin', 'hn'],
      month: '2026-09',
      company: 'Acme',
    });
  });

  it('says how to name a company, and won’t search until it can', async () => {
    render(<FindJobs api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />);
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
      <FindJobs
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
      <FindJobs
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
    render(<FindJobs api={focusApi()} today="2026-10-12" onStart={onStart} onClose={() => {}} />);
    expect(screen.queryByRole('group', { name: 'Look for' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onStart).toHaveBeenLastCalledWith({ sites: ['hn'] });
  });

  it('focuses this search alone, keeping the focus first and starting with its ID', async () => {
    const onStart = vi.fn();
    const api = focusApi();
    const { container } = render(
      <FindJobs api={api} today="2026-10-12" onStart={onStart} onClose={() => {}} />,
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
      <FindJobs
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
      'Type pay as a yearly amount, such as 150,000 or 150k, or by the hour, such as $40 an hour, with the lower one first.',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Search' }).disabled).toBe(true);
    await userEvent.clear(screen.getByRole('textbox', { name: 'to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('alert').textContent).toBe('That change couldn’t be saved.');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('remembers the places picked for next time', async () => {
    const { unmount } = render(
      <FindJobs api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /^Indeed/ }));
    unmount();
    render(<FindJobs api={focusApi()} today="2026-10-12" onStart={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('checkbox', { name: /^Indeed/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Search 2 places' })).toBeTruthy();
  });

  describe('ready-made searches to open in the browser', () => {
    const remote = readAnswers({
      roles: ['Staff Engineer', 'Platform Engineer'],
      workplaces: ['remote'],
      remoteFrom: 'anywhere in the US',
    });
    const unfold = () =>
      userEvent.click(
        screen.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ }),
      );

    it('are folded under LinkedIn and Indeed, saying how many, and don’t change the places', async () => {
      const onStart = vi.fn();
      const { container } = render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          searches={browserSearches(remote)}
          onStart={onStart}
          onClose={() => {}}
        />,
      );
      const toggle = screen.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent).toContain('2 ready-made searches');
      expect(screen.queryByRole('link')).toBeNull();
      // Right after the two places a web search sees only some of.
      const places = [
        ...screen.getByRole('group', { name: 'Where to look' }).querySelectorAll('input, button'),
      ];
      const indeed = screen.getByRole('checkbox', { name: /^Indeed/ });
      expect(places.indexOf(toggle)).toBe(places.indexOf(indeed) + 1);
      await unfold();
      const list = screen.getByRole('list', { name: 'Remote, United States' });
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((row) => row.textContent),
      ).toEqual(['Staff EngineerLinkedInIndeed', 'Platform EngineerLinkedInIndeed']);
      const link = within(list).getByRole<HTMLAnchorElement>('link', {
        name: 'Staff Engineer, Remote, United States, on LinkedIn',
      });
      // A link in a new window is how the app sends an address to the user's own browser.
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
      expect(link.getAttribute('href')).toBe(
        'https://www.linkedin.com/jobs/search/?keywords=Staff%20Engineer&location=United%20States&f_WT=2&f_TPR=r604800',
      );
      expect(
        within(list)
          .getByRole('link', { name: 'Platform Engineer, Remote, United States, on Indeed' })
          .getAttribute('href'),
      ).toBe('https://www.indeed.com/jobs?q=Platform%20Engineer&l=Remote&fromage=7');
      const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations).toEqual([]);
      // The plain checkboxes search as ever, whatever's unfolded.
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(onStart).toHaveBeenCalledWith({ sites: ['hn'] });
    });

    it('point to the Browser extension window, leaving this one open', async () => {
      const onOpenExtension = vi.fn();
      const onClose = vi.fn();
      render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          searches={browserSearches(remote)}
          onOpenExtension={onOpenExtension}
          onStart={() => {}}
          onClose={onClose}
        />,
      );
      await unfold();
      const line = screen.getByText(/saves a job from those pages/);
      await userEvent.click(within(line).getByRole('button', { name: 'browser extension' }));
      expect(onOpenExtension).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('follow the kind picked, with each kind’s name while looking for every kind', async () => {
      const answers = readAnswers({
        ...remote,
        firstKind: { id: 'developer', name: 'Developer' },
        otherKinds: [
          { id: 'project-manager', name: 'Project manager', roles: ['Program Manager'] },
          { id: 'teacher', name: 'Teacher' },
        ],
      });
      const { container } = render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          kinds={kindsOf(answers).map(({ id, name }) => ({ id, name }))}
          searches={browserSearches(answers)}
          onStart={() => {}}
          onClose={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ }).textContent,
      ).toContain('3 ready-made searches');
      await unfold();
      expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy();
      expect(
        within(screen.getByRole('list', { name: 'Project manager: Remote, United States' }))
          .getAllByRole('listitem')
          .map((row) => row.textContent),
      ).toEqual(['Program ManagerLinkedInIndeed']);
      // A kind with no titles says what to do, among the others that have some.
      expect(screen.getByRole('heading', { name: 'Teacher' })).toBeTruthy();
      expect(screen.getByText(/^No job titles yet\./)).toBeTruthy();
      const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations).toEqual([]);
      await userEvent.click(screen.getByRole('radio', { name: 'Project manager' }));
      expect(
        screen.getByRole('list', { name: 'Project manager: Remote, United States' }),
      ).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Developer' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Project manager' })).toBeNull();
      expect(screen.queryByRole('link', { name: /Staff Engineer/ })).toBeNull();
      expect(screen.getByRole('link', { name: /^Program Manager.*on LinkedIn$/ })).toBeTruthy();
      // The kind with none says what to do, with no empty list.
      await userEvent.click(screen.getByRole('radio', { name: 'Teacher' }));
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.getByText(/^Add the job titles you want in/)).toBeTruthy();
    });

    it('say to add titles in Profile for someone with none, and go there', async () => {
      const onOpenProfile = vi.fn();
      const onClose = vi.fn();
      const { container } = render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          searches={browserSearches(readAnswers({ workplaces: ['remote'] }))}
          onOpenProfile={onOpenProfile}
          onStart={() => {}}
          onClose={onClose}
        />,
      );
      const toggle = screen.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ });
      expect(toggle.textContent).toContain('Needs your job titles');
      await unfold();
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText(/^Add the job titles you want in/).textContent).toContain(
        'under What you want',
      );
      const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations).toEqual([]);
      await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
      expect(onOpenProfile).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalled();
    });

    it('say Get started, as the sidebar does, for someone still getting started', async () => {
      const onOpenProfile = vi.fn();
      render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          profileName="Get started"
          onOpenProfile={onOpenProfile}
          onStart={() => {}}
          onClose={() => {}}
        />,
      );
      await unfold();
      expect(screen.getByText(/^Add the job titles you want in/).textContent).toContain(
        'in Get started, under What you want',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
      expect(onOpenProfile).toHaveBeenCalledOnce();
    });

    it('say when they’re for the first few titles and cities', async () => {
      const { unmount } = render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          searches={browserSearches(readAnswers({ roles: ['A', 'B', 'C', 'D', 'E', 'F'] }))}
          onStart={() => {}}
          onClose={() => {}}
        />,
      );
      await unfold();
      expect(screen.getByText('These are for your first 5 job titles and 3 cities.')).toBeTruthy();
      unmount();
      render(
        <FindJobs
          api={focusApi()}
          today="2026-10-12"
          searches={browserSearches(remote)}
          onStart={() => {}}
          onClose={() => {}}
        />,
      );
      await unfold();
      expect(screen.queryByText(/^These are for your first/)).toBeNull();
    });
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

  it('opens on the job Claude noted might be the same, first and picked', async () => {
    const saved = jobRows([...sampleJobs(), ...sampleSaved()], TODAY);
    const noted = saved.find((row) => row.job.id === KEELSON)?.job;
    const other = noted?.maybeSame[0]?.id;
    if (!noted || !other) throw new Error('No sample job noted as maybe the same');
    const mergeJobs = vi.fn(async () => ({ ok: true as const }));
    render(
      <MergeDialog
        job={noted}
        rows={saved}
        api={{ mergeJobs } as unknown as FactwrightApi}
        suggested={other}
        onClose={vi.fn()}
      />,
    );
    const list = screen.getByRole('list', { name: 'Jobs to merge with' });
    const first = within(list).getAllByRole('radio')[0] as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(first.closest('label')?.textContent).toContain('Staff AI Platform Engineer');
    expect(first.closest('label')?.textContent).toContain('Likely the same');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(mergeJobs).toHaveBeenCalledWith(KEELSON, other);
  });
});
