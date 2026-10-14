import { type Bytes, concat, fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes.ts';
import type { SyncClient } from './client.ts';
import { ACCOUNT_KEY_BYTES, type Key, lock, unlock } from './keys.ts';
import { isOneTimeKey, isRequestId, type LinkRequest } from './protocol.ts';

/*
 * Approving a new device from one that's set up, so nobody types a code. It works as Matrix's
 * emoji check (m.sas.v1) and Bluetooth's number comparison do:
 *
 * 1. The new device makes a one-time key pair and asks to link. It sends a hash of its public
 *    key with the request, not the key itself. The hash fixes the key before anyone sees it.
 * 2. A device that's set up offers to approve it, with a one-time public key of its own.
 * 3. Only then does the new device show its public key. The approver checks it hashes to what
 *    the request said.
 * 4. Each works out the same secret from its own private key and the other's public key (ECDH),
 *    and shows six emoji made from it. The person checks both screens show the same.
 * 5. Once they say so on the approver, it seals the account key with a key made from the secret.
 *    Once they say so on the new device, it picks the sealed key up, once, and opens it.
 *
 * The server passes everything along, and sees only public keys, the hash and sealed data. To
 * get the account key, or to slip a key of its own to the new device, it would have to swap in
 * keys of its own and still make both screens show the same emoji. The hash fixes the key it
 * shows the approver before it sees the approver's key, and the new device shows its key only
 * after the server has passed one along, so whatever it swaps in, the emoji on the two screens
 * are each pure chance: they match one time in 2^36. Each try needs the person to start linking,
 * and a miss shows them two different sets of emoji.
 */

const subtle = () => crypto.subtle;

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const AES = { name: 'AES-GCM', length: 256 } as const;
const SALT = utf8('factwright');

/** A request's ID, which the new device picks. */
const REQUEST_ID_BYTES = 16;

/** A one-time public key: an uncompressed P-256 point. */
const PUBLIC_KEY_BYTES = 65;

/** Emoji in a check code. Each is one of 64, so six make 36 bits. */
export const CHECK_LENGTH = 6;

/** What the steps of approving need from the sync server. */
export type ApproveClient = Pick<
  SyncClient,
  | 'askToLink'
  | 'linkRequest'
  | 'offerToApprove'
  | 'showKey'
  | 'approveRequest'
  | 'denyRequest'
  | 'takeApproval'
  | 'cancelRequest'
>;

/** One side's one-time key pair. Its private key can't be read out, and lives only this once. */
interface OneTimeKey {
  privateKey: Key;
  /** The public key, in URL-safe base64. */
  publicKey: string;
}

/*
 * Web Crypto's types differ a little between Node, browsers and Workers, though what runs is the
 * same. These are written so they mean the same in each.
 */
type KeyPair = { publicKey: Key; privateKey: Key };
type DeriveParams = Parameters<ReturnType<typeof subtle>['deriveBits']>[0];

async function oneTimeKey(): Promise<OneTimeKey> {
  const pair = (await subtle().generateKey(P256, false, ['deriveBits'])) as KeyPair;
  const raw = new Uint8Array((await subtle().exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) };
}

/** Another device's one-time public key, or null when it isn't a point on the curve. */
async function publicKeyFrom(text: string): Promise<Key | null> {
  const raw = isOneTimeKey(text) ? fromBase64Url(text) : null;
  if (raw?.length !== PUBLIC_KEY_BYTES) return null;
  try {
    return await subtle().importKey('raw', raw, P256, false, []);
  } catch {
    return null;
  }
}

/**
 * The hash a new device asks to link with: of the request's ID and its one-time public key. Null
 * for an ID or a key that isn't one.
 */
export async function commitmentTo(id: string, key: string): Promise<string | null> {
  const idBytes = isRequestId(id) ? fromBase64Url(id) : null;
  const keyBytes = isOneTimeKey(key) ? fromBase64Url(key) : null;
  if (idBytes?.length !== REQUEST_ID_BYTES || keyBytes?.length !== PUBLIC_KEY_BYTES) return null;
  const digest = await subtle().digest(
    'SHA-256',
    concat(utf8('factwright/v1/approve/commitment\n'), idBytes, keyBytes),
  );
  return toBase64Url(new Uint8Array(digest));
}

/** Six-bit numbers from bytes, first bits first, as Matrix reads its emoji. */
function sixBitGroups(bytes: Bytes, count: number): number[] {
  const groups: number[] = [];
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6 && groups.length < count) {
      bits -= 6;
      groups.push((value >> bits) & 63);
    }
  }
  return groups;
}

/** What both devices work out the same, once each has the other's one-time public key. */
interface Agreed {
  /** The check code: six numbers from 0 to 63, one for each emoji. */
  check: number[];
  /** Seals the account key for the new device, and opens it there. */
  seal: Key;
}

/**
 * The check code and the sealing key, from this side's private key and the other's public key.
 * Both are bound to the request and to both public keys, in the order the protocol gives them.
 * Null when the other key isn't one.
 */
async function agree(
  own: OneTimeKey,
  theirs: string,
  id: string,
  side: 'new' | 'approver',
): Promise<Agreed | null> {
  const other = await publicKeyFrom(theirs);
  const idBytes = fromBase64Url(id);
  const ownBytes = fromBase64Url(own.publicKey);
  const theirBytes = fromBase64Url(theirs);
  if (!other || !idBytes || !ownBytes || !theirBytes) return null;
  const context =
    side === 'new' ? concat(idBytes, ownBytes, theirBytes) : concat(idBytes, theirBytes, ownBytes);
  const ecdh = { name: 'ECDH', public: other } as DeriveParams;
  const secret = await subtle().deriveBits(ecdh, own.privateKey, 256);
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const hkdf = (purpose: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: SALT,
    info: concat(utf8(purpose), context),
  });
  const [bits, seal] = await Promise.all([
    subtle().deriveBits(hkdf('factwright/v1/approve/check\n'), base, 48),
    subtle().deriveKey(hkdf('factwright/v1/approve/seal\n'), base, AES, false, [
      'encrypt',
      'decrypt',
    ]),
  ]);
  return { check: sixBitGroups(new Uint8Array(bits), CHECK_LENGTH), seal };
}

const sealedPurpose = (id: string) => utf8(`factwright/v1/approve/sealed\n${id}`);

/** Where a new device's request stands, as it waits to be approved. */
export type AskStep =
  /** No device has offered to approve it yet. */
  | { state: 'waiting' }
  /**
   * A device offered to approve it: the person checks both screens show these emoji. "approved"
   * once they said so on that device too, and the sealed account key waits here.
   */
  | { state: 'check'; approver: string; check: number[]; approved: boolean }
  /** Turned down on another device. */
  | { state: 'denied' }
  /** Gone: run out, or called off. */
  | { state: 'gone' }
  /** Something didn't add up, such as a key that changed or isn't one. It can't go on. */
  | { state: 'failed' };

/**
 * A new device, asking to link. It asks once, then takes each step as the request moves on, and
 * picks the account key up only once the person has said the emoji match here.
 */
export class LinkAsk {
  readonly id: string;
  private readonly client: ApproveClient;
  private readonly own: OneTimeKey;
  /** The approver's one-time key: the first one offered, which is the only one it ever uses. */
  private approverKey: string | null = null;
  private agreed: Agreed | null = null;
  private confirmed = false;
  private stepping: Promise<AskStep> | null = null;

  private constructor(client: ApproveClient, id: string, own: OneTimeKey) {
    this.client = client;
    this.id = id;
    this.own = own;
  }

  /** Asks to link, with a hash of a new one-time key. */
  static async start(client: ApproveClient): Promise<LinkAsk> {
    const own = await oneTimeKey();
    const id = toBase64Url(randomBytes(REQUEST_ID_BYTES));
    const commitment = await commitmentTo(id, own.publicKey);
    if (!commitment) throw new Error('A request to link couldn’t be made.');
    await client.askToLink(id, commitment);
    return new LinkAsk(client, id, own);
  }

  /** Where the request stands now. Steps taken at once wait for each other. */
  step(): Promise<AskStep> {
    this.stepping ??= this.takeStep().finally(() => {
      this.stepping = null;
    });
    return this.stepping;
  }

  private async takeStep(): Promise<AskStep> {
    const request = await this.client.linkRequest(this.id);
    if (!request) return { state: 'gone' };
    if (request.state === 'denied') return { state: 'denied' };
    if (request.state === 'linked') return { state: 'gone' };
    if (!request.approver) return { state: 'waiting' };
    if (this.approverKey === null) {
      const agreed = await agree(this.own, request.approver.key, this.id, 'new');
      if (!agreed) return { state: 'failed' };
      // Fixed before this device shows its own key, and never changed after.
      this.approverKey = request.approver.key;
      this.agreed = agreed;
    } else if (request.approver.key !== this.approverKey) {
      return { state: 'failed' };
    }
    if (!this.agreed) return { state: 'failed' };
    if (request.key !== this.own.publicKey) await this.client.showKey(this.id, this.own.publicKey);
    return {
      state: 'check',
      approver: request.approver.device,
      check: this.agreed.check,
      approved: request.state === 'approved',
    };
  }

  /** The person said this screen's emoji match the approver's. Until then, nothing is picked up. */
  confirm(): void {
    if (this.agreed) this.confirmed = true;
  }

  /**
   * The account key, picked up and opened once it's approved and the person has said the emoji
   * match here. Null when it isn't there, or doesn't open with what this device worked out.
   */
  async finish(): Promise<Bytes | null> {
    if (!this.agreed || !this.confirmed) return null;
    const sealed = await this.client.takeApproval(this.id);
    if (!sealed) return null;
    const locked = fromBase64Url(sealed);
    const opened = locked ? await unlock(this.agreed.seal, locked, sealedPurpose(this.id)) : null;
    return opened?.length === ACCOUNT_KEY_BYTES ? opened : null;
  }

  /** Calls the request off. */
  cancel(): Promise<void> {
    return this.client.cancelRequest(this.id);
  }
}

/** Where approving a request stands, on the device that's set up. */
export type ApprovalStep =
  /** Waiting for the new device to show its one-time key. */
  | { state: 'waiting' }
  /** The person checks both screens show these emoji. */
  | { state: 'check'; check: number[] }
  /** Another device is approving it. */
  | { state: 'taken' }
  /** The new device picked up the account key this device sealed for it. */
  | { state: 'linked' }
  /** Gone: run out, called off, or turned down. */
  | { state: 'gone' }
  /**
   * The new device's key doesn't hash to what it asked with, or isn't one: something between the
   * two devices changed it. It mustn't be approved.
   */
  | { state: 'failed' };

/** A device that's set up, approving one request. It never seals the key before the check. */
export class LinkApproval {
  readonly id: string;
  private readonly client: ApproveClient;
  /** The hash the request came with, as seen before this device offered its own key. */
  private readonly commitment: string;
  private readonly own: OneTimeKey;
  private agreed: Agreed | null = null;
  private newDeviceKey: string | null = null;
  private stepping: Promise<ApprovalStep> | null = null;

  private constructor(client: ApproveClient, request: LinkRequest, own: OneTimeKey) {
    this.client = client;
    this.id = request.id;
    this.commitment = request.commitment;
    this.own = own;
  }

  /** Offers to approve a request, with a one-time key of its own. */
  static async start(client: ApproveClient, request: LinkRequest): Promise<LinkApproval> {
    const own = await oneTimeKey();
    await client.offerToApprove(request.id, own.publicKey);
    return new LinkApproval(client, request, own);
  }

  /** Where approving stands now. Steps taken at once wait for each other. */
  step(): Promise<ApprovalStep> {
    this.stepping ??= this.takeStep().finally(() => {
      this.stepping = null;
    });
    return this.stepping;
  }

  private async takeStep(): Promise<ApprovalStep> {
    const request = await this.client.linkRequest(this.id);
    if (!request || request.state === 'denied') return { state: 'gone' };
    if (request.approver?.key !== this.own.publicKey) return { state: 'taken' };
    if (request.state === 'linked') return { state: 'linked' };
    if (this.agreed) {
      return request.key === this.newDeviceKey
        ? { state: 'check', check: this.agreed.check }
        : { state: 'failed' };
    }
    if (!request.key) return { state: 'waiting' };
    if ((await commitmentTo(this.id, request.key)) !== this.commitment) return { state: 'failed' };
    const agreed = await agree(this.own, request.key, this.id, 'approver');
    if (!agreed) return { state: 'failed' };
    this.agreed = agreed;
    this.newDeviceKey = request.key;
    return { state: 'check', check: agreed.check };
  }

  /** Once the person says both screens show the same emoji: seals the account key for the new device. */
  async approve(accountKey: Bytes): Promise<void> {
    if (!this.agreed) throw new Error('Check the emoji on both devices first.');
    const sealed = await lock(this.agreed.seal, accountKey, sealedPurpose(this.id));
    await this.client.approveRequest(this.id, toBase64Url(sealed));
  }

  /** Turns the request down. */
  deny(): Promise<void> {
    return this.client.denyRequest(this.id);
  }
}
