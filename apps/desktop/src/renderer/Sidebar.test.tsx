// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../shared/sync.ts';
import { Sidebar } from './Sidebar.tsx';

afterEach(cleanup);

/** The sidebar with sync as given, and everything else quiet. */
function renderSidebar(sync: SyncStatus | 'checking', onOpenExtension = vi.fn()) {
  render(
    <Sidebar
      page="jobs"
      onPage={vi.fn()}
      gettingStarted={false}
      claude="checking"
      onRecheckClaude={vi.fn()}
      setup={{ check: null, checking: false, checkAgain: vi.fn() }}
      sync={sync}
      onOpenSync={vi.fn()}
      onOpenClaudeSettings={vi.fn()}
      onOpenExtension={onOpenExtension}
      levels={null}
      update={{ status: { state: 'none' }, busy: false, unsaved: () => false, onRestart: vi.fn() }}
      version="0.9.1"
    />,
  );
  return onOpenExtension;
}

describe('Sidebar', () => {
  it('opens Save to Factwright’s window from Browser extension', () => {
    const onOpenExtension = renderSidebar({ state: 'off' });
    fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    expect(onOpenExtension).toHaveBeenCalledTimes(1);
    // Supporting Factwright is still a link, to Steve's page.
    expect(screen.getByRole('link', { name: 'Support Factwright' })).toBeTruthy();
  });

  it('offers the extension whatever sync is doing, as it saves straight to this computer too', () => {
    const states: (SyncStatus | 'checking')[] = [
      'checking',
      { state: 'no-server' },
      { state: 'signed-out', email: 'sam@example.com' },
      {
        state: 'signed-out',
        email: 'sam@example.com',
        ownServer: 'https://factwright-sync.sam.workers.dev',
      },
    ];
    for (const sync of states) {
      renderSidebar(sync);
      expect(screen.getByRole('button', { name: 'Browser extension' })).toBeTruthy();
      cleanup();
    }
  });
});
