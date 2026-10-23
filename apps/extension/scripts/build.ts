// Builds the extension for Chrome and for Firefox: dist/chrome and dist/firefox, to load unpacked
// while trying it, and a zip of each, to upload to the Chrome Web Store and Firefox Add-ons.
// `pnpm --filter @factwright/extension build`.
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { FACTWRIGHT_SYNC, manifest, type Target } from '../src/manifest.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};
/**
 * The sync server it's built for, which setup offers first: Factwright's, unless
 * VITE_FACTWRIGHT_SYNC_SERVER names another, such as one running locally. Anything but this
 * computer must be reached over HTTPS: what the extension sends is locked, but its sign-in isn't.
 * You can still choose a server of your own in setup, in any build.
 */
const server = (() => {
  const named = process.env.VITE_FACTWRIGHT_SYNC_SERVER || FACTWRIGHT_SYNC;
  const url = new URL(named);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`The sync server must be an https:// address, or this computer's: ${named}`);
  }
  return url.origin;
})();
/** Only a build for Factwright's own sync goes to the stores, so only it gets zips. */
const forStores = server === FACTWRIGHT_SYNC;

/**
 * For the end-to-end run alone: native messaging asked for at install, as its browser can't
 * answer the prompt that asks for it when setup does. The stores' build always asks in setup.
 */
const nativeAtInstall = process.env.FACTWRIGHT_NATIVE_AT_INSTALL === '1';
if (nativeAtInstall && forStores) {
  throw new Error('The stores’ build asks for native messaging in setup, never at install.');
}

/** Every file under a folder, by its path inside it. */
function filesIn(folder: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(folder, path).split('\\').join('/')] = readFileSync(path);
    }
  };
  walk(folder);
  return files;
}

/**
 * The page reader, as built: the browser sends this one function into the page on its own, so it
 * must still work with nothing from around it. It's taken out of the built file and run on a
 * posting, and the build stops if it reaches for anything outside itself.
 */
function checkPageReader(folder: string): void {
  const files = Object.entries(filesIn(folder)).filter(([path]) => path.endsWith('.js'));
  const found = files
    .map(([, data]) => new TextDecoder().decode(data))
    .find((code) => code.includes('function readJobPage('));
  if (!found) throw new Error('The built extension has no readJobPage.');
  const start = found.indexOf('function readJobPage(');
  // The function runs to the brace that closes its body.
  let depth = 0;
  let end = found.indexOf('{', found.indexOf(')', start));
  for (; end < found.length; end++) {
    if (found[end] === '{') depth++;
    else if (found[end] === '}' && --depth === 0) break;
  }
  const source = found.slice(start, end + 1);
  const page = new JSDOM(
    `<title>Staff Engineer</title><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Staff Engineer',
      hiringOrganization: { name: 'Northwind' },
      description: '<p>Build things.</p>',
    })}</script><h1>Staff Engineer</h1>`,
    // The function runs in the page's own window, as the browser runs it, with only what a page has.
    { url: 'https://jobs.example.com/staff?utm_source=x', runScripts: 'outside-only' },
  );
  const { window } = page;
  const run = window.eval(`(${source})`) as (
    doc: Document,
    href: string,
    selected: string,
  ) => { title: string; company: string; posting: string; url: string };
  const job = run(window.document, window.location.href, '');
  if (
    job.title !== 'Staff Engineer' ||
    job.company !== 'Northwind' ||
    job.posting !== 'Build things.' ||
    job.url !== 'https://jobs.example.com/staff'
  ) {
    throw new Error(`The built page reader read the wrong job: ${JSON.stringify(job)}`);
  }
}

/**
 * The form's function, as built: the browser sends it into the page on its own, as the page
 * reader, so it's taken out of the built file and run on a small form, and the build stops if it
 * reaches for anything outside itself.
 */
async function checkFormReader(folder: string): Promise<void> {
  const files = Object.entries(filesIn(folder)).filter(([path]) => path.endsWith('.js'));
  const found = files
    .map(([, data]) => new TextDecoder().decode(data))
    .find((code) => code.includes('async function formPage('));
  if (!found) throw new Error('The built extension has no formPage.');
  const start = found.indexOf('async function formPage(');
  let depth = 0;
  let end = found.indexOf('{', found.indexOf(')', start));
  for (; end < found.length; end++) {
    if (found[end] === '{') depth++;
    else if (found[end] === '}' && --depth === 0) break;
  }
  const source = found.slice(start, end + 1);
  const page = new JSDOM(
    '<form><label for="e">Email *</label><input id="e" type="email" required /></form>',
    { url: 'https://jobs.example.com/apply', runScripts: 'outside-only' },
  );
  const { window } = page;
  const run = window.eval(`(${source})`) as (
    task: unknown,
    doc: Document,
    href: string,
  ) => Promise<{ did: string; form: { fields: { question: string; required: boolean }[] } }>;
  const read = await run({ do: 'read' }, window.document, window.location.href);
  const [field] = read.form.fields;
  if (read.did !== 'read' || field?.question !== 'Email' || !field.required) {
    throw new Error(`The built form reader read the wrong form: ${JSON.stringify(read)}`);
  }
}

rmSync(DIST, { recursive: true, force: true });
await build({
  root: ROOT,
  logLevel: 'warn',
  // The checked server, and nothing from a .env file, which would skip the checks above.
  envDir: false,
  define: { 'import.meta.env.VITE_FACTWRIGHT_SYNC_SERVER': JSON.stringify(server) },
});
checkPageReader(join(DIST, 'build'));
await checkFormReader(join(DIST, 'build'));

for (const target of ['chrome', 'firefox'] as const satisfies readonly Target[]) {
  const out = join(DIST, target);
  mkdirSync(out, { recursive: true });
  cpSync(join(DIST, 'build'), out, { recursive: true });
  writeFileSync(
    join(out, 'manifest.json'),
    `${JSON.stringify(manifest(target, version, server, { nativeAtInstall }), null, 2)}\n`,
  );
  if (!forStores) {
    console.log(`dist/${target}, for ${server}: no zip, since it's not for the stores`);
    continue;
  }
  // The same bytes for the same files, whenever it's built: each file's time is fixed.
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(filesIn(out)).map(([path, data]) => [
        path,
        [data, { mtime: new Date('2026-01-01T00:00:00Z') }],
      ]),
    ),
  );
  writeFileSync(join(DIST, `factwright-${target}-${version}.zip`), zipped);
  console.log(`dist/${target} and dist/factwright-${target}-${version}.zip`);
}
rmSync(join(DIST, 'build'), { recursive: true, force: true });
