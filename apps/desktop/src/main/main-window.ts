/** What the app uses of its window, so tests can stand in for one. */
export interface WindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  restore(): void;
  focus(): void;
  once(event: 'closed', listener: () => void): unknown;
  webContents: { isDestroyed(): boolean; send(channel: string, ...values: unknown[]): void };
}

export interface MainWindowDeps<W extends WindowLike> {
  /** Opens a new window. */
  open: () => W;
  /** Once a window closes, whether by the user or as the app quits. */
  closed: () => void;
}

/**
 * The app's window, whichever one is open now. On a Mac the app keeps running after its window
 * closes, and the Dock opens a new one, and a closed window throws at anything asked of it. So
 * nothing keeps a window of its own: everything reaches it through this, which knows the one
 * that's open, if any.
 */
export class MainWindow<W extends WindowLike> {
  private readonly deps: MainWindowDeps<W>;
  private window: W | null = null;

  constructor(deps: MainWindowDeps<W>) {
    this.deps = deps;
  }

  /** The window that's open, or null while there's none. */
  current(): W | null {
    const window = this.window;
    return window && !window.isDestroyed() ? window : null;
  }

  /** Opens the window, unless one is open already. */
  open(): W {
    const open = this.current();
    if (open) return open;
    const window = this.deps.open();
    this.window = window;
    window.once('closed', () => {
      if (this.window === window) this.window = null;
      this.deps.closed();
    });
    return window;
  }

  /** Brings the window forward, or opens it again after it was closed. */
  show(): void {
    const open = this.current();
    if (!open) {
      this.open();
      return;
    }
    if (open.isMinimized()) open.restore();
    open.focus();
  }

  /** Whether the user is looking at the window. */
  focused(): boolean {
    return this.current()?.isFocused() ?? false;
  }

  /** Sends to the window, unless it's closed, as when a run ends while the app quits. */
  send(channel: string, ...values: unknown[]): void {
    const contents = this.current()?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(channel, ...values);
  }
}
