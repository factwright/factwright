// Fills a form in a real Firefox, headless, with the built extension's own form function: sent
// into a page served here by the extension's scripting.executeScript, as its sidebar does it, it
// reads the form, fills it, uploads a file through Firefox's content-script sandbox, and reads
// what's in it. It reads no field you can't see, as a page's traps for bots. Then the job
// application sites: turned on in setup, Firefox registers the extension's script on them, which
// puts its Fill button on the form, and Firefox, which opens its sidebar only from a click of its
// own, has the button fill the form there, which, with no Factwright on this computer, says so.
// Turned off, the script and its button are gone. Nothing is submitted. As e2e:firefox does, it
// needs Mozilla's Firefox 158 or later, which FIREFOX names, or on a Mac the one in Applications.
// `pnpm --filter @factwright/extension e2e:firefox-fill`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_HELPER } from '@factwright/core';
import { FIREFOX_ID } from '../src/manifest.ts';
import type {
  FieldAnswer,
  FieldFilled,
  FieldValue,
  FormTask,
  PageField,
} from '../src/page/form.ts';
import { Firefox, waitFor } from './bidi.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');
const mac = process.platform === 'darwin';

function check(that: boolean, what: string): void {
  if (!that) throw new Error(`Not so: ${what}`);
  console.log(`✓ ${what}`);
}

/** Firefox: the one FIREFOX names, or else the one in Applications on a Mac, or on PATH. */
function firefoxProgram(): string {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  const found = (
    mac
      ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
      : (process.env.PATH ?? '').split(delimiter).map((folder) => join(folder, 'firefox'))
  ).find((path) => existsSync(path));
  if (!found) {
    console.error('There’s no Firefox to run: name one with FIREFOX.');
    process.exit(1);
  }
  return found;
}

/** The extension's address in this Firefox, which a pref fixes. */
const UUID = '5f0d3a91-2c4b-4e8a-9b6f-7d1e2c3b4a50';

/** The forms it fills: the plain one, and Lever's as Chromium showed it. */
const PAGES: Record<string, string> = {
  '/plain/apply': 'plain-application.html',
  '/lever/apply': 'lever-application.html',
};

/** A form with fields you can't see, and the questions of the ones you can. */
const TRAPS = '/traps/apply';
const SEEN = ['Full name', 'Are you willing to relocate?', 'Country', 'City'];

const site = createServer((request, response) => {
  const name = request.url === TRAPS ? 'hidden-fields.html' : PAGES[request.url ?? ''];
  response.writeHead(name ? 200 : 404, { 'content-type': 'text/html' });
  response.end(name ? readFileSync(join(FIXTURES, name)) : 'Not found');
});
await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
const work = mkdtempSync(join(tmpdir(), 'fw-firefox-fill-'));
let firefox: Firefox | null = null;
let failed = false;
try {
  // Built for this computer's site as its sync server, which it may reach, so it may read the
  // pages here without a click on its button, which WebDriver BiDi can't make.
  execFileSync('node', ['scripts/build.ts'], {
    cwd: ROOT,
    env: { ...process.env, VITE_FACTWRIGHT_SYNC_SERVER: origin },
    stdio: 'ignore',
  });
  const extension = join(ROOT, 'dist', 'firefox');
  // The form's function as built, which the sidebar sends into the page.
  const code = readdirSync(join(extension, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(extension, 'assets', name), 'utf8'))
    .find((text) => text.includes('async function formPage('));
  if (!code) throw new Error('The built extension has no formPage.');
  const start = code.indexOf('async function formPage(');
  let depth = 0;
  let end = code.indexOf('{', code.indexOf(')', start));
  for (; end < code.length; end++) {
    if (code[end] === '{') depth++;
    else if (code[end] === '}' && --depth === 0) break;
  }
  const source = code.slice(start, end + 1);

  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(work, 'profile'), { recursive: true });
  firefox = await Firefox.launch({
    program: firefoxProgram(),
    profile: join(work, 'profile'),
    prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: UUID }),
      // An optional permission asked for on a click is granted, as Firefox's prompt can't be
      // answered here. Asked for any other way, Firefox still refuses it.
      'extensions.webextOptionalPermissionPrompts': false,
    },
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      CFFIXED_USER_HOME: home,
    },
  });
  const running = firefox;
  console.log(`Firefox ${running.version}`);
  await running.send('webExtension.install', { extensionData: { type: 'path', path: extension } });
  // Setup opens on install: one of the extension's own pages, to run its scripting from.
  const setup = await waitFor(
    'setup to open',
    async () =>
      (await running.tabs()).find((tab) => tab.url === `moz-extension://${UUID}/setup.html`)
        ?.context,
  );
  const { context: tab } = await running.send<{ context: string }>('browsingContext.create', {
    type: 'tab',
  });

  /** Runs the form's function in the page at an address, by the extension's own scripting. */
  async function inPage<Answer>(address: string, task: FormTask): Promise<Answer> {
    const called = await running.send<
      | { type: 'success'; result: { value?: unknown } }
      | { type: 'exception'; exceptionDetails: { text: string } }
    >('script.callFunction', {
      functionDeclaration: `async (json) => {
        const [address, task] = JSON.parse(json);
        const formPage = ${source};
        const tabs = await browser.tabs.query({});
        const tab = tabs.find((each) => each.url === address);
        if (!tab) throw new Error('No tab at ' + address);
        const [first] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: formPage,
          args: [task],
        });
        return JSON.stringify(first?.result ?? null);
      }`,
      arguments: [{ type: 'string', value: JSON.stringify([address, task]) }],
      target: { context: setup },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (called.type === 'exception') throw new Error(called.exceptionDetails.text);
    return JSON.parse(String(called.result.value)) as Answer;
  }

  // A small PDF, to see the upload take.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
  const resume = { name: 'Ana Ruiz - Resume.pdf', type: 'application/pdf', base64: pdf };
  for (const path of Object.keys(PAGES)) {
    const address = `${origin}${path}`;
    await running.send('browsingContext.navigate', {
      context: tab,
      url: address,
      wait: 'complete',
    });
    const read = await inPage<{ did: 'read'; form: { fields: PageField[] } }>(address, {
      do: 'read',
    });
    const fields = read.form.fields;
    check(
      fields.length > 5,
      `${path}: Firefox lets the extension read the form, ${fields.length} fields`,
    );
    const at = (question: string) => fields.find((field) => field.question === question);
    const asked: [string, Omit<FieldAnswer, 'ref' | 'key'>][] = [
      ['Full name', { text: 'Ana María Ruiz' }],
      ['Email address', { text: 'ana@example.com' }],
      ['Email', { text: 'ana@example.com' }],
      ['State', { pick: ['CO', 'Colorado'] }],
      ['Will you now or in the future require visa sponsorship?', { pick: ['No'] }],
      ['Which shifts can you work?', { pick: ['Day'] }],
      ['Pronouns', { pick: ['She/her'] }],
      ['What best describes your gender?', { pick: ['Woman'] }],
      ['Resume', { file: resume }],
      ['Resume/CV', { file: resume }],
      ['Create a password', { text: 'hunter2' }],
    ];
    const answers: FieldAnswer[] = asked.flatMap(([question, answer]) => {
      const field = at(question);
      return field ? [{ ref: field.ref, key: field.key, ...answer }] : [];
    });
    const { filled } = await inPage<{ filled: FieldFilled[] }>(address, {
      do: 'fill',
      url: address,
      answers,
    });
    const took = (question: string) =>
      filled.find((each) => each.ref === at(question)?.ref)?.ok === true;
    const files = fields.filter((field) => field.control === 'file');
    check(
      filled.filter((each) => each.ok).length ===
        answers.length - (at('Create a password') ? 1 : 0),
      `${path}: each field takes what it's given, as typing would`,
    );
    check(!at('Create a password') || !took('Create a password'), `${path}: but never a password`);
    const { values } = await inPage<{ values: FieldValue[] }>(address, {
      do: 'values',
      fields: files.map(({ ref, key }) => ({ ref, key })),
    });
    const inFile = values.find((each) => files.some((field) => field.key === each.key))?.value;
    check(
      inFile === 'Ana Ruiz - Resume.pdf',
      `${path}: the resume goes in through Firefox's content-script sandbox`,
    );
  }
  const traps = `${origin}${TRAPS}`;
  await running.send('browsingContext.navigate', { context: tab, url: traps, wait: 'complete' });
  const seen = await inPage<{ form: { fields: PageField[] } }>(traps, { do: 'read' });
  const questions = seen.form.fields.map((field) => field.question);
  check(
    JSON.stringify(questions) === JSON.stringify(SEEN),
    `it reads only the fields you can see, never a trap for bots (${questions.join(', ')})`,
  );

  // The job application sites. Setup shows them once it's set up to save to this computer, which
  // native messaging it asks for on a click.
  type Ext = {
    storage: { local: { set(items: object): Promise<void> } };
    scripting: {
      getRegisteredContentScripts(): Promise<{ matches: string[]; excludeMatches?: string[] }[]>;
    };
    runtime: { sendNativeMessage?(name: string, message: object): Promise<unknown> };
  };
  await running.run(setup, () =>
    (globalThis as unknown as { browser: Ext }).browser.storage.local.set({
      settings: { linkedInText: true, where: 'computer' },
    }),
  );
  await running.send('browsingContext.reload', { context: setup, wait: 'complete' });
  /** A button on setup's page, by its words, once it's there to click, clicked as a person does. */
  const click = async (context: string, words: string) => {
    const target = await waitFor(`the ${words} button`, () =>
      running.find(
        context,
        (name: string) =>
          [...document.querySelectorAll('button')].find(
            (each) => each.textContent === name && !each.disabled,
          ),
        words,
      ),
    );
    await running.click(context, target);
  };
  const says = (context: string, words: string) =>
    waitFor(`“${words}”`, () =>
      running.run(context, (wanted: string) => document.body.innerText.includes(wanted), words),
    );
  await click(setup, 'Allow it');
  await click(setup, 'Turn on for job application sites');
  await says(setup, 'On for job application sites.');
  const registered = () =>
    running.run(setup, () =>
      (globalThis as unknown as { browser: Ext }).browser.scripting.getRegisteredContentScripts(),
    );
  const [script, ...more] = await registered();
  check(
    more.length === 0 &&
      script?.matches.includes('https://jobs.lever.co/*') === true &&
      script.matches.includes('http://127.0.0.1/*') &&
      script.excludeMatches?.includes('*://*.linkedin.com/*') === true,
    'turned on in setup, which Firefox grants on the click, its script is registered for the job application sites alone',
  );

  /** The extension's frame on a page, by what its address says after its #. */
  const frameOn = (context: string, mode: string) =>
    waitFor(`the ${mode} frame`, async () => {
      const tree = await running.send<{
        contexts: { context: string; children: { context: string; url: string }[] }[];
      }>('browsingContext.getTree', { root: context });
      return tree.contexts[0]?.children.find((each) => each.url.includes(`/frame.html#${mode}`))
        ?.context;
    });
  const lever = `${origin}/lever/apply`;
  await running.send('browsingContext.navigate', { context: tab, url: lever, wait: 'complete' });
  const fillButton = await frameOn(tab, 'button');
  check(true, 'the script puts its Fill button on the form, in the extension’s own frame');
  // Before the button asks Factwright anything, Firefox must find no helper, as the run has
  // registered none: one it found would be your own Factwright's.
  const helper = await running.run(
    setup,
    async (name: string) => {
      try {
        const sent = (globalThis as unknown as { browser: Ext }).browser.runtime.sendNativeMessage;
        return { answer: await sent?.(name, { type: 'hello' }) };
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
    SAVE_HELPER,
  );
  if (!('error' in helper) || !/no such native application/i.test(helper.error ?? '')) {
    throw new Error(`Firefox found a helper the run didn’t register: ${JSON.stringify(helper)}`);
  }
  await click(fillButton, 'Fill');
  await says(fillButton, 'couldn’t find Factwright');
  check(
    true,
    'its Fill button asks for the form’s answers itself, as Firefox opens its sidebar only from its own click, and says why it can’t fill it',
  );
  await click(setup, 'Turn off');
  await says(setup, 'Off for job application sites.');
  await waitFor('the Fill button to go', async () => {
    const tree = await running.send<{
      contexts: { children: { url: string }[] }[];
    }>('browsingContext.getTree', { root: tab });
    return !tree.contexts[0]?.children.some((each) => each.url.includes('/frame.html'));
  });
  check(
    (await registered()).length === 0,
    'turned off, Firefox takes its script away, and its button goes from the page',
  );
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await firefox?.close().catch(() => {});
  site.close();
  // Firefox may hold its profile a moment after it stops.
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // A temporary folder left behind does no harm.
  }
  // Built again for Factwright's own sync, as the stores get it.
  execFileSync('node', ['scripts/build.ts'], { cwd: ROOT, stdio: 'ignore' });
}
process.exit(failed ? 1 : 0);
