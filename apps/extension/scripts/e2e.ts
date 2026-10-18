// Runs Save to Factwright in Chromium, from setting it up to saving a job: through a server of
// your own, chosen in setup, with a site that counts every request standing in for the server it's
// built for, and then through the server it's built for, a local copy of the sync server standing
// in for Factwright's sync. It signs in with a code, then links both ways, with the emoji
// Factwright on a computer checks, and with a link code. Then, through a copy that sells sync, as
// Factwright's will, an account without sync is told it needs a subscription, links once it has
// one, and saves nothing while sync is paused. The computer's side runs here, with the same code
// the desktop app uses. `pnpm --filter @factwright/extension e2e` (it needs Playwright's
// Chromium: `pnpm --filter @factwright/site exec playwright install chromium`). With
// `-- --screenshots`, it also draws the stores' screenshots, into store/screenshots, from what it
// shows along the way, and with `-- --shots <folder>`, saves each setup page it checks there, in
// light and dark.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type TestServer } from '@factwright/server/testing';
import {
  accountKeys,
  checkEmoji,
  decodeRecord,
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
} from '@factwright/sync';
import { LIGHT } from '@factwright/ui/tokens';
import { type Browser, chromium, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

/**
 * The extension, loaded in a fresh Chromium, and its setup page. The browser's prompts can't be
 * answered in a test, so a request to reach any site but this computer's is answered no, as
 * declining it would be. Each request is noted, as `asked`, to check what setup asked for.
 */
async function browser(extension: string) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fw-ext-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    deviceScaleFactor: 2,
  });
  await context.addInitScript((local) => {
    type Permissions = { request(asked: { origins: string[] }): Promise<boolean> };
    const page = globalThis as unknown as {
      asked: string[][];
      chrome?: { permissions?: Permissions };
    };
    const api = page.chrome?.permissions;
    if (!api) return;
    const request = api.request.bind(api);
    page.asked = [];
    api.request = (asked) => {
      page.asked.push(asked.origins);
      return asked.origins.every((origin) => origin === local)
        ? request(asked)
        : Promise.resolve(false);
    };
  }, LOCAL_SITE);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const id = new URL(worker.url()).host;
  const setup = await context.newPage();
  const errors: string[] = [];
  setup.on('pageerror', (error) => errors.push(error.message));
  await setup.goto(`chrome-extension://${id}/setup.html`);
  return { context, setup, errors };
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

/**
 * Signs the extension in to a server, Factwright's or one of your own, chosen in setup: it shows
 * a code, which the person allows in the browser. Then setup goes on to linking, unless it shows
 * another step, `next`.
 */
async function signIn(
  setup: Page,
  origin: string,
  token: string,
  own = false,
  next = 'Link it with your job hunt',
): Promise<void> {
  if (own) {
    await setup.getByRole('radio', { name: 'Your own server' }).check();
    await setup.locator('#server').fill(origin);
  }
  await setup.getByRole('button', { name: 'Sign in to sync' }).click();
  const userCode = ((await setup.locator('.code').textContent()) ?? '').replace('-', '');
  if (own) await shoot(setup, '4-code');
  const auth = { authorization: `Bearer ${token}` };
  await fetch(`${origin}/api/auth/device?user_code=${userCode}`, { headers: auth });
  await fetch(`${origin}/api/auth/device/approve`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ userCode }),
  });
  await setup.getByRole('heading', { name: next }).waitFor({ timeout: 30_000 });
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
 * A local copy of the sync server standing in for Factwright's sync, a server of your own, a site
 * standing in for Factwright's sync that counts what reaches it, and an address typed wrong, which
 * isn't a sync server.
 */
const factwright = await startServer();
const server = await startServer();
const origin = server.url.origin;
/** A sync server that sends its sign-in to another address than the one it was reached at. */
const moved = await startServer({ APP_URL: 'https://sync.example.com' });
/** A copy that sells sync, as Factwright's will. Nothing here pays, so nothing reaches Stripe. */
const selling = await startServer({
  STRIPE_SECRET_KEY: 'rk_test_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
  STRIPE_API_URL: 'http://127.0.0.1:9',
  EARLY_BEFORE: '2026-01-01T00:00:00.000Z',
});
const standIn = await notSync();
const typo = await notSync();
const build = (env: Record<string, string> = {}) =>
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
const extension = join(ROOT, 'dist', 'chrome');
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
    await setup.getByRole('button', { name: 'Sign in to sync' }).waitFor();
    check(
      (await setup.getByRole('radio', { name: 'Factwright’s sync' }).isChecked()) &&
        !(await setup.locator('#server').isVisible()),
      'setup offers Factwright’s sync first',
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
    // Every tab that opens, to show none does. A tab at an address that goes nowhere soon shows
    // an error page instead, so it's counted as it opens, not checked by its address after.
    const opened: string[] = [];
    const onTab = (tab: Page) => opened.push(tab.url());
    context.on('page', onTab);
    await setup.locator('#server').fill(moved.url.origin);
    await setup.getByRole('button', { name: 'Sign in to sync' }).click();
    await setup.getByText('sends its sign-in to another address, sync.example.com').waitFor();
    await pause(1000);
    context.off('page', onTab);
    check(opened.length === 0, 'never opens a sign-in page at another address than your server’s');
    await signIn(setup, origin, sam.token, true);
    const devices = (await sam.client.account()).devices.map((device) => device.name);
    check(devices.includes('Save to Factwright in Chrome on Mac'), 'signs in under its own name');
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

    // The popup, on a job's page: the tab it reads stands in here, since a test can't click the
    // toolbar. The save it makes is real.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 480 });
    await popup.addInitScript((page) => {
      const api = (
        globalThis as unknown as {
          chrome: { tabs: { query: unknown }; scripting: { executeScript: unknown } };
        }
      ).chrome;
      api.tabs.query = async () => [{ id: 1, url: page.url, title: page.pageTitle }];
      api.scripting.executeScript = async () => [{ result: page }];
    }, SAMPLE_JOB);
    await popup.goto(setup.url().replace('setup.html', 'popup.html'));
    await popup.getByRole('button', { name: 'Save to Factwright' }).waitFor({ timeout: 10_000 });
    check(
      (await popup.locator('#company').inputValue()) === 'Harbor & Pine',
      'the popup shows the job it read, to check',
    );
    check(
      (await popup.locator('#keep').isChecked()) &&
        (await popup.locator('.posting').textContent())?.startsWith('About the role') === true,
      'with the posting it saves, to look over, and a way to leave it out',
    );
    await frame(
      await popup.locator('body').screenshot(),
      400,
      'Check it, save it',
      'On a job’s page, click Save to Factwright. It reads the job’s title, company, pay and posting.',
      '1-save.png',
    );
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
      (await unknown.locator('details.preview').getAttribute('open')) !== null &&
        (await unknown.getByText('read the page’s main text').count()) === 1 &&
        (await unknown.locator('#company').inputValue()) === 'Lumen',
      'shows a page’s main text open, to check it’s the posting',
    );
    await unknown.close();

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

    // Signed out, setup offers your own server again, with its address.
    await setup.reload();
    await setup.getByRole('button', { name: 'Sign out of Save to Factwright' }).click();
    await setup.getByRole('button', { name: 'Sign in to sync' }).waitFor();
    check(
      (await setup.getByRole('radio', { name: 'Your own server' }).isChecked()) &&
        (await setup.locator('#server').inputValue()) === origin,
      'signed out, setup remembers your own server',
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
    // Something not an address left in your own server's box doesn't stop Factwright's sync.
    await setup.getByRole('radio', { name: 'Your own server' }).check();
    await setup.locator('#server').fill('not an address');
    await setup.getByRole('radio', { name: 'Factwright’s sync' }).check();
    await signIn(setup, factwright.url.origin, sam.token);
    check(true, 'signs in through Factwright’s sync, whatever’s left in your own server’s box');
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
  // once it has sync again. Then, with sync paused, a save saves nothing, and says why.
  build({ VITE_FACTWRIGHT_SYNC_SERVER: selling.url.origin });
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
    await signIn(setup, selling.url.origin, sam.token, false, 'Sync needs a subscription');
    check(
      (await setup
        .getByText('Factwright’s sync needs a subscription, and this account doesn’t have one now')
        .count()) === 1 && (await sam.client.linkRequests()).length === 0,
      'says sync needs a subscription, asking Factwright on the computer nothing',
    );
    check(
      (await setup.getByRole('link', { name: 'How to set one up' }).getAttribute('href')) ===
        'https://github.com/factwright/sync-server',
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
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  // Set while framing, which TypeScript can't follow from here.
  await (framer as Browser | null)?.close();
  await server.close();
  await factwright.close();
  await moved.close();
  await selling.close();
  standIn.close();
  typo.close();
  // Built again for Factwright's own sync server, as the stores get it.
  build();
}
process.exit(failed ? 1 : 0);
