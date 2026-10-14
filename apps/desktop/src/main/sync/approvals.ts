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

export interface ApprovalsDeps {
  /** After each change, for the window. */
  onChange: (view: ApprovalsView) => void;
  /** The account key, once sync is on here, to approve other devices with. */
  accountKey: () => Bytes | null;
  /** With the account key an approval brought: checks it's the account's, then turns sync on. */
  linkWith: (accountKey: Bytes) => Promise<EditResult>;
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
} as const;

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
  /** Whether the server can approve devices, once it's said. */
  private supported: boolean | null = null;
  private asking: { ask: LinkAsk | null; view: AskingView } | null = null;
  private requests: LinkRequest[] = [];
  private approving: { approval: LinkApproval; view: ApprovingView } | null = null;

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
          elsewhere: request.approver !== null && !request.approving,
        })),
      approving: this.approving?.view ?? null,
    };
  }

  private changed(): void {
    this.deps.onChange(this.view());
  }

  /**
   * Takes up a sign-in, or none, as when sync is turned off. What was under the last one stops:
   * its own request is called off, and an approval it started is left to run out.
   */
  use(client: SyncClient | null): void {
    if (client === this.client) return;
    void this.asking?.ask?.cancel().catch(() => {});
    this.client = client;
    this.supported = null;
    this.asking = null;
    this.requests = [];
    this.approving = null;
    this.changed();
    if (client) void this.check(client);
  }

  /** Asks the server whether it can approve devices, until it answers. */
  private async check(client: SyncClient): Promise<boolean> {
    if (this.supported !== null) return this.supported;
    try {
      const supported = (await client.features()).includes('approve');
      if (this.client !== client) return false;
      this.supported = supported;
      this.changed();
      return supported;
    } catch {
      return false;
    }
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
    if (this.asking && this.asking.view.step !== 'ended') return { ok: true };
    // Shown at once, while the request is made.
    const asking: { ask: LinkAsk | null; view: AskingView } = {
      ask: null,
      view: { step: 'waiting' },
    };
    this.asking = asking;
    this.changed();
    let ask: LinkAsk;
    try {
      ask = await LinkAsk.start(client);
    } catch (error) {
      if (this.asking === asking) this.endAsking(this.deps.reason(error));
      return failed(this.deps.reason(error));
    }
    if (this.asking !== asking) {
      void ask.cancel().catch(() => {});
      return { ok: true };
    }
    asking.ask = ask;
    void this.followAsking(asking, ask);
    return { ok: true };
  }

  private endAsking(message: string): void {
    if (!this.asking) return;
    this.asking = { ask: null, view: { step: 'ended', message } };
    this.changed();
  }

  /** Follows the request until it's linked or over, a step at a time. */
  private async followAsking(
    asking: NonNullable<Approvals['asking']>,
    ask: LinkAsk,
  ): Promise<void> {
    while (this.asking === asking) {
      let step: Awaited<ReturnType<LinkAsk['step']>>;
      try {
        step = await ask.step();
      } catch (error) {
        if (this.asking !== asking) return;
        if (error instanceof SyncError && error.kind === 'offline') {
          await this.wait(OFFLINE_MS);
          continue;
        }
        this.endAsking(this.deps.reason(error));
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
        this.endAsking(ENDED[step.state]);
        return;
      }
      this.changed();
      await this.wait(STEP_MS);
    }
  }

  private async finishAsking(asking: NonNullable<Approvals['asking']>, ask: LinkAsk) {
    let accountKey: Bytes | null;
    try {
      accountKey = await ask.finish();
    } catch (error) {
      if (this.asking === asking) this.endAsking(this.deps.reason(error));
      return;
    }
    if (this.asking !== asking) return;
    if (!accountKey) {
      this.endAsking(ENDED.broken);
      return;
    }
    // Picked up, so it's never called off: the approving device sees it linked.
    asking.ask = null;
    const linked = await this.deps.linkWith(accountKey);
    if (this.asking !== asking) return;
    if (!linked.ok) {
      this.endAsking(linked.message);
      return;
    }
    this.asking = null;
    this.changed();
  }

  /**
   * The person's answer on this computer: whether its emoji match the other device's. Only once
   * they match is the account key picked up. Otherwise the request is called off.
   */
  confirm(matched: boolean): void {
    const asking = this.asking;
    if (asking?.view.step !== 'check' || !asking.ask) return;
    if (!matched) {
      void asking.ask.cancel().catch(() => {});
      this.endAsking(ENDED.mismatch);
      return;
    }
    asking.ask.confirm();
    asking.view = { ...asking.view, confirmed: true };
    this.changed();
  }

  /** Stops asking, as when the person closes the dialog or links another way. */
  stopAsking(): void {
    if (!this.asking) return;
    void this.asking.ask?.cancel().catch(() => {});
    this.asking = null;
    this.changed();
  }

  // ---- Approving, on a computer that's set up ----

  /**
   * Looks again for other devices' requests to link. Without the account key, there are none.
   * It asks whether the server can approve devices again too, if it hasn't said yet.
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
      const requests = await client.linkRequests();
      if (this.client !== client) return;
      this.requests = requests.filter((request) => !request.mine);
      this.changed();
    } catch {
      // Kept as they were: the next look tries again.
    }
  }

  /** Offers to approve a request, then waits for the new device's key to show the emoji. */
  async approve(id: string): Promise<EditResult> {
    const client = this.client;
    if (!client || !this.deps.accountKey()) return failed('Turn on sync first.');
    if (this.approving && this.approving.view.step !== 'ended') {
      return failed('Finish approving the other device first.');
    }
    let approval: LinkApproval;
    let device: string;
    try {
      // Read again, so the hash it's checked against is the one the server holds now.
      const request = await client.linkRequest(id);
      if (request?.state !== 'waiting' || request.mine) return failed(ENDED.gone);
      device = request.device;
      approval = await LinkApproval.start(client, request);
    } catch (error) {
      void this.refresh();
      return failed(this.deps.reason(error));
    }
    if (this.client !== client) return failed('Signing in was canceled.');
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
        if (error instanceof SyncError && error.kind === 'offline') {
          await this.wait(OFFLINE_MS);
          continue;
        }
        this.endApproving(false, this.deps.reason(error));
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
      if (step.state === 'check' && !sent)
        approving.view = { id, device, step: 'check', check: step.check };
      this.changed();
      await this.wait(sent || step.state === 'check' ? SENT_MS : STEP_MS);
    }
  }

  /**
   * The person's answer on this computer. Only when they say the emoji match is the account key
   * sealed for the new device. Otherwise the request is turned down.
   */
  async answer(matched: boolean): Promise<EditResult> {
    const approving = this.approving;
    if (approving?.view.step !== 'check') return failed('Check the emoji first.');
    const { id, device } = approving.view;
    try {
      if (!matched) {
        await approving.approval.deny();
        if (this.approving === approving) this.endApproving(false, ENDED.mismatch);
        return { ok: true };
      }
      const accountKey = this.deps.accountKey();
      if (!accountKey) return failed('Turn on sync first.');
      await approving.approval.approve(accountKey);
    } catch (error) {
      return failed(this.deps.reason(error));
    }
    if (this.approving === approving) {
      approving.view = { id, device, step: 'sent' };
      this.changed();
    }
    return { ok: true };
  }

  /** Turns another device's request down, without starting to approve it. */
  async deny(id: string): Promise<EditResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    try {
      await client.denyRequest(id);
    } catch (error) {
      if (!(error instanceof SyncError && error.kind === 'not-found')) {
        return failed(this.deps.reason(error));
      }
    }
    await this.refresh();
    return { ok: true };
  }

  /** Puts an approval that's over away, as when the person closes it. */
  dismiss(): void {
    if (this.approving?.view.step !== 'ended') return;
    this.approving = null;
    this.changed();
  }
}
