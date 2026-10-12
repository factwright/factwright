import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SyncStatus } from '../../shared/sync.ts';

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
