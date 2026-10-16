// Runs Save to Factwright in Chromium, built for a local copy of the sync server, from setting it up
// to saving a job: signing in with a code, then linking both ways, with the emoji Factwright on a
// computer checks, and with a link code. The computer's side runs here, with the same code the
// desktop app uses. `pnpm --filter @factwright/extension e2e` (it needs Playwright's Chromium:
// `pnpm --filter @factwright/site exec playwright install chromium`). With `-- --screenshots`, it
// also draws the stores' screenshots, into store/screenshots, from what it shows along the way.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
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

/** The extension, loaded in a fresh Chromium, and its setup page. */
async function browser(extension: string) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fw-ext-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    deviceScaleFactor: 2,
  });
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
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('p')) {
      element.textContent = (element.textContent ?? '').replace(
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
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + 2 * margin,
      height: (end ? end.y - box.y : box.height + margin) + margin,
    },
  });
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

/** Signs the extension in: it shows a code, which the person allows in the browser. */
async function signIn(setup: Page, origin: string, token: string): Promise<void> {
  await setup.getByRole('button', { name: 'Sign in to sync' }).click();
  const userCode = ((await setup.locator('.code').textContent()) ?? '').replace('-', '');
  const auth = { authorization: `Bearer ${token}` };
  await fetch(`${origin}/api/auth/device?user_code=${userCode}`, { headers: auth });
  await fetch(`${origin}/api/auth/device/approve`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ userCode }),
  });
  await setup
    .getByRole('heading', { name: 'Link it with your job hunt' })
    .waitFor({ timeout: 30_000 });
}

const server = await startServer();
const origin = server.url.origin;
const build = (env: Record<string, string> = {}) =>
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
let failed = false;
try {
  build({ VITE_FACTWRIGHT_SYNC_SERVER: origin });
  const extension = join(ROOT, 'dist', 'chrome');

  // Linked the main way: Factwright on the computer approves it, after both show the same emoji.
  {
    const { sam, accountKey, keys } = await account(server);
    const computer = (
      await server.newSession(sam.id, 'Factwright/0.4.0 (Sam%E2%80%99s%20Mac)', 'device')
    ).client;
    const { context, setup, errors } = await browser(extension);
    await signIn(setup, origin, sam.token);
    const devices = (await sam.client.account()).devices.map((device) => device.name);
    check(devices.includes('Save to Factwright in Chrome on Mac'), 'signs in under its own name');
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
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }

  // Linked with a link code, as Factwright's Sync settings shows one, once its sign-in is too old
  // to ask Factwright on the computer.
  {
    const { sam, accountKey } = await account(server);
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    await sam.client.saveLink(link.id, link.data);
    const { context, setup } = await browser(extension);
    await signIn(setup, origin, sam.token);
    await server.env.DB.prepare(
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
    check(true, 'links with a link code too');
    await context.close();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  // Set while framing, which TypeScript can't follow from here.
  await (framer as Browser | null)?.close();
  await server.close();
  // Built again for Factwright's own sync server, as the stores get it.
  build();
}
process.exit(failed ? 1 : 0);
