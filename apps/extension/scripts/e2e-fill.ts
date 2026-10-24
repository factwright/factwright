// Fills an application form with Factwright in Chromium, on this computer. The built extension's
// panel reads a form on a page served here, asks Factwright through the desktop app's helper,
// built for testing, and the app's own inbox and fill code, over a made-up job hunt, then fills
// the form and uploads the job's resume. Your Claude drafts the form's own questions, as a
// stand-in here, and the panel fills its drafts in once it's done. Once the form is done, Mark as
// applied records what was sent, marks the job Applied, and offers to keep a new answer in
// Profile. Then the job application sites: turned on from the panel, they put a Fill button on
// the form, which opens Chromium's side panel and fills it, and menus in its fields, whose answers
// go in a field only once you pick one, and which offer to keep a new answer you typed. A company's
// careers page on another site that shows the form in a frame gets them in the frame, where the
// panel fills it, and Lever's location box gets the place it suggests. Turned off in setup,
// they're gone. On a form with fields you can't see, as a page's traps for bots, it reads only
// those you can. Nothing is submitted, and nothing leaves this computer.
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
import {
  INBOX_FOLDER,
  NO_APPLICATIONS,
  NO_EQUAL_OPPORTUNITY,
  NO_HISTORY,
  SAVE_HELPER,
} from '@factwright/core';
import { type BrowserContext, chromium, type Page } from '@playwright/test';
import { PrivateAnswers } from '../../desktop/src/main/about/private.ts';
import { answerAsk } from '../../desktop/src/main/extension/fill.ts';
import { JobInbox } from '../../desktop/src/main/extension/inbox.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { type AboutYou, applyChanges, NO_ANSWERS } from '../../desktop/src/shared/about.ts';
import { PRIVATE_FILE } from '../../desktop/src/shared/private.ts';
import { LEVER_LOOKS_UP, withOwnCode } from './sites-own-code.ts';

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

/** The company's own careers page, on another site, which shows the job's form in a frame. */
const CAREERS_PATH = '/careers/northwind';

/** A careers page on the form's own site, which shows it in a frame too, and could read it. */
const SAME_SITE_PATH = '/careers/same-site';

/** A site on this computer: the application forms, and "Not found" for anything else. */
async function site() {
  const lever = readFileSync(join(FIXTURES, 'lever-application.html'), 'utf8');
  const pages: Record<string, Buffer> = {
    [FORM_PATH]: Buffer.from(withOwnCode(lever, LEVER_LOOKS_UP)),
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
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  // The careers page is at this computer's other name, another site to the browser, which the
  // extension may not reach: only the form in its frame is on a job site, as a test counts it.
  const careers = `http://localhost:${port}`;
  pages[CAREERS_PATH] = Buffer.from(
    [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<title>Senior Product Manager, Data · Careers at Northwind Labs</title></head>',
      '<body style="margin:0;font-family:sans-serif">',
      '<header style="height:240px;padding:0 24px"><h1>Careers at Northwind Labs</h1>',
      '<p>Senior Product Manager, Data · Denver, CO</p></header>',
      `<iframe title="Apply for this job" src="${origin}${FORM_PATH}" style="display:block;width:100%;height:2600px;border:0"></iframe>`,
      '</body></html>',
    ].join(''),
  );
  pages[SAME_SITE_PATH] = Buffer.from(
    `<!doctype html><title>Careers at Northwind Labs</title><h1>Careers at Northwind Labs</h1><iframe title="Apply for this job" src="${FORM_PATH}" style="display:block;width:100%;height:2600px;border:0"></iframe>`,
  );
  return { origin, careers, requests: () => requests, close: () => server.close() };
}

const work = mkdtempSync(join(tmpdir(), 'fw-fill-'));
const contexts: BrowserContext[] = [];
let failed = false;
const local = await site();
const extension = join(ROOT, 'dist', 'chrome');
try {
  // Built for this computer's site as its sync server, which it may reach, so the panel may read
  // the form there without a click on its button, and with native messaging and the job
  // application sites at install, as a test can't answer the browser's prompt for either. A build
  // for testing counts this computer's site among the job application sites.
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_FACTWRIGHT_SYNC_SERVER: local.origin,
      FACTWRIGHT_NATIVE_AT_INSTALL: '1',
      FACTWRIGHT_JOB_SITES_AT_INSTALL: '1',
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
    history: () => NO_HISTORY,
    answers: () => about,
    saveAnswers: (changes: Parameters<typeof applyChanges>[1]) => {
      about = applyChanges(about, changes);
      return about;
    },
  };
  const kept = new PrivateAnswers(join(home, PRIVATE_FILE));
  kept.save({ equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, gender: 'woman' } });
  // Your Claude, drafting a form's questions in the window: a stand-in that saves its drafts a
  // few seconds after it starts, as the answer-questions skill does, with a choice's first option.
  let drafting = false;
  const drafts = {
    start: async (jobId: string) => {
      const asked = jobs.savedForm(jobId)?.questions ?? [];
      drafting = true;
      setTimeout(() => {
        const choices = asked.filter((each) => each.options.length > 0);
        writeFileSync(
          join(folder, 'answers.md'),
          [
            '# Application questions: Northwind Labs, Senior Product Manager, Data',
            '',
            ...asked
              .filter((each) => each.options.length === 0)
              .flatMap((each) => [`## ${each.question}`, '', 'Drafted by the stand-in.', '']),
            '## Choices',
            '',
            '| Question | Pick | Why |',
            '| --- | --- | --- |',
            ...choices.map((each) => `| ${each.question} | ${each.options[0]} | A stand-in. |`),
            '',
          ].join('\n'),
        );
        jobs.read();
        drafting = false;
      }, 4000);
      return 'started' as const;
    },
    state: () => ({ drafting, waiting: false }),
  };
  const inbox = new JobInbox({
    folder: join(home, INBOX_FOLDER),
    add: (saved) => jobs.addSaved(saved),
    answer: (ask) => answerAsk(ask, { jobs, about: aboutStore, kept, workspace, drafts }),
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
  // What the extension's pages ask the browser for, each time, which the browser then answers.
  await context.addInitScript(() => {
    const page = globalThis as unknown as {
      asked?: string[][];
      chrome?: { permissions?: { request(asked: { origins?: string[] }): Promise<boolean> } };
    };
    const api = page.chrome?.permissions;
    if (!api) return;
    const request = api.request.bind(api);
    page.asked = [];
    api.request = (asked) => {
      page.asked?.push(asked.origins ?? []);
      return request(asked);
    };
  });
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
  // The extension's script on the page says what went wrong in it here.
  form.on('console', (message) => {
    // The site here answers "Not found" for its icon, which the browser asks for itself.
    if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });
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
  const formTabAt = {
    id: formTab.id,
    windowId: formTab.windowId,
    url: `${local.origin}${FORM_PATH}`,
    title: await form.title(),
  };
  const panelOn = async (tab = formTabAt): Promise<Page> => {
    const panel = await context.newPage();
    panel.on('pageerror', (error) => errors.push(error.message));
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.addInitScript((tab) => {
      const api = (globalThis as unknown as { chrome: { tabs: { query: unknown } } }).chrome;
      api.tabs.query = async () => [{ ...tab, url: tab.url, title: tab.title }];
    }, tab);
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    return panel;
  };
  /** A picture of a page, whole, or as the window shows it, with the extension's frame on it. */
  const shoot = async (page: Page, name: string, fullPage = true) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
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
  // Lever's location box takes only one of its own suggestions: of those Lever's code here
  // suggests for Denver, the one in Colorado.
  check(
    (await value('input[name="location"]')) === 'Denver, Colorado, United States' &&
      (await value('input[name="selectedLocation"]')).includes('Denver, Colorado'),
    'it picks the place Lever’s location box suggests for where you live, which Lever keeps',
  );
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

  // Your Claude drafts the form's own questions that nothing on file answers, and the panel
  // fills each draft in once it's done.
  await panel.getByRole('button', { name: /^Draft (it|them) with your Claude$/ }).click();
  await panel
    .getByText(/^Your Claude is drafting \d+ answers? in Factwright/)
    .waitFor({ timeout: 20_000 });
  await panel.getByText(/^Your Claude drafted \d+ answers?\./).waitFor({ timeout: 40_000 });
  const drafted = jobs.savedForm(job?.id ?? '')?.questions.map((each) => each.question) ?? [];
  console.log(`  Drafted: ${drafted.join(' · ')}`);
  check(
    drafted.includes('Have you ever been previously employed by Northwind Labs?'),
    'it has your Claude draft the questions nothing on file answers, kept with the job',
  );
  check(await checked('No'), 'and fills in each draft once your Claude is done');
  check(
    (await panel.getByText('Your Claude’s draft for this job').count()) >= 1,
    'saying it’s your Claude’s draft',
  );
  await shoot(panel, 'fill-2b-drafted');

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
  // The job application sites, turned on from the panel, which asks the browser for them alone.
  const offering = await panelOn();
  await offering.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 40_000 });
  await offering.getByRole('button', { name: 'Turn on for job application sites' }).click();
  await offering
    .getByText('Factwright’s menus and Fill button are on for job application sites.')
    .waitFor({ timeout: 20_000 });
  const asked = (await offering.evaluate(
    () => (globalThis as unknown as { asked: string[][] }).asked,
  )) as string[][];
  const jobSites = asked.at(-1) ?? [];
  console.log(`  Asked for: ${jobSites.join(' ')}`);
  check(
    jobSites.includes('https://jobs.lever.co/*') &&
      jobSites.includes('http://127.0.0.1/*') &&
      !jobSites.some((site) => /<all_urls>|^\*:|linkedin|indeed|^https:\/\/\*\/\*$/.test(site)),
    'the panel turns on the job application sites, asking for them alone, never every site',
  );
  await offering.close();

  /** The extension's frame on the form, its Fill button or a menu, once it shows `words`. */
  const frameOn = async (mode: 'button' | 'menu', words = '', ms = 20_000, on = form) => {
    const until = Date.now() + ms;
    for (;;) {
      for (const frame of on.frames()) {
        if (!frame.url().includes(`/frame.html#${mode}`) || frame.isDetached()) continue;
        const text = await frame
          .locator('body')
          .innerText()
          .catch(() => '');
        if (
          (await frame
            .locator('button')
            .count()
            .catch(() => 0)) > 0 &&
          text.includes(words)
        ) {
          return frame;
        }
      }
      if (Date.now() > until) throw new Error(`No ${mode} frame on the form with ${words}.`);
      await on.waitForTimeout(100);
    }
  };
  /**
   * Presses a button in the extension's frame, from the keyboard, as you can: the panels here make
   * the window narrower than the form's page, so a click by place wouldn't reach a frame from
   * another process, as it does in a window as big as its page.
   */
  const press = async (button: ReturnType<Page['locator']>, on = form) => {
    // The frame takes a click only once it's shown for half a second, as a person sees it first.
    await on.waitForTimeout(600);
    await button.focus();
    await on.keyboard.press('Enter');
  };
  const fieldValue = (name: string) =>
    form.locator(`[name="${name}"]`).evaluate((input) => (input as HTMLInputElement).value);
  const waitForValue = async (name: string, wanted: string, ms = 30_000) => {
    const until = Date.now() + ms;
    while ((await fieldValue(name)) !== wanted) {
      if (Date.now() > until) throw new Error(`${name} never held ${wanted}.`);
      await form.waitForTimeout(100);
    }
  };
  // The page that was open gets the script at once: its Fill button.
  await frameOn('button');
  check(true, 'the form that’s open gets its Fill button at once');
  const scripts = (await setup.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: { scripting: { getRegisteredContentScripts(): Promise<{ matches: string[] }[]> } };
      }
    ).chrome.scripting.getRegisteredContentScripts(),
  )) as { matches: string[]; excludeMatches?: string[] }[];
  check(
    scripts.length === 1 &&
      scripts[0]?.matches.includes('https://jobs.lever.co/*') === true &&
      scripts[0]?.excludeMatches?.includes('*://*.linkedin.com/*') === true,
    'its script is registered for the job application sites, and never LinkedIn or Indeed',
  );

  // The Fill button opens Chromium's side panel, which fills the form, as Fill does.
  await form.reload();
  await form.bringToFront();
  const fillButton = await frameOn('button');
  check((await fieldValue('email')) === '', 'a form loaded again is empty');
  await shoot(form, 'fill-4-button', false);
  await press(fillButton.getByRole('button', { name: 'Fill', exact: true }));
  await waitForValue('email', 'ana@example.com');
  check(
    (await fieldValue('name')) === 'Ana María Ruiz',
    'its Fill button opens the side panel, which fills the form',
  );

  // A field's menu offers Factwright's answer, and puts it in the field only once you pick it.
  await form.reload();
  await frameOn('button');
  await form.locator('input[name="name"]').click();
  const nameMenu = await frameOn('menu');
  const answer = nameMenu.getByRole('button', { name: /Ana María Ruiz/ });
  await answer.waitFor({ timeout: 20_000 });
  check(
    (await answer.textContent())?.includes('From Profile') === true,
    'a field’s menu offers Factwright’s answer, and says where it came from',
  );
  check((await fieldValue('name')) === '', 'nothing is in the field until you pick it');
  check(
    !(await form.content()).includes('ana@example.com'),
    'and the page never has an answer it shows, which are in the extension’s own frame',
  );
  await shoot(form, 'fill-5-menu', false);
  // A page that fades the menu, as one that would trick you into a click might, gets no pick.
  await form.evaluate(() => {
    document.documentElement.style.filter = 'opacity(0.3)';
  });
  await press(answer);
  await form.waitForTimeout(500);
  check((await fieldValue('name')) === '', 'a menu the page fades or covers takes no click');
  await form.evaluate(() => {
    document.documentElement.style.filter = '';
  });
  // A pick the page hid goes nowhere, and its menu closes: it opens again as you click back in.
  await form.locator('input[name="email"]').click();
  await form.locator('input[name="name"]').click();
  const again = await frameOn('menu', 'Ana María Ruiz');
  await press(again.getByRole('button', { name: /Ana María Ruiz/ }));
  await waitForValue('name', 'Ana María Ruiz', 10_000);
  check(true, 'picking it, as the page shows it, puts it in the field');

  // A new answer you type, for a field Profile keeps, is offered to keep as you leave it.
  const before = about.you.phone;
  await form.locator('input[name="phone"]').click();
  await frameOn('menu');
  await form.locator('input[name="phone"]').pressSequentially('(720) 555-0123');
  await form.keyboard.press('Tab');
  const saving = await frameOn('menu', 'Save to Factwright?');
  check(
    (await saving.getByText('Phone: (720) 555-0123').count()) === 1,
    'leaving a field with a new answer offers to keep it',
  );
  await shoot(form, 'fill-6-save', false);
  check(about.you.phone === before, 'and keeps nothing until you choose to');
  await press(saving.getByRole('button', { name: 'Save', exact: true }));
  await saving.getByText('Saved to Factwright.').waitFor({ timeout: 20_000 });
  check(about.you.phone === '(720) 555-0123', 'Save keeps it in Profile');

  // A company's careers page on another site, which shows the form in a frame from a job site:
  // the Fill button and the menus are in the frame, and the panel fills the form there.
  const careers = await context.newPage();
  careers.on('pageerror', (error) => errors.push(error.message));
  await careers.goto(`${local.careers}${CAREERS_PATH}`);
  await careers.bringToFront();
  const applying = () => {
    const found = careers.frames().find((each) => each.url() === `${local.origin}${FORM_PATH}`);
    if (!found) throw new Error('No frame with the form on the careers page.');
    return found;
  };
  const framedValue = (name: string) =>
    applying()
      .locator(`[name="${name}"]`)
      .evaluate((input) => (input as HTMLInputElement).value);
  const framedButton = await frameOn('button', '', 20_000, careers);
  /** The extension's frames in the form's frame: each one's box, as the form's frame lays it out. */
  const ownBoxes = () =>
    applying().evaluate(() =>
      [...document.documentElement.children]
        .filter((each) => {
          const style = getComputedStyle(each);
          return style.position === 'fixed' && style.visibility !== 'hidden';
        })
        .map((each) => each.getBoundingClientRect().toJSON() as DOMRect),
    );
  /** The part of the form's frame that shows, from its own top. */
  const showing = () =>
    careers.evaluate(() => {
      const frame = document.querySelector('iframe')?.getBoundingClientRect();
      return { top: -(frame?.top ?? 0), bottom: innerHeight - (frame?.top ?? 0) };
    });
  const inShown = async () => {
    const [box] = await ownBoxes();
    const shown = await showing();
    return Boolean(box) && (box?.top ?? 0) >= shown.top && (box?.bottom ?? 0) <= shown.bottom;
  };
  check(
    await inShown(),
    'a form in a frame of a careers page on another site gets its Fill button, in the part of the frame that shows',
  );
  await careers.mouse.wheel(0, 700);
  const until2 = Date.now() + 5000;
  while (!(await inShown()) || (await showing()).top < 400) {
    if (Date.now() > until2) throw new Error('The Fill button stayed where the frame scrolled.');
    await careers.waitForTimeout(100);
  }
  check(true, 'and it stays there as the careers page scrolls the frame');
  const frames = (await setup.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome.storage.session.get('jobFrames'),
  )) as { jobFrames?: Record<string, { url: string }[]> };
  check(
    Object.values(frames.jobFrames ?? {})
      .flat()
      .some((each) => each.url === `${local.origin}${FORM_PATH}`),
    'the frame is kept, while the browser runs, for the panel to find its form',
  );
  await shoot(careers, 'fill-7-framed-button', false);
  await press(framedButton.getByRole('button', { name: 'Fill', exact: true }), careers);
  // Each field in turn, the location last of these, once Lever's code here has suggested it.
  const until3 = Date.now() + 40_000;
  while ((await framedValue('location')) !== 'Denver, Colorado, United States') {
    if (Date.now() > until3) {
      throw new Error(
        `The form in the frame was never filled: ${JSON.stringify({
          email: await framedValue('email'),
          location: await framedValue('location'),
        })}`,
      );
    }
    await careers.waitForTimeout(100);
  }
  check(
    (await framedValue('name')) === 'Ana María Ruiz' &&
      (await framedValue('email')) === 'ana@example.com',
    'its Fill button opens the side panel, which fills the form in the frame',
  );
  check(
    !(await careers.content()).includes('ana@example.com'),
    'and the careers page around it never has an answer',
  );
  // A field's menu in the frame, whose answer goes in the field once you pick it.
  await careers.reload();
  await frameOn('button', '', 20_000, careers);
  await applying().locator('input[name="name"]').click();
  const framedMenu = await frameOn('menu', 'Ana María Ruiz', 20_000, careers);
  check((await framedValue('name')) === '', 'a field’s menu in the frame fills nothing yet');
  await shoot(careers, 'fill-8-framed-menu', false);
  await press(framedMenu.getByRole('button', { name: /Ana María Ruiz/ }), careers);
  const until4 = Date.now() + 10_000;
  while ((await framedValue('name')) !== 'Ana María Ruiz') {
    if (Date.now() > until4) throw new Error('The pick in the frame never went in its field.');
    await careers.waitForTimeout(100);
  }
  check(true, 'and picking its answer puts it in the field, in the frame');

  // A careers page on the form's own site, which could read what's put in the form in its frame,
  // fades the frame as you pick: the pick goes nowhere, as the script checks the page around it.
  await careers.goto(`${local.origin}${SAME_SITE_PATH}`);
  await frameOn('button', '', 20_000, careers);
  await applying().locator('input[name="name"]').click();
  const sameSiteMenu = await frameOn('menu', 'Ana María Ruiz', 20_000, careers);
  await careers.evaluate(() => {
    const frame = document.querySelector('iframe');
    if (frame) frame.style.opacity = '0.3';
  });
  await press(sameSiteMenu.getByRole('button', { name: /Ana María Ruiz/ }), careers);
  await careers.waitForTimeout(500);
  check(
    (await framedValue('name')) === '',
    'a page of the form’s own site around its frame that fades it gets no pick',
  );
  // Fill this application on that page, which the extension may read: it finds the frames of the
  // page itself, and fills the form in the one from a job site.
  await careers.reload();
  const sameSite = (
    await setup.evaluate(
      (url) =>
        (
          globalThis as unknown as {
            chrome: { tabs: { query(query: object): Promise<{ id: number; windowId: number }[]> } };
          }
        ).chrome.tabs.query({ url }),
      `${local.origin}${SAME_SITE_PATH}`,
    )
  )[0];
  if (!sameSite) throw new Error('No tab with the careers page.');
  const besideCareers = await panelOn({
    id: sameSite.id,
    windowId: sameSite.windowId,
    url: `${local.origin}${SAME_SITE_PATH}`,
    title: await careers.title(),
  });
  await besideCareers.getByText(/^Filled \d+ of \d+ fields/).waitFor({ timeout: 40_000 });
  check(
    (await framedValue('email')) === 'ana@example.com' &&
      (await besideCareers
        .locator('.question')
        .filter({ hasText: /^Current location/ })
        .count()) === 1,
    'Fill this application on a careers page fills the form in its frame, and the panel lists its fields',
  );
  await besideCareers.close();

  // Turned off in setup, the Fill button and the menus are gone, there and then.
  await setup.reload();
  await setup.getByRole('button', { name: 'Turn off', exact: true }).click();
  await setup.getByText('Off for job application sites.').waitFor({ timeout: 20_000 });
  const until = Date.now() + 10_000;
  while (form.frames().some((each) => each.url().includes('/frame.html'))) {
    if (Date.now() > until) throw new Error('The Fill button stayed after turning them off.');
    await form.waitForTimeout(100);
  }
  await form.reload();
  await form.waitForTimeout(1500);
  const left = (await setup.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: { scripting: { getRegisteredContentScripts(): Promise<unknown[]> } };
      }
    ).chrome.scripting.getRegisteredContentScripts(),
  )) as unknown[];
  check(
    left.length === 0 && !form.frames().some((each) => each.url().includes('/frame.html')),
    'turned off in setup, its script is unregistered, and its button and menus are gone',
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
