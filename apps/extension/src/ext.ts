/**
 * The browser's extension APIs the extension uses, in both browsers: Firefox names them `browser`
 * and Chrome `chrome`, and in Manifest V3 both answer with promises. Only what it calls is typed
 * here, so nothing else can be reached by mistake.
 */

export interface Tab {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
}

export interface MenuClick {
  menuItemId: string | number;
  pageUrl?: string;
  linkUrl?: string;
  selectionText?: string;
}

interface Event<Listener> {
  addListener(listener: Listener): void;
}

export interface Ext {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest(): { version: string };
    sendMessage(message: unknown): Promise<unknown>;
    /** A listener answers with sendResponse, and returns true while it works on the answer. */
    onMessage: Event<
      (
        message: unknown,
        sender: { id?: string; url?: string },
        sendResponse: (answer: unknown) => void,
      ) => boolean | undefined
    >;
    onInstalled: Event<(details: { reason: string }) => void>;
    onStartup: Event<() => void>;
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean; url?: string }): Promise<Tab[]>;
    create(properties: { url: string; active?: boolean }): Promise<Tab>;
    update(tabId: number, properties: { active?: boolean }): Promise<Tab>;
  };
  scripting: {
    executeScript<Result>(injection: {
      target: { tabId: number };
      func: () => Result;
    }): Promise<{ result?: Result }[]>;
  };
  storage: {
    local: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: Event<(changes: Record<string, { newValue?: unknown }>, area: string) => void>;
  };
  action: {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    setTitle(details: { title: string; tabId?: number }): Promise<void>;
    /** Opens the popup, where the browser allows it: Chrome 127 on, and Firefox on a click. */
    openPopup?(): Promise<void>;
  };
  contextMenus: {
    create(properties: {
      id: string;
      title: string;
      contexts: ('page' | 'selection' | 'link')[];
    }): unknown;
    removeAll(): Promise<void>;
    onClicked: Event<(click: MenuClick, tab?: Tab) => void>;
  };
  commands: {
    onCommand: Event<(command: string, tab?: Tab) => void>;
  };
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
    remove(permissions: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
  };
  /**
   * The browser's own window for extensions to sign in through: it opens a page, and once that
   * page goes to this extension's return address, closes, and hands the address to this extension
   * alone. Missing where a browser doesn't have it.
   */
  identity?: {
    getRedirectURL(): string;
    launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
  };
}

/** The browser's extension APIs: Firefox's `browser`, or Chrome's `chrome`. */
export const ext: Ext = ((globalThis as { browser?: Ext }).browser ??
  (globalThis as { chrome?: Ext }).chrome) as Ext;
