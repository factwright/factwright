// Runs Save to Factwright in Chromium, built for a local copy of the sync server, from setting it up
// to saving a job: signing in with a code, then linking both ways, with the emoji Factwright on a
// computer checks, and with a link code. The computer's side runs here, with the same code the
// desktop app uses. `pnpm --filter @factwright/extension e2e` (it needs Playwright's Chromium:
// `pnpm --filter @factwright/site exec playwright install chromium`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
import { chromium, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
    const saved = (await save()) as { ok: boolean; id: string; already: boolean };
    check(saved.ok && !saved.already, 'saves a job');
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
    check(((await save()) as { already: boolean }).already, 'saves the same job only once');
    check(errors.length === 0, 'with nothing going wrong on its pages');
    await context.close();
  }

  // Linked with a link code, as Factwright's Sync settings shows one.
  {
    const { sam, accountKey } = await account(server);
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    await sam.client.saveLink(link.id, link.data);
    const { context, setup } = await browser(extension);
    await signIn(setup, origin, sam.token);
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
  await server.close();
  // Built again for Factwright's own sync server, as the stores get it.
  build();
}
process.exit(failed ? 1 : 0);
