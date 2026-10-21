// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../shared/sync.ts';
import { reportUrl, Sidebar } from './Sidebar.tsx';

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

  it('drafts an email to report a problem, naming the version', () => {
    renderSidebar({ state: 'off' });
    const report = screen.getByRole('link', { name: 'Report a problem' });
    const href = report.getAttribute('href') ?? '';
    // It opens the user's own mail app, as the window opens a mailto link outside it.
    expect(report.getAttribute('target')).toBe('_blank');
    const draft = new URL(href);
    expect(draft.protocol).toBe('mailto:');
    expect(draft.pathname).toBe('steve@factwright.com');
    expect(draft.searchParams.get('subject')).toBe('A problem in Factwright 0.9.1');
    expect(draft.searchParams.get('body')).toContain('If it’s something Claude wrote');
  });

  it('drafts the report without a version when there isn’t one', () => {
    const draft = new URL(reportUrl(''));
    expect(draft.searchParams.get('subject')).toBe('A problem in Factwright');
    // Spaces stay spaces in the mail app, not plus signs.
    expect(reportUrl('0.12.0')).toContain('subject=A%20problem%20in%20Factwright%200.12.0');
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
