import type { Bytes } from './bytes.ts';
import {
  type AccountInfo,
  API,
  type Change,
  type ChangesPage,
  type ErrorBody,
  type KeyRecord,
  type PushChange,
  type PushResponse,
  type VersionInfo,
} from './protocol.ts';

/** Why a request to the sync server failed, so the app can say what to do about it. */
export type SyncErrorKind =
  /** The session ended or was signed out elsewhere: sign in again. */
  | 'signed-out'
  /** The server couldn't be reached. Try again later. */
  | 'offline'
  /** The account is out of space. */
  | 'full'
  | 'too-big'
  /** Too many requests: wait, then try again. */
  | 'slow-down'
  | 'not-found'
  | 'conflict'
  /** The server didn't take the request as sent. */
  | 'refused'
  /** Something went wrong on the server. */
  | 'server';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly status: number;
  /** For "slow-down", how many seconds to wait. */
  readonly retryAfter: number | null;

  constructor(kind: SyncErrorKind, message: string, status = 0, retryAfter: number | null = null) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const KIND_BY_STATUS: Record<number, SyncErrorKind> = {
  400: 'refused',
  401: 'signed-out',
  403: 'refused',
  404: 'not-found',
  409: 'conflict',
  413: 'too-big',
  429: 'slow-down',
  507: 'full',
};

export interface ClientOptions {
  /** The server's address, such as "https://app.factwright.com". */
  server: string;
  /** The session token, for the desktop app. The web view signs in with a cookie instead. */
  token?: () => string | null;
  /** Sent with every request, such as the app's name and version. */
  headers?: Readonly<Record<string, string>>;
  /** For tests. */
  fetch?: typeof fetch;
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: Bytes };

/** Talks to the sync server. It only ever sends locked data and opaque IDs. */
export class SyncClient {
  private readonly options: ClientOptions;

  constructor(options: ClientOptions) {
    this.options = options;
  }

  /** The address of a path on the server. */
  url(path: string): URL {
    return new URL(path, this.options.server);
  }

  private async request(path: string, init: Init = {}): Promise<Response> {
    const { json, body, ...rest } = init;
    const headers = new Headers(this.options.headers);
    const token = this.options.token?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (json !== undefined) headers.set('content-type', 'application/json');
    if (body !== undefined) headers.set('content-type', 'application/octet-stream');
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.url(path), {
        ...rest,
        headers,
        ...(json !== undefined && { body: JSON.stringify(json) }),
        ...(body !== undefined && { body }),
      });
    } catch (error) {
      throw new SyncError('offline', `Couldn’t reach the sync server: ${String(error)}`);
    }
    if (response.ok) return response;
    const answer = (await response.json().catch(() => null)) as ErrorBody | null;
    const retry = Number(response.headers.get('retry-after'));
    throw new SyncError(
      KIND_BY_STATUS[response.status] ?? 'server',
      answer?.message ?? `The sync server answered ${response.status}.`,
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }

  private async json<T>(path: string, init: Init = {}): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  /** The locked account key, or null before any device has set up sync. */
  async keys(): Promise<KeyRecord | null> {
    return (await this.json<{ keys: KeyRecord | null }>(API.keys)).keys;
  }

  /**
   * Saves the locked account key. The first device saves it. "taken" means another device got
   * there first, so this one should link to it instead.
   */
  async saveKeys(keyId: string, recovery: string): Promise<'saved' | 'taken'> {
    try {
      await this.request(API.keys, { method: 'PUT', json: { keyId, recovery } });
      return 'saved';
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'conflict') return 'taken';
      throw error;
    }
  }

  /** Changes after a point in the account's history, a page at a time. */
  changes(since: number, limit?: number): Promise<ChangesPage> {
    const query = new URLSearchParams({ since: String(since) });
    if (limit) query.set('limit', String(limit));
    return this.json(`${API.changes}?${query}`);
  }

  push(changes: PushChange[]): Promise<PushResponse> {
    return this.json(API.changes, { method: 'POST', json: { changes } });
  }

  /** Which of these files the server doesn't have yet. */
  async missingFiles(ids: string[]): Promise<string[]> {
    const answer = await this.json<{ missing: string[] }>(API.missingFiles, {
      method: 'POST',
      json: { ids },
    });
    return answer.missing;
  }

  async putFile(id: string, data: Bytes): Promise<void> {
    await this.request(`${API.files}/${id}`, { method: 'PUT', body: data });
  }

  /** A file's locked contents, or null when the server doesn't have them. */
  async getFile(id: string): Promise<Bytes | null> {
    try {
      const response = await this.request(`${API.files}/${id}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  /** A record's versions, newest first. */
  async versions(record: string): Promise<VersionInfo[]> {
    return (await this.json<{ versions: VersionInfo[] }>(`${API.records}/${record}/versions`))
      .versions;
  }

  /** One version of a record, with its data, or null when there's no such version. */
  async version(record: string, version: number): Promise<Change | null> {
    try {
      return await this.json<Change>(`${API.records}/${record}/versions/${version}`);
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  /** Leaves the account key, locked with a link code, for a new device to pick up. */
  async saveLink(id: string, data: string): Promise<void> {
    await this.request(API.links, { method: 'POST', json: { id, data } });
  }

  /** Picks up a link, which then stops working, or null when there's none under that ID. */
  async takeLink(id: string): Promise<string | null> {
    try {
      return (await this.json<{ data: string }>(`${API.links}/${id}/take`, { method: 'POST' }))
        .data;
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  async cancelLink(id: string): Promise<void> {
    await this.request(`${API.links}/${id}`, { method: 'DELETE' });
  }

  account(): Promise<AccountInfo> {
    return this.json(API.account);
  }

  /** Signs a device out of the account. */
  async removeDevice(id: string): Promise<void> {
    await this.request(`${API.devices}/${id}`, { method: 'DELETE' });
  }

  /** A short-lived ticket to listen for changes as they happen. */
  async liveTicket(): Promise<string> {
    return (await this.json<{ ticket: string }>(API.liveTicket, { method: 'POST' })).ticket;
  }

  /** Where to listen for changes, as a WebSocket address. */
  liveUrl(ticket: string): string {
    const url = this.url(`${API.live}?${new URLSearchParams({ ticket })}`);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return url.toString();
  }
}
