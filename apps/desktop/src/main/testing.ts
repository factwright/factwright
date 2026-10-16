import { EventEmitter } from 'node:events';
import { MainWindow, type WindowLike } from './main-window.ts';

/**
 * A stand-in for the app's window. Like Electron's, once it's closed it throws at anything asked
 * of it, but whether it's closed.
 */
export class FakeWindow extends EventEmitter implements WindowLike {
  minimized = false;
  /** Whether the user is looking at it. */
  looking = false;
  /** What was sent to its page, each with its channel first. */
  readonly sent: unknown[][] = [];
  private destroyed = false;
  readonly webContents = {
    isDestroyed: () => this.destroyed,
    send: (channel: string, ...values: unknown[]) => {
      this.alive();
      this.sent.push([channel, ...values]);
    },
  };

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    this.alive();
    return this.minimized;
  }

  isFocused(): boolean {
    this.alive();
    return this.looking;
  }

  restore(): void {
    this.alive();
    this.minimized = false;
  }

  focus(): void {
    this.alive();
    this.looking = true;
  }

  /** Closes it, as the user does: it's destroyed, then says it closed. */
  close(): void {
    this.destroyed = true;
    this.emit('closed');
  }

  /** Destroys it, without saying it closed yet. */
  destroy(): void {
    this.destroyed = true;
  }

  private alive(): void {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
  }
}

/**
 * The app's window, as the main process keeps it, opening stand-ins: with every window it opened,
 * in order, and how many have closed.
 */
export function fakeMainWindow() {
  const opened: FakeWindow[] = [];
  const closed = { count: 0 };
  const window = new MainWindow({
    open: () => {
      const made = new FakeWindow();
      opened.push(made);
      return made;
    },
    closed: () => {
      closed.count += 1;
    },
  });
  return { window, opened, closed };
}
