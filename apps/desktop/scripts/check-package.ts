// Checks what the built app carries in its archive: the built app without its source maps, its
// package file, and node-pty, and nothing else from the folder, such as sources, tests or local
// settings. Run after `pnpm dist:mac` or `dist:win`: node scripts/check-package.ts
import { existsSync, readFileSync } from 'node:fs';

/** Where the built app keeps its archive, for each kind of computer. */
const ARCHIVES: Readonly<Record<string, string>> = {
  darwin: 'dist/mac-universal/Factwright.app/Contents/Resources/app.asar',
  win32: 'dist/win-unpacked/resources/app.asar',
};

/** What the archive may hold at its top, and in node_modules. */
const TOP = ['node_modules', 'out', 'package.json'];
const MODULES = ['node-addon-api', 'node-pty'];

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
];
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`The app's archive holds only ${TOP.join(', ')}.`);
