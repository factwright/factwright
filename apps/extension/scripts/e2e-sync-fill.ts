// Fills an application form with Factwright in Chromium, through sync, as in a browser on a
// computer without Factwright. Factwright on another computer, its own sync running here, has
// synced a made-up job hunt to an account on a local copy of the sync server. The built extension
// links to the account in setup, with a link code, and its panel reads the job hunt from sync with
// the account's keys and fills the form from it, with the job's resume uploaded from what sync
// holds. The equal-opportunity answer, which Factwright keeps on its computer alone, is left for
// you. The form's new question is left with the job, which Factwright then has, for your Claude,
// a stand-in here, whose draft, once it syncs, fills in at the next Fill. Mark as applied marks
// the job Applied in Factwright, with what was sent, and Save keeps a new answer in Profile, but
// never the equal-opportunity one, which never syncs. The job application sites' menus and Fill
// button answer from sync too, and offer to keep nothing. A Workday application fills through sync
// a page at a time, with a part added for each job in the synced work history. Nothing the
// extension read is left in its storage. Nothing is submitted, and nothing leaves this computer.
// `pnpm --filter @factwright/extension e2e:sync-fill` (it needs Playwright's Chromium, as `e2e`
// does). With `-- --shots <folder>`, it saves the panel and the filled form there as pictures.
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
import { startServer, type TestServer } from '@factwright/server/testing';
import { type BrowserContext, chromium, type Page } from '@playwright/test';
import { LEVER_LOOKS_UP, withOwnCode, workdayCode } from './sites-own-code.ts';
import { FOLDER, PDF, syncedHunt } from './synced-hunt.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');
const SHOTS = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

function check(that: boolean, what: string): void {
  if (!that) throw new Error(`Not so: ${what}`);
  console.log(`✓ ${what}`);
}

const unpackedId = (folder: string) =>
  [...createHash('sha256').update(realpathSync(folder)).digest().subarray(0, 16).toString('hex')]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('');

/** The job's application, as Lever shows its form, served on this computer. */
const FORM_PATH = '/northwind/7a1c9e40-2b6d-4f1e-9c3a-5d8e0f2b4a71/apply';

/** The form's own question that nothing on file answers, for your Claude. */
const OWN_QUESTION = 'Have you ever been previously employed by Northwind Labs?';

/**
 * A Workday application, at its own address, as its pages are built from Workday's markup, with
 * its own code acted out: it runs over several pages in the tab, the next ones from here.
 */
const WORKDAY_PATH =
  '/larkspur/job/Denver-CO/Senior-Product-Manager_R2026-0147/apply/applyManually';
const WORKDAY_PAGES = '/workday-pages/';
const WORKDAY_STEPS = ['my-information', 'my-experience'];

/** Your work history, as Profile keeps it: three positions at two companies, and two schools. */
const WORK_HISTORY = {
  jobs: [
    {
      company: 'Tidewater Analytics',
      location: 'Denver, CO',
      positions: [
        { title: 'Director of Product', start: '2023-04', end: 'present', summary: '' },
        { title: 'Senior Product Manager', start: '2021-03', end: '2023-04', summary: '' },
      ],
    },
    {
      company: 'Fernway',
      location: 'Boulder, CO',
      positions: [{ title: 'Product Manager', start: '2018-06', end: '2021-03', summary: '' }],
    },
  ],
  schools: [
    { school: 'CU Boulder', degree: 'B.S.', field: 'Computer Science', start: '2013', end: '2017' },
    { school: 'Denver East High School', degree: '', field: '', start: '2009', end: '2013' },
  ],
};

/** A site on this computer, the sync server's, with the application forms. */
async function site() {
  const pages: Record<string, string> = {
    [FORM_PATH]: withOwnCode(
      readFileSync(join(FIXTURES, 'lever-application.html'), 'utf8'),
      LEVER_LOOKS_UP,
    ),
    [WORKDAY_PATH]: withOwnCode(
      readFileSync(join(FIXTURES, 'workday-my-information.html'), 'utf8'),
      workdayCode(WORKDAY_PAGES),
    ),
    ...Object.fromEntries(
      WORKDAY_STEPS.map((step) => [
        `${WORKDAY_PAGES}workday-${step}.html`,
        readFileSync(join(FIXTURES, `workday-${step}.html`), 'utf8'),
      ]),
    ),
  };
  const server = createServer((request, response) => {
    const page = pages[request.url ?? ''];
    if (page) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Not found</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, close: () => server.close() };
}

const work = mkdtempSync(join(tmpdir(), 'fw-sync-fill-'));
const contexts: BrowserContext[] = [];
let sync: TestServer | null = null;
let failed = false;
const local = await site();
const extension = join(ROOT, 'dist', 'chrome');
try {
  sync = await startServer();
  const form = `${local.origin}${FORM_PATH}`;
  const hunt = await syncedHunt(sync, join(work, 'computer'), form);
  const job = hunt.jobs.list().jobs.find((each) => each.company === 'Northwind Labs');
  check(Boolean(job?.files.length), 'Factwright on the computer synced the job, with its resume');

  // Built for the local sync server, on this computer, whose site the extension may reach, as the
  // form's is, so its panel may read the form there without a click on its button. The job
  // application sites are allowed at install, as a test can't answer the browser's prompt, and a
  // build for testing counts this computer's site among them. No native messaging: there's no
  // Factwright here.
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_FACTWRIGHT_SYNC_SERVER: sync.url.origin,
      FACTWRIGHT_JOB_SITES_AT_INSTALL: '1',
    },
    stdio: 'ignore',
  });
  const profile = mkdtempSync(join(work, 'profile-'));
  const id = unpackedId(extension);
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    deviceScaleFactor: 2,
    viewport: { width: 1100, height: 900 },
  });
  contexts.push(context);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  check(new URL(worker.url()).host === id, 'Chromium loads the built extension');
  const errors: string[] = [];

  // Setup, on install: through sync, signed in with a code the account approves, and linked with a
  // link code, as Factwright's Sync settings shows one.
  const setup = await context.newPage();
  setup.on('pageerror', (error) => errors.push(error.message));
  await setup.goto(`chrome-extension://${id}/setup.html`);
  await setup.getByRole('radio', { name: 'Through sync' }).check();
  await setup.getByRole('button', { name: 'Continue' }).click();
  await setup.getByRole('button', { name: 'Sign in to sync' }).click();
  const userCode = ((await setup.locator('.code').textContent()) ?? '').replace('-', '');
  const auth = { authorization: `Bearer ${hunt.sam.token}` };
  await fetch(`${sync.url.origin}/api/auth/device?user_code=${userCode}`, { headers: auth });
  await fetch(`${sync.url.origin}/api/auth/device/approve`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ userCode }),
  });
  await setup
    .getByRole('heading', { name: 'Link it with your job hunt' })
    .waitFor({ timeout: 30_000 });
  await setup.locator('summary').click();
  await setup.fill('#code', await hunt.linkCode());
  await setup.getByRole('button', { name: 'Link with the code' }).click();
  await setup.getByRole('heading', { name: 'You’re set' }).waitFor({ timeout: 15_000 });
  check(
    (await setup.getByRole('heading', { name: 'Filling an application' }).count()) === 1,
    'linked through sync, setup says how filling an application works through sync',
  );

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The site here answers "Not found" for its icon, which the browser asks for itself.
    if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(form);
  const [formTab] = await setup.evaluate(
    (url) =>
      (
        globalThis as unknown as {
          chrome: { tabs: { query(query: object): Promise<{ id: number; windowId: number }[]> } };
        }
      ).chrome.tabs.query({ url }),
    form,
  );
  if (!formTab) throw new Error('No tab with the form.');
  const formTabAt = { ...formTab, url: form, title: await page.title() };
  /** The panel, as clicking Fill this application opens it beside a form's tab. */
  const panelOn = async (tabAt: typeof formTabAt = formTabAt): Promise<Page> => {
    const panel = await context.newPage();
    panel.on('pageerror', (error) => errors.push(error.message));
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.addInitScript((tab) => {
      type Asked = { origins?: string[]; permissions?: string[] };
      const page = globalThis as unknown as {
        asked: string[][];
        chrome: {
          tabs: { query: unknown };
          permissions: { request(asked: Asked): Promise<boolean> };
        };
      };
      page.chrome.tabs.query = async () => [tab];
      // What the panel asks the browser for, each time. Native messaging is declined, as a test
      // can't answer the browser's prompt for it, and there's no Factwright here to reach.
      const request = page.chrome.permissions.request.bind(page.chrome.permissions);
      page.asked = [];
      page.chrome.permissions.request = (asked) => {
        page.asked.push(asked.permissions ?? asked.origins ?? []);
        return asked.permissions?.includes('nativeMessaging')
          ? Promise.resolve(false)
          : request(asked);
      };
    }, tabAt);
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    return panel;
  };
  const shoot = async (on: Page, name: string, fullPage = true) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await on.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
  };
  const value = (name: string) =>
    page.locator(`[name="${name}"]`).evaluate((input) => (input as HTMLInputElement).value);
  const checked = (label: string) =>
    page
      .getByLabel(label, { exact: true })
      .first()
      .evaluate((input) => (input as HTMLInputElement).checked);

  // The panel fills the form from the job hunt, through sync.
  const panel = await panelOn();
  await panel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  console.log(`  ${(await panel.getByRole('status').first().textContent()) ?? ''}`);
  check(
    (await panel.getByText('From your job hunt, through sync.').count()) === 1,
    'the panel fills from your job hunt, through sync, and says so',
  );
  check(
    (await panel.getByText('Senior Product Manager, Data at Northwind Labs').count()) === 1,
    'it finds the job the form is for, by its posting, as Factwright would',
  );
  check((await value('name')) === 'Ana María Ruiz', 'it fills the name from the synced Profile');
  check((await value('email')) === 'ana@example.com', 'and the email');
  check(
    (await value('org')) === 'Tidewater Analytics',
    'and where you work now, from the job’s synced resume',
  );
  check((await value('urls[GitHub]')) === 'https://github.com/anaruiz', 'and links');
  check(
    (await value('location')) === 'Denver, Colorado, United States',
    'and the place Lever’s location box suggests for where you live',
  );
  check(await checked('She/her'), 'it picks your pronouns, from For applications');
  const uploaded = await page
    .locator('input[type="file"][name="resume"]')
    .evaluate((input) =>
      [...((input as HTMLInputElement).files ?? [])].map((file) => `${file.name} ${file.size}`),
    );
  check(
    uploaded.length === 1 && uploaded[0] === `Ana María Ruiz - Resume.pdf ${PDF.length}`,
    'it uploads the job’s own resume, whole, from what sync holds',
  );
  check(
    !(await checked('Woman')) &&
      (await panel.getByText('An equal-opportunity question, for you').count()) >= 1,
    'and leaves the equal-opportunity answer for you, which Factwright keeps on its computer alone',
  );
  await shoot(panel, 'sync-1-panel');
  await shoot(page, 'sync-2-form');

  // Factwright on this computer answers more of a form: the panel offers it, and asks the browser
  // for native messaging only on that click.
  const asked = () =>
    panel.evaluate(() => (globalThis as unknown as { asked: string[][] }).asked) as Promise<
      string[][]
    >;
  check(
    (await asked()).length === 0,
    'filling through sync asks the browser for nothing, native messaging included',
  );
  await panel.getByRole('button', { name: 'Use Factwright on this computer' }).click();
  await panel.waitForFunction(
    () => (globalThis as unknown as { asked: string[][] }).asked.length > 0,
  );
  check(
    JSON.stringify(await asked()) === JSON.stringify([['nativeMessaging']]),
    'it offers Factwright on this computer, asking for native messaging alone, on the click',
  );
  check(
    (await panel.getByText('From your job hunt, through sync.').count()) === 1,
    'and declined, the form stays filled through sync',
  );

  // The form's own question nothing on file answers is left with the job, for your Claude.
  check(
    (await panel.getByRole('button', { name: /^Draft (it|them) with your Claude$/ }).count()) === 0,
    'through sync, it doesn’t offer to start your Claude, which runs in Factwright',
  );
  await panel.getByRole('button', { name: /^Leave (it|them) for your Claude$/ }).click();
  await panel.getByText(/^Left \d+ questions? with the job\./).waitFor({ timeout: 30_000 });
  await shoot(panel, 'sync-3-left');
  await hunt.sync();
  const kept = hunt.jobs.savedForm(job?.id ?? '');
  console.log(`  Left: ${kept?.questions.map((each) => each.question).join(' · ')}`);
  check(
    kept?.from === 'browser' &&
      kept.url === form &&
      kept.questions.some((each) => each.question === OWN_QUESTION && each.options.length > 1),
    'Factwright on the computer has the form’s question, with its options, once it syncs',
  );
  check(
    hunt.jobs.job(job?.id ?? '')?.questions.includes(OWN_QUESTION) === true,
    'and has it among the job’s application questions, for your Claude',
  );

  // Your Claude drafts it in Factwright: a stand-in, as answer-questions saves its drafts.
  writeFileSync(
    join(hunt.workspace, 'applications', FOLDER, 'answers.md'),
    [
      '# Application questions: Northwind Labs, Senior Product Manager, Data',
      '',
      '## Choices',
      '',
      '| Question | Pick | Why |',
      '| --- | --- | --- |',
      `| ${OWN_QUESTION} | No | A stand-in. |`,
      '',
    ].join('\n'),
  );
  await hunt.sync();
  await panel.getByRole('button', { name: 'Fill again' }).click();
  await panel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  check(
    (await checked('No')) &&
      (await panel.getByText('Your Claude’s draft for this job').count()) >= 1,
    'once your Claude’s draft syncs, Fill again fills it in, saying it’s your Claude’s',
  );

  // Then you'd submit the form on the site, and Mark as applied.
  await page.locator('input[name="phone"]').fill('(720) 555-0199');
  await page.getByLabel('Woman', { exact: true }).first().check();
  await panel.getByRole('button', { name: 'Mark as applied' }).click();
  await panel.getByText('Marked applied.').waitFor({ timeout: 30_000 });
  const savePhone = panel.getByRole('button', { name: /^Save your answer to Phone/ });
  check(
    (await panel.getByText('Keep for next time?').count()) === 1 && (await savePhone.count()) === 1,
    'through sync, it offers to keep your new phone number in Profile',
  );
  check(
    (await panel.getByRole('button', { name: /^Save your answer to .*gender/i }).count()) === 0 &&
      (await panel.getByText(/never in sync, so they aren’t offered here/).count()) === 1,
    'but never your equal-opportunity answer, which never syncs, and it says why',
  );
  await savePhone.click();
  await panel.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 });
  await hunt.sync();
  const profileFile = join(hunt.workspace, 'about-me', 'answers.json');
  const answers = JSON.parse(readFileSync(profileFile, 'utf8')) as {
    you: { phone?: string; email?: string; location?: string };
  };
  check(
    answers.you.phone === '(720) 555-0199' && answers.you.email === 'ana@example.com',
    'Factwright on the computer has the new phone number in Profile, once it syncs',
  );
  // Meanwhile, you change where you live in Profile, in Factwright on the computer.
  writeFileSync(
    profileFile,
    `${JSON.stringify({ ...answers, you: { ...answers.you, location: 'Boulder, CO' } }, null, 2)}\n`,
  );
  await hunt.sync();
  await panel.getByRole('button', { name: /^Save your answer to Current location/ }).click();
  await panel.getByText('Kept beside Profile').waitFor({ timeout: 30_000 });
  await shoot(panel, 'sync-4-applied');
  await hunt.sync();
  const copies = readdirSync(join(hunt.workspace, 'about-me')).filter((name) =>
    /^answers \(Factwright in .+\)\.json$/.test(name),
  );
  const copy = copies[0]
    ? (JSON.parse(readFileSync(join(hunt.workspace, 'about-me', copies[0]), 'utf8')) as {
        you?: { location?: string };
      })
    : null;
  check(
    (JSON.parse(readFileSync(profileFile, 'utf8')) as typeof answers).you.location ===
      'Boulder, CO' &&
      copies.length === 1 &&
      copy?.you?.location === 'Denver, Colorado, United States',
    'an answer Factwright changed since the form was filled stays, and yours is kept beside it',
  );
  const applied = hunt.jobs.job(job?.id ?? '');
  check(
    applied?.status === 'applied' && applied.appliedOn !== null,
    'Factwright on the computer has the job Applied, once it syncs',
  );
  check(
    applied?.sent.some((each) => each.question === OWN_QUESTION && each.text === 'No') === true &&
      !applied?.sent.some((each) => /gender|email|phone/i.test(each.question)),
    'with what you sent for the form’s own question, and nothing Profile filled',
  );
  check(
    hunt.tracker
      .history()
      .get(job?.id ?? '')
      ?.some((each) => each.status === 'applied') === true,
    'and the change in the job’s history',
  );
  await panel.close();

  // The job application sites, turned on from the panel: their menus and Fill button answer from
  // sync too.
  const offering = await panelOn();
  await offering.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  await offering.getByRole('button', { name: 'Turn on for job application sites' }).click();
  await offering
    .getByText('Factwright’s menus and Fill button are on for job application sites.')
    .waitFor({ timeout: 20_000 });
  await offering.close();
  /** The extension's frame on the form, its Fill button or a menu, once it shows `words`. */
  const frameOn = async (mode: 'button' | 'menu', words = '', ms = 30_000) => {
    const until = Date.now() + ms;
    for (;;) {
      for (const frame of page.frames()) {
        if (!frame.url().includes(`/frame.html#${mode}`) || frame.isDetached()) continue;
        const text = await frame
          .locator('body')
          .innerText()
          .catch(() => '');
        const buttons = await frame
          .locator('button')
          .count()
          .catch(() => 0);
        if (buttons > 0 && text.includes(words)) return frame;
      }
      if (Date.now() > until) throw new Error(`No ${mode} frame on the form with ${words}.`);
      await page.waitForTimeout(100);
    }
  };
  await page.reload();
  await page.bringToFront();
  await frameOn('button');
  await page.locator('input[name="name"]').click();
  const menu = await frameOn('menu', 'Ana María Ruiz');
  check(
    (await menu.getByRole('button', { name: /Ana María Ruiz/ }).textContent())?.includes(
      'From Profile',
    ) === true,
    'a field’s menu offers the answer from the synced Profile',
  );
  await shoot(page, 'sync-5-menu', false);
  // A new answer you type isn't offered to keep, through sync.
  await page.locator('input[name="phone"]').click();
  await page.locator('input[name="phone"]').pressSequentially('(720) 555-0123');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  const offers = await Promise.all(
    page
      .frames()
      .filter((frame) => frame.url().includes('/frame.html#menu') && !frame.isDetached())
      .map((frame) =>
        frame
          .locator('body')
          .innerText()
          .catch(() => ''),
      ),
  );
  check(
    !offers.some((text) => text.includes('Save to Factwright?')),
    'and leaving a field with a new answer offers nothing to keep',
  );

  // A Workday application, which runs over several pages in one tab, through sync: each page you
  // go on to fills the way the first did, and My Experience offers a part for each job in your
  // work history, once it syncs.
  writeFileSync(
    join(hunt.workspace, 'about-me', 'history.json'),
    `${JSON.stringify(WORK_HISTORY, null, 2)}\n`,
  );
  await hunt.sync();
  const workday = await context.newPage();
  workday.on('pageerror', (error) => errors.push(error.message));
  const workdayAt = `${local.origin}${WORKDAY_PATH}`;
  await workday.goto(workdayAt);
  await workday.bringToFront();
  const [workdayTab] = await setup.evaluate(
    (url) =>
      (
        globalThis as unknown as {
          chrome: { tabs: { query(query: object): Promise<{ id: number; windowId: number }[]> } };
        }
      ).chrome.tabs.query({ url }),
    workdayAt,
  );
  if (!workdayTab) throw new Error('No tab with the Workday application.');
  const workdayPanel = await panelOn({
    ...workdayTab,
    url: workdayAt,
    title: await workday.title(),
  });
  /** What's in one of the Workday page's boxes, by its id. */
  const typedIn = (boxId: string) =>
    workday.locator(`[id="${boxId}"]`).evaluate((input) => (input as HTMLInputElement).value);
  /** What's in a box of one of Workday's parts, by the part's heading's id and the box's name. */
  const inPart = (part: string, name: string) =>
    workday
      .locator(`[aria-labelledby="${part}"] [name="${name}"]`)
      .evaluate((input) => (input as HTMLInputElement).value);
  const throughSync = async () =>
    (await workdayPanel.getByText('From your job hunt, through sync.').count()) === 1;
  await workdayPanel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  check(
    (await throughSync()) && (await typedIn('name--legalName--firstName')) === 'Ana María',
    'a Workday application fills through sync too, from its first page',
  );
  await workday.getByRole('button', { name: 'Save and Continue', exact: true }).click();
  await workdayPanel
    .getByText('The application is on My Experience now', { exact: false })
    .waitFor({ timeout: 20_000 });
  await workdayPanel.getByRole('button', { name: 'Fill this page', exact: true }).click();
  await workdayPanel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  check(
    (await throughSync()) &&
      (await typedIn('workExperience-225--companyName')) === 'Tidewater Analytics',
    'Fill this page, on the page it went on to, fills it through sync the same way',
  );
  await workdayPanel
    .getByRole('button', { name: 'Add 2 for your other jobs', exact: true })
    .click();
  await workdayPanel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 60_000 });
  check(
    (await throughSync()) && (await inPart('Work-Experience-3-panel', 'companyName')) === 'Fernway',
    'it offers a part for each job in your synced work history, and fills each new one through sync',
  );
  await shoot(workdayPanel, 'sync-6-workday');
  await workdayPanel.close();
  await workday.close();

  // Nothing it read is left in its storage: only the sign-in and the keys, which can't be read.
  const stored = await setup.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: Record<'local' | 'session', { get(keys: null): Promise<object> }>;
        };
      }
    ).chrome.storage;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('save-to-factwright');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('account').objectStore('account').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const account = records[0] as Record<string, unknown> | undefined;
    return {
      storage: JSON.stringify([await api.local.get(null), await api.session.get(null)]),
      databases: (await indexedDB.databases()).map((each) => each.name),
      records: records.length,
      account: Object.keys(account ?? {}).sort(),
      keys: Object.keys((account?.keys as object) ?? {}).sort(),
    };
  });
  check(
    !/Tidewater|Fernway|Ana Mar|ana@example\.com|Northwind|anaruiz/.test(stored.storage) &&
      JSON.stringify(stored.databases) === '["save-to-factwright"]' &&
      stored.records === 1 &&
      JSON.stringify(stored.account) === '["email","keys","server","token","user"]' &&
      JSON.stringify(stored.keys) === '["fileIds","files","id","recordIds","records"]',
    'nothing it read through sync is kept in its storage: only its sign-in and the keys',
  );
  check(
    errors.length === 0,
    `with nothing going wrong on its pages${errors.length ? `: ${errors.join('; ')}` : ''}`,
  );
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  local.close();
  sync?.close();
  rmSync(work, { recursive: true, force: true });
  // Built again for Factwright's own sync, as the stores get it.
  execFileSync('node', ['scripts/build.ts'], { cwd: ROOT, stdio: 'ignore' });
}
process.exit(failed ? 1 : 0);
