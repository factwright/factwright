import { type SyncClient, SyncError } from '@factwright/sync';
import type { SyncActivity } from '../../shared/sync.ts';
import type { SyncEngine, SyncReport } from './engine.ts';
import type { SyncState } from './state.ts';

/** How long to wait after a change before syncing, so a burst of saves syncs once. */
const QUIET_MS = 1500;
/** How often to sync anyway, in case a change from elsewhere went unheard. */
const EVERY_MS = 10 * 60 * 1000;
/** Waits before trying again after the server couldn't be reached: longer each time. */
const BACKOFF_MS = [15_000, 60_000, 5 * 60_000];
/** Keeps the connection for live changes open. */
const PING_MS = 30_000;

export interface RunnerDeps {
  engine: SyncEngine;
  client: SyncClient;
  state: SyncState;
  /** After each round, with what it did. */
  onReport: (report: SyncReport) => void;
  /** Whenever what sync is doing changes. */
  onActivity: (activity: SyncActivity, message: string | null) => void;
  /** When the session has ended, so sync stops until the user signs in again. */
  onSignedOut: () => void;
  /** For tests. */
  WebSocket?: typeof WebSocket;
}

/** Why sync is stuck, in plain words. */
function problemOf(error: unknown): string {
  if (error instanceof SyncError && error.kind === 'full') {
    return 'Your account is out of space. New changes stay on this computer.';
  }
  return `Sync ran into a problem, and will try again: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Runs sync in the background: soon after each change here, as soon as another device changes
 * something, and every ten minutes anyway. One round at a time. When the server can't be
 * reached it waits, longer each time, and says so.
 */
export class SyncRunner {
  private readonly deps: RunnerDeps;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private every: ReturnType<typeof setInterval> | undefined;
  /** The round running now, if one is. */
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private stopped = false;
  private socket: WebSocket | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  start(): void {
    this.stopped = false;
    this.request(0);
    this.every = setInterval(() => this.request(0), EVERY_MS);
    void this.listen();
  }

  /** Stops syncing. Resolves once a round that's running has finished. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.every);
    clearInterval(this.ping);
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = undefined;
    await this.running;
  }

  /** Syncs soon. Asking again before then just moves it back. */
  request(delay = QUIET_MS): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.stopped) return;
    this.running = this.round();
    await this.running;
  }

  private async round(): Promise<void> {
    this.deps.onActivity('syncing', null);
    try {
      const report = await this.deps.engine.syncOnce();
      this.failures = 0;
      this.deps.onReport(report);
      this.deps.onActivity(
        report.full ? 'problem' : 'idle',
        report.full ? problemOf(new SyncError('full', '')) : null,
      );
    } catch (error) {
      this.failed(error);
    } finally {
      this.running = null;
      if (this.again && !this.stopped) {
        this.again = false;
        this.request(0);
      }
    }
  }

  private failed(error: unknown): void {
    if (error instanceof SyncError && error.kind === 'signed-out') {
      void this.stop();
      this.deps.onSignedOut();
      return;
    }
    const wait =
      error instanceof SyncError && error.kind === 'slow-down' && error.retryAfter
        ? error.retryAfter * 1000
        : (BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? EVERY_MS);
    this.failures += 1;
    const offline = error instanceof SyncError && error.kind === 'offline';
    this.deps.onActivity(
      offline ? 'offline' : 'problem',
      offline
        ? 'Can’t reach the sync server. Your changes are safe here, and sync once it’s back.'
        : problemOf(error),
    );
    this.request(wait);
  }

  /** Listens for changes other devices make, so they arrive here right away. */
  private async listen(): Promise<void> {
    if (this.stopped) return;
    const Socket = this.deps.WebSocket ?? globalThis.WebSocket;
    try {
      const ticket = await this.deps.client.liveTicket();
      if (this.stopped) return;
      const socket = new Socket(this.deps.client.liveUrl(ticket));
      this.socket = socket;
      socket.addEventListener('message', (event) => {
        try {
          const { cursor } = JSON.parse(String(event.data)) as { cursor?: unknown };
          if (typeof cursor === 'number' && cursor !== this.deps.state.cursor()) this.request(300);
        } catch {
          // A pong.
        }
      });
      socket.addEventListener('open', () => {
        clearInterval(this.ping);
        this.ping = setInterval(() => socket.send('ping'), PING_MS);
      });
      socket.addEventListener('close', () => this.listenAgain());
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'signed-out') return;
      this.listenAgain();
    }
  }

  private listenAgain(): void {
    clearInterval(this.ping);
    if (this.stopped) return;
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => void this.listen(), BACKOFF_MS[1]);
  }
}
