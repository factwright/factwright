import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

/** The links the app's main process sent to the browser. */
interface Noted {
  opened: string[];
}

let dataDir: string;
let opened: Opened;

// A site of the test's own, to see what the window can reach.
const heard: string[] = [];
const site = createServer((request, response) => {
  heard.push(request.url ?? '');
  response.end('A page');
});

test.beforeAll(async () => {
  await new Promise<void>((listening) => site.listen(0, '127.0.0.1', listening));
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
  await new Promise((closed) => site.close(closed));
});

// These sites are never opened from code, here or anywhere: the test goes by each link's text, and
// stops at the point the app would hand it to the browser.
test('opens a ready-made search in the user’s own browser, and fetches none itself', async () => {
  const { app, window } = opened;
  // Should a click ever send the page to one of these sites, it goes no further, and the test says
  // so. A download doesn't come through here, so none is asked for from these sites below.
  const asked: string[] = [];
  await window.route(/linkedin\.com|indeed\.com|governmentjobs\.com/i, (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  await app.evaluate(({ BrowserWindow, session, shell }) => {
    const noted = globalThis as unknown as Noted;
    noted.opened = [];
    // The browser stays closed: a link that leaves the app lands here.
    shell.openExternal = async (url: string) => {
      noted.opened.push(url);
    };
    // Should a download ever get this far, no window asks where to save it.
    session.defaultSession.on('will-download', (event) => event.preventDefault());
    // As small as the window goes.
    BrowserWindow.getAllWindows()[0]?.setSize(900, 600);
  });
  const sentToBrowser = () => app.evaluate(() => (globalThis as unknown as Noted).opened);
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
  const onSite = (name: string) =>
    inTheCity.getByRole('link', { name: `Registered Nurse, Columbus, OH, on ${name}` });
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
  for (const [name] of addresses) await onSite(name).click();
  await expect.poll(sentToBrowser).toEqual(addresses.map(([, address]) => address));

  // With Alt or Option held, which means "download this" to Chromium, it goes the same way. This
  // link's address is the test's own, so that nothing can reach the site from a build without what
  // keeps it from doing that, as the test doesn't build the app.
  const { port } = site.address() as AddressInfo;
  const held = `https://127.0.0.1:${port}/with-alt-held`;
  await window.evaluate(
    `document.querySelector('a[aria-label="Registered Nurse, Columbus, OH, on Indeed"]').href = '${held}'`,
  );
  await onSite('Indeed').click({ modifiers: ['Alt'] });
  await onSite('Indeed').focus();
  await window.keyboard.press('Alt+Enter');
  await expect
    .poll(sentToBrowser)
    .toEqual([...addresses.map(([, address]) => address), held, held]);
  // The app stays as it was: its own page, one window, the dialog still open.
  expect(window.url()).toBe(page);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(fold).toBeVisible();
  expect(asked).toEqual([]);

  // The Browser extension window opens over it, and either way of closing it comes back here, with
  // the focus on what opened it.
  const opener = dialog.getByRole('button', { name: 'browser extension' });
  const extension = window.getByRole('dialog', { name: 'Browser extension' });
  const focused = () => window.evaluate('document.activeElement?.textContent');
  for (const way of ['Close', 'Done']) {
    await opener.click();
    await expect(extension).toBeVisible();
    await extension.getByRole('button', { name: way }).click();
    await expect(extension).toHaveCount(0);
    await expect(inTheCity).toBeVisible();
    await expect.poll(focused).toBe('browser extension');
  }

  // Last, as this leaves the page's clicks stopped. With nothing in the page to catch it, Alt and a
  // click tells Chromium to download a link, which the content security policy doesn't cover, and
  // the page still can't reach the web. The test's own site shows that, once it's heard from the
  // test itself, so it's listening.
  await window.evaluate(`(() => {
    window.addEventListener('click', (event) => event.stopImmediatePropagation(), true);
    const link = document.createElement('a');
    link.href = 'http://127.0.0.1:${port}/from-the-window';
    link.textContent = 'A link to download';
    document.querySelector('dialog[open] form').prepend(link);
  })()`);
  await dialog
    .getByRole('link', { name: 'A link to download' })
    .click({ modifiers: ['Alt'], noWaitAfter: true });
  await window.waitForTimeout(1000);
  await fetch(`http://127.0.0.1:${port}/from-the-test`);
  expect(heard).toEqual(['/from-the-test']);
});

test('takes someone with no titles to where they add them', async () => {
  // The made-up jobs open on the jobs, with nobody having got started yet.
  const folder = newDataFolder();
  const { app, window } = await openApp(folder);
  try {
    await window.getByRole('button', { name: 'Find jobs' }).click();
    const dialog = window.getByRole('dialog', { name: 'Find jobs' });
    const fold = dialog.getByRole('button', { name: /^Look on LinkedIn and Indeed yourself/ });
    await expect(fold).toContainText('Needs your job titles');
    await fold.click();
    await expect(dialog.getByRole('list')).toHaveCount(0);
    await expect(dialog.getByText(/^Add the job titles you want in/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Get started' }).click();
    await expect(dialog).toHaveCount(0);
    // The step that asks for them, which wasn't open yet, with focus on the page the user is on.
    await expect(window.getByRole('heading', { name: 'What you want' })).toBeVisible();
    await expect(
      window.getByRole('button', { name: /What you want/ }).and(window.locator('[aria-current]')),
    ).toBeVisible();
    await expect
      .poll(() => window.evaluate('document.activeElement?.textContent?.trim()'))
      .toBe('Get started');
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
