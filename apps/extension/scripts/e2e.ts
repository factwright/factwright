// Runs the extension in Chromium, from setting it up to saving a job: through a server of
// your own, chosen in setup, with a site that counts every request standing in for the server it's
// built for, and then through the server it's built for, a local copy of the sync server standing
// in for Factwright's sync. A server of your own signs it in through the browser's own window for
// extensions alone, and one with no window, or that doesn't know this copy, gets no code, since it
// could pass along one Factwright's sync gave it. Where the server it's built for doesn't know this
// copy, it signs in with a code. It links both ways, with the emoji Factwright on a computer
// checks, and with a link code. Where the server it's built for knows this copy, as Factwright's
// knows the stores' copies, it signs in through the window, with no code: signed in there
// already, or signing in there first, and turned down, closed, or failing partway, for a code
// instead. Then, through a copy that sells sync, as Factwright's will, an account without sync is
// told it needs a subscription, links once it has one, and saves nothing while sync is paused. The
// computer's side runs here, with the same code the desktop app uses. Then it saves straight to
// Factwright on this computer, through the desktop app's helper, built for testing, and the app's
// own inbox code, in a folder of its own (it needs a C compiler, as the desktop app's helper does).
// `pnpm --filter @factwright/extension e2e` (it needs Playwright's
// Chromium: `pnpm --filter @factwright/site exec playwright install chromium`). With
// `-- --screenshots`, it also draws the stores' screenshots, into store/screenshots, from what it
// shows along the way, and with `-- --shots <folder>`, saves each setup page it checks there, and
// the popup on a page that doesn't look like a job's, in light and dark.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_FOLDER, INBOX_JOB, newJobRows, SAVE_HELPER } from '@factwright/core';
import { sessionCookie, startServer, type TestServer } from '@factwright/server/testing';
import {
  accountKeys,
  checkEmoji,
  decodeRecord,
  encodeRecord,
  fileName,
  LinkApproval,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
  openRecord,
  recordId,
  rowName,
  type SyncRecord,
  sealRecord,
} from '@factwright/sync';
import { LIGHT } from '@factwright/ui/tokens';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
// Factwright's own inbox and answers, as the desktop app runs them, standing in for the app on
// this computer.
import { answerAsk, type FillDeps } from '../../desktop/src/main/extension/fill.ts';
import { JobInbox } from '../../desktop/src/main/extension/inbox.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The desktop app, whose helper the browser starts to save on this computer. */
const DESKTOP = fileURLToPath(new URL('../../desktop', import.meta.url));
/** Where the stores' screenshots go, when it's asked to draw them. */
const SHOTS = process.argv.includes('--screenshots') ? join(ROOT, 'store', 'screenshots') : null;
/** Where the setup pages it checks go, in light and dark, when it's asked for them. */
const PAGES = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(that: boolean, what: string): void {
  if (!that) throw new Error(`Failed: ${what}`);
  console.log(`✓ ${what}`);
}

/** An account with sync on, as Factwright on a computer leaves it. */
async function account(server: TestServer) {
  const sam = await server.signUp();
  const accountKey = newAccountKey();
  const keys = await accountKeys(accountKey);
  await sam.client.saveKeys(keys.id, await lockWithRecoveryKey(accountKey, newRecoveryKey().bytes));
  return { sam, accountKey, keys };
}

/** The sites every server here is on: this computer's, which the builds here may reach. */
const LOCAL_SITE = 'http://127.0.0.1/*';

/** Each browser it opens, so it can close any that a failure leaves open. */
const browsers: BrowserContext[] = [];

/**
 * The extension, loaded in a fresh Chromium, with a profile of its own in the run's folder, and its
 * setup page. The browser's prompts can't be answered in a test, so a request to reach any site
 * but this computer's is answered no, as declining it would be. A request for native messaging
 * goes to the browser, which a build for the test grants at install. Each request is noted, as
 * `asked`, to check what setup asked for.
 */
async function browser(extension: string, env: Record<string, string> = {}) {
  const profile = mkdtempSync(join(work, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    deviceScaleFactor: 2,
    // What the browser passes on to the programs it starts, such as Factwright's helper.
    env: { ...process.env, ...env } as Record<string, string>,
  });
  browsers.push(context);
  await context.addInitScript((local) => {
    type Asked = { origins?: string[]; permissions?: string[] };
    type Permissions = { request(asked: Asked): Promise<boolean> };
    const page = globalThis as unknown as {
      asked: string[][];
      chrome?: { permissions?: Permissions };
    };
    const api = page.chrome?.permissions;
    if (!api) return;
    const request = api.request.bind(api);
    page.asked = [];
    api.request = (asked) => {
      const origins = asked.origins ?? [];
      page.asked.push(asked.origins ?? asked.permissions ?? []);
      return origins.every((origin) => origin === local) ? request(asked) : Promise.resolve(false);
    };
  }, LOCAL_SITE);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const id = new URL(worker.url()).host;
  if (id !== unpackedId(extension)) throw new Error(`Chromium gave the extension ${id}.`);
  const setup = await context.newPage();
  const errors: string[] = [];
  setup.on('pageerror', (error) => errors.push(error.message));
  await setup.goto(`chrome-extension://${id}/setup.html`);
  return { context, setup, errors, id, profile };
}

/**
 * A store's screenshot: what the extension showed, framed at the 1280 by 800 both stores take, with
 * what it shows in words beside it.
 */
let framer: Browser | null = null;

async function frame(
  shot: Buffer,
  width: number,
  title: string,
  words: string,
  name: string,
): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Framed in a browser of its own at 1x, so the image is exactly 1280 by 800, with the extension's
  // pages, taken at 2x, sharp in it.
  framer ??= await chromium.launch({ channel: 'chromium', headless: true });
  const page = await framer.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;
    background:${LIGHT.sunken};color:${LIGHT.text};display:flex;align-items:center;justify-content:center;
    gap:64px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
    <div style="max-width:400px"><h1 style="font-size:42px;line-height:1.15;margin:0 0 18px">${title}</h1>
    <p style="font-size:21px;line-height:1.45;margin:0;color:${LIGHT.muted}">${words}</p></div>
    <img alt="" style="width:${width}px;border-radius:14px;border:1px solid ${LIGHT.border};
    box-shadow:0 24px 60px rgba(20,20,40,.16)" src="data:image/png;base64,${shot.toString('base64')}">
    </body></html>`);
  await page.screenshot({ path: join(SHOTS, name) });
  await page.close();
}

/**
 * A page's content with a margin around it, as a picture, and the test account's address shown as
 * a person's would be. With `before`, only what's above that element, to fit a store's picture.
 */
async function capture(page: Page, before?: string): Promise<Buffer> {
  // Only the words change, so links and the like stay as the page has them.
  await page.evaluate(() => {
    const words = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = words.nextNode(); node; node = words.nextNode()) {
      node.textContent = (node.textContent ?? '').replace(
        /\b\w+@example\.com\b/,
        'sam@example.com',
      );
    }
  });
  const box = await page.locator('main').boundingBox();
  if (!box) throw new Error('The page shows nothing to picture.');
  const end = before ? await page.locator(before).first().boundingBox() : null;
  const margin = 24;
  return page.screenshot({
    // Below the window too, for a page longer than it.
    fullPage: true,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + 2 * margin,
      height: (end ? end.y - box.y : box.height + margin) + margin,
    },
  });
}

/** A setup page, in light and dark, to check by eye, when it's asked for them. */
async function shoot(page: Page, name: string): Promise<void> {
  if (!PAGES) return;
  mkdirSync(PAGES, { recursive: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    writeFileSync(join(PAGES, `${name}-${colorScheme}.png`), await capture(page));
  }
  await page.emulateMedia({ colorScheme: null });
}

/** A posting as a job site publishes it, for the popup to show in the stores' screenshots. */
const SAMPLE_JOB = {
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  pageUrl: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  pageTitle: 'Harbor & Pine - Senior Product Manager, Data',
  title: 'Senior Product Manager, Data',
  company: 'Harbor & Pine',
  location: 'Remote (US)',
  pay: 'USD 165,000–190,000 a year',
  employment: 'Full time',
  posted: '2026-10-14',
  posting: `About the role\n\n${'Lead the data platform’s roadmap with engineering and analytics. '.repeat(70)}`,
  source: 'structured',
};

/** An application form, as the page's own function reads it, for the popup to offer to fill. */
const SAMPLE_FORM = {
  url: 'https://jobs.lever.co/harborpine/9d2e0b1c/apply',
  title: 'Harbor & Pine - Data Engineer',
  fields: ['Full name', 'Email', 'Resume/CV'].map((question, ref) => ({
    ref,
    key: `input ${question}`,
    question,
    hint: '',
    section: '',
    control: ref === 2 ? 'file' : 'text',
    type: ['text', 'email', 'file'][ref] ?? 'text',
    autocomplete: ['name', 'email', ''][ref] ?? '',
    name: question.toLowerCase(),
    options: [],
    required: true,
    limit: null,
  })),
  submitted: false,
  step: '',
  adders: [],
};

/**
 * The popup on a job's page, as clicking the toolbar button opens it: the tab it reads stands in
 * here, as a test can't click the toolbar, with the job the page's own function reads there, and
 * the application form it reads, if any. The tab is the popup's own, so the browser has a window
 * to open the panel in. The saves it makes are real, unless `failing` says what saving answers,
 * as when the sync server can't be reached.
 */
async function popupOn(
  context: BrowserContext,
  setup: Page,
  page: typeof SAMPLE_JOB,
  form: typeof SAMPLE_FORM | null = null,
  failing: { message: string } | null = null,
): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 480 });
  await popup.addInitScript(
    ({ shown, form, failing }) => {
      type Tabs = { query(asked: unknown): Promise<{ id?: number; windowId?: number }[]> };
      type Runtime = { sendMessage(message: { type?: string }): Promise<unknown> };
      const api = (
        globalThis as unknown as {
          chrome: { tabs: Tabs; runtime: Runtime; scripting: { executeScript: unknown } };
        }
      ).chrome;
      if (failing) {
        const send = api.runtime.sendMessage.bind(api.runtime);
        api.runtime.sendMessage = async (message) =>
          message?.type === 'save'
            ? { ok: false, reason: 'offline', message: failing.message }
            : send(message);
      }
      const query = api.tabs.query.bind(api.tabs);
      api.tabs.query = async () => {
        const [own] = await query({ active: true, currentWindow: true });
        return [
          { id: own?.id ?? 1, windowId: own?.windowId, url: shown.url, title: shown.pageTitle },
        ];
      };
      // Each of the extension's functions, by its name, as it's built unminified.
      api.scripting.executeScript = async ({ func }: { func?: { name: string } }) => {
        if (func?.name === 'formPage')
          return form ? [{ frameId: 0, result: { did: 'read', form } }] : [];
        if (func?.name === 'frameShows') {
          return [{ frameId: 0, result: { href: shown.url, selected: 0 } }];
        }
        if (func?.name === 'hereIs') return [{ frameId: 0, result: shown.url }];
        if (func?.name === 'framedAddresses') return [{ frameId: 0, result: [] }];
        return [{ frameId: 0, result: shown }];
      };
    },
    { shown: page, form, failing },
  );
  await popup.goto(setup.url().replace('setup.html', 'popup.html'));
  return popup;
}

/** Setup's first page asks where saved jobs go: through sync leads to the choice of sync. */
async function throughSync(setup: Page): Promise<void> {
  await setup.getByRole('radio', { name: 'Through sync' }).check();
  await setup.getByRole('button', { name: 'Continue' }).click();
  await setup.getByRole('button', { name: 'Sign in to sync' }).waitFor();
}

/**
 * Signs the extension in to the server it's built for, where that doesn't know this copy: it shows
 * a code, which the person allows in the browser. Then setup goes on to linking, unless it shows
 * another step, `next`.
 */
async function signIn(
  setup: Page,
  origin: string,
  token: string,
  next = 'Link it with your job hunt',
): Promise<void> {
  await setup.getByRole('button', { name: 'Sign in to sync' }).click();
  const userCode = ((await setup.locator('.code').textContent()) ?? '').replace('-', '');
  await shoot(setup, '4-code');
  const auth = { authorization: `Bearer ${token}` };
  await fetch(`${origin}/api/auth/device?user_code=${userCode}`, { headers: auth });
  await fetch(`${origin}/api/auth/device/approve`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ userCode }),
  });
  await setup.getByRole('heading', { name: next }).waitFor({ timeout: 30_000 });
}

/**
 * The ID Chromium gives an extension loaded from a folder, as it works it out: from a hash of the
 * folder's path, with each hex digit as a letter from a to p.
 */
const unpackedId = (folder: string) =>
  [...createHash('sha256').update(realpathSync(folder)).digest().subarray(0, 16).toString('hex')]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('');

/** The browser signed in at a server, as signing in there with GitHub or Google leaves it. */
async function signedInAt(context: BrowserContext, server: TestServer, token: string) {
  const [name = '', value = ''] = sessionCookie(token).split(/=(.*)/s);
  await context.addCookies([
    { name, value, url: server.url.origin, httpOnly: true, sameSite: 'Lax' },
  ]);
}

/**
 * Clicks Sign in to sync, and gives the browser's sign-in window that opens for it, never the
 * setup tab the extension opens on install, which can open late.
 */
async function openWindow(context: BrowserContext, setup: Page): Promise<Page> {
  const opened = context.waitForEvent('page', {
    predicate: (page) => !page.url().startsWith('chrome-extension://'),
    timeout: 15_000,
  });
  await setup.getByRole('button', { name: 'Sign in to sync' }).click();
  const window = await opened;
  await window.waitForLoadState();
  return window;
}

/**
 * Factwright's helper, built for testing, in the run's folder: it takes the app's data folder from
 * FACTWRIGHT_HELPER_HOME, which the helper the installers carry never does.
 */
function testingHelper(): string {
  const out = join(mkdtempSync(join(work, 'helper-')), 'factwright-save');
  execFileSync('node', ['scripts/build-helper.ts', '--testing', '--out', out], {
    cwd: DESKTOP,
    stdio: 'ignore',
  });
  return out;
}

/**
 * Registers the helper with the test's browser, as Factwright does with each browser it finds,
 * for this extension's ID alone. Chromium looks in its profile's own folder for these.
 */
function registerHelper(profile: string, helper: string, id: string): void {
  const folder = join(profile, 'NativeMessagingHosts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${SAVE_HELPER}.json`),
    JSON.stringify({
      name: SAVE_HELPER,
      description:
        'Connects Factwright’s browser extension to the Factwright app on this computer.',
      path: helper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    }),
  );
}

/** A site on this computer that answers everything with "Not found", and counts what it's asked. */
async function notSync() {
  let requests = 0;
  const site = createServer((_, response) => {
    requests += 1;
    response.writeHead(404, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Not found</h1>');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(site.address() as AddressInfo).port}`,
    requests: () => requests,
    close: () => site.close(),
  };
}

/**
 * A server of your own that offers no sign-in window: one from before it, or one that only acts as
 * if it were, to have setup show a code another server gave it, such as Factwright's, for the
 * person to allow there. It answers its sign-in options as such a server, and counts what else it's
 * asked.
 */
async function noWindow() {
  let requests = 0;
  const site = createServer((request, response) => {
    if (request.url === '/api/sign-in-options') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ providers: ['github'], features: ['approve'] }));
      return;
    }
    requests += 1;
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(site.address() as AddressInfo).port}`,
    requests: () => requests,
    close: () => site.close(),
  };
}

const extension = join(ROOT, 'dist', 'chrome');
// There before it's built, for its ID.
mkdirSync(extension, { recursive: true });
// The web view, which shows the sign-in window's page, built before the servers that serve it.
execFileSync('pnpm', ['--filter', '@factwright/web', 'build'], { stdio: 'ignore' });
/**
 * A local copy of the sync server standing in for Factwright's sync, which knows only the stores'
 * copies, a server of your own, which knows this copy too, as its owner can list one, a site
 * standing in for Factwright's sync that counts what reaches it, and an address typed wrong,
 * which isn't a sync server.
 */
const factwright = await startServer();
const server = await startServer({ EXTENSION_IDS: unpackedId(extension) });
const origin = server.url.origin;
/** A copy that sells sync, as Factwright's will. Nothing here pays, so nothing reaches Stripe. */
const selling = await startServer({
  STRIPE_SECRET_KEY: 'rk_test_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
  STRIPE_API_URL: 'http://127.0.0.1:9',
  EARLY_BEFORE: '2026-01-01T00:00:00.000Z',
});
/**
 * A copy of the sync server standing in for Factwright's that knows this copy of the extension,
 * as Factwright's knows the stores' copies, so it signs in through the browser's window. With
 * GitHub to sign in with, though nothing here goes there.
 */
const windowed = await startServer({
  EXTENSION_IDS: unpackedId(extension),
  GITHUB_CLIENT_ID: 'github-app-id',
  GITHUB_CLIENT_SECRET: 'not-used',
});
const standIn = await notSync();
const typo = await notSync();
const old = await noWindow();
const build = (env: Record<string, string> = {}) =>
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
/**
 * The run's own temporary folder, for each browser's profile, the helper built for testing, and
 * Factwright's data folder on this computer. It's removed once the run is done, passing or not:
 * what `--shots` and `--screenshots` save goes elsewhere.
 */
const work = mkdtempSync(join(tmpdir(), 'fw-chromium-'));
let failed = false;
try {
  build({ VITE_FACTWRIGHT_SYNC_SERVER: standIn.origin });

  // Linked the main way, through a server of your own: Factwright on the computer approves it,
  // after both show the same emoji.
  {
    const { sam, accountKey, keys } = await account(server);
    const computer = (
      await server.newSession(sam.id, 'Factwright/0.4.0 (Sam%E2%80%99s%20Mac)', 'device')
    ).client;
    const { context, setup, errors } = await browser(extension);
    await setup.getByRole('button', { name: 'Continue' }).waitFor();
    check(
      await setup.getByRole('radio', { name: 'Factwright on this computer' }).isChecked(),
      'setup asks where saved jobs go, offering Factwright on this computer first',
    );
    await throughSync(setup);
    check(
      (await setup.getByRole('radio', { name: 'Factwright’s sync' }).isChecked()) &&
        !(await setup.locator('#server').isVisible()),
      'through sync, setup offers Factwright’s sync first',
    );
    await shoot(setup, '1-choose');
    await setup.getByRole('radio', { name: 'Your own server' }).check();
    await setup.locator('#server').fill('https://factwright-sync.sam.workers.dev');
    await shoot(setup, '2-own-server');
    await setup.locator('#server').fill('http://sync.example.com');
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    check(
      (await setup.getByRole('alert').textContent()) ===
        'Your server’s address must start with https://.',
      'takes only an https address for your own server',
    );
    await setup.locator('#server').fill('factwright-sync.sam.workers.dev');
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    await setup.getByText('needs to reach factwright-sync.sam.workers.dev').waitFor();
    const asked = () =>
      setup.evaluate(() => (globalThis as unknown as { asked: string[][] }).asked);
    check(
      JSON.stringify((await asked()).at(-1)) ===
        JSON.stringify(['https://factwright-sync.sam.workers.dev/*']),
      'asks the browser for the one site typed, as https when it’s typed without',
    );
    await setup.locator('#server').fill(typo.origin);
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    await setup.getByText('doesn’t answer as a Factwright sync server').waitFor();
    check(typo.requests() === 1, 'checks your own server is a Factwright sync server first');
    await shoot(setup, '3-not-sync');
    // A server of your own with no sign-in window gets no code to show, so it can't pass along one
    // Factwright's sync gave it. Every tab that opens is counted, to show none does. A tab at an
    // address that goes nowhere soon shows an error page instead, so it's counted as it opens, not
    // checked by its address after.
    const opened: string[] = [];
    const onTab = (tab: Page) => opened.push(tab.url());
    context.on('page', onTab);
    await setup.locator('#server').fill(old.origin);
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    await setup
      .getByText(`${new URL(old.origin).host} needs an update for this version of the extension`)
      .waitFor();
    await pause(1000);
    check(
      opened.length === 0 && old.requests() === 0,
      'never signs in to a server of your own with a code, which it could pass along from another',
    );
    await shoot(setup, '4-own-update');
    // One that doesn't know this copy, as with a copy you build yourself, says how to add it.
    await setup.locator('#server').fill(factwright.url.origin);
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    await setup.getByText(`Add its ID, ${unpackedId(extension)}, to EXTENSION_IDS`).waitFor();
    await pause(1000);
    context.off('page', onTab);
    check(
      opened.length === 0,
      'says how to add this copy to a server of your own that doesn’t know it, with no code either',
    );

    // A window that stops short offers no code for a server of your own: only trying again. Chrome's
    // own answer stands in here, since the window isn't the test's to break.
    const failing = await context.newPage();
    await failing.addInitScript(() => {
      (
        globalThis as unknown as { chrome: { identity: { launchWebAuthFlow: unknown } } }
      ).chrome.identity.launchWebAuthFlow = async () => {
        throw new Error('Authorization page could not be loaded.');
      };
    });
    await failing.goto(setup.url());
    await throughSync(failing);
    await failing.getByRole('radio', { name: 'Your own server' }).check();
    await failing.locator('#server').fill(origin);
    await failing.getByRole('button', { name: 'Sign in to sync' }).click();
    await failing.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 15_000 });
    check(
      (await failing.getByRole('button', { name: 'Sign in with a code instead' }).count()) === 0 &&
        (await failing.getByText('Or sign in with a code').count()) === 0,
      'offers no code for a server of your own when the window stops short',
    );
    await failing.close();

    // Through the browser's window, as Factwright's sync signs in the stores' copies: the person,
    // signed in at your server in this browser, allows it there.
    await setup.locator('#server').fill(origin);
    await signedInAt(context, server, sam.token);
    const window = await openWindow(context, setup);
    check(
      window.url().startsWith(`${origin}/sign-in/extension?`),
      'signs in to your own server through the browser’s window, on its own page',
    );
    await shoot(setup, '4-own-window');
    const closed = window.waitForEvent('close');
    await window.getByRole('button', { name: 'Allow', exact: true }).click();
    await closed;
    await setup
      .getByRole('heading', { name: 'Link it with your job hunt' })
      .waitFor({ timeout: 30_000 });
    const devices = (await sam.client.account()).devices.map((device) => device.name);
    check(devices.includes('Factwright in Chrome on Mac'), 'signs in under its own name');
    check(
      JSON.stringify((await asked()).at(-1)) === JSON.stringify([LOCAL_SITE]) &&
        standIn.requests() === 0,
      'signs in through your own server, never reaching the one it’s built for',
    );
    let [request] = await computer.linkRequests();
    for (let i = 0; i < 20 && !request; i++) {
      await pause(500);
      [request] = await computer.linkRequests();
    }
    if (!request) throw new Error('No request to link reached the computer.');
    const approval = await LinkApproval.start(computer, request, keys.id);
    let step = await approval.step();
    for (let i = 0; i < 30 && step.state === 'waiting'; i++) {
      await pause(500);
      step = await approval.step();
    }
    if (step.state !== 'check') throw new Error(`The computer got to ${step.state}.`);
    await setup.getByRole('heading', { name: 'Check the emoji' }).waitFor({ timeout: 15_000 });
    await frame(
      await capture(setup),
      620,
      'Linked by Factwright on your computer',
      'Set it up once: sign in to sync, then approve it in Factwright, once both show the same emoji.',
      '3-link.png',
    );
    const shown = (await setup.locator('p.small.muted').first().textContent()) ?? '';
    check(
      shown ===
        checkEmoji(step.check)
          .map((each) => each.name)
          .join(', '),
      'shows the same emoji as the computer',
    );
    await setup.getByRole('button', { name: 'They match' }).click();
    await approval.approve(accountKey);
    await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 20_000 });
    check((await approval.step()).state === 'linked', 'links once both say the emoji match');
    check(
      (await setup.getByText(`Saves through your own sync server, ${server.url.host}.`).count()) ===
        1,
      'says which server it saves through',
    );
    await shoot(setup, '5-set');
    await frame(
      await capture(setup, 'h2:text-is("Account")'),
      620,
      'Save it your way',
      'From the toolbar, a keyboard shortcut or the right-click menu, from any job site. You choose whether it reads LinkedIn’s postings or saves their links alone.',
      '4-settings.png',
    );

    // The popup, on a job's page: what it read, to save in one click.
    const popup = await popupOn(context, setup, SAMPLE_JOB);
    await popup.getByRole('button', { name: 'Save to Factwright' }).waitFor({ timeout: 10_000 });
    const card = (await popup.locator('.card.job').textContent()) ?? '';
    check(
      card.includes('Senior Product Manager, Data') &&
        card.includes('Harbor & Pine') &&
        card.includes('USD 165,000–190,000 a year') &&
        card.includes('Remote (US)') &&
        card.includes('words, from the job’s own data') &&
        (await popup.locator('input').count()) === 0,
      'the popup shows the job it read, to save in one click',
    );
    await shoot(popup, 'popup-1-save');
    await frame(
      await popup.locator('body').screenshot(),
      400,
      'One click saves it',
      'On a job’s page, click the Factwright button. It reads the job’s title, company, pay, place and posting.',
      '1-save.png',
    );
    await popup.getByRole('button', { name: 'Edit details' }).click();
    check(
      (await popup.locator('#company').inputValue()) === 'Harbor & Pine' &&
        (await popup.locator('#pay').inputValue()) === 'USD 165,000–190,000 a year',
      'Edit details shows each to check and change',
    );
    check(
      (await popup.locator('#keep').isChecked()) &&
        (await popup.locator('.posting').textContent())?.startsWith('About the role') === true,
      'with the posting it saves, to look over, and a way to leave it out',
    );
    await shoot(popup, 'popup-2-edit-details');
    await popup.getByRole('button', { name: 'Save to Factwright' }).click();
    await popup.getByText('Saved to your job hunt, as New.').waitFor({ timeout: 15_000 });
    check(true, 'the popup saves it');
    await frame(
      await popup.locator('body').screenshot(),
      400,
      'Saved as New, with the posting as you saw it',
      'It shows in Factwright on your computer once it syncs, locked with your job hunt’s own key on the way.',
      '2-saved.png',
    );
    await popup.close();

    // On the same page again, the popup knows the job's saved, through sync, and offers no save,
    // but for the page's posting, which a job saved without one takes.
    const known = await popupOn(context, setup, SAMPLE_JOB);
    await known.getByText('In your job hunt').waitFor({ timeout: 10_000 });
    check(
      ((await known.locator('.card.job').textContent()) ?? '').includes('Harbor & Pine · New') &&
        (await known.getByRole('button', { name: /^save (to factwright|and fill)/i }).count()) ===
          0,
      'the popup knows a job you saved, with its status, and offers no save',
    );
    await shoot(known, 'popup-3-saved');
    await known.getByRole('button', { name: 'Save this page’s posting with it' }).click();
    await known.getByText('With the posting as you first saved it.').waitFor({ timeout: 15_000 });
    check(true, 'and keeps the posting the job has, saving this page’s only for one without');
    await known.close();
    // On its application, a saved job's page with a form, it offers to fill it.
    const applying = await popupOn(
      context,
      setup,
      {
        ...SAMPLE_JOB,
        url: `${SAMPLE_JOB.url}/apply`,
        pageUrl: `${SAMPLE_JOB.url}/apply`,
        posting: 'Submit your application',
        source: 'main',
      },
      { ...SAMPLE_FORM, url: `${SAMPLE_JOB.url}/apply` },
    );
    await applying.getByRole('button', { name: 'Fill this application' }).waitFor({
      timeout: 10_000,
    });
    check(
      (await applying.getByText('In your job hunt').count()) === 1 &&
        (await applying.getByRole('button', { name: /save/i }).count()) === 0,
      'and on its application, the same job, with Fill and no save',
    );
    await shoot(applying, 'popup-4-saved-with-form');
    await applying.close();

    // A job that isn't saved, on its application: one button saves it and fills the form.
    const unsaved = await popupOn(
      context,
      setup,
      {
        ...SAMPLE_JOB,
        url: SAMPLE_FORM.url,
        pageUrl: SAMPLE_FORM.url,
        pageTitle: SAMPLE_FORM.title,
        title: 'Data Engineer',
        location: 'Denver, CO',
        pay: '',
        posting: 'Full name Email Resume/CV Submit application',
        source: 'main',
      },
      SAMPLE_FORM,
    );
    await unsaved.getByRole('button', { name: 'Save and fill' }).waitFor({ timeout: 10_000 });
    check(
      ((await unsaved.locator('.card.job').textContent()) ?? '').includes(
        'No posting: only its link is saved',
      ) && (await unsaved.getByRole('button', { name: 'Fill this application' }).count()) === 0,
      'an unsaved job on its application gets Save and fill, saving the link alone',
    );
    await shoot(unsaved, 'popup-5-save-and-fill');
    const pages = context.pages().length;
    await unsaved.getByRole('button', { name: 'Save and fill' }).click();
    // Chrome opens the panel straight after the click that saved it, and the popup closes, or the
    // popup offers Fill, as where the browser won't.
    const panelled = await Promise.race([
      unsaved.waitForEvent('close', { timeout: 15_000 }).then(() => 'panel' as const),
      unsaved
        .getByRole('button', { name: 'Fill this application' })
        .waitFor({ timeout: 15_000 })
        .then(() => 'button' as const),
    ]);
    const engineer = await recordId(keys, rowName('jobs', 'harbor-and-pine--data-engineer'));
    const postingOf = await recordId(
      keys,
      fileName('saved/harbor-and-pine--data-engineer/posting.md'),
    );
    const synced = (await sam.client.changes(0)).changes;
    check(
      synced.some((each) => each.record === engineer) &&
        !synced.some((each) => each.record === postingOf),
      `Save and fill saves the job by its link, then fills (${panelled === 'panel' ? 'the panel opened' : 'Fill to click'})`,
    );
    if (panelled === 'button') await shoot(unsaved, 'popup-6-saved-fill');
    if (!unsaved.isClosed()) await unsaved.close();
    for (const page of context.pages().slice(pages)) await page.close();

    // Where saving doesn't work, the form can still be filled.
    const elsewhere = 'https://jobs.lever.co/harborpine/77aa11bb/apply';
    const offline = await popupOn(
      context,
      setup,
      {
        ...SAMPLE_JOB,
        url: elsewhere,
        pageUrl: elsewhere,
        title: 'Data Scientist',
        posting: '',
        source: 'page',
      },
      { ...SAMPLE_FORM, url: elsewhere },
      { message: 'Couldn’t reach your sync server. Try again.' },
    );
    await offline.getByRole('button', { name: 'Save and fill' }).click();
    await offline.getByText('Couldn’t reach your sync server. Try again.').waitFor({
      timeout: 15_000,
    });
    check(
      (await offline.getByRole('button', { name: 'Fill without saving' }).count()) === 1,
      'where saving doesn’t work, it offers to fill the form without saving',
    );
    await offline.close();

    // A job a Hacker News search found by its company's whole board, as the app syncs it: saving
    // it from its own posting adds the posting to it, and makes no copy.
    const found = 'seeq--ai-software-engineer-staff-principal';
    const board = [
      { url: 'https://apply.workable.com/seeq', label: 'Board' },
      { url: 'https://news.ycombinator.com/item?id=45678901', label: 'HN post' },
    ];
    const seeqRow = {
      ...newJobRows({
        id: found,
        company: 'Seeq',
        role: 'AI Software Engineer, Staff/Principal',
        link: '',
        pay: '',
        status: 'new',
        today: '2026-10-20',
        now: '2026-10-20T12:00:00.000Z',
        statusId: 'from-the-app',
      }).job,
      links: JSON.stringify(board),
      manual: 0,
      status: null,
      status_on: null,
    };
    const seeqRecord = await recordId(keys, rowName('jobs', found));
    const body = { kind: 'row', table: 'jobs', id: found, row: seeqRow, device: 'Mac', at: '' };
    await computer.push([
      {
        record: seeqRecord,
        base: 0,
        data: await sealRecord(keys, seeqRecord, 1, encodeRecord(body as SyncRecord)),
        file: null,
        deleted: false,
      },
    ]);
    const workable = 'https://apply.workable.com/seeq/j/1B6E0A1710/';
    const seeq = await popupOn(context, setup, {
      ...SAMPLE_JOB,
      url: workable,
      pageUrl: workable,
      site: 'apply.workable.com',
      pageTitle: 'AI Software Engineer - Staff/Principal - Seeq',
      title: 'AI Software Engineer - Staff/Principal',
      company: 'Seeq',
      location: 'United States',
      pay: '',
    });
    await seeq.getByText('You saved it from another page.').waitFor({ timeout: 10_000 });
    check(
      ((await seeq.locator('.card.job').textContent()) ?? '').includes(
        'AI Software Engineer, Staff/Principal',
      ),
      'the popup finds the same role a search found by its company’s board, to add this page to',
    );
    await shoot(seeq, 'popup-7-joins');
    await seeq.getByRole('button', { name: 'Save to Factwright' }).click();
    await seeq.getByText('Already in your job hunt, from another page.').waitFor({
      timeout: 15_000,
    });
    const joined = (await sam.client.changes(0)).changes.findLast(
      (each) => each.record === seeqRecord,
    );
    const joinedRow = joined && (await openRecord(keys, seeqRecord, joined.version, joined.data));
    const after = joinedRow ? decodeRecord(joinedRow) : null;
    const copy = await recordId(keys, rowName('jobs', `${found}-2`));
    check(
      after?.kind === 'row' &&
        String(after.row?.links).includes(workable) &&
        !(await sam.client.changes(0)).changes.some((each) => each.record === copy),
      'and saving adds this page’s link and posting to that job, with no copy',
    );
    await shoot(seeq, 'popup-8-joined');
    await seeq.close();

    const job = {
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      site: 'linkedin.com',
      company: 'Northwind',
      role: 'Staff Engineer, Payments',
      pay: '$200k–$240k',
      posting: 'About the job\n\nBuild payments at scale.',
    };
    const save = () =>
      setup.evaluate(
        (sent) =>
          (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
            }
          ).chrome.runtime.sendMessage({ type: 'save', job: sent }),
        job,
      );
    const saved = (await save()) as {
      ok: boolean;
      id: string;
      already: boolean;
      posting: string;
    };
    check(saved.ok && !saved.already && saved.posting === 'saved', 'saves a job');
    const { changes } = await sam.client.changes(0);
    const record = await recordId(keys, rowName('jobs', saved.id));
    const change = changes.find((each) => each.record === record);
    const plain = change && (await openRecord(keys, record, change.version, change.data));
    const row = plain ? decodeRecord(plain) : null;
    check(
      row?.kind === 'row' && row.row?.status === 'new' && row.row.company === 'Northwind',
      'the job reaches sync as New, locked with the account’s keys',
    );
    const posting = await recordId(keys, fileName(`saved/${saved.id}/posting.md`));
    check(
      changes.some((each) => each.record === posting),
      'with the posting as the person saw it',
    );
    const again = (await save()) as { already: boolean; posting: string };
    check(again.already && again.posting === 'kept', 'saves the same job only once');

    // A page it knows nothing of: its main text, shown to check, which a quick save never takes.
    const unknown = await context.newPage();
    await unknown.setViewportSize({ width: 360, height: 600 });
    await unknown.addInitScript(
      (page) => {
        const api = (
          globalThis as unknown as {
            chrome: { tabs: { query: unknown }; scripting: { executeScript: unknown } };
          }
        ).chrome;
        api.tabs.query = async () => [{ id: 2, url: page.url, title: page.pageTitle }];
        api.scripting.executeScript = async () => [{ result: page }];
      },
      { ...SAMPLE_JOB, url: 'https://lumen.example/careers/7', source: 'main', company: '' },
    );
    await unknown.goto(setup.url().replace('setup.html', 'popup.html'));
    await unknown.getByRole('button', { name: 'Save to Factwright' }).waitFor({ timeout: 10_000 });
    check(
      (await unknown.getByText('read the page’s main text').count()) === 1 &&
        ((await unknown.locator('.card.job').textContent()) ?? '').includes('Lumen'),
      'says it read a page’s main text, to check it’s the posting',
    );
    await unknown.getByRole('button', { name: 'Edit details' }).click();
    check(
      (await unknown.locator('details.preview').getAttribute('open')) !== null &&
        (await unknown.locator('#company').inputValue()) === 'Lumen',
      'and shows it open in Edit details',
    );
    await unknown.locator('#company').fill('');
    await unknown.getByRole('button', { name: 'Save to Factwright' }).click();
    await unknown.getByText('Add the company’s name.').waitFor({ timeout: 10_000 });
    check(
      (await unknown.locator('#company').inputValue()) === '',
      'and once you’ve cleared the company, never puts the site’s name back',
    );
    await unknown.close();

    // A page that doesn't look like a job's: its title and company left blank, to save anyway.
    const notJob = await context.newPage();
    await notJob.setViewportSize({ width: 360, height: 600 });
    await notJob.addInitScript(
      (page) => {
        const api = (
          globalThis as unknown as {
            chrome: { tabs: { query: unknown }; scripting: { executeScript: unknown } };
          }
        ).chrome;
        api.tabs.query = async () => [{ id: 3, url: page.url, title: page.pageTitle }];
        api.scripting.executeScript = async () => [{ result: page }];
      },
      {
        ...SAMPLE_JOB,
        url: 'https://weather.example/today/chicago',
        pageUrl: 'https://weather.example/today/chicago',
        site: 'weather.example',
        pageTitle: 'Chicago, IL Weather Forecast',
        title: 'Chicago, IL Weather Forecast',
        company: 'Weather Example',
        location: '',
        pay: '',
        employment: '',
        posted: '',
        posting: 'Today: sunny, with a high of 61°F. Hourly forecast: wind 10 miles per hour.',
        source: 'main',
      },
    );
    await notJob.goto(setup.url().replace('setup.html', 'popup.html'));
    await notJob.getByRole('button', { name: 'Save it anyway' }).waitFor({ timeout: 10_000 });
    check(
      (await notJob.getByText('This doesn’t look like a job posting').count()) === 1 &&
        (await notJob.locator('#role').inputValue()) === '' &&
        (await notJob.locator('#company').inputValue()) === '' &&
        (await notJob.getByRole('button', { name: 'Save to Factwright' }).count()) === 0 &&
        (await notJob.evaluate(() => document.activeElement?.id)) === 'role',
      'says when a page doesn’t look like a job’s, and fills in no title or company',
    );
    await shoot(notJob, '7-not-a-job');
    await notJob.locator('#role').fill('Meteorologist');
    await notJob.getByRole('button', { name: 'Save it anyway' }).click();
    await notJob.getByText('Add the company’s name.').waitFor({ timeout: 10_000 });
    check(
      (await notJob.locator('#role').inputValue()) === 'Meteorologist' &&
        (await notJob.locator('#company').inputValue()) === '' &&
        (await notJob.evaluate(() => document.activeElement?.id)) === 'company',
      'and saves it anyway only with what you type, never the site’s name as the company',
    );
    await notJob.close();

    // With the browser's permission for your own server taken away, setup asks for it back.
    const taken = await context.newPage();
    await taken.addInitScript(() => {
      (
        globalThis as unknown as { chrome: { permissions: { contains: unknown } } }
      ).chrome.permissions.contains = async () => false;
    });
    await taken.goto(setup.url());
    await taken.getByRole('heading', { name: 'Let it reach your sync server' }).waitFor();
    check(
      (await taken.getByText(`through ${server.url.host}, your own sync server`).count()) === 1,
      'asks for your own server back when the browser has taken it away',
    );
    await shoot(taken, '6-allow');
    await taken.close();

    // Signed out, setup asks where saved jobs go again, offering sync, then your own server
    // again, with its address.
    await setup.reload();
    await setup.getByRole('button', { name: 'Sign out' }).click();
    await setup.getByRole('button', { name: 'Continue' }).waitFor();
    check(
      await setup.getByRole('radio', { name: 'Through sync' }).isChecked(),
      'signed out, setup asks where saved jobs go, offering sync, as chosen last',
    );
    await throughSync(setup);
    check(
      (await setup.getByRole('radio', { name: 'Your own server' }).isChecked()) &&
        (await setup.locator('#server').inputValue()) === origin,
      'and through sync, it remembers your own server',
    );
    check(
      standIn.requests() === 0,
      'from setting up to saving and signing out, nothing reaches the server it’s built for',
    );
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }

  // Linked through Factwright's sync, the server it's built for, with a link code, as Factwright's
  // Sync settings shows one, once its sign-in is too old to ask Factwright on the computer.
  build({ VITE_FACTWRIGHT_SYNC_SERVER: factwright.url.origin });
  {
    const { sam, accountKey } = await account(factwright);
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    await sam.client.saveLink(link.id, link.data);
    const { context, setup } = await browser(extension);
    await throughSync(setup);
    // Something not an address left in your own server's box doesn't stop Factwright's sync.
    await setup.getByRole('radio', { name: 'Your own server' }).check();
    await setup.locator('#server').fill('not an address');
    await setup.getByRole('radio', { name: 'Factwright’s sync' }).check();
    await signIn(setup, factwright.url.origin, sam.token);
    check(
      true,
      'signs in through Factwright’s sync, whatever’s left in your own server’s box, with a code where it doesn’t know this copy',
    );
    await factwright.env.DB.prepare(
      'UPDATE "session" SET createdAt = ? WHERE userId = ? AND token != ?',
    )
      .bind(new Date(Date.now() - 2 * 3_600_000).toISOString(), sam.id, sam.token)
      .run();
    await setup.reload();
    await setup
      .getByRole('heading', { name: 'Sign in again to link it' })
      .waitFor({ timeout: 15_000 });
    check(true, 'offers a new sign-in, or a code, once its sign-in is too old to ask');
    await setup.locator('summary').click();
    await setup.fill('#code', code.text);
    await setup.getByRole('button', { name: 'Link with the code' }).click();
    await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 15_000 });
    check(
      (await setup.getByText('Saves through Factwright’s sync').count()) === 1,
      'links with a link code too, through Factwright’s sync',
    );
    await context.close();
  }

  // Through a copy that sells sync, as Factwright's will: an account that can't sync now is told
  // it needs a subscription, rather than asking Factwright on the computer to link it, and links
  // once it has sync again. Then, with sync paused, a save saves nothing, and says why. And Use
  // this computer instead leaves sync for Factwright on this computer, which this build asks the
  // browser to let it reach at install, as a test can't answer the browser's prompt.
  build({ VITE_FACTWRIGHT_SYNC_SERVER: selling.url.origin, FACTWRIGHT_NATIVE_AT_INSTALL: '1' });
  {
    /** The operator giving free sync, or taking it back, as Steve does for someone who asked. */
    const freeSync = async (email: string, off = false) => {
      const response = await fetch(new URL('/api/admin/free-sync', selling.url), {
        method: 'POST',
        headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ email, ...(off && { off: true }) }),
      });
      if (!response.ok) throw new Error(`Free sync answered ${response.status}.`);
    };
    // Sync was turned on while the account had it, which it has no longer.
    const sam = await selling.signUp();
    await freeSync(sam.email);
    const accountKey = newAccountKey();
    const keys = await accountKeys(accountKey);
    await sam.client.saveKeys(
      keys.id,
      await lockWithRecoveryKey(accountKey, newRecoveryKey().bytes),
    );
    await freeSync(sam.email, true);
    const { context, setup, errors } = await browser(extension);
    await throughSync(setup);
    await signIn(setup, selling.url.origin, sam.token, 'Sync needs a subscription');
    check(
      (await setup
        .getByText('Factwright’s sync needs a subscription, and this account doesn’t have one now')
        .count()) === 1 && (await sam.client.linkRequests()).length === 0,
      'says sync needs a subscription, asking Factwright on the computer nothing',
    );
    check(
      (await setup.getByRole('link', { name: 'How to set one up' }).getAttribute('href')) ===
        'https://factwright.com/own-server',
      'pointing to a sync server of your own, which is free',
    );
    await shoot(setup, '7-subscription');

    await freeSync(sam.email);
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    await sam.client.saveLink(link.id, link.data);
    await setup.getByRole('button', { name: 'Check again' }).click();
    await setup
      .getByRole('heading', { name: 'Link it with your job hunt' })
      .waitFor({ timeout: 15_000 });
    check(true, 'asks Factwright on the computer once the account has sync again');
    await setup.locator('summary').click();
    await setup.fill('#code', code.text);
    await setup.getByRole('button', { name: 'Link with the code' }).click();
    await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 15_000 });

    await freeSync(sam.email, true);
    const result = (await setup.evaluate(
      (sent) =>
        (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }
        ).chrome.runtime.sendMessage({ type: 'save', job: sent }),
      {
        url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
        site: 'jobs.lever.co',
        company: 'Harbor & Pine',
        role: 'Senior Product Manager, Data',
        pay: '',
        posting: 'About the role\n\nLead the data platform.',
      },
    )) as { ok: boolean; reason?: string; message?: string };
    check(
      !result.ok &&
        result.reason === 'paused' &&
        (await sam.client.changes(0)).changes.length === 0,
      'saves nothing while sync is paused, and says why',
    );
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();

    // Use this computer instead: it signs out of sync, and looks for Factwright on this computer,
    // which isn't registered here.
    const other = await browser(extension);
    await throughSync(other.setup);
    await signIn(other.setup, selling.url.origin, sam.token, 'Sync needs a subscription');
    const extensions = async () =>
      (await sam.client.account()).devices.filter((device) =>
        device.name.startsWith('Factwright in '),
      ).length;
    const signedInBefore = await extensions();
    await other.setup.getByRole('button', { name: 'Use this computer instead' }).click();
    await other.setup
      .getByRole('heading', { name: 'Get Factwright on this computer' })
      .waitFor({ timeout: 15_000 });
    check(
      (await extensions()) === signedInBefore - 1,
      'Use this computer instead signs out of sync, and looks for Factwright on this computer',
    );
    check(other.errors.length === 0, 'with nothing going wrong on its pages');
    await other.context.close();
  }

  // Through the browser's own window for extensions, where Factwright's sync knows this copy, as it
  // knows the stores' copies: no code to compare, since the browser hands the answer to this
  // extension alone.
  build({ VITE_FACTWRIGHT_SYNC_SERVER: windowed.url.origin });
  {
    // Signed in at the server in this browser already: the window asks once, naming the account.
    const { sam, accountKey } = await account(windowed);
    const { context, setup, errors } = await browser(extension);
    await signedInAt(context, windowed, sam.token);
    await throughSync(setup);
    const window = await openWindow(context, setup);
    check(
      window.url().startsWith(`${windowed.url.origin}/sign-in/extension?`),
      'opens the server’s own page in the browser’s window',
    );
    await window.getByRole('heading', { name: 'Let the Factwright extension sign in?' }).waitFor();
    check(
      (await window.getByText(sam.email).count()) === 1 &&
        (await window.getByRole('link', { name: 'Jobs' }).count()) === 0,
      'which names the account it signs in to, with nothing to wander off to',
    );
    check(
      (await setup.getByText('In the window that opened').count()) === 1 &&
        (await setup.locator('.code').count()) === 0 &&
        (await window.locator('.code, [class*="code"]').count()) === 0,
      'with no code to compare, in setup or in the window',
    );
    await shoot(setup, '8-window-waiting');
    await shoot(window, '9-window-allow');
    const closed = window.waitForEvent('close');
    await window.getByRole('button', { name: 'Allow', exact: true }).click();
    await closed;
    await setup
      .getByRole('heading', { name: 'Link it with your job hunt' })
      .waitFor({ timeout: 30_000 });
    check(true, 'signs in once it’s allowed, and the window closes by itself');
    const devices = (await sam.client.account()).devices;
    const signedIn = devices.find((device) => device.name === 'Factwright in Chrome on Mac');
    check(
      signedIn !== undefined && devices.length === 2,
      'signs in under its own name, as a session of its own',
    );
    const via = await windowed.env.DB.prepare(`SELECT via FROM "session" WHERE id = ?`)
      .bind(signedIn?.id)
      .first<{ via: string }>();
    check(
      via?.via === 'device',
      'a device’s session, which can’t approve devices or delete the account',
    );
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    await sam.client.saveLink(link.id, link.data);
    await setup.locator('summary').click();
    await setup.fill('#code', code.text);
    await setup.getByRole('button', { name: 'Link with the code' }).click();
    await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 15_000 });
    check(true, 'and links, as with any sign-in');
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }
  {
    // Signed out in this browser: the window signs in at the server first, then asks.
    const { sam } = await account(windowed);
    const { context, setup, errors } = await browser(extension);
    await throughSync(setup);
    const window = await openWindow(context, setup);
    await window.getByRole('heading', { name: 'Sign in to Factwright' }).waitFor();
    check(
      (await window.getByRole('button', { name: 'Continue with GitHub' }).count()) === 1,
      'signed out, the window signs in at the server first',
    );
    await shoot(window, '10-window-sign-in');
    // GitHub brings the window back to the same page, signed in.
    await signedInAt(context, windowed, sam.token);
    await window.reload();
    await window.getByRole('heading', { name: 'Let the Factwright extension sign in?' }).waitFor();
    const closed = window.waitForEvent('close');
    await window.getByRole('button', { name: 'Allow', exact: true }).click();
    await closed;
    await setup
      .getByRole('heading', { name: 'Link it with your job hunt' })
      .waitFor({ timeout: 30_000 });
    check(
      (await sam.client.account()).devices.some(
        (device) => device.name === 'Factwright in Chrome on Mac',
      ),
      'then asks, and signs in once it’s allowed',
    );
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }
  {
    // Turned down, or closed: nothing signs in, and setup is back where it started.
    const { sam } = await account(windowed);
    const { context, setup } = await browser(extension);
    await signedInAt(context, windowed, sam.token);
    await throughSync(setup);
    let window = await openWindow(context, setup);
    const closed = window.waitForEvent('close');
    await window.getByRole('button', { name: 'Don’t allow' }).click();
    await closed;
    await setup.getByText('You chose Don’t allow, so the extension didn’t sign in.').waitFor();
    check(
      (await sam.client.account()).devices.length === 1,
      'turned down, signs nothing in, and says so',
    );
    window = await openWindow(context, setup);
    await window.getByRole('button', { name: 'Allow', exact: true }).waitFor();
    await window.close();
    await setup.getByRole('button', { name: 'Sign in to sync' }).waitFor();
    check(
      (await setup.getByRole('alert').count()) === 0 &&
        (await sam.client.account()).devices.length === 1,
      'closed, signs nothing in, and asks nothing',
    );

    // A window that stops short, as Chrome's does when a page in it doesn't load, offers a code
    // instead. Chrome's own answer stands in here, since the window isn't the test's to break.
    const failing = await context.newPage();
    await failing.addInitScript(() => {
      (
        globalThis as unknown as { chrome: { identity: { launchWebAuthFlow: unknown } } }
      ).chrome.identity.launchWebAuthFlow = async () => {
        throw new Error('Authorization page could not be loaded.');
      };
    });
    await failing.goto(setup.url());
    await throughSync(failing);
    await failing.getByRole('button', { name: 'Sign in to sync' }).click();
    await failing.getByRole('button', { name: 'Sign in with a code instead' }).waitFor({
      timeout: 15_000,
    });
    check(
      (await failing.getByRole('alert').textContent()) ===
        'A page in the sign-in window didn’t load, so it closed. Check the connection, then try again.',
      'says when the window stopped short',
    );
    await shoot(failing, '11-window-failed');
    await failing.getByRole('button', { name: 'Sign in with a code instead' }).click();
    const userCode = ((await failing.locator('.code').textContent()) ?? '').replace('-', '');
    const auth = { authorization: `Bearer ${sam.token}` };
    await fetch(`${windowed.url.origin}/api/auth/device?user_code=${userCode}`, { headers: auth });
    await fetch(`${windowed.url.origin}/api/auth/device/approve`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ userCode }),
    });
    await failing
      .getByRole('heading', { name: 'Link it with your job hunt' })
      .waitFor({ timeout: 30_000 });
    check(true, 'and then signs in with a code, as before');
    await context.close();
  }

  // Saved straight to Factwright on this computer, with no account: the browser starts
  // Factwright's helper, which drops each job in the inbox of the app's data folder, and the app,
  // here its own inbox code, adds it from there. This build asks for native messaging at install,
  // as a test can't answer the browser's prompt for it.
  build({ VITE_FACTWRIGHT_SYNC_SERVER: standIn.origin, FACTWRIGHT_NATIVE_AT_INSTALL: '1' });
  {
    const home = mkdtempSync(join(work, 'home-'));
    const inboxFolder = join(home, INBOX_FOLDER);
    const helper = testingHelper();
    const { context, setup, errors, id, profile } = await browser(extension, {
      FACTWRIGHT_HELPER_HOME: home,
    });
    await setup.getByRole('button', { name: 'Continue' }).waitFor();
    await shoot(setup, 'computer-1-where');
    // Before Factwright has registered its helper, setup can't find it, and says how to get it.
    await setup.getByRole('button', { name: 'Continue' }).click();
    await setup.getByRole('heading', { name: 'Get Factwright on this computer' }).waitFor();
    check(true, 'says how to get Factwright when it isn’t on this computer');
    await shoot(setup, 'computer-2-get-factwright');
    registerHelper(profile, helper, id);
    await setup.getByRole('button', { name: 'Check again' }).click();
    await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 15_000 });
    check(
      (await setup.getByText('saves jobs to Factwright on this computer').count()) === 1,
      'finds Factwright on this computer once its helper is registered, and saves there',
    );
    await shoot(setup, 'computer-3-set');

    const job = {
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      site: 'linkedin.com',
      company: 'Northwind',
      role: 'Staff Engineer, Payments',
      pay: '$200k–$240k',
      posting: 'About the job\n\nBuild payments at scale.',
    };
    const save = (sent: typeof job) =>
      setup.evaluate(
        (message) =>
          (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
            }
          ).chrome.runtime.sendMessage({ type: 'save', job: message }),
        sent,
      );
    const waiting = () => readdirSync(inboxFolder).filter((name) => INBOX_JOB.test(name));
    check(
      JSON.stringify(await save(job)) === JSON.stringify({ ok: true, later: true }),
      'with Factwright closed, it says Factwright adds the job when it opens',
    );
    const [dropped] = waiting();
    check(
      waiting().length === 1 &&
        readFileSync(join(inboxFolder, dropped ?? ''), 'utf8') ===
          JSON.stringify({ type: 'save', ...job }),
      'the helper drops the job in the inbox, as the extension sent it, and nothing else',
    );

    // The popup says so too, for a job saved while Factwright is closed.
    const closed = await popupOn(context, setup, {
      ...SAMPLE_JOB,
      url: 'https://jobs.ashbyhq.com/lumen/7d1e',
      pageUrl: 'https://jobs.ashbyhq.com/lumen/7d1e',
      site: 'jobs.ashbyhq.com',
      company: 'Lumen',
      title: 'Data Platform Lead',
    });
    await closed.getByRole('button', { name: 'Save to Factwright' }).click();
    await closed.getByText('Saved for Factwright on this computer.').waitFor({ timeout: 15_000 });
    check(
      (await closed.getByRole('link', { name: 'Settings', exact: true }).count()) === 1,
      'the popup says Factwright adds it the next time it opens, with Settings and no account',
    );
    await shoot(closed, 'computer-4-later');
    await closed.close();

    // Factwright opens, and adds the jobs that waited.
    const tracker = new Tracker(join(home, 'tracker.db'));
    const jobs = new JobsService({
      workspace: join(home, 'workspace'),
      tracker,
      onChange: () => {},
    });
    const inbox = new JobInbox({
      folder: inboxFolder,
      add: (saved) => jobs.addSaved(saved),
      // The popup's look-up alone, which needs only the jobs.
      answer: (ask) => answerAsk(ask, { jobs } as unknown as FillDeps),
    });
    inbox.start();
    const northwind = tracker.rows().find((row) => row.company === 'Northwind');
    check(
      northwind?.status === 'new' &&
        tracker.rows().some((row) => row.company === 'Lumen' && row.status === 'new') &&
        waiting().length === 0 &&
        readFileSync(join(home, 'workspace', 'saved', northwind.id, 'posting.md'), 'utf8').includes(
          'Build payments at scale.',
        ),
      'Factwright adds the jobs that waited as it opens: as New, with their postings',
    );

    // With Factwright open, the popup's save is added at once, and says so.
    const popup = await popupOn(context, setup, SAMPLE_JOB);
    await popup.getByRole('button', { name: 'Save to Factwright' }).click();
    await popup.getByText('Saved to your job hunt, as New.').waitFor({ timeout: 15_000 });
    check(
      tracker.rows().some((row) => row.company === 'Harbor & Pine' && row.status === 'new') &&
        (await popup.getByText('once it syncs').count()) === 0,
      'with Factwright open, the popup’s save is in the job hunt at once',
    );
    await shoot(popup, 'computer-5-saved');
    await popup.close();
    // Factwright on this computer knows it's saved, as the popup asks it, from its application too.
    const known = await popupOn(context, setup, {
      ...SAMPLE_JOB,
      url: `${SAMPLE_JOB.url}/apply`,
      pageUrl: `${SAMPLE_JOB.url}/apply`,
    });
    await known.getByText('In your job hunt').waitFor({ timeout: 15_000 });
    check(
      ((await known.locator('.card.job').textContent()) ?? '').includes('Harbor & Pine · New'),
      'Factwright on this computer says the popup’s job is saved, from its application too',
    );
    await known.close();
    const again = (await save(job)) as { ok: boolean; already: boolean; posting: string };
    check(again.ok && again.already && again.posting === 'kept', 'saves the same job only once');
    inbox.stop();
    tracker.close();

    // With the browser's OK taken away, as Firefox lets you, setup asks for it back.
    const taken = await context.newPage();
    await taken.addInitScript(() => {
      (
        globalThis as unknown as { chrome: { permissions: { contains: unknown } } }
      ).chrome.permissions.contains = async () => false;
    });
    await taken.goto(setup.url());
    await taken
      .getByRole('heading', { name: 'Let it reach Factwright on this computer' })
      .waitFor();
    check(true, 'asks for the browser’s OK back when it’s taken away');
    await shoot(taken, 'computer-6-allow');
    await taken.close();

    // And it can save through sync instead.
    await setup.reload();
    await setup.getByRole('button', { name: 'Save through sync instead' }).click();
    await setup.getByRole('button', { name: 'Sign in to sync' }).waitFor();
    check(standIn.requests() === 0, 'saving on this computer, nothing reaches a sync server');
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  // Any browser a failure left open is closed first, as Chromium writes to its profile while it
  // runs: Playwright stops one that won't close as the run ends. Then the run's folder goes,
  // before anything below can fail and skip it.
  for (const context of browsers) await context.close().catch(() => {});
  try {
    // Chromium may hold its profile a moment after it stops.
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // A temporary folder left behind does no harm.
  }
  // Set while framing, which TypeScript can't follow from here.
  await (framer as Browser | null)?.close();
  await server.close();
  await factwright.close();
  await selling.close();
  await windowed.close();
  standIn.close();
  typo.close();
  old.close();
  // Built again for Factwright's own sync server, as the stores get it.
  build();
}
process.exit(failed ? 1 : 0);
