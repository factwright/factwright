// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

/** The line that says what setting a browser up came to. */
const said = () => screen.getByRole('status');

describe('ExtensionDialog', () => {
  it('says where each browser stands, and sets one up only when asked, saying how it went', async () => {
    const api = sampled();
    const { container } = render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await screen.findByRole('list', { name: 'Your browsers' });
    expect(row('Google Chrome').getByText('Not set up')).toBeTruthy();
    expect(row('Firefox').getByText('Ready')).toBeTruthy();
    expect(screen.getByText(/From version 0.2, the extension can save straight/)).toBeTruthy();
    expect(screen.getByText(/macOS may ask you to allow it: choose Allow/)).toBeTruthy();
    // Looking sets nothing up.
    expect(api.setUpSaveHelper).not.toHaveBeenCalled();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Set up Google Chrome' }));
    expect(api.setUpSaveHelper).toHaveBeenCalledWith(['chrome']);
    expect(await row('Google Chrome').findByText('Ready', {}, { timeout: 2000 })).toBeTruthy();
    // The button that was clicked is gone: what happened is said, and focus goes there, once the
    // dialog's effect has run, which a busy computer can leave until after the words show.
    expect(said().textContent).toBe('Google Chrome is ready.');
    await waitFor(() => expect(document.activeElement).toBe(said()));
    // A browser that's ready can be set up again, as when its file has gone.
    expect(screen.getByRole('button', { name: 'Set up Google Chrome again' })).toBeTruthy();
  });

  it('says how to let macOS allow a browser it refused, and opens Files & Folders', async () => {
    const api = sampled('refuse');
    render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Google Chrome' }));
    expect(
      await row('Google Chrome').findByText('macOS said no', {}, { timeout: 2000 }),
    ).toBeTruthy();
    expect(said().textContent).toBe(
      'macOS didn’t let Factwright set up Google Chrome. The steps below say how to allow it.',
    );
    const note = screen.getByRole('note');
    expect(within(note).getByText('To let macOS allow it')).toBeTruthy();
    expect(within(note).getByText('Under Factwright, turn on Google Chrome.')).toBeTruthy();
    await userEvent.click(within(note).getByRole('button', { name: 'Open Files & Folders' }));
    expect(api.openFilesAndFolders).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again for Google Chrome' })).toBeTruthy();
  });

  it('names each app to allow, as Files & Folders does, Chrome’s too for Brave', async () => {
    render(<ExtensionDialog api={sampled('brave')} onClose={vi.fn()} />);
    await screen.findByRole('list', { name: 'Your browsers' });
    expect(
      within(screen.getByRole('note')).getByText(
        'Under Factwright, turn on Google Chrome and Brave Browser.',
      ),
    ).toBeTruthy();
  });

  it('says in words what went wrong besides macOS refusing', async () => {
    const view: SaveHelperView = {
      unavailable: null,
      onRequest: true,
      browsers: [
        { id: 'chrome', name: 'Google Chrome', state: 'not-set-up', allow: ['Google Chrome'] },
      ],
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
    expect(said().textContent).toBe('Google Chrome couldn’t be set up: The disk is full.');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says so when setting up fails outright', async () => {
    const api = {
      ...sampled(),
      setUpSaveHelper: vi.fn(async (): Promise<SetUpResult> => {
        throw new Error('Those aren’t browsers to set up.');
      }),
    };
    render(<ExtensionDialog api={api} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Google Chrome' }));
    expect(said().textContent).toBe('Setting up Google Chrome didn’t work. Try again.');
    // What the window knew still shows.
    expect(row('Google Chrome').getByText('Not set up')).toBeTruthy();
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
      await screen.findByText(/didn’t find a browser the extension runs in: Chrome, Chromium/),
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
