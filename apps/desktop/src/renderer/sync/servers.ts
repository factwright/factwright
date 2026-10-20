import type { SyncStatus } from '../../shared/sync.ts';

/**
 * The guide to running a sync server of your own, on Factwright's website, which "How to set one
 * up" and "How to update" open, kept with the web view's and Save to Factwright's in
 * @factwright/core.
 */
export { OWN_SERVER_GUIDE } from '@factwright/core';

/** A server's address as people know it, such as factwright-sync.sam.workers.dev. */
export const hostOf = (server: string): string => new URL(server).host;

/** Whose a server's pages are, in a sentence: Factwright's, or a server of your own's by its address. */
export const whose = (own: string | null): string => (own ? `${hostOf(own)}’s` : 'Factwright’s');

/** The server of your own a status is with, if it's one, by its address. */
export function ownServerOf(status: SyncStatus): string | null {
  return 'ownServer' in status ? (status.ownServer ?? null) : null;
}
