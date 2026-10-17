import type { SyncStatus } from '../../shared/sync.ts';

/**
 * The steps for running a sync server of your own, which "How to set one up" and "How to update"
 * open: the ready-to-deploy copy, with its Deploy to Cloudflare button.
 */
export const OWN_SERVER_GUIDE = 'https://github.com/factwright/sync-server';

/** A server's address as people know it, such as factwright-sync.sam.workers.dev. */
export const hostOf = (server: string): string => new URL(server).host;

/** Whose a server's pages are, in a sentence: Factwright's, or a server of your own's by its address. */
export const whose = (own: string | null): string => (own ? `${hostOf(own)}’s` : 'Factwright’s');

/** The server of your own a status is with, if it's one, by its address. */
export function ownServerOf(status: SyncStatus): string | null {
  return 'ownServer' in status ? (status.ownServer ?? null) : null;
}

/**
 * Whether Save to Factwright can save through the sync here. For now that's Factwright's own sync
 * only, as the stores' extension reaches app.factwright.com alone. So it can't with a server of
 * your own, or in a copy without Factwright's sync.
 */
export function extensionWorks(status: SyncStatus | 'checking', factwrightSync: boolean): boolean {
  if (status === 'checking' || status.state === 'no-server') return false;
  return factwrightSync && ownServerOf(status) === null;
}
