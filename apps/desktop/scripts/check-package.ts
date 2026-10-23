// Checks what the built app carries in its archive: the built app without its source maps, its
// package file, and node-pty, and nothing else from the folder, such as sources, tests or local
// settings. Then that the helper the extension saves through is where the installers put it,
// and on a Mac, that it runs on both kinds of Mac. Run after
// `pnpm dist:mac` or `dist:win`: node scripts/check-package.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the built app keeps its archive, for each kind of computer. */
const ARCHIVES: Readonly<Record<string, string>> = {
  darwin: 'dist/mac-universal/Factwright.app/Contents/Resources/app.asar',
  win32: 'dist/win-unpacked/resources/app.asar',
};

/** Where the built app keeps the helper, for each kind of computer. */
const HELPERS: Readonly<Record<string, string>> = {
  darwin: 'dist/mac-universal/Factwright.app/Contents/Resources/helper/factwright-save',
  win32: 'dist/win-unpacked/factwright-save.exe',
};

/** What the archive may hold at its top, and in node_modules. */
const TOP = ['node_modules', 'out', 'package.json'];
const MODULES = ['node-addon-api', 'node-pty'];

/** The kinds of Mac the helper has to run on, as the app does. */
const MAC_KINDS = ['x86_64', 'arm64'];

interface Entry {
  files?: Record<string, Entry>;
}

const file = new URL(`../${process.argv[2] ?? ARCHIVES[process.platform]}`, import.meta.url);
if (!existsSync(file)) {
  console.error(`No built app's archive at ${file.pathname}: run pnpm dist:mac or dist:win first.`);
  process.exit(1);
}
// An archive starts with the size of its index, then the index itself as JSON.
const archive = readFileSync(file);
const index = JSON.parse(archive.toString('utf8', 16, 16 + archive.readUInt32LE(12))) as Entry;

/** Every path in the archive, with "/" between folders. */
function paths(entry: Entry, prefix = ''): string[] {
  return Object.entries(entry.files ?? {}).flatMap(([name, child]) =>
    child.files ? paths(child, `${prefix}${name}/`) : [`${prefix}${name}`],
  );
}

/** What's wrong with the helper, if anything. */
function helperProblems(): string[] {
  const where = HELPERS[process.platform];
  if (!where) return [];
  const helper = fileURLToPath(new URL(`../${where}`, import.meta.url));
  if (!existsSync(helper)) {
    return [
      `${where} isn't there, so the extension couldn't save to the app. dist:mac and dist:win build it first, and pnpm helper builds it on its own.`,
    ];
  }
  if (process.platform !== 'darwin') return [];
  const lipo = spawnSync('lipo', ['-archs', helper], { encoding: 'utf8' });
  if (lipo.status !== 0) {
    const why = lipo.stderr?.trim() || lipo.error?.message || `lipo stopped with ${lipo.status}`;
    return [`${where} couldn't be checked: ${why}`];
  }
  const kinds = lipo.stdout.trim().split(/\s+/);
  return MAC_KINDS.every((kind) => kinds.includes(kind))
    ? []
    : [`${where} runs on ${kinds.join(' and ')} alone: it needs ${MAC_KINDS.join(' and ')}.`];
}

const problems = [
  ...Object.keys(index.files ?? {})
    .filter((name) => !TOP.includes(name))
    .map((name) => `${name} shouldn't be in the app`),
  ...Object.keys(index.files?.node_modules?.files ?? {})
    .filter((name) => !MODULES.includes(name))
    .map((name) => `node_modules/${name} shouldn't be in the app`),
  ...paths(index)
    .filter((path) => path.startsWith('out/') && path.endsWith('.map'))
    .map((path) => `${path} would carry the app's source`),
  ...helperProblems(),
];
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`The app's archive holds only ${TOP.join(', ')}.`);
if (process.platform === 'darwin') {
  console.log(`The helper is in the app, for ${MAC_KINDS.join(' and ')}.`);
} else if (HELPERS[process.platform]) {
  console.log("The helper is beside the app's program.");
}
