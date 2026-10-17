// @vitest-environment jsdom
import { EXTENSION_URL } from '@factwright/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../shared/sync.ts';
import { Sidebar } from './Sidebar.tsx';

afterEach(cleanup);

/** The sidebar with sync as given, and everything else quiet. */
function renderSidebar(sync: SyncStatus | 'checking', factwrightSync = true) {
  render(
    <Sidebar
      page="jobs"
      onPage={vi.fn()}
      gettingStarted={false}
      claude="checking"
      onRecheckClaude={vi.fn()}
      setup={{ check: null, checking: false, checkAgain: vi.fn() }}
      sync={sync}
      factwrightSync={factwrightSync}
      onOpenSync={vi.fn()}
      onOpenClaudeSettings={vi.fn()}
      levels={null}
      update={{ status: { state: 'none' }, busy: false, unsaved: () => false, onRestart: vi.fn() }}
      version="0.8.0"
    />,
  );
}

describe('Sidebar', () => {
  it('links to the browser extension, which opens in the user’s browser', () => {
    renderSidebar({ state: 'off' });
    const link = screen.getByRole('link', { name: 'Browser extension' });
    expect(link.getAttribute('href')).toBe(EXTENSION_URL);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('leaves the extension out of a copy without Factwright’s sync, which it saves through', () => {
    renderSidebar({ state: 'off' }, false);
    expect(screen.queryByRole('link', { name: 'Browser extension' })).toBeNull();
    // Supporting Factwright doesn't need sync.
    expect(screen.getByRole('link', { name: 'Support Factwright' })).toBeTruthy();
    cleanup();
    // Nor where this computer syncs through Factwright's, set up by a copy that has it.
    renderSidebar({ state: 'no-server' }, false);
    expect(screen.queryByRole('link', { name: 'Browser extension' })).toBeNull();
  });

  it('leaves the extension out with a server of your own, which it can’t reach yet', () => {
    renderSidebar({
      state: 'signed-out',
      email: 'sam@example.com',
      ownServer: 'https://factwright-sync.sam.workers.dev',
    });
    expect(screen.queryByRole('link', { name: 'Browser extension' })).toBeNull();
    cleanup();
    renderSidebar({ state: 'signed-out', email: 'sam@example.com' });
    expect(screen.getByRole('link', { name: 'Browser extension' })).toBeTruthy();
  });

  it('waits for sync’s check before linking to the extension', () => {
    renderSidebar('checking');
    expect(screen.queryByRole('link', { name: 'Browser extension' })).toBeNull();
  });
});
