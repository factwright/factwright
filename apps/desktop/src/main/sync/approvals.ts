import {
  type Bytes,
  LinkApproval,
  LinkAsk,
  type LinkRequest,
  type SyncClient,
  SyncError,
} from '@factwright/sync';
import type { EditResult } from '../../shared/api.ts';
import type { ApprovalsView, ApprovingView, AskingView } from '../../shared/sync.ts';

/** How often a step that waits on the other device looks again. */
const STEP_MS = 1500;
/** How long to wait after the server couldn't be reached, before looking again. */
const OFFLINE_MS = 5000;
/** How often an approval waiting on the new device's person looks, to see it's still there. */
const SENT_MS = 3000;
/** How long a server's word that it can't approve devices holds, before it's asked again. */
const RECHECK_MS = 10 * 60 * 1000;
/** How long calling a request off may hold up the app as it quits. */
const QUIT_MS = 1500;

export interface ApprovalsDeps {
  /** After each change, for the window. */
  onChange: (view: ApprovalsView) => void;
  /** The account key, once sync is on here, to approve other devices with. */
  accountKey: () => Bytes | null;
  /** The account key's ID, which the emoji are bound to, once sync is on here. */
  keyId: () => string | null;
  /** With the account key an approval brought: checks it's the account's, then turns sync on. */
  linkWith: (accountKey: Bytes) => Promise<EditResult>;
  /** When the server says this sign-in has ended, such as when another device signed it out. */
  signedOut: () => void;
  /** What to tell the user when a request to the server fails. */
  reason: (error: unknown) => string;
  /** For tests. */
  wait?: (ms: number) => Promise<void>;
}

const failed = (message: string) => ({ ok: false as const, message });

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ENDED = {
  denied: 'Your other device turned this down, so nothing was linked.',
  gone: 'That request ran out before it was approved. Ask again, or type a code.',
  failed:
    'Something changed the request on its way between your devices, so nothing was linked. Ask again.',
  mismatch: 'Nothing was linked. If you didn’t start this, you can ignore it.',
  broken: 'That didn’t work, so nothing was linked. Ask again.',
  crowded:
    'More than one device is asking to link. Turn down any that aren’t yours, then approve yours.',
} as const;

const isSignedOut = (error: unknown) => error instanceof SyncError && error.kind === 'signed-out';
const isOffline = (error: unknown) => error instanceof SyncError && error.kind === 'offline';

/** This computer asking: the request, while it can still be called off, and how it stands. */
interface Asking {
  ask: LinkAsk | null;
  view: AskingView;
  /** Picking the sealed key up, so the request is never called off now. */
  finishing: boolean;
}

/**
 * Linking devices by approval, on this computer, in both directions:
 * - asking: this computer, signed in but not linked, asks a device that's set up to approve it.
 * - approving: with sync on here, other devices' requests to link, and approving one.
 * Either way the person checks both screens show the same emoji. The steps themselves, and why
 * they're safe, are in @factwright/sync's approve.ts.
 */
export class Approvals {
  private readonly deps: ApprovalsDeps;
  private readonly wait: (ms: number) => Promise<void>;
  private client: SyncClient | null = null;
  /** Whether the server can approve devices, once it's said, and when it said so. */
  private supported: boolean | null = null;
  private checkedAt = 0;
  private asking: Asking | null = null;
  private requests: LinkRequest[] = [];
  private approving: { approval: LinkApproval; view: ApprovingView } | null = null;
  /** The request this computer turned down last, which the person can still sign out. */
  private turnedDown: { id: string; device: string } | null = null;

  constructor(deps: ApprovalsDeps) {
    this.deps = deps;
    this.wait = deps.wait ?? pause;
  }

  view(): ApprovalsView {
    return {
      supported: this.supported === true,
      asking: this.asking?.view ?? null,
      requests: this.requests
        .filter((request) => request.id !== this.approving?.view.id)
        .map((request) => ({
          id: request.id,
          device: request.device,
          asked: request.asked,
          signedIn: request.signedIn,
          elsewhere: request.approver !== null && !request.approving,
        })),
      approving: this.approving?.view ?? null,
      turnedDown: this.turnedDown,
    };
  }

  private changed(): void {
    this.deps.onChange(this.view());
  }

  /** Calls this computer's own request off, unless it's being picked up. */
  private callOff(asking: Asking | null): Promise<void> {
    if (!asking?.ask || asking.finishing) return Promise.resolve();
    return asking.ask.cancel().catch(() => {});
  }

  /**
   * Takes up a sign-in, or none, as when sync is turned off. What was under the last one stops:
   * its own request is called off, and an approval it started is left to run out.
   */
  use(client: SyncClient | null): void {
    if (client === this.client) return;
    void this.callOff(this.asking);
    this.client = client;
    this.supported = null;
    this.asking = null;
    this.requests = [];
    this.approving = null;
    this.turnedDown = null;
    this.changed();
    if (client) void this.check(client);
  }

  /** As the app quits: calls this computer's own request off, as far as there's time to. */
  async stop(): Promise<void> {
    const asking = this.asking;
    this.asking = null;
    await Promise.race([this.callOff(asking), pause(QUIT_MS)]);
  }

  /**
   * Whether the server can approve devices. A no is asked again after a while, so a server
   * updated while the app runs gets its yes.
   */
  private async check(client: SyncClient): Promise<boolean> {
    if (this.supported === true) return true;
    if (this.supported === false && Date.now() - this.checkedAt < RECHECK_MS) return false;
    try {
      const supported = (await client.features()).includes('approve');
      if (this.client !== client) return false;
      this.checkedAt = Date.now();
      if (supported !== this.supported) {
        this.supported = supported;
        this.changed();
      }
      return supported;
    } catch {
      return false;
    }
  }

  /** Handles a request that failed, and says what went wrong. Signed out, it's signed out. */
  private failure(error: unknown): string {
    if (isSignedOut(error)) this.deps.signedOut();
    return this.deps.reason(error);
  }

  // ---- Asking, on a computer that isn't linked yet ----

  /** Asks to be approved from a device that's set up. Asking again while it waits does nothing. */
  async ask(): Promise<EditResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    if (!(await this.check(client))) {
      return failed('The sync server can’t approve devices yet. Type a code instead.');
    }
    if (this.client !== client) return failed('Signing in was canceled.');
    if (this.asking && this.asking.view.step !== 'ended' && this.asking.view.step !== 'stale') {
      return { ok: true };
    }
    // Shown at once, while the request is made.
    const asking: Asking = { ask: null, view: { step: 'waiting' }, finishing: false };
    this.asking = asking;
    this.changed();
    let ask: LinkAsk;
    try {
      ask = await LinkAsk.start(client);
    } catch (error) {
      if (this.asking !== asking) return failed(this.deps.reason(error));
      // A sign-in from a while ago can't ask: the person types a code, or signs in again.
      if (error instanceof SyncError && error.code === 'stale') {
        this.asking = { ask: null, view: { step: 'stale' }, finishing: false };
        this.changed();
        return failed(error.message);
      }
      const message = this.failure(error);
      this.endAsking(message);
      return failed(message);
    }
    if (this.asking !== asking) {
      void ask.cancel().catch(() => {});
      return { ok: true };
    }
    asking.ask = ask;
    void this.followAsking(asking, ask);
    return { ok: true };
  }

  /**
   * Ends a run with nothing linked, calling its request off unless the server's done with it: a
   * request turned down stays, so the approving device can still sign this one out. The emoji
   * stay, if they showed: once this computer has shown its key, the person can still compare
   * them with the other device's, whatever the server says next.
   */
  private endAsking(message: string, callOff = true): void {
    const asking = this.asking;
    if (!asking) return;
    if (callOff) void this.callOff(asking);
    const shown = asking.view.step === 'check' ? asking.view.check : undefined;
    this.asking = {
      ask: null,
      view: { step: 'ended', message, ...(shown && { check: shown }) },
      finishing: false,
    };
    this.changed();
  }

  /** Follows the request until it's linked or over, a step at a time. */
  private async followAsking(asking: Asking, ask: LinkAsk): Promise<void> {
    while (this.asking === asking) {
      let step: Awaited<ReturnType<LinkAsk['step']>>;
      try {
        step = await ask.step();
      } catch (error) {
        if (this.asking !== asking) return;
        if (isOffline(error)) {
          await this.wait(OFFLINE_MS);
          continue;
        }
        this.endAsking(this.failure(error));
        return;
      }
      if (this.asking !== asking) return;
      if (step.state === 'waiting') {
        asking.view = { step: 'waiting' };
      } else if (step.state === 'check') {
        const confirmed = asking.view.step === 'check' && asking.view.confirmed;
        asking.view = { step: 'check', approver: step.approver, check: step.check, confirmed };
        if (confirmed && step.approved) {
          await this.finishAsking(asking, ask);
          return;
        }
      } else {
        this.endAsking(ENDED[step.state], step.state === 'failed');
        return;
      }
      this.changed();
      await this.wait(STEP_MS);
    }
  }

  /**
   * Picks the sealed key up and links with it. Once it's picked up, it's kept and linked with
   * even if the person stops asking meanwhile, as long as it's the same sign-in.
   */
  private async finishAsking(asking: Asking, ask: LinkAsk): Promise<void> {
    const client = this.client;
    asking.finishing = true;
    let accountKey: Bytes | null;
    try {
      accountKey = await ask.finish();
    } catch (error) {
      asking.finishing = false;
      if (this.asking === asking) this.endAsking(this.failure(error));
      return;
    }
    // Picked up, so it's never called off: the approving device sees it linked.
    asking.ask = null;
    if (this.client !== client) return;
    if (!accountKey) {
      if (this.asking === asking) this.endAsking(ENDED.broken);
      return;
    }
    const linked = await this.deps.linkWith(accountKey);
    if (this.client !== client) return;
    if (!linked.ok) {
      if (this.asking === asking) this.endAsking(linked.message);
      return;
    }
    if (this.asking === asking) {
      this.asking = null;
      this.changed();
    }
  }

  /**
   * The person's answer on this computer: whether its emoji match the other device's. Only once
   * they match is the account key picked up. Otherwise the request is called off.
   */
  confirm(matched: boolean): void {
    const asking = this.asking;
    if (asking?.view.step !== 'check' || !asking.ask) return;
    if (!matched) {
      this.endAsking(ENDED.mismatch);
      return;
    }
    asking.ask.confirm();
    asking.view = { ...asking.view, confirmed: true };
    this.changed();
  }

  /** Stops asking, as when the person links another way or uses another account. */
  stopAsking(): void {
    if (!this.asking) return;
    void this.callOff(this.asking);
    this.asking = null;
    this.changed();
  }

  // ---- Approving, on a computer that's set up ----

  /**
   * Looks again for other devices' requests to link. Without the account key, there are none.
   * It asks whether the server can approve devices again too, if it hasn't said yes.
   */
  async refresh(): Promise<void> {
    const client = this.client;
    if (!client || !(await this.check(client)) || !this.deps.accountKey()) {
      if (this.requests.length > 0) {
        this.requests = [];
        this.changed();
      }
      return;
    }
    try {
      await this.lookAgain(client);
    } catch (error) {
      // Kept as they were: the next look tries again.
      if (isSignedOut(error)) this.deps.signedOut();
    }
  }

  /** The account's requests from other devices, as the server has them now. */
  private async lookAgain(client: SyncClient): Promise<LinkRequest[]> {
    const requests = (await client.linkRequests()).filter((request) => !request.mine);
    if (this.client === client) {
      this.requests = requests;
      this.changed();
    }
    return requests;
  }

  /**
   * Offers to approve a request, then waits for the new device's key to show the emoji. Only
   * while it's the one device asking: with two, someone else may be asking alongside the person.
   */
  async approve(id: string): Promise<EditResult> {
    const client = this.client;
    const keyId = this.deps.keyId();
    if (!client || !this.deps.accountKey() || !keyId) return failed('Turn on sync first.');
    if (this.approving && this.approving.view.step !== 'ended') {
      return failed('Finish approving the other device first.');
    }
    let approval: LinkApproval;
    let device: string;
    try {
      // Read again, so the hash it's checked against is the one the server holds now.
      const requests = await this.lookAgain(client);
      const request = requests.find((each) => each.id === id);
      if (request?.state !== 'waiting') return failed(ENDED.gone);
      if (requests.length > 1) return failed(ENDED.crowded);
      device = request.device;
      approval = await LinkApproval.start(client, request, keyId);
    } catch (error) {
      void this.refresh();
      return failed(this.failure(error));
    }
    if (this.client !== client) return failed('Signing in was canceled.');
    this.turnedDown = null;
    const approving = { approval, view: { id, device, step: 'waiting' } as ApprovingView };
    this.approving = approving;
    this.changed();
    void this.followApproving(approving);
    return { ok: true };
  }

  private endApproving(linked: boolean, message: string): void {
    const approving = this.approving;
    if (!approving) return;
    this.approving = {
      ...approving,
      view: {
        id: approving.view.id,
        device: approving.view.device,
        step: 'ended',
        linked,
        message,
      },
    };
    this.changed();
    void this.refresh();
  }

  private async followApproving(approving: NonNullable<Approvals['approving']>): Promise<void> {
    while (this.approving === approving) {
      let step: Awaited<ReturnType<LinkApproval['step']>>;
      try {
        step = await approving.approval.step();
      } catch (error) {
        if (this.approving !== approving) return;
        if (isOffline(error)) {
          await this.wait(OFFLINE_MS);
          continue;
        }
        this.endApproving(false, this.failure(error));
        return;
      }
      if (this.approving !== approving) return;
      const { id, device } = approving.view;
      const sent = approving.view.step === 'sent';
      if (step.state === 'linked') {
        this.endApproving(true, `${device} is linked.`);
        return;
      }
      if (step.state === 'gone') {
        this.endApproving(false, `${device} called it off, or it ran out. Nothing was linked.`);
        return;
      }
      if (step.state === 'taken') {
        this.endApproving(false, 'Another device is approving it.');
        return;
      }
      if (step.state === 'failed') {
        // Something between the devices changed the new device's key: it's turned down here.
        void approving.approval.deny().catch(() => {});
        this.endApproving(false, ENDED.failed);
        return;
      }
      if (step.state === 'check' && !sent) {
        approving.view = { id, device, step: 'check', check: step.check };
      }
      this.changed();
      await this.wait(sent || step.state === 'check' ? SENT_MS : STEP_MS);
    }
  }

  /**
   * The person's answer on this computer. Only when they say the emoji match is the account key
   * sealed for the new device, and only while it's still the one device asking. Otherwise the
   * request is turned down.
   */
  async answer(matched: boolean): Promise<EditResult> {
    const approving = this.approving;
    const client = this.client;
    if (approving?.view.step !== 'check' || !client) return failed('Check the emoji first.');
    const { id, device } = approving.view;
    try {
      if (!matched) {
        // Turned down, but not signed out: the emoji can differ for reasons that aren't the
        // device's doing, such as something between the two.
        await approving.approval.deny();
        if (this.approving === approving) this.endApproving(false, ENDED.mismatch);
        return { ok: true };
      }
      // Another device may have asked since this one was opened. Then the person checks which
      // is theirs before anything is sealed.
      const others = (await this.lookAgain(client)).filter((request) => request.id !== id);
      if (others.length > 0) return failed(ENDED.crowded);
      const accountKey = this.deps.accountKey();
      if (!accountKey) return failed('Turn on sync first.');
      await approving.approval.approve(accountKey);
    } catch (error) {
      return failed(this.failure(error));
    }
    if (this.approving === approving) {
      approving.view = { id, device, step: 'sent' };
      this.changed();
    }
    return { ok: true };
  }

  /**
   * Turns another device's request down, without starting to approve it. The device stays
   * signed in: it may be the person's own, such as a request left behind by a closed tab. The
   * person can sign it out next, if it isn't theirs.
   */
  async deny(id: string): Promise<EditResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    const device = this.requests.find((request) => request.id === id)?.device ?? 'That device';
    try {
      await client.denyRequest(id);
    } catch (error) {
      if (!(error instanceof SyncError && error.kind === 'not-found')) {
        return failed(this.failure(error));
      }
    }
    this.turnedDown = { id, device };
    await this.refresh();
    this.changed();
    return { ok: true };
  }

  /** Signs out the device whose request this computer just turned down: it isn't the person's. */
  async signOutTurnedDown(): Promise<EditResult> {
    const client = this.client;
    const turnedDown = this.turnedDown;
    if (!client || !turnedDown) return failed('There’s nothing to sign out.');
    try {
      await client.denyRequest(turnedDown.id, true);
    } catch (error) {
      const gone = error instanceof SyncError && error.kind === 'not-found';
      return failed(
        gone
          ? 'That request ran out, so it can’t sign the device out from here. Sign it out under Signed-in devices.'
          : this.failure(error),
      );
    }
    this.turnedDown = null;
    this.changed();
    return { ok: true };
  }

  /** Puts away what's over: an approval that ended, or the request just turned down. */
  dismiss(): void {
    if (this.approving?.view.step === 'ended') this.approving = null;
    this.turnedDown = null;
    this.changed();
  }
}
