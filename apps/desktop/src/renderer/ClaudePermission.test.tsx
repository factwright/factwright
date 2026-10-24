// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditResult } from '../shared/api.ts';
import type { PermissionAnswer, PermissionAsk } from '../shared/permission-asks.ts';
import { ClaudePermission } from './ClaudePermission.tsx';

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

const PAGE: PermissionAsk = {
  id: 'perm_1',
  kind: 'page',
  url: 'https://jobs.example.com/careers/42',
  host: 'jobs.example.com',
};

/** Waits out the moment the answers wait after a prompt shows: half a second, or more when busy. */
const answerable = () =>
  vi.waitFor(
    () => expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', false),
    { timeout: 2000 },
  );

function open(ask: PermissionAsk = PAGE, result: EditResult = { ok: true }) {
  const api = {
    answerPermission: vi.fn(async (_id: string, _answer: PermissionAnswer | 'terminal') => result),
  };
  const onClose = vi.fn();
  const view = render(
    <ClaudePermission api={api} ask={ask} about="Fit check · Acme Robotics" onClose={onClose} />,
  );
  return { api, onClose, ...view };
}

describe('ClaudePermission', () => {
  it('shows the whole address of a page, and the site it goes to, for the user to OK', async () => {
    const { container, api, onClose } = open();
    const dialog = screen.getByRole('dialog', { name: 'Let Claude read a web page?' });
    expect(dialog.textContent).toContain(
      'Claude Code asks, as your Claude works on Fit check · Acme Robotics.',
    );
    expect(screen.getByText('https://jobs.example.com/careers/42')).toBeTruthy();
    expect(screen.getByText('jobs.example.com').tagName).toBe('STRONG');
    expect((await axe.run(container)).violations).toEqual([]);
    // A click the moment it shows, such as a double-click's second, answers nothing.
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', true);
    await answerable();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(api.answerPermission).toHaveBeenCalledWith('perm_1', { allow: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('says no with a note for Claude, or leaves it to the terminal', async () => {
    const first = open();
    await userEvent.click(screen.getByRole('button', { name: 'Tell Claude why not' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note for Claude' }),
      'Use the posting',
    );
    await answerable();
    await userEvent.click(screen.getByRole('button', { name: 'Don’t allow' }));
    expect(first.api.answerPermission).toHaveBeenCalledWith('perm_1', {
      allow: false,
      note: 'Use the posting',
    });
    cleanup();
    const second = open();
    await userEvent.click(screen.getByRole('button', { name: 'Answer in the terminal' }));
    expect(second.api.answerPermission).toHaveBeenCalledWith('perm_1', 'terminal');
    expect(second.onClose).toHaveBeenCalled();
  });

  it('shows a file’s change as the text it takes out and puts in, warning of a file elsewhere', () => {
    open({
      id: 'perm_2',
      kind: 'edit',
      file: '/Users/alex/notes.md',
      outside: true,
      before: 'old words',
      after: 'new words',
      everywhere: true,
    });
    expect(screen.getByRole('dialog', { name: 'Let Claude change a file?' })).toBeTruthy();
    expect(screen.getByText('/Users/alex/notes.md')).toBeTruthy();
    expect(screen.getByText(/outside your job hunt folder/)).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'It replaces, every place it appears' }).textContent,
    ).toContain('old words');
    expect(screen.getByRole('region', { name: 'With' }).textContent).toContain('new words');
  });

  it('says when writing a file replaces one, and shows all it writes', () => {
    open({
      id: 'perm_3',
      kind: 'write',
      file: 'guide/voice.md',
      outside: false,
      content: '# How you sound',
      replaces: true,
    });
    expect(screen.getByRole('dialog', { name: 'Let Claude replace a file?' })).toBeTruthy();
    expect(screen.getByText(/replaces all of it/)).toBeTruthy();
    expect(screen.queryByText(/outside your job hunt folder/)).toBeNull();
    expect(screen.getByRole('region', { name: 'What it writes' }).textContent).toContain(
      '# How you sound',
    );
  });

  it('lists what saving to the profile saves, and what it clears', () => {
    open({
      id: 'perm_4',
      kind: 'profile',
      changes: [
        { label: 'When you can start', value: 'Two weeks’ notice' },
        { label: 'Phone', value: null },
      ],
    });
    expect(
      screen.getByRole('dialog', { name: 'Let Claude save this to your profile?' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'When you can start',
      'Phone',
    ]);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'Two weeks’ notice',
      'Clears what’s there',
    ]);
  });

  it('names the template it replaces by its own name and ID, and shows the whole new one', () => {
    open({
      id: 'perm_5',
      kind: 'template',
      template: 'executive',
      name: 'Navy (clean)',
      look: 'Navy headings.',
      replace: true,
      replacing: 'Executive',
      code: '{\n  "name": "Navy (clean)"\n}',
    });
    expect(
      screen.getByRole('dialog', { name: 'Let Claude replace your template “Executive”?' }),
    ).toBeTruthy();
    expect(screen.getByText('executive').tagName).toBe('CODE');
    expect(screen.getByText(/It replaces your template “Executive”/)).toBeTruthy();
    expect(screen.getByText('The whole template, as it saves it')).toBeTruthy();
    expect(screen.getByText(/"name": "Navy \(clean\)"/).tagName).toBe('PRE');
  });

  it('stays open, saying why, when the answer doesn’t reach Claude Code', async () => {
    const { onClose } = open(PAGE, {
      ok: false,
      message: 'Claude Code isn’t waiting for this anymore.',
    });
    await answerable();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Claude Code isn’t waiting for this anymore.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
