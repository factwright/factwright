// Fills an application form with Factwright in Chromium, on this computer. The built extension's
// panel reads a form on a page served here, asks Factwright through the desktop app's helper,
// built for testing, and the app's own inbox and fill code, over a made-up job hunt, then fills
// the form and uploads the job's resume. Once the form is done, Mark as applied records what was
// sent, marks the job Applied, and offers to keep a new answer in Profile. On a form with fields
// you can't see, as a page's traps for bots, it reads only those you can. Nothing is submitted,
// and nothing leaves this computer.
// `pnpm --filter @factwright/extension e2e:fill` (it needs Playwright's Chromium, as `e2e` does,
// and a C compiler, for the helper). With `-- --shots <folder>`, it saves the panel and the filled
// form there as pictures, to look over a change.
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
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_FOLDER, NO_APPLICATIONS, NO_EQUAL_OPPORTUNITY, SAVE_HELPER } from '@factwright/core';
import { type BrowserContext, chromium, type Page } from '@playwright/test';
import { PrivateAnswers } from '../../desktop/src/main/about/private.ts';
import { answerAsk } from '../../desktop/src/main/extension/fill.ts';
import { JobInbox } from '../../desktop/src/main/extension/inbox.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { type AboutYou, applyChanges, NO_ANSWERS } from '../../desktop/src/shared/about.ts';
import { PRIVATE_FILE } from '../../desktop/src/shared/private.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DESKTOP = fileURLToPath(new URL('../../desktop', import.meta.url));
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

/** A form with fields you can't see, and the questions of the ones you can. */
const TRAPS_PATH = '/fernway/apply';
const SEEN = ['Full name', 'Are you willing to relocate?', 'Country', 'City'];

/** A site on this computer: the application forms, and "Not found" for anything else. */
async function site() {
  const pages: Record<string, Buffer> = {
    [FORM_PATH]: readFileSync(join(FIXTURES, 'lever-application.html')),
    [TRAPS_PATH]: readFileSync(join(FIXTURES, 'hidden-fields.html')),
  };
  let requests = 0;
  const server = createServer((request, response) => {
    const page = pages[request.url ?? ''];
    if (page) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page);
      return;
    }
    // The browser asks every site for its icon itself.
    if (request.url !== '/favicon.ico') requests += 1;
    response.writeHead(404, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Not found</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, requests: () => requests, close: () => server.close() };
}

const work = mkdtempSync(join(tmpdir(), 'fw-fill-'));
const contexts: BrowserContext[] = [];
let failed = false;
const local = await site();
const extension = join(ROOT, 'dist', 'chrome');
try {
  // Built for this computer's site as its sync server, which it may reach, so the panel may read
  // the form there without a click on its button, and with native messaging at install, as a
  // test can't answer the browser's prompt for it.
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_FACTWRIGHT_SYNC_SERVER: local.origin,
      FACTWRIGHT_NATIVE_AT_INSTALL: '1',
    },
    stdio: 'ignore',
  });

  // A made-up job hunt: the job, saved from its form's page, with its resume and Claude's draft
  // for one of its questions.
  const home = mkdtempSync(join(work, 'home-'));
  const workspace = join(home, 'workspace');
  const folder = join(
    workspace,
    'applications',
    '2026-10-20-northwind-labs-senior-product-manager',
  );
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'job.md'),
    [
      '# Northwind Labs: Senior Product Manager, Data',
      '',
      '- **Date:** 2026-10-20',
      `- **Apply:** Lever ${local.origin}${FORM_PATH}`,
    ].join('\n'),
  );
  writeFileSync(
    join(folder, 'resume.json'),
    JSON.stringify({
      name: 'Ana María Ruiz',
      headline: 'Product manager',
      summary: 'Ships data products.',
      layout: 'classic',
      output_name: 'AnaRuizResume10202026_Northwind',
      experience: [
        {
          title: 'Senior Product Manager',
          company: 'Tidewater Analytics',
          start: '2021',
          end: 'Present',
        },
      ],
    }),
  );
  // A made-up resume the engine printed, as the desktop app's tests use.
  const pdf = readFileSync(
    createRequire(join(DESKTOP, 'package.json')).resolve('@factwright/xray/fixtures/engineer.pdf'),
  );
  writeFileSync(join(folder, 'AnaRuizResume10202026_Northwind.pdf'), pdf);
  const tracker = new Tracker(join(home, 'tracker.db'));
  const jobs = new JobsService({ workspace, tracker, onChange: () => {} });
  jobs.read();
  const job = jobs.list().jobs.find((each) => each.company === 'Northwind Labs');
  check(Boolean(job?.files.length), 'the made-up job has its resume');
  let about: AboutYou = {
    ...NO_ANSWERS,
    you: {
      name: 'Ana María Ruiz',
      email: 'ana@example.com',
      phone: '(303) 555-0142',
      location: 'Denver, CO',
      linkedin: 'https://www.linkedin.com/in/anaruiz',
      website: 'https://anaruiz.dev',
    },
    applications: {
      ...NO_APPLICATIONS,
      pronouns: 'She/her',
      github: 'https://github.com/anaruiz',
      country: 'United States',
      countries: ['United States'],
    },
  };
  const aboutStore = {
    answers: () => about,
    saveAnswers: (changes: Parameters<typeof applyChanges>[1]) => {
      about = applyChanges(about, changes);
      return about;
    },
  };
  const kept = new PrivateAnswers(join(home, PRIVATE_FILE));
  kept.save({ equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, gender: 'woman' } });
  const inbox = new JobInbox({
    folder: join(home, INBOX_FOLDER),
    add: (saved) => jobs.addSaved(saved),
    answer: (ask) => answerAsk(ask, { jobs, about: aboutStore, kept, workspace }),
  });

  // The helper, built for testing, which takes the data folder from FACTWRIGHT_HELPER_HOME.
  const helper = join(mkdtempSync(join(work, 'helper-')), 'factwright-save');
  execFileSync('node', ['scripts/build-helper.ts', '--testing', '--out', helper], {
    cwd: DESKTOP,
    stdio: 'ignore',
  });
  const profile = mkdtempSync(join(work, 'profile-'));
  const id = unpackedId(extension);
  mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(
    join(profile, 'NativeMessagingHosts', `${SAVE_HELPER}.json`),
    JSON.stringify({
      name: SAVE_HELPER,
      description: 'Factwright: saves jobs and fills applications on this computer',
      path: helper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    }),
  );
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    deviceScaleFactor: 2,
    viewport: { width: 1100, height: 900 },
    env: { ...process.env, FACTWRIGHT_HELPER_HOME: home } as Record<string, string>,
  });
  contexts.push(context);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  check(new URL(worker.url()).host === id, 'Chromium loads the built extension');
  const errors: string[] = [];
  // Setup opens on install: it's set to save to Factwright on this computer.
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${id}/setup.html`);
  await setup.evaluate(
    (server) =>
      (
        globalThis as unknown as {
          chrome: { storage: { local: { set(items: object): Promise<void> } } };
        }
      ).chrome.storage.local.set({
        settings: { linkedInText: true, server, where: 'computer' },
      }),
    local.origin,
  );

  const form = await context.newPage();
  form.on('pageerror', (error) => errors.push(error.message));
  await form.goto(`${local.origin}${FORM_PATH}`);
  const formTab = (
    await setup.evaluate(
      (url) =>
        (
          globalThis as unknown as {
            chrome: { tabs: { query(query: object): Promise<{ id: number; windowId: number }[]> } };
          }
        ).chrome.tabs.query({ url }),
      `${local.origin}${FORM_PATH}`,
    )
  )[0];
  if (!formTab) throw new Error('No tab with the form.');

  /** The panel, as clicking Fill this application opens it beside the form's tab. */
  const panelOn = async (): Promise<Page> => {
    const panel = await context.newPage();
    panel.on('pageerror', (error) => errors.push(error.message));
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.addInitScript(
      (tab) => {
        const api = (globalThis as unknown as { chrome: { tabs: { query: unknown } } }).chrome;
        api.tabs.query = async () => [{ ...tab, url: tab.url, title: tab.title }];
      },
      {
        id: formTab.id,
        windowId: formTab.windowId,
        url: `${local.origin}${FORM_PATH}`,
        title: await form.title(),
      },
    );
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    return panel;
  };
  const shoot = async (page: Page, name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };

  // With Factwright closed, the panel says to open it, and fills nothing.
  const closed = await panelOn();
  await closed
    .getByText('Open Factwright on this computer to fill this page')
    .waitFor({ timeout: 20_000 });
  check(true, 'with Factwright closed, the panel says to open it');
  await closed.close();

  // With Factwright open, the panel fills the form, and lists each field with where its answer came from.
  inbox.start();
  const panel = await panelOn();
  await panel.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 40_000 });
  const said = (await panel.getByRole('status').first().textContent()) ?? '';
  console.log(`  ${said}`);
  check(
    (await panel.getByText('Senior Product Manager, Data at Northwind Labs').count()) === 1,
    'the panel finds the job the form is for, by its posting',
  );
  const value = (selector: string) =>
    form.locator(selector).evaluate((element) => (element as HTMLInputElement).value);
  check((await value('input[name="name"]')) === 'Ana María Ruiz', 'it fills the name from Profile');
  check((await value('input[name="email"]')) === 'ana@example.com', 'and the email');
  check(
    (await value('input[name="org"]')) === 'Tidewater Analytics',
    'and where you work now, from the job’s resume',
  );
  check((await value('input[name="urls[GitHub]"]')) === 'https://github.com/anaruiz', 'and links');
  const uploaded = await form
    .locator('input[type="file"][name="resume"]')
    .evaluate((input) =>
      [...((input as HTMLInputElement).files ?? [])].map((file) => `${file.name} ${file.size}`),
    );
  check(
    uploaded.length === 1 && uploaded[0] === `Ana María Ruiz - Resume.pdf ${pdf.length}`,
    'it uploads the job’s own resume, whole, under a plain name',
  );
  const checked = (label: string) =>
    form
      .getByLabel(label, { exact: true })
      .first()
      .evaluate((input) => (input as HTMLInputElement).checked);
  check(await checked('She/her'), 'it picks your pronouns among the form’s');
  check(await checked('Woman'), 'and the equal-opportunity answer you set in Profile');
  check(!(await checked('No')), 'and leaves the form’s own questions for you');
  check(
    (await panel.getByText('From the job’s resume').count()) >= 1 &&
      (await panel.getByText('An equal-opportunity question, for you').count()) >= 1,
    'the panel says where each answer came from, and what’s left for you',
  );
  await shoot(panel, 'fill-1-panel');
  await shoot(form, 'fill-2-form');

  // You answer what's left, and change your phone; then you'd submit the form on the site.
  await form.getByLabel('No', { exact: true }).first().check();
  await form.locator('input[name="phone"]').fill('(720) 555-0199');
  await panel.getByRole('button', { name: 'Mark as applied' }).click();
  await panel.getByText('Marked applied.').waitFor({ timeout: 20_000 });
  const applied = jobs.list().jobs.find((each) => each.company === 'Northwind Labs');
  check(applied?.status === 'applied', 'Mark as applied marks the job Applied');
  check(
    applied?.sent.some(
      (each) =>
        each.question === 'Have you ever been previously employed by Northwind Labs?' &&
        each.text === 'No',
    ) === true,
    'and keeps what you sent for the form’s own question',
  );
  check(
    !applied?.sent.some((each) => /gender|email|phone/i.test(each.question)),
    'but nothing Profile filled, and no equal-opportunity answer',
  );
  await panel.getByText('Keep for next time?').waitFor();
  await shoot(panel, 'fill-3-applied');
  await panel.getByRole('button', { name: /^Save your answer to Phone/ }).click();
  await panel.getByText('Saved', { exact: true }).waitFor({ timeout: 20_000 });
  check(
    about.you.phone === '(720) 555-0199',
    'it keeps the new phone in Profile, once you choose to',
  );
  // The built form function, as the panel sends it into a page, on a form with traps for bots.
  const built = readdirSync(join(extension, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(extension, 'assets', name), 'utf8'))
    .find((text) => text.includes('async function formPage('));
  if (!built) throw new Error('The built extension has no formPage.');
  const start = built.indexOf('async function formPage(');
  let end = built.indexOf('{', built.indexOf(')', start));
  for (let depth = 0; end < built.length; end++) {
    if (built[end] === '{') depth++;
    else if (built[end] === '}' && --depth === 0) break;
  }
  const traps = await context.newPage();
  await traps.goto(`${local.origin}${TRAPS_PATH}`);
  const questions = await traps.evaluate(
    `(${built.slice(start, end + 1)})({ do: 'read' }).then((answer) => answer.form.fields.map((field) => field.question))`,
  );
  check(
    JSON.stringify(questions) === JSON.stringify(SEEN),
    `it reads only the fields you can see, never a trap for bots (${String(questions)})`,
  );
  check(local.requests() === 0, 'nothing reached any other site');
  check(
    errors.length === 0,
    `with nothing going wrong on its pages${errors.length ? `: ${errors.join('; ')}` : ''}`,
  );
  inbox.stop();
  tracker.close();
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  local.close();
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // A temporary folder left behind does no harm.
  }
  // Built again for Factwright's own sync, as the stores get it.
  execFileSync('node', ['scripts/build.ts'], { cwd: ROOT, stdio: 'ignore' });
}
process.exit(failed ? 1 : 0);
