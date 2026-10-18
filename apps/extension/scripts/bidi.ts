// A small WebDriver BiDi client, for the end-to-end run in a real Firefox (scripts/e2e-firefox.ts):
// Playwright's Firefox can't load extensions, but Firefox itself speaks WebDriver BiDi. It starts
// Firefox headless, with a profile of its own and the prefs it's given, and talks to it over
// Node's own WebSocket. It runs functions in pages, and in Firefox's own window, and clicks as a
// person does, which an extension's page needs to ask the browser for a permission.
import { type ChildProcess, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A pref's value, as a profile's user.js sets it. */
export type Pref = string | number | boolean;

export interface FirefoxOptions {
  /** The Firefox program. */
  program: string;
  /** A folder of its own for the profile, which gets the prefs. */
  profile: string;
  prefs: Record<string, Pref>;
  /** What Firefox runs with, and passes on to the programs it starts. */
  env: NodeJS.ProcessEnv;
}

/** A page's element, as WebDriver BiDi names it, to click. */
export interface ElementRef {
  sharedId: string;
}

/** A value from a page, as WebDriver BiDi sends it. */
interface RemoteValue {
  type: string;
  value?: unknown;
  sharedId?: string;
}

/** How a function run in a page went: its value, or what it threw, and the page's realm. */
type Called =
  | { type: 'success'; result: RemoteValue; realm: string }
  | { type: 'exception'; exceptionDetails: { text: string } };

/** How long Firefox may take to start, and to answer a command. */
const START_MS = 60_000;
const COMMAND_MS = 30_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Firefox {
  private readonly process: ChildProcess;
  private readonly socket: WebSocket;
  private readonly waiting = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  private next = 0;
  /** The version that answered, such as 158.0. */
  version = '';

  private constructor(process: ChildProcess, socket: WebSocket) {
    this.process = process;
    this.socket = socket;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        type: string;
        result?: unknown;
        error?: string;
        message?: string;
      };
      const waiting = message.id === undefined ? undefined : this.waiting.get(message.id);
      if (!waiting || message.id === undefined) return;
      this.waiting.delete(message.id);
      if (message.type === 'error') {
        waiting.reject(new Error(`${message.error}: ${message.message}`));
      } else {
        waiting.resolve(message.result);
      }
    });
    // Once the session's gone, nothing waiting will be answered.
    socket.addEventListener('close', () => {
      for (const waiting of this.waiting.values()) {
        waiting.reject(new Error('Firefox ended the session.'));
      }
      this.waiting.clear();
    });
  }

  /**
   * Starts Firefox and a WebDriver BiDi session with it. System access lets the run reach the
   * extension's own pages, which Firefox counts as privileged, and Firefox's own window.
   */
  static async launch(options: FirefoxOptions): Promise<Firefox> {
    writeFileSync(
      join(options.profile, 'user.js'),
      Object.entries(options.prefs)
        .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
        .join(''),
    );
    const firefox = spawn(
      options.program,
      [
        '--headless',
        '--no-remote',
        '--profile',
        options.profile,
        '--remote-debugging-port=0',
        '--remote-allow-system-access',
      ],
      { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      // Firefox says where it listens once it's ready, on a port it picks.
      let said = '';
      const address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Firefox didn’t start: ${said}`)),
          START_MS,
        );
        const hear = (chunk: Buffer) => {
          said += chunk.toString();
          const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(said);
          if (!found?.[1]) return;
          clearTimeout(timer);
          resolve(found[1]);
        };
        firefox.stdout?.on('data', hear);
        firefox.stderr?.on('data', hear);
        firefox.on('error', reject);
        firefox.on('exit', (code) => reject(new Error(`Firefox stopped, with ${code}: ${said}`)));
      });
      const socket = new WebSocket(`${address}/session`);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('Firefox’s session didn’t open.')));
      });
      const client = new Firefox(firefox, socket);
      const session = await client.send<{ capabilities: { browserVersion: string } }>(
        'session.new',
        { capabilities: {} },
      );
      client.version = session.capabilities.browserVersion;
      return client;
    } catch (error) {
      firefox.kill('SIGKILL');
      throw error;
    }
  }

  /** Sends a command, and waits for its result. */
  send<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    const id = ++this.next;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Firefox didn’t answer ${method}.`));
      }, COMMAND_MS);
      this.waiting.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result as Result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(new Error(`${method}: ${error.message}`));
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Runs a function in a page, with what it's given as JSON, and gives what it returned, and the
   * realm it ran in.
   */
  private async call(
    context: string,
    declaration: string,
    args: unknown[],
  ): Promise<{ result: RemoteValue; realm: string }> {
    const called = await this.send<Called>('script.callFunction', {
      functionDeclaration: declaration,
      arguments: [{ type: 'string', value: JSON.stringify(args) }],
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (called.type === 'exception') throw new Error(called.exceptionDetails.text);
    return called;
  }

  /**
   * Runs a function in a page, or in Firefox's own window, and gives its answer. The function goes
   * as its source, so it can use only what it's given, and its answer comes back as JSON.
   */
  async run<Args extends unknown[], Result>(
    context: string,
    fn: (...args: Args) => Result,
    ...args: Args
  ): Promise<Awaited<Result>> {
    const { result } = await this.call(
      context,
      `async (json) => JSON.stringify(await (${fn.toString()})(...JSON.parse(json)))`,
      args,
    );
    return (
      result.type === 'string' ? JSON.parse(String(result.value)) : undefined
    ) as Awaited<Result>;
  }

  /** An element a function in the page finds, or null. */
  async find<Args extends unknown[]>(
    context: string,
    fn: (...args: Args) => Element | null | undefined,
    ...args: Args
  ): Promise<ElementRef | null> {
    const { result } = await this.call(
      context,
      `(json) => (${fn.toString()})(...JSON.parse(json)) ?? null`,
      args,
    );
    return result.type === 'node' && result.sharedId ? { sharedId: result.sharedId } : null;
  }

  /**
   * The realm of the page a browsing context shows, which a page opened again doesn't share.
   * Firefox doesn't list an extension's pages' realms, so it's the one a function runs in.
   */
  async realm(context: string): Promise<string> {
    return (await this.call(context, '() => null', [])).realm;
  }

  /**
   * Clicks an element as a person does, with the mouse at its middle: the page takes it as the
   * person's own click, which a script's click isn't.
   */
  async click(context: string, element: ElementRef): Promise<void> {
    // The mouse moves only within what the page shows, so the element is brought into view first.
    await this.send('script.callFunction', {
      functionDeclaration: '(element) => element.scrollIntoView({ block: "center" })',
      arguments: [element],
      target: { context },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    await this.send('input.performActions', {
      context,
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element } },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /** The browsing contexts of the tabs that are open, with their addresses. */
  async tabs(): Promise<{ context: string; url: string }[]> {
    const tree = await this.send<{ contexts: { context: string; url: string }[] }>(
      'browsingContext.getTree',
      { maxDepth: 0 },
    );
    return tree.contexts;
  }

  /** Firefox's own window, which the run reaches with system access. */
  async ownWindow(): Promise<string> {
    const tree = await this.send<{ contexts: { context: string }[] }>('browsingContext.getTree', {
      maxDepth: 0,
      'moz:scope': 'chrome',
    });
    const [window] = tree.contexts;
    if (!window) throw new Error('Firefox shows no window of its own.');
    return window.context;
  }

  /** Ends the session and Firefox with it, stopping it if it doesn't stop by itself. */
  async close(): Promise<void> {
    const stopped = new Promise((resolve) => {
      if (this.process.exitCode !== null || this.process.signalCode !== null) resolve(undefined);
      else this.process.once('exit', resolve);
    });
    await this.send('browser.close').catch(() => {});
    this.socket.close();
    if ((await Promise.race([stopped, pause(10_000).then(() => 'late')])) === 'late') {
      this.process.kill('SIGKILL');
      await stopped;
    }
  }
}

/** Waits for something to be true, asking every tenth of a second, and says what it waited for. */
export async function waitFor<Value>(
  what: string,
  ask: () => Promise<Value | null | undefined | false | ''>,
  ms = 15_000,
): Promise<Value> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await ask();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Waited for ${what}, which didn’t happen.`);
    await pause(100);
  }
}
