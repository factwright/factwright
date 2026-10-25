// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangeView, RunChanges, UndoResult } from '../shared/run-changes.ts';
import { changesWords, TaskChanges } from './TaskChanges.tsx';

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

const FOLDER = 'applications/2026-10-25-northwind-labs-senior-engineer';

const CHANGES: RunChanges = {
  id: '20261025-140311-123-a1b2c3',
  files: [
    {
      path: `${FOLDER}/job.md`,
      change: 'changed',
      lines: { added: 12, removed: 1 },
      canUndo: true,
      undone: false,
    },
    {
      path: `${FOLDER}/resume.json`,
      change: 'new',
      lines: { added: 96, removed: 0 },
      canUndo: true,
      undone: false,
    },
    {
      path: `${FOLDER}/AlexRiveraResume10252026_Northwind.pdf`,
      change: 'new',
      lines: null,
      canUndo: true,
      undone: false,
    },
    {
      path: 'guide/preferences.md',
      change: 'changed',
      lines: { added: 1, removed: 0 },
      canUndo: false,
      undone: true,
    },
  ],
  pages: ['https://www.northwindlabs.com/about', 'https://jobs.ashbyhq.com/northwind/4f1c'],
};

function shown(
  changes: RunChanges = CHANGES,
  undone: UndoResult = { ok: true, changes: CHANGES },
  view: ChangeView | null = { before: 'One\nTwo\n', after: 'One\nThree\n' },
) {
  const api = { viewChange: vi.fn(async () => view) };
  const undo = vi.fn(async () => undone);
  const page = render(<TaskChanges api={api} changes={changes} undo={undo} />);
  return { api, undo, ...page };
}

describe('TaskChanges', () => {
  it('lists each file the task changed, with how much, and the pages it read', async () => {
    const { container } = shown();
    expect(screen.getByText('Claude changed 4 files and read 2 pages.')).toBeTruthy();
    const files = within(screen.getByRole('list', { name: 'Files Claude changed' }));
    const rows = files.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toContain('job.md');
    expect(rows[0]).toContain(FOLDER);
    expect(rows[0]).toContain('+12 −1');
    expect(rows[1]).toContain('New · 96 lines');
    expect(rows[2]).toContain('New · PDF');
    expect(rows[3]).toContain('Undone');
    // Only a file of text has a view, and only one not undone has Undo.
    expect(screen.getByRole('button', { name: `View ${FOLDER}/job.md` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^View .*\.pdf$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Undo .*\.pdf$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo guide/preferences.md' })).toBeNull();
    expect(screen.getByText('northwindlabs.com/about')).toBeTruthy();
    expect(screen.getByText('jobs.ashbyhq.com/northwind/4f1c')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('folds away, and shows again', async () => {
    shown();
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('list', { name: 'Files Claude changed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('list', { name: 'Files Claude changed' })).toBeTruthy();
  });

  it('shows a file before and after the task, a line at a time', async () => {
    const { api } = shown();
    await userEvent.click(screen.getByRole('button', { name: `View ${FOLDER}/job.md` }));
    const dialog = await screen.findByRole('dialog', { name: 'What changed in job.md' });
    expect(api.viewChange).toHaveBeenCalledWith(CHANGES.id, `${FOLDER}/job.md`);
    const lines = await within(dialog).findByRole('list', {
      name: 'The change to job.md, a line at a time',
    });
    expect(
      within(lines)
        .getAllByRole('listitem')
        .map((line) => line.textContent),
    ).toEqual([' One', '−Taken out: Two', '+Added: Three']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('folds long runs of lines both have, keeping a few around each change', async () => {
    const same = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    shown(CHANGES, undefined, {
      before: [...same, 'Old'].join('\n'),
      after: [...same, 'New'].join('\n'),
    });
    await userEvent.click(screen.getByRole('button', { name: `View ${FOLDER}/job.md` }));
    const lines = await screen.findByRole('list', { name: /a line at a time/ });
    const text = within(lines)
      .getAllByRole('listitem')
      .map((line) => line.textContent);
    expect(text).toEqual([
      '17 lines the same',
      ' Line 18',
      ' Line 19',
      ' Line 20',
      '−Taken out: Old',
      '+Added: New',
    ]);
  });

  it('says when a file is too long to show', async () => {
    shown(CHANGES, undefined, null);
    await userEvent.click(screen.getByRole('button', { name: `View ${FOLDER}/job.md` }));
    expect(await screen.findByText(/too long to show here, or isn’t text/)).toBeTruthy();
  });

  it('undoes a change, and asks first when the file changed again since', async () => {
    const since: UndoResult = {
      ok: false,
      reason: 'since',
      message: 'This file changed again after Claude’s task.',
    };
    const { undo } = shown(CHANGES, since);
    await userEvent.click(screen.getByRole('button', { name: `Undo ${FOLDER}/job.md` }));
    expect(undo).toHaveBeenLastCalledWith(`${FOLDER}/job.md`, false);
    expect(screen.getByRole('alert').textContent).toContain('changed again after Claude’s task');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: `Undo ${FOLDER}/job.md` }));
    undo.mockResolvedValueOnce({ ok: true, changes: CHANGES });
    await userEvent.click(screen.getByRole('button', { name: 'Undo anyway' }));
    expect(undo).toHaveBeenLastCalledWith(`${FOLDER}/job.md`, true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why when a file can’t be put back', async () => {
    shown(CHANGES, { ok: false, reason: 'failed', message: 'The copy of that file is gone.' });
    await userEvent.click(screen.getByRole('button', { name: `Undo ${FOLDER}/resume.json` }));
    expect((await screen.findByRole('alert')).textContent).toBe('The copy of that file is gone.');
  });

  it('shows nothing for a task that changed nothing and read nothing', () => {
    const { container } = shown({ ...CHANGES, files: [], pages: [] });
    expect(container.textContent).toBe('');
  });

  it('says what changed in a sentence', () => {
    expect(changesWords({ files: CHANGES.files.slice(0, 1), pages: [] })).toBe(
      'Claude changed 1 file.',
    );
    expect(changesWords({ files: [], pages: ['https://acme.com'] })).toBe('Claude read 1 page.');
  });
});
