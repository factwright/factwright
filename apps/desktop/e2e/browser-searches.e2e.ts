import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

/** What the app's main process noted: links it sent to the browser, and what it asked for. */
interface Noted {
  opened: string[];
  asked: string[];
}

let dataDir: string;
let opened: Opened;

test.beforeAll(async () => {
  dataDir = newDataFolder();
  const about = join(dataDir, 'workspace', 'about-me');
  mkdirSync(about);
  writeFileSync(
    join(about, 'answers.json'),
    JSON.stringify({
      roles: ['Registered Nurse'],
      workplaces: ['remote', 'onsite'],
      remoteFrom: 'anywhere in the US',
      places: ['Columbus, OH'],
      companies: ['public'],
      startedOn: '2026-10-01',
    }),
  );
  opened = await openApp(dataDir);
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// These sites are never opened from code, here or anywhere: the test goes by each link's text, and
// stops at the point the app would hand it to the browser.
test('opens a ready-made search in the user’s own browser, and fetches none itself', async () => {
  const { app, window } = opened;
  await app.evaluate(({ BrowserWindow, shell }) => {
    const noted = globalThis as unknown as Noted;
    noted.opened = [];
    noted.asked = [];
    // The browser stays closed: a link that leaves the app lands here.
    shell.openExternal = async (url: string) => {
      noted.opened.push(url);
    };
    const main = BrowserWindow.getAllWindows()[0];
    main?.webContents.session.webRequest.onBeforeRequest((details, done) => {
      noted.asked.push(details.url);
      done({});
    });
    // As small as the window goes.
    main?.setSize(900, 600);
  });
  const sentToBrowser = () => app.evaluate(() => (globalThis as unknown as Noted).opened);
  const asked = () => app.evaluate(() => (globalThis as unknown as Noted).asked);
  const page = window.url();

  await window.getByRole('button', { name: 'Find jobs' }).click();
  const dialog = window.getByRole('dialog', { name: 'Find jobs' });
  // Folded, and in view as the dialog opens, even in the smallest window.
  const fold = dialog.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ });
  await expect(fold).toBeInViewport();
  await expect(fold).toContainText('2 ready-made searches');
  await expect(dialog.getByRole('link')).toHaveCount(0);

  await fold.click();
  const remote = dialog.getByRole('list', { name: 'Remote, United States' });
  await expect(remote.getByRole('listitem')).toHaveCount(1);
  await expect(
    remote.getByRole('link', { name: 'Registered Nurse, Remote, United States, on LinkedIn' }),
  ).toHaveAttribute(
    'href',
    'https://www.linkedin.com/jobs/search/?keywords=Registered%20Nurse&location=United%20States&f_WT=2&f_TPR=r604800',
  );
  await expect(
    remote.getByRole('link', { name: 'Registered Nurse, Remote, United States, on Indeed' }),
  ).toHaveAttribute('href', 'https://www.indeed.com/jobs?q=Registered%20Nurse&l=Remote&fromage=7');

  // Each goes where any outside link goes, with its address as it reads.
  const inTheCity = dialog.getByRole('list', { name: 'Columbus, OH' });
  const addresses: [string, string][] = [
    [
      'LinkedIn',
      'https://www.linkedin.com/jobs/search/?keywords=Registered%20Nurse&location=Columbus%2C%20OH&f_TPR=r604800',
    ],
    ['Indeed', 'https://www.indeed.com/jobs?q=Registered%20Nurse&l=Columbus%2C%20OH&fromage=7'],
    [
      'GovernmentJobs',
      'https://www.governmentjobs.com/jobs?keyword=Registered%20Nurse&location=Columbus%2C%20OH',
    ],
  ];
  for (const [site] of addresses) {
    await inTheCity
      .getByRole('link', { name: `Registered Nurse, Columbus, OH, on ${site}` })
      .click();
  }
  await expect.poll(sentToBrowser).toEqual(addresses.map(([, address]) => address));

  // The app stays as it was: its own page, one window, the dialog still open.
  expect(window.url()).toBe(page);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(fold).toBeVisible();

  // The Browser extension window opens over it, and closing it comes back here.
  await dialog.getByRole('button', { name: 'browser extension' }).click();
  const extension = window.getByRole('dialog', { name: 'Browser extension' });
  await expect(extension).toBeVisible();
  await extension.getByRole('button', { name: 'Close' }).click();
  await expect(extension).toHaveCount(0);
  await expect(inTheCity).toBeVisible();

  // The app fetched none of these. The list is real: the page's own fetch shows up in it.
  await window.evaluate('fetch(location.href).then(() => true, () => false)');
  await expect.poll(asked).toContain(page);
  expect((await asked()).filter((url) => /linkedin|indeed|governmentjobs/i.test(url))).toEqual([]);
});
