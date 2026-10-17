import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, ServerTerms, SyncStatus } from '../../shared/sync.ts';

/** Where sync stands, kept up to date. "checking" until the app first says. */
export function useSync(api: FactwrightApi): SyncStatus | 'checking' {
  const [status, setStatus] = useState<SyncStatus | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    api.syncStatus().then(
      (latest) => live && setStatus((current) => (current === 'checking' ? latest : current)),
      () => {},
    );
    const stop = api.onSyncStatus(setStatus);
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return status;
}

const NO_APPROVALS: ApprovalsView = {
  supported: false,
  asking: null,
  requests: [],
  approving: null,
  turnedDown: null,
};

/** Linking devices by approval, as this computer takes part in it, kept up to date. */
export function useApprovals(api: FactwrightApi): ApprovalsView {
  const [view, setView] = useState(NO_APPROVALS);
  useEffect(() => {
    let live = true;
    // What the app sends as it changes is newer than the first answer, which only fills in.
    let heard = false;
    api.linkApprovals().then(
      (latest) => live && !heard && setView(latest),
      () => {},
    );
    const stop = api.onLinkApprovals((latest) => {
      heard = true;
      setView(latest);
    });
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return view;
}

/**
 * The terms and price of the server sync is with, or of Factwright's own while it's off, as the
 * server's sign-in options say. Null until they're known, and when the server has none. `server`
 * names the server, so another one's are never shown: a server of your own's address, or nothing
 * for Factwright's.
 */
export function useServerTerms(api: FactwrightApi, server: string | null): ServerTerms | null {
  const [known, setKnown] = useState<{ server: string | null; terms: ServerTerms | null }>({
    server: null,
    terms: null,
  });
  useEffect(() => {
    let live = true;
    api.syncServerTerms().then(
      (terms) => live && setKnown({ server, terms }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, server]);
  return known.server === server ? known.terms : null;
}

/** "just now", "5 minutes ago", "3 hours ago" or "on Oct 12", for when something happened. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `on ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
