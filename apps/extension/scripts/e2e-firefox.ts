// Runs Save to Factwright's "Factwright on this computer" in a real Firefox, as the stores' build:
// setup asks Firefox for native messaging on the click that chooses it, finds Factwright's helper,
// and saves through it, from setup and from the background, which both ran before Firefox allowed
// it. Chromium's run (scripts/e2e.ts) does the rest, the popup included, which Firefox lets read a
// tab only on the toolbar button's own click; this is what Firefox does its own way. Playwright's
// Firefox can't load extensions, so it drives a real one over WebDriver BiDi (scripts/bidi.ts):
// the extension goes in as a temporary add-on, at an address a pref fixes, and another pref has
// Firefox grant an optional permission without its prompt, which a test can't answer, as a person
// allowing it would. The click that asks is a real one, as Firefox wants.
//
// The helper is the desktop app's, built for testing, and the app's own inbox code stands in for
// the app, in folders of its own. Firefox looks for the helper's manifest in its home folder, and
// on Linux that can be a temporary folder for Firefox alone. On a Mac or Windows, Firefox reads
// the person's own, which a test never writes to, so there it says so and stops. It needs Firefox,
// Mozilla's own build rather than Ubuntu's snap, and a C compiler, for the helper.
// `pnpm --filter @factwright/extension e2e:firefox`, with FIREFOX naming another Firefox to run.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_FOLDER, INBOX_JOB, SAVE_HELPER } from '@factwright/core';
// Factwright's own inbox, as the desktop app runs it, standing in for the app on this computer.
import { JobInbox } from '../../desktop/src/main/extension/inbox.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { FIREFOX_ID } from '../src/manifest.ts';
import type { JobToSave, SaveResult } from '../src/save.ts';
import { Firefox, waitFor } from './bidi.ts';

if (process.platform !== 'linux') {
  console.log(
    'Skipped: the Firefox run needs Linux, where Firefox can have a home folder of its own to find Factwright’s helper in. On a Mac or Windows it would read yours, which a test never writes to. CI runs it on Linux.',
  );
  process.exit(0);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The desktop app, whose helper Firefox starts to save on this computer. */
const DESKTOP = fileURLToPath(new URL('../../desktop', import.meta.url));

function check(that: boolean, what: string): void {
  if (!that) throw new Error(`Failed: ${what}`);
  console.log(`✓ ${what}`);
}

/** Firefox: the one FIREFOX names, or the one on PATH. */
function firefoxProgram(): string {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  const found = (process.env.PATH ?? '')
    .split(delimiter)
    .map((folder) => join(folder, 'firefox'))
    .find((path) => existsSync(path));
  if (!found) {
    console.error(
      'There’s no Firefox to run: install Mozilla’s own, not the snap, or name one with FIREFOX.',
    );
    process.exit(1);
  }
  return found;
}

/** The extension's address in this Firefox, which a pref fixes, as Firefox picks one at install. */
const UUID = '5f0d3a91-2c4b-4e8a-9b6f-7d1e2c3b4a50';
const ORIGIN = `moz-extension://${UUID}`;

/** The two jobs it saves, as the popup would send them, after checking them. */
const NORTHWIND: JobToSave = {
  url: 'https://www.linkedin.com/jobs/view/4012345678/',
  site: 'linkedin.com',
  company: 'Northwind',
  role: 'Staff Engineer, Payments',
  pay: '$200k–$240k',
  posting: 'About the job\n\nBuild payments at scale.',
};
const HARBOR: JobToSave = {
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  company: 'Harbor & Pine',
  role: 'Senior Product Manager, Data',
  pay: 'USD 165,000–190,000 a year',
  posting: 'About the role\n\nLead the data platform’s roadmap.',
};

/** What the run calls of Firefox's extension API, in the extension's own pages. */
interface InPage {
  browser: {
    runtime: {
      sendMessage(message: unknown): Promise<unknown>;
      sendNativeMessage?(application: string, message: object): Promise<unknown>;
      getContexts(filter: { contextTypes: string[] }): Promise<{ contextId: string }[]>;
    };
    permissions: {
      contains(permissions: { permissions: string[] }): Promise<boolean>;
      request(permissions: { permissions: string[] }): Promise<boolean>;
      remove(permissions: { permissions: string[] }): Promise<boolean>;
    };
  };
}

/** What the run uses of Firefox's own window: its console, which hears each page's errors. */
interface OwnWindow {
  Services: { console: { registerListener(listener: { observe(message: unknown): void }): void } };
  Ci: { nsIScriptError: { warningFlag: number; infoFlag: number } };
  pageErrors?: string[];
}

/** An error as Firefox's console hears it. */
interface ScriptError {
  sourceName: string;
  lineNumber: number;
  errorMessage: string;
  flags: number;
}

/**
 * Where Firefox sends requests to every site but this computer's: a proxy here that turns each
 * away, and notes which site it was for, to check nothing reaches Factwright's sync.
 */
async function turnAway() {
  const sites = new Set<string>();
  const proxy = createServer((request, response) => {
    sites.add((request.headers.host ?? '').replace(/:\d+$/, ''));
    response.writeHead(403);
    response.end();
  });
  // An https site is asked for by its name and port.
  proxy.on('connect', (request, socket) => {
    sites.add((request.url ?? '').replace(/:\d+$/, ''));
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    port: (proxy.address() as AddressInfo).port,
    sites,
    close: () => {
      proxy.closeAllConnections();
      proxy.close();
    },
  };
}

const program = firefoxProgram();
const work = mkdtempSync(join(tmpdir(), 'fw-firefox-'));
/** Firefox's home folder, of its own, where it looks for the helper's manifest. */
const home = join(work, 'home');
const manifests = join(home, '.mozilla', 'native-messaging-hosts');
/** Factwright's data folder, which the helper built for testing takes from FACTWRIGHT_HELPER_HOME. */
const data = join(work, 'factwright');
const inboxFolder = join(data, INBOX_FOLDER);
const profile = join(work, 'profile');
for (const folder of [manifests, data, profile]) mkdirSync(folder, { recursive: true });
/** Where a helper was, which is gone, as when Factwright was moved to the trash. */
const GONE = join(work, 'Applications', 'Factwright.app', 'factwright-save');

/**
 * Registers a helper with Firefox, as Factwright does with each browser it finds, for the stores'
 * Firefox ID alone.
 */
function registerHelper(path: string): void {
  writeFileSync(
    join(manifests, `${SAVE_HELPER}.json`),
    JSON.stringify({
      name: SAVE_HELPER,
      description: 'Saves jobs from Save to Factwright to the Factwright app on this computer.',
      path,
      type: 'stdio',
      allowed_extensions: [FIREFOX_ID],
    }),
  );
}

const proxy = await turnAway();
let running: Firefox | null = null;
let inbox: JobInbox | null = null;
let tracker: Tracker | null = null;
let failed = false;
try {
  // The stores' build, which asks for native messaging in setup rather than at install.
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: { ...process.env, VITE_FACTWRIGHT_SYNC_SERVER: '', FACTWRIGHT_NATIVE_AT_INSTALL: '' },
    stdio: 'ignore',
  });
  const extension = join(ROOT, 'dist', 'firefox');
  const built = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8')) as {
    permissions: string[];
    optional_permissions?: string[];
  };
  check(
    built.optional_permissions?.includes('nativeMessaging') === true &&
      !built.permissions.includes('nativeMessaging'),
    'built as the stores get it, asking for native messaging in setup, not at install',
  );
  // Factwright's helper, built for testing: it takes the app's data folder from
  // FACTWRIGHT_HELPER_HOME, which the helper the installers carry never does.
  const helper = join(work, 'helper', 'factwright-save');
  execFileSync('node', ['scripts/build-helper.ts', '--testing', '--out', helper], {
    cwd: DESKTOP,
    stdio: 'ignore',
  });

  const firefox = await Firefox.launch({
    program,
    profile,
    prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: UUID }),
      // An optional permission asked for on a click is granted, as Firefox's prompt can't be
      // answered here. Asked for any other way, Firefox still refuses it.
      'extensions.webextOptionalPermissionPrompts': false,
      // The background stays up for the whole run, so the one that ran before native messaging
      // was allowed is the one that saves after.
      'extensions.background.idle.timeout': 600_000,
      // Every site but this computer's through the proxy, which turns it away.
      'network.proxy.type': 1,
      'network.proxy.http': '127.0.0.1',
      'network.proxy.http_port': proxy.port,
      'network.proxy.ssl': '127.0.0.1',
      'network.proxy.ssl_port': proxy.port,
    },
    env: {
      ...process.env,
      HOME: home,
      // And its settings folder in it, so wherever a newer Firefox looks, it's this run's own.
      XDG_CONFIG_HOME: join(home, '.config'),
      // Passed on to the helper Firefox starts.
      FACTWRIGHT_HELPER_HOME: data,
    },
  });
  running = firefox;
  console.log(`Firefox ${firefox.version}, ${program}`);

  // Each error on the extension's pages, as Firefox's console hears it.
  const own = await firefox.ownWindow();
  await firefox.run(
    own,
    (origin: string) => {
      const window = globalThis as unknown as OwnWindow;
      const { nsIScriptError } = window.Ci;
      window.pageErrors = [];
      window.Services.console.registerListener({
        observe(message) {
          let error: ScriptError;
          try {
            error = (message as { QueryInterface(iid: unknown): ScriptError }).QueryInterface(
              nsIScriptError,
            );
          } catch {
            // A note, not an error.
            return;
          }
          const notes = nsIScriptError.warningFlag | nsIScriptError.infoFlag;
          if (error.sourceName.startsWith(origin) && (error.flags & notes) === 0) {
            window.pageErrors?.push(
              `${error.sourceName}:${error.lineNumber}: ${error.errorMessage}`,
            );
          }
        },
      });
    },
    ORIGIN,
  );

  const { extension: id } = await firefox.send<{ extension: string }>('webExtension.install', {
    extensionData: { type: 'path', path: extension },
  });
  check(id === FIREFOX_ID, 'Firefox takes it as a temporary add-on, with the stores’ ID');
  const setup = await waitFor(
    'setup to open',
    async () => (await firefox.tabs()).find((tab) => tab.url === `${ORIGIN}/setup.html`)?.context,
  );

  /** The heading of the page setup shows, or nothing while it's between pages. */
  const shown = () =>
    firefox.run(setup, () => document.querySelector('h1')?.textContent ?? '').catch(() => '');
  /** A button on setup's page, by its words, once it's there to click. */
  const button = (words: string) =>
    waitFor(`the ${words} button`, () =>
      firefox.find(
        setup,
        (name: string) =>
          [...document.querySelectorAll('button')].find(
            (each) => each.textContent === name && !each.disabled,
          ),
        words,
      ),
    );
  /**
   * Clicks a button in setup, as a person does, and waits for the page it leads to: one of
   * `pages`, by their headings, shown since the click.
   */
  async function choose(words: string, pages: string[]): Promise<string> {
    const target = await button(words);
    await firefox.run(setup, () => {
      for (const old of document.querySelectorAll('h1')) old.dataset.before = '';
    });
    await firefox.click(setup, target);
    try {
      return await waitFor(`setup to show ${pages.join(' or ')}`, () =>
        firefox.run(
          setup,
          (headings: string[]) => {
            const now = document.querySelector('h1:not([data-before])')?.textContent ?? '';
            return headings.includes(now) ? now : '';
          },
          pages,
        ),
      );
    } catch (error) {
      const says = await firefox.run(setup, () => document.body.innerText).catch(() => '');
      throw new Error(`${(error as Error).message} It shows: ${says}`);
    }
  }
  const allowed = () =>
    firefox.run(setup, () =>
      (globalThis as unknown as InPage).browser.permissions.contains({
        permissions: ['nativeMessaging'],
      }),
    );
  const canSend = () =>
    firefox.run(
      setup,
      () =>
        typeof (globalThis as unknown as InPage).browser.runtime.sendNativeMessage === 'function',
    );
  /** The extension's background, by its ID, which changes if it starts again. */
  const background = () =>
    firefox.run(setup, async () =>
      (
        await (globalThis as unknown as InPage).browser.runtime.getContexts({
          contextTypes: ['BACKGROUND'],
        })
      )
        .map((each) => each.contextId)
        .join(),
    );
  const realm = () => firefox.realm(setup);
  /** What Firefox says to a hello sent straight to the helper from setup: its answer or error. */
  const hello = () =>
    firefox.run(
      setup,
      async (helperName: string) => {
        const { runtime } = (globalThis as unknown as InPage).browser;
        try {
          return { answer: await runtime.sendNativeMessage?.(helperName, { type: 'hello' }) };
        } catch (error) {
          return { error: (error as Error).message };
        }
      },
      SAVE_HELPER,
    );
  /** Asks the background to save a job, as the popup asks it to (src/messages.ts). */
  const save = (job: JobToSave) =>
    firefox.run(
      setup,
      (sent: JobToSave) =>
        (globalThis as unknown as InPage).browser.runtime.sendMessage({
          type: 'save',
          job: sent,
        }) as Promise<SaveResult>,
      job,
    );

  // Before it's set up: no native messaging, and none from a script, without a click.
  await button('Continue');
  check(
    await firefox.run(
      setup,
      () => (document.getElementById('computer') as HTMLInputElement | null)?.checked === true,
    ),
    'setup opens by itself, asking where saved jobs go, with Factwright on this computer first',
  );
  check(
    !(await allowed()) && !(await canSend()),
    'before it’s allowed, Firefox gives the extension no native messaging',
  );
  const refused = await firefox.run(setup, async () => {
    try {
      const granted = await (globalThis as unknown as InPage).browser.permissions.request({
        permissions: ['nativeMessaging'],
      });
      return `granted: ${granted}`;
    } catch (error) {
      return (error as Error).message;
    }
  });
  check(
    !refused.startsWith('granted') && !(await allowed()),
    `Firefox grants it only on a click: asked for from a script, it says “${refused}”`,
  );
  check(
    JSON.stringify(await save(NORTHWIND)) ===
      JSON.stringify({
        ok: false,
        reason: 'signed-out',
        message: 'Set up Save to Factwright first.',
      }),
    'before it’s set up, the background saves nothing, and says to set it up',
  );
  const backgroundBefore = await background();
  const realmBefore = await realm();

  // Continue on Factwright on this computer, before Factwright has registered its helper.
  const before = await choose('Continue', [
    'Get Factwright on this computer',
    'Factwright didn’t answer',
    'You’re set',
  ]);
  check(
    await allowed(),
    'Continue asks Firefox for native messaging, on the click, and it’s granted',
  );
  check(
    (await realm()) === realmBefore && (await canSend()),
    'and setup sends to the helper at once, from the same page, without opening again',
  );
  const unregistered = await hello();
  check(
    unregistered.error === 'No such native application com.factwright.save' &&
      before === 'Get Factwright on this computer',
    `with no manifest, Firefox says “${unregistered.error}”, and setup says how to get Factwright`,
  );

  // Registered, but the helper isn't where the manifest says, as when Factwright was moved to the
  // trash, which a Mac leaves registered.
  registerHelper(GONE);
  const moved = await choose('Check again', [
    'Get Factwright on this computer',
    'Factwright didn’t answer',
    'You’re set',
  ]);
  const gone = await hello();
  check(
    gone.error === 'An unexpected error occurred' && moved === 'Get Factwright on this computer',
    `with the helper gone, Firefox says “${gone.error}”, and setup says how to get Factwright`,
  );

  registerHelper(helper);
  check(
    (await choose('Check again', [
      'You’re set',
      'Get Factwright on this computer',
      'Factwright didn’t answer',
    ])) === 'You’re set' &&
      (await firefox.run(
        setup,
        () =>
          document.body.textContent?.includes('saves jobs to Factwright on this computer') === true,
      )),
    'finds Factwright once its helper is registered, and saves there',
  );

  // Factwright closed: the background's save waits in the inbox.
  const waiting = () => readdirSync(inboxFolder).filter((name) => INBOX_JOB.test(name));
  check(
    JSON.stringify(await save(NORTHWIND)) === JSON.stringify({ ok: true, later: true }),
    'with Factwright closed, the background saves it, for Factwright to add when it opens',
  );
  check(
    (await background()) === backgroundBefore,
    'from the background that ran before native messaging was allowed, which Firefox gave it at once',
  );
  const [dropped] = waiting();
  check(
    waiting().length === 1 &&
      readFileSync(join(inboxFolder, dropped ?? ''), 'utf8') ===
        JSON.stringify({ type: 'save', ...NORTHWIND }),
    'the helper drops the job in the inbox, as the extension sent it, and nothing else',
  );

  // Factwright opens, and adds the job that waited.
  tracker = new Tracker(join(data, 'tracker.db'));
  const jobs = new JobsService({ workspace: join(data, 'workspace'), tracker, onChange: () => {} });
  inbox = new JobInbox({ folder: inboxFolder, add: (saved) => jobs.addSaved(saved) });
  inbox.start();
  const northwind = tracker.rows().find((row) => row.company === 'Northwind');
  check(
    northwind?.status === 'new' &&
      waiting().length === 0 &&
      readFileSync(join(data, 'workspace', 'saved', northwind.id, 'posting.md'), 'utf8').includes(
        'Build payments at scale.',
      ),
    'Factwright adds the job that waited as it opens: as New, with its posting',
  );

  // Factwright open: a save is in the job hunt at once, with Factwright's own answer.
  const added = await save(HARBOR);
  check(
    added.ok &&
      'posting' in added &&
      !added.already &&
      added.posting === 'saved' &&
      tracker.rows().some((row) => row.company === 'Harbor & Pine' && row.status === 'new'),
    'with Factwright open, a save is in the job hunt at once, as New',
  );
  const again = await save(HARBOR);
  check(
    again.ok && 'posting' in again && again.already && again.posting === 'kept',
    'saves the same job only once',
  );

  // The helper gone after setup, as when Factwright was moved to the trash: a save says so.
  registerHelper(GONE);
  const lost = await save(HARBOR);
  check(
    !lost.ok &&
      lost.reason === 'no-app' &&
      lost.message.startsWith('Save to Factwright couldn’t find Factwright on this computer.'),
    'with the helper gone, a save says it couldn’t find Factwright, and how to get it',
  );
  registerHelper(helper);

  // Firefox lets a person take its OK away, in its add-ons manager, as this does: saves stop, and
  // setup asks for it back, on a click.
  await firefox.run(setup, () =>
    (globalThis as unknown as InPage).browser.permissions.remove({
      permissions: ['nativeMessaging'],
    }),
  );
  const taken = await save(HARBOR);
  check(
    !taken.ok && taken.reason === 'no-access',
    'with Firefox’s OK taken away, a save sends nothing, and says the browser doesn’t let it',
  );
  await firefox.run(setup, () => {
    setTimeout(() => location.reload(), 0);
  });
  await waitFor(
    'setup to ask for the OK back',
    async () => (await shown()) === 'Let it reach Factwright on this computer',
  );
  const reopened = await realm();
  check(
    (await choose('Allow it', ['You’re set', 'Let it reach Factwright on this computer'])) ===
      'You’re set' &&
      (await allowed()) &&
      (await realm()) === reopened &&
      (await canSend()),
    'setup asks for it back, and Allow it asks Firefox again, on the click, and sends at once',
  );
  const back = await save(HARBOR);
  check(
    back.ok && 'posting' in back && back.already && (await background()) === backgroundBefore,
    'and the background saves again at once, as Firefox gives native messaging back',
  );

  // And it can save through sync instead, which nothing here has reached.
  await firefox.click(setup, await button('Save through sync instead'));
  await button('Sign in to sync');
  check(
    !proxy.sites.has('app.factwright.com'),
    'saving on this computer, nothing reaches Factwright’s sync',
  );
  const errors = await firefox.run(
    own,
    () => (globalThis as unknown as OwnWindow).pageErrors ?? [],
  );
  check(
    errors.length === 0,
    `with nothing going wrong on its pages${errors.length ? `: ${errors.join('; ')}` : ''}`,
  );
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  inbox?.stop();
  tracker?.close();
  await running?.close();
  proxy.close();
  try {
    // Firefox may hold its profile a moment after it stops.
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // A temporary folder left behind does no harm.
  }
}
process.exit(failed ? 1 : 0);
