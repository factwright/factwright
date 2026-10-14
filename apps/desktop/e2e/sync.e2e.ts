import { rmSync } from 'node:fs';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let server: TestServer;
let person: Account;
const folders: string[] = [];
const apps: Opened[] = [];

test.beforeAll(async () => {
  server = await startServer();
  person = await server.signUp('Alex Rivera');
});

test.afterAll(async () => {
  for (const opened of apps) await opened.app.close().catch(() => {});
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  await server?.close();
});

/** A computer running the app, pointed at the sync server running locally. */
async function computer(empty: boolean): Promise<Opened> {
  const dataDir = newDataFolder({ empty });
  folders.push(dataDir);
  const opened = await openApp(dataDir, { FACTWRIGHT_SERVER_URL: server.url.origin });
  apps.push(opened);
  await opened.app.evaluate(({ safeStorage, shell }) => {
    // A stand-in keychain, so tests never reach this computer's real one.
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (text: string) => Buffer.from(`stand-in:${text}`);
    safeStorage.decryptString = (locked: Buffer) => locked.toString().slice('stand-in:'.length);
    // The browser stays closed: the test approves sign-in as the person would there.
    const opening = globalThis as unknown as { opened: string[] };
    opening.opened = [];
    shell.openExternal = async (url: string) => {
      opening.opened.push(url);
    };
  });
  return opened;
}

/** In the browser, signed in: the person checks the code and allows the app. */
async function approveInBrowser({ app }: Opened) {
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length))
    .toBe(1);
  const url = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened[0]);
  const userCode = new URL(url ?? '').searchParams.get('user_code') ?? '';
  const headers = { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' };
  await fetch(new URL(`/api/auth/device?user_code=${userCode}`, server.url), { headers });
  await fetch(new URL('/api/auth/device/approve', server.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ userCode }),
  });
}

const syncCard = ({ window }: Opened) => window.getByRole('region', { name: 'Sync' });

let mac: Opened;
let pc: Opened;

test('turns on sync on the first computer, with a recovery key saved', async () => {
  mac = await computer(false);
  const { window } = mac;
  await expect(syncCard(mac).getByText('Off')).toBeVisible();
  await syncCard(mac).getByRole('button', { name: 'Turn on…' }).click();
  await window.getByRole('button', { name: 'Sign in with your browser' }).click();
  await expect(window.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
  await approveInBrowser(mac);
  await expect(window.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
  await window.getByText('I’ve saved my recovery key somewhere safe').click();
  await window.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(window.getByRole('heading', { name: 'Sync' })).toBeVisible();
  await expect(window.getByText(/Up to date/).first()).toBeVisible({ timeout: 20_000 });
});

test('links a second computer with a code, and the job hunt arrives', async () => {
  pc = await computer(true);
  // A computer with nothing on it welcomes a new user, who can bring their job hunt instead.
  await expect(pc.window.getByRole('heading', { name: 'Let’s get you set up' })).toBeVisible();
  await syncCard(pc).getByRole('button', { name: 'Turn on…' }).click();
  await pc.window.getByRole('button', { name: 'Sign in with your browser' }).click();
  await approveInBrowser(pc);
  await expect(pc.window.getByRole('heading', { name: 'Link this computer' })).toBeVisible();

  await mac.window.getByRole('button', { name: 'Link a phone or computer' }).click();
  const code = (await mac.window.locator('code').last().textContent()) ?? '';
  expect(code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);

  // The computer asks to be approved, with typing a code still there as another way.
  await pc.window.getByText('Or type a code from your other device').click();
  await pc.window.getByRole('textbox', { name: 'Code from your other device' }).fill(code);
  await pc.window.getByRole('button', { name: 'Link this computer' }).click();
  await expect(pc.window.getByRole('heading', { name: 'Sync' })).toBeVisible();
  await pc.window.getByRole('button', { name: 'Done' }).click();
  await expect(pc.window.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible({
    timeout: 20_000,
  });
});

test('keeps both computers in step as the job hunt changes', async () => {
  await mac.window.getByRole('button', { name: 'Done' }).click();
  await pc.window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await pc.window.getByRole('textbox', { name: 'New note' }).fill('Recruiter: Sam, from the PC');
  await pc.window.getByRole('button', { name: 'Add note' }).click();
  await mac.window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await expect(mac.window.getByRole('list', { name: 'Your notes' })).toContainText(
    'Recruiter: Sam, from the PC',
    { timeout: 20_000 },
  );
});

test('links a third computer from the first, once both show the same emoji', async () => {
  const laptop = await computer(true);
  await syncCard(laptop).getByRole('button', { name: 'Turn on…' }).click();
  await laptop.window.getByRole('button', { name: 'Sign in with your browser' }).click();
  await approveInBrowser(laptop);
  await expect(laptop.window.getByRole('heading', { name: 'Link this computer' })).toBeVisible();
  await expect(laptop.window.getByText('Waiting for your other device…')).toBeVisible();

  // The first computer hears of it at once, and the person approves it there.
  await expect(syncCard(mac).getByText('A device wants to link')).toBeVisible();
  await syncCard(mac).getByRole('button', { name: 'Review' }).click();
  const request = mac.window.getByRole('region', { name: 'A new device wants to link' });
  await request.getByRole('button', { name: 'Approve…' }).click();
  const onMac = mac.window.getByRole('list', { name: 'Check code' });
  const onLaptop = laptop.window.getByRole('list', { name: 'Check code' });
  await expect(onMac).toBeVisible();
  await expect(onLaptop).toBeVisible();
  const emoji = await onMac.getByRole('listitem').allTextContents();
  expect(emoji).toHaveLength(6);
  expect(await onLaptop.getByRole('listitem').allTextContents()).toEqual(emoji);

  await laptop.window.getByRole('button', { name: 'They match', exact: true }).click();
  await mac.window.getByRole('button', { name: 'They match, link it' }).click();
  await expect(laptop.window.getByRole('heading', { name: 'Sync' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(mac.window.getByText(/is linked\.$/)).toBeVisible({ timeout: 20_000 });
  await laptop.window.getByRole('button', { name: 'Done' }).click();
  await expect(laptop.window.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible({
    timeout: 20_000,
  });
});
