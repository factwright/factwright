// @vitest-environment jsdom
import { THEMES } from '@factwright/ui';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceDialog } from './AppearanceDialog.tsx';
import { showTheme, terminalColors, themeNow, watchTheme } from './theme.ts';

function open(saved = 'system') {
  const api = {
    theme: vi.fn(async () => saved),
    setTheme: vi.fn(async (theme: string) => theme),
  };
  const onClose = vi.fn();
  render(<AppearanceDialog api={api} onClose={onClose} />);
  return { api, onClose };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  showTheme('system');
  vi.unstubAllGlobals();
});

describe('AppearanceDialog', () => {
  it('offers following the system and every theme, with the one in use picked', async () => {
    open('nord');
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Nord' }).checked).toBe(true),
    );
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tokyo Night' })).toBeTruthy();
  });

  it('shows a pick straight away, on the whole window, and keeps it', async () => {
    const { api } = open();
    await userEvent.click(await screen.findByRole('radio', { name: 'Tokyo Night' }));
    expect(document.documentElement.dataset.theme).toBe('tokyo-night');
    expect(api.setTheme).toHaveBeenCalledWith('tokyo-night');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Tokyo Night' }).checked).toBe(true);
  });

  it('goes back to the system’s setting by leaving the window with no theme of its own', async () => {
    open('nord');
    showTheme('nord');
    await userEvent.click(await screen.findByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('says so when a theme can’t be kept, and still shows it', async () => {
    const { api } = open();
    api.setTheme.mockRejectedValueOnce(new Error('disk full'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Nord' }));
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t keep it');
    expect(document.documentElement.dataset.theme).toBe('nord');
  });

  it('closes with Done', async () => {
    const { onClose } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('the theme the window shows', () => {
  it('tells those watching when it changes, until they stop', () => {
    const heard = vi.fn();
    const stop = watchTheme(heard);
    showTheme('nord');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(themeNow().id).toBe('nord');
    stop();
    showTheme('dark');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('gives a run’s terminal its own colors while the theme stays the kind it started in', () => {
    const nord = THEMES.find((theme) => theme.id === 'nord');
    showTheme('nord');
    expect(terminalColors('dark')).toEqual(nord?.terminal);
  });

  it('keeps a run’s text readable when the theme turns to the other kind', () => {
    const light = THEMES.find((theme) => theme.id === 'light');
    const dark = THEMES.find((theme) => theme.id === 'dark');
    // Claude Code wrote it for dark, so light's palette would put pale text on a pale background.
    showTheme('solarized-light');
    expect(terminalColors('dark')).toEqual(dark?.terminal);
    showTheme('tokyo-night');
    expect(terminalColors('light')).toEqual(light?.terminal);
  });
});
