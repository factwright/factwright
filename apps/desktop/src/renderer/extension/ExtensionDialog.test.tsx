// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SaveHelperView, SetUpResult } from '../../shared/save-helper.ts';
import { ExtensionDialog } from './ExtensionDialog.tsx';
import { sampleSaveHelper } from './sample-helper.ts';

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

/** The window's API, as the sample answers it, watching each call. */
function sampled(choice: string | null = null, platform = 'darwin') {
  const api = sampleSaveHelper(choice, platform);
  return {
    saveHelperStatus: vi.fn(api.saveHelperStatus),
    setUpSaveHelper: vi.fn(api.setUpSaveHelper),
    openFilesAndFolders: vi.fn(api.openFilesAndFolders),
  };
}

/** A browser's row in the list. */
const row = (name: string) => {
  const item = screen
    .getAllByRole('listitem')
    .find((each) => within(each).queryByText(name, { exact: true }));
  if (!item) throw new Error(`No row for ${name}`);
  return within(item);
};

describe('ExtensionDialog', () => {
  it('says where each browser stands, and sets one up only when asked', async () => {
    const api = sampled();
    const { container } = render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await screen.findByRole('list', { name: 'Your browsers' });
    expect(row('Google Chrome').getByText('Not set up')).toBeTruthy();
    expect(row('Firefox').getByText('Ready')).toBeTruthy();
    expect(
      screen.getByText(/macOS keeps each app’s folder to itself, so it asks you first/),
    ).toBeTruthy();
    // Looking sets nothing up.
    expect(api.setUpSaveHelper).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Set up Google Chrome' }));
    expect(api.setUpSaveHelper).toHaveBeenCalledWith(['chrome']);
    expect(await row('Google Chrome').findByText('Ready', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Set up|Try again/ })).toBeNull();
  });

  it('says how to let macOS allow a browser it refused, and opens Files & Folders', async () => {
    const api = sampled('refuse');
    render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Google Chrome' }));
    expect(
      await row('Google Chrome').findByText('macOS said no', {}, { timeout: 2000 }),
    ).toBeTruthy();
    const note = screen.getByRole('note');
    expect(within(note).getByText('To let macOS allow it')).toBeTruthy();
    expect(within(note).getByText('Under Factwright, turn on Google Chrome.')).toBeTruthy();
    // macOS refusing shows as the browser's state and these steps, not as an error.
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(within(note).getByRole('button', { name: 'Open Files & Folders' }));
    expect(api.openFilesAndFolders).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again for Google Chrome' })).toBeTruthy();
  });

  it('says in words what went wrong besides macOS refusing', async () => {
    const view: SaveHelperView = {
      unavailable: null,
      onRequest: true,
      browsers: [{ id: 'chrome', name: 'Google Chrome', state: 'not-set-up' }],
    };
    const result: SetUpResult = {
      view,
      problems: [
        { id: 'chrome', name: 'Google Chrome', blocked: false, message: 'The disk is full.' },
      ],
    };
    const api = {
      saveHelperStatus: vi.fn(async () => view),
      setUpSaveHelper: vi.fn(async () => result),
      openFilesAndFolders: vi.fn(async () => true),
    };
    render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Google Chrome' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Google Chrome couldn’t be set up: The disk is full.',
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says why this copy can’t set up the browsers', async () => {
    render(<ExtensionDialog api={sampled('translocated')} onClose={vi.fn()} />);
    expect(await screen.findByText(/Move Factwright to your Applications folder/)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    cleanup();
    render(<ExtensionDialog api={sampled('no-helper')} onClose={vi.fn()} />);
    expect(await screen.findByText(/missing the small helper/)).toBeTruthy();
  });

  it('says when no browser it runs in is installed', async () => {
    render(<ExtensionDialog api={sampled('none')} onClose={vi.fn()} />);
    expect(
      await screen.findByText(/didn’t find a browser Save to Factwright runs in/),
    ).toBeTruthy();
  });

  it('on Windows, says the browsers are told as Factwright starts', async () => {
    render(<ExtensionDialog api={sampled(null, 'win32')} onClose={vi.fn()} />);
    expect(
      await screen.findByText(/tells each browser where to find it when it starts/),
    ).toBeTruthy();
    expect(row('Google Chrome').getByText('Ready')).toBeTruthy();
    expect(screen.queryByText(/macOS/)).toBeNull();
  });

  it('says so when it can’t look for the browsers', async () => {
    const api = {
      saveHelperStatus: vi.fn(async (): Promise<SaveHelperView> => {
        throw new Error('gone');
      }),
      setUpSaveHelper: vi.fn(),
      openFilesAndFolders: vi.fn(),
    };
    render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn’t look for your browsers/,
    );
  });
});
