// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASK_FIRST, type ClaudePermissions } from '../shared/permissions.ts';
import { PermissionsDialog } from './PermissionsDialog.tsx';

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

/** The window's API for this setting, keeping what's chosen. */
function apiWith(start: ClaudePermissions = ASK_FIRST) {
  let saved = start;
  return {
    claudePermissions: vi.fn(async () => saved),
    setClaudePermissions: vi.fn(async (chosen: ClaudePermissions) => {
      saved = chosen;
      return chosen;
    }),
  };
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('PermissionsDialog', () => {
  it('says what Claude always does, and asks first for the rest until the user chooses', async () => {
    const { container } = render(<PermissionsDialog api={apiWith()} onClose={vi.fn()} />);
    await waitFor(() => expect(box('Change any file in your job hunt').checked).toBe(false));
    expect(box('Read any website').checked).toBe(false);
    expect(screen.getByText(/reads postings on Greenhouse, Lever, Ashby and Gem/)).toBeTruthy();
    expect(screen.getByText('Changes apply the next time Claude starts.')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('saves each choice as it’s made', async () => {
    const api = apiWith();
    render(<PermissionsDialog api={api} onClose={vi.fn()} />);
    await waitFor(() => expect(box('Read any website').disabled).toBe(false));
    await userEvent.click(box('Change any file in your job hunt'));
    expect(api.setClaudePermissions).toHaveBeenLastCalledWith({ anyFile: true, anySite: false });
    await userEvent.click(box('Read any website'));
    expect(api.setClaudePermissions).toHaveBeenLastCalledWith({ anyFile: true, anySite: true });
    expect(box('Read any website').checked).toBe(true);
  });

  it('explains each choice, for screen readers too', async () => {
    render(<PermissionsDialog api={apiWith()} onClose={vi.fn()} />);
    const files = await screen.findByRole('checkbox', { name: 'Change any file in your job hunt' });
    const hint = document.getElementById(files.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('facts, guide and base resumes');
    const sites = box('Read any website');
    expect(
      document.getElementById(sites.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('trick Claude into sending your details');
  });

  it('says when a choice didn’t save, and shows what’s really saved', async () => {
    const api = apiWith();
    api.setClaudePermissions.mockRejectedValueOnce(new Error('disk full'));
    render(<PermissionsDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Read any website' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t save. Try again.');
    await waitFor(() => expect(box('Read any website').checked).toBe(false));
  });

  it('closes with Done', async () => {
    const onClose = vi.fn();
    render(<PermissionsDialog api={apiWith()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
