// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../shared/sync.ts';
import type { UpdateStatus } from '../shared/updates.ts';
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
      update={{
        status: { state: 'none' },
        inBanner: false,
        busy: false,
        unsaved: () => false,
        onRestart: vi.fn(),
      }}
      version="0.9.1"
    />,
  );
  return onOpenExtension;
}

/** The sidebar with an update as given, its strip put off, and everything else quiet. */
function sidebarWithUpdate(status: UpdateStatus, onRestart: () => Promise<boolean>) {
  return (
    <Sidebar
      page="jobs"
      onPage={vi.fn()}
      gettingStarted={false}
      claude="checking"
      onRecheckClaude={vi.fn()}
      setup={{ check: null, checking: false, checkAgain: vi.fn() }}
      sync={{ state: 'off' }}
      onOpenSync={vi.fn()}
      onOpenClaudeSettings={vi.fn()}
      onOpenExtension={vi.fn()}
      levels={null}
      update={{ status, inBanner: false, busy: false, unsaved: () => false, onRestart }}
      version="0.18.0"
    />
  );
}

describe('Sidebar', () => {
  it('starts the update card afresh for each update', async () => {
    const ready: UpdateStatus = { state: 'ready', version: '0.18.1', notes: null };
    const { rerender } = render(sidebarWithUpdate(ready, async () => false));
    // The restart didn't happen, as when Claude started working meanwhile.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restart now' })));
    expect(screen.getByText(/Factwright didn’t restart/)).toBeTruthy();
    // A newer update took its place.
    rerender(sidebarWithUpdate({ state: 'downloading', version: '0.18.2', percent: 10 }, vi.fn()));
    rerender(sidebarWithUpdate({ ...ready, version: '0.18.2' }, async () => true));
    expect(screen.queryByText(/Factwright didn’t restart/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });

  it('opens the Browser extension window from its button', () => {
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

  it('opens the roadmap to suggest a feature, just above Report a problem', () => {
    renderSidebar({ state: 'off' });
    const suggest = screen.getByRole('link', { name: 'Suggest a feature' });
    // It opens in the user's own browser, as the window opens a link outside it. The app sends
    // nothing itself.
    expect(suggest.getAttribute('href')).toBe('https://factwright.com/roadmap');
    expect(suggest.getAttribute('target')).toBe('_blank');
    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.indexOf('Suggest a feature')).toBe(links.indexOf('Report a problem') - 1);
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
