// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunTask } from '../../shared/runs.ts';
import { type RunControls, runControlsFor } from '../jobs/RunActions.tsx';
import { UpdateWithClaude } from './UpdateWithClaude.tsx';

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

afterEach(cleanup);

const controls = (over: Partial<RunControls> = {}): RunControls => ({
  stateOf: () => null,
  tasksOn: () => [],
  start: vi.fn(),
  show: vi.fn(),
  ...over,
});

const REQUEST = '0123456789abcdef';

const api = () => ({
  requestProfileChanges: vi.fn(async () => ({ ok: true, request: REQUEST }) as const),
});

async function open(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `Update with Claude: ${name}` }));
  return screen.findByRole('dialog', { name: `Update with Claude: ${name}` });
}

describe('UpdateWithClaude', () => {
  it('holds the user’s words for the run, then starts it on that part alone', async () => {
    const run = controls();
    const requests = api();
    const flush = vi.fn(async () => {});
    render(<UpdateWithClaude part="about" api={requests} run={run} onBefore={flush} />);
    const dialog = await open('About you');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'What should your Claude change?' }),
      'Use my new email',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the changes' }));
    await waitFor(() => expect(run.start).toHaveBeenCalled());
    expect(requests.requestProfileChanges).toHaveBeenCalledWith({
      part: 'about',
      changes: 'Use my new email',
    });
    // Nothing the user typed is in the task, and what they'd typed elsewhere saved first.
    expect(run.start).toHaveBeenCalledWith({
      skill: 'update-profile',
      part: 'about',
      request: REQUEST,
    });
    expect(flush).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks nothing of Claude without words', async () => {
    render(<UpdateWithClaude part="about" api={api()} run={controls()} />);
    const dialog = await open('About you');
    const make = within(dialog).getByRole('button', { name: 'Make the changes' });
    expect((make as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(dialog).getByRole('textbox'), '   ');
    expect((make as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts a run on one kind of job, by its id, under its own name', async () => {
    const run = controls();
    const requests = api();
    render(
      <UpdateWithClaude
        part="kind"
        kind="project-manager"
        name="Project manager"
        api={requests}
        run={run}
        quiet
      />,
    );
    const dialog = await open('Project manager');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Add program director');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the changes' }));
    await waitFor(() => expect(run.start).toHaveBeenCalled());
    expect(requests.requestProfileChanges).toHaveBeenCalledWith({
      part: 'kind',
      kind: 'project-manager',
      changes: 'Add program director',
    });
    expect(run.start).toHaveBeenCalledWith({
      skill: 'update-profile',
      part: 'kind',
      kind: 'project-manager',
      request: REQUEST,
    });
  });

  it('says plainly what stays out of Claude’s reach', async () => {
    render(<UpdateWithClaude part="applications" api={api()} run={controls()} />);
    const dialog = await open('For applications');
    expect(dialog.textContent).toContain(
      'Your street, postal code and equal-opportunity answers stay on this computer, and your Claude never sees them.',
    );
  });

  it.each([
    ['about', 'About you', 'Your street and postal code stay on this computer'],
    ['facts', 'Your fact bank', 'Removing a fact stays with you'],
    ['shared', 'What you’ve shared', 'Adding or removing a file stays with you'],
    ['resumes', 'Starting resumes', 'Facts still waiting to be verified stay off them'],
    ['templates', 'Resume templates', 'To copy the look of a resume you like, add it in Change.'],
  ] as const)('says what’s left out of %s', async (part, name, words) => {
    render(<UpdateWithClaude part={part} api={api()} run={controls()} />);
    expect((await open(name)).textContent).toContain(words);
  });

  it('keeps the words when the app turns them away, saying why', async () => {
    const run = controls();
    const requests = {
      requestProfileChanges: vi.fn(
        async () =>
          ({ ok: false, message: 'That kind of job isn’t in your Profile anymore.' }) as const,
      ),
    };
    render(<UpdateWithClaude part="about" api={requests} run={run} />);
    const dialog = await open('About you');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Change it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the changes' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('anymore');
    expect(run.start).not.toHaveBeenCalled();
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Change it');
  });

  it('stays there, unable to start, saying why, until Claude Code is ready', () => {
    render(<UpdateWithClaude part="about" api={api()} run={undefined} />);
    const button = screen.getByRole('button', { name: 'Update with Claude: About you' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Your Claude needs to be ready first.');
  });

  it('says so, keeping the words, when Claude Code stops being ready while it’s open', async () => {
    const requests = api();
    const { rerender } = render(<UpdateWithClaude part="about" api={requests} run={controls()} />);
    const dialog = await open('About you');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Change it');
    rerender(<UpdateWithClaude part="about" api={requests} run={undefined} />);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the changes' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('isn’t ready');
    expect(requests.requestProfileChanges).not.toHaveBeenCalled();
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Change it');
  });

  it('starts nothing when it’s closed while it’s saving what’s waiting', async () => {
    const run = controls();
    const requests = api();
    let saved = () => {};
    const flush = () =>
      new Promise<void>((resolve) => {
        saved = resolve;
      });
    render(<UpdateWithClaude part="about" api={requests} run={run} onBefore={flush} />);
    const dialog = await open('About you');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Change it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the changes' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    saved();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.start).not.toHaveBeenCalled();
  });

  it('says Claude is on it, or in line, for that part and no other', () => {
    const about: RunTask = { skill: 'update-profile', part: 'about', request: REQUEST };
    const wants: RunTask = { skill: 'update-profile', part: 'wants', request: REQUEST };
    const design: RunTask = { skill: 'update-profile', part: 'kind', kind: 'design', request: '' };
    const run = runControlsFor(
      [
        { id: 'run-1', task: about, phase: 'working' },
        { id: 'run-2', task: wants, phase: 'in-line' },
      ],
      () => {},
      () => {},
    );
    render(
      <>
        <section aria-label="About">
          <UpdateWithClaude part="about" api={api()} run={run} />
        </section>
        <section aria-label="Wants">
          <UpdateWithClaude part="wants" api={api()} run={run} />
        </section>
        <section aria-label="Design">
          <UpdateWithClaude part="kind" kind="design" name="Design" api={api()} run={run} />
        </section>
        <section aria-label="Product">
          <UpdateWithClaude part="kind" kind="product" name="Product" api={api()} run={run} />
        </section>
      </>,
    );
    // Named for a screen reader, which may be elsewhere.
    expect(screen.getByRole('region', { name: 'About' }).textContent).toBe(
      'Claude is on it (Update with Claude: About you)',
    );
    expect(screen.getByRole('region', { name: 'Wants' }).textContent).toBe(
      'In line (Update with Claude: What you want)',
    );
    expect(run.stateOf(design)).toBeNull();
    // Another kind of job, or another part, is free to go in line.
    expect(screen.getByRole('button', { name: 'Update with Claude: Design' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update with Claude: Product' })).toBeTruthy();
  });

  it('passes an accessibility check, with its visible words in its name', async () => {
    const { container } = render(
      <UpdateWithClaude part="applications" api={api()} run={controls()} />,
    );
    const button = screen.getByRole('button', { name: /^Update with Claude/ });
    expect(button.getAttribute('aria-label')).toContain(button.textContent);
    await open('For applications');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
