import type { AccountInfo } from '@factwright/sync';

/** What sync is doing right now: syncing, done, unable to reach the server, or stuck. */
export type SyncActivity = 'syncing' | 'idle' | 'offline' | 'problem';

/**
 * Why a computer that synced before sets up again:
 * - `remade`: the account has no key on the server, such as after it was deleted and made again.
 *   A new account key and recovery key, which the old ones won't open.
 * - `unsaved`: the account has no key on the server, though this computer has synced it under
 *   its own, as version 0.1.0 did after an account was made again. A recovery key for that key.
 * - `changed`: the account this computer synced uses another key now. It links again.
 */
export type SetUpAgain = 'remade' | 'unsaved' | 'changed';

/** Where sync stands on this computer, as the sidebar and the sync dialog show it. */
export type SyncStatus =
  | { state: 'off' }
  /** The system's keychain can't keep secrets, so sync can't turn on here. */
  | { state: 'unavailable' }
  /** Waiting for the user to approve signing in, in their browser. */
  | { state: 'signing-in'; code: string; url: string }
  /**
   * Signed in, but this computer doesn't have the account key yet. The first device makes it,
   * with a recovery key; any other gets it from a device that's set up, or the recovery key.
   */
  | {
      state: 'setting-up';
      email: string;
      firstDevice: boolean;
      again?: SetUpAgain;
    }
  | {
      state: 'on';
      email: string;
      activity: SyncActivity;
      /** When the last sync finished, as an ISO time. */
      lastSynced: string | null;
      /** What went wrong, or what to know, in plain words. */
      message: string | null;
      /** How many files stay on this computer, too big or with a name others can't hold. */
      skipped: number;
    }
  /** The session ended, such as when this computer was signed out from another device. */
  | { state: 'signed-out'; email: string };

/** A code for adding a phone or computer: a QR code's address, and the code to type. */
export interface LinkCode {
  id: string;
  /** The code, in groups of four, such as "7KQ2-M9XD-…". */
  code: string;
  /** The web view's address with the code, for a phone's camera. */
  url: string;
  expiresAt: string;
}

export type RecoveryKeyResult = { ok: true; recoveryKey: string } | { ok: false; message: string };

export type LinkCodeResult = { ok: true; link: LinkCode } | { ok: false; message: string };

export type AccountResult = { ok: true; account: AccountInfo } | { ok: false; message: string };
