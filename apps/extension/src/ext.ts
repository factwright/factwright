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

/** Sites the extension may reach, and the browser's features it may use, such as native messaging. */
export interface Permissions {
  origins?: string[];
  permissions?: string[];
}

/**
 * Who sent a message: one of the extension's own pages, its script on a job site you allowed,
 * or its own frame on such a site, with the tab it's in and the frame in that tab.
 */
export interface Sender {
  id?: string;
  url?: string;
  tab?: Tab;
  frameId?: number;
}

/**
 * A script the browser runs on the sites it names, as each of their pages loads, which the
 * extension registers for the job sites you allowed, and only those.
 */
export interface ContentScript {
  id: string;
  matches: string[];
  excludeMatches?: string[];
  js: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  persistAcrossSessions?: boolean;
}

interface Event<Listener> {
  addListener(listener: Listener): void;
  removeListener?(listener: Listener): void;
}

export interface Ext {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest(): { version: string };
    sendMessage(message: unknown): Promise<unknown>;
    /**
     * Sends a message to a program on this computer, such as the helper Factwright installs, and
     * waits for its answer. It's there only once the browser lets the extension use native
     * messaging, which it asks for when you choose to save to Factwright on this computer.
     */
    sendNativeMessage?(application: string, message: object): Promise<unknown>;
    /** A listener answers with sendResponse, and returns true while it works on the answer. */
    onMessage: Event<
      (
        message: unknown,
        sender: Sender,
        sendResponse: (answer: unknown) => void,
      ) => boolean | undefined
    >;
    onInstalled: Event<(details: { reason: string }) => void>;
    onStartup: Event<() => void>;
    /** The extension's own pages that are open, such as its setup page in a tab. */
    getContexts?(filter: {
      contextTypes: 'TAB'[];
      documentUrls: string[];
    }): Promise<{ tabId: number; windowId: number }[]>;
  };
  windows: {
    update(windowId: number, properties: { focused?: boolean }): Promise<unknown>;
  };
  tabs: {
    /** Tabs, by what they show: only those on sites the browser lets the extension reach say. */
    query(query: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string | string[];
    }): Promise<Tab[]>;
    create(properties: { url: string; active?: boolean }): Promise<Tab>;
    update(tabId: number, properties: { active?: boolean }): Promise<Tab>;
    /** Sends the extension's script in a tab a message, in one frame, and waits for its answer. */
    sendMessage(tabId: number, message: unknown, options?: { frameId?: number }): Promise<unknown>;
    /** A tab coming to the front, in a window. */
    onActivated: Event<(info: { tabId: number; windowId: number }) => void>;
    /** A tab closing. */
    onRemoved: Event<(tabId: number) => void>;
  };
  scripting: {
    /** Runs one function in a tab's page, given what it's passed, and waits for what it gives back. */
    executeScript<Result, Args extends unknown[] = []>(
      injection:
        | { target: { tabId: number }; func: (...args: Args) => Result; args?: Args }
        | { target: { tabId: number }; files: string[] },
    ): Promise<{ result?: Awaited<Result> }[]>;
    /** Has the browser run a script on the sites it names, as their pages load, from now on. */
    registerContentScripts(scripts: ContentScript[]): Promise<void>;
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<ContentScript[]>;
    updateContentScripts(scripts: ContentScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  };
  /**
   * Chrome's side panel, beside the page, where filling a form is checked. Opening it takes a
   * click, a menu item or a shortcut. Missing in Firefox, which has a sidebar instead.
   */
  sidePanel?: {
    open(options: { tabId?: number; windowId?: number }): Promise<void>;
  };
  /**
   * Firefox's sidebar, as Chrome's side panel. Opening it takes a click on the extension's button
   * or in one of its own pages, a menu item or a shortcut: never a click in a page's frame.
   */
  sidebarAction?: {
    open(): Promise<void>;
    isOpen(details: { windowId?: number }): Promise<boolean>;
  };
  /**
   * Chrome's rules for how the toolbar button looks on pages that match them, which the browser
   * checks itself, so the extension never reads a page to light the button up. Missing in Firefox.
   */
  declarativeContent?: {
    onPageChanged: {
      removeRules(ruleIds?: string[]): Promise<void>;
      addRules(
        rules: { id?: string; conditions: unknown[]; actions: unknown[] }[],
      ): Promise<unknown>;
    };
    PageStateMatcher: new (options: {
      pageUrl?: { hostSuffix?: string; hostEquals?: string; schemes?: string[] };
      css?: string[];
    }) => unknown;
    SetIcon: new (options: { imageData: Record<number, ImageData> }) => unknown;
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
    /** Opens the popup, where the browser allows it: Chrome, and Firefox on a click. */
    openPopup?(): Promise<void>;
  };
  contextMenus: {
    create(properties: {
      id: string;
      title: string;
      contexts: ('page' | 'selection' | 'link' | 'editable')[];
    }): unknown;
    removeAll(): Promise<void>;
    onClicked: Event<(click: MenuClick, tab?: Tab) => void>;
  };
  commands: {
    onCommand: Event<(command: string, tab?: Tab) => void>;
  };
  permissions: {
    contains(permissions: Permissions): Promise<boolean>;
    request(permissions: Permissions): Promise<boolean>;
    remove(permissions: Permissions): Promise<boolean>;
    getAll(): Promise<Permissions>;
    /** Permissions the browser granted, or took away, as from its own settings. */
    onAdded: Event<(permissions: Permissions) => void>;
    onRemoved: Event<(permissions: Permissions) => void>;
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
