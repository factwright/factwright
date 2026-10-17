import type { AccountInfo, Legal } from '@factwright/sync';

/** What sync is doing right now: syncing, done, unable to reach the server, or stuck. */
export type SyncActivity = 'syncing' | 'idle' | 'offline' | 'problem';

/**
 * Why a computer sets up again, or links after all:
 * - `remade`: it synced before, but the account has no key on the server, such as after it was
 *   deleted and made again. A new account key and recovery key, which the old ones won't open.
 * - `changed`: the account it synced uses another key now. It links again.
 * - `taken`: another device turned on sync for the account first, as this one saved its recovery
 *   key. That device's recovery key is the one that works, and this one links to it.
 */
export type SetUpAgain = 'remade' | 'changed' | 'taken';

/** The sync server a sign-in is with, when it's one of your own. Factwright's own goes unnamed. */
export interface OnServer {
  /**
   * The server of your own, by its address, such as "https://factwright-sync.sam.workers.dev".
   * Missing for Factwright's own sync.
   */
  ownServer?: string;
}

/** Where sync stands on this computer, as the sidebar and the sync dialog show it. */
export type SyncStatus =
  | { state: 'off' }
  /** The system's keychain can't keep secrets, so sync can't turn on here. */
  | { state: 'unavailable' }
  /**
   * Sync here is with Factwright's own server, which this copy doesn't have, such as a copy built
   * from Factwright's code on the data folder of one from factwright.com. It's left as it is.
   */
  | { state: 'no-server' }
  /** Waiting for the user to approve signing in, in their browser. */
  | ({ state: 'signing-in'; code: string; url: string } & OnServer)
  /**
   * Signed in, but this computer doesn't have the account key yet. The first device makes it,
   * with a recovery key; any other gets it from a device that's set up, or the recovery key.
   */
  | ({
      state: 'setting-up';
      email: string;
      firstDevice: boolean;
      again?: SetUpAgain;
    } & OnServer)
  | ({
      state: 'on';
      email: string;
      activity: SyncActivity;
      /** When the last sync finished, as an ISO time. */
      lastSynced: string | null;
      /** What went wrong, or what to know, in plain words. */
      message: string | null;
      /** How many files stay on this computer, too big or with a name others can't hold. */
      skipped: number;
    } & OnServer)
  /**
   * The session ended, such as when this computer was signed out from another device. With a
   * server of your own, it stays the one to sign in to again, until sync is turned off here.
   */
  | ({ state: 'signed-out'; email: string } & OnServer);

/** What the window shows of a sync server's sign-in options. */
export interface ServerTerms {
  /** The terms of service and privacy policy signing in agrees to, when the server has them. */
  legal: Legal | null;
  /** Whether sync there is a subscription, so the window shows its price. */
  subscription: boolean;
}

/** The page that helps with a server of your own that won't do: setting one up, or updating it. */
export type ServerHelp = 'set-up' | 'update';

/** What connecting a server of your own says, once signing in to it ends or it won't do. */
export type ConnectResult = { ok: true } | { ok: false; message: string; help?: ServerHelp };

/** A code for adding a phone or computer: a QR code's address, and the code to type. */
export interface LinkCode {
  id: string;
  /** The code, in groups of four, such as "7KQ2-M9XD-…". */
  code: string;
  /** The web view's address with the code, for a phone's camera. */
  url: string;
  expiresAt: string;
}

/**
 * This computer asking to be linked from a device that's set up. The check is six numbers from
 * 0 to 63, each an emoji both screens show.
 */
export type AskingView =
  /** Asking: no device has offered to approve it yet. */
  | { step: 'waiting' }
  /** A device offered to approve it: the person checks both screens show the same emoji. */
  | { step: 'check'; approver: string; check: number[]; confirmed: boolean }
  /**
   * Over, with nothing linked: turned down, run out, or something didn't check out. The emoji
   * this computer showed stay, if it showed any, to compare with what the other device showed.
   */
  | { step: 'ended'; message: string; check?: number[] }
  /**
   * This computer signed in too long ago to ask, so a sign-in someone was tricked into long ago
   * can't: it types a code instead, or signs in again.
   */
  | { step: 'stale' };

/** Another device asking to link, which this computer can approve. */
export interface RequestView {
  id: string;
  /** The device asking, such as "Chrome on Windows". */
  device: string;
  /** When it asked, and when it signed in, as ISO times. */
  asked: string;
  signedIn: string;
  /** Whether another device is approving it. */
  elsewhere: boolean;
}

/** Where approving another device's request stands on this computer. */
export type ApprovingStep =
  /** Waiting for the new device to show its key. */
  | { step: 'waiting' }
  /** The person checks both screens show the same emoji. */
  | { step: 'check'; check: number[] }
  /** Approved: the new device finishes linking once its person says the emoji match there. */
  | { step: 'sent' }
  /** Over: linked, or nothing was. */
  | { step: 'ended'; linked: boolean; message: string };

/** This computer approving another device's request. */
export type ApprovingView = { id: string; device: string } & ApprovingStep;

/** Linking devices by approval, as this computer takes part in it. */
export interface ApprovalsView {
  /** Whether the sync server can approve devices. With an older one, only codes work. */
  supported: boolean;
  /** This computer, asking to be linked. */
  asking: AskingView | null;
  /** Other devices asking to link, which this computer can approve. */
  requests: RequestView[];
  /** The request this computer is approving. */
  approving: ApprovingView | null;
  /** The request this computer turned down last, whose device the person can still sign out. */
  turnedDown: { id: string; device: string } | null;
}

export type RecoveryKeyResult = { ok: true; recoveryKey: string } | { ok: false; message: string };

export type LinkCodeResult = { ok: true; link: LinkCode } | { ok: false; message: string };

export type AccountResult = { ok: true; account: AccountInfo } | { ok: false; message: string };
