// Puts the oldest macOS the built app opens on in its update feed, so a copy on an older Mac keeps
// the version it has, instead of updating to one it can't open. Run after electron-builder, as
// `pnpm dist:mac` does: node scripts/mac-feed.ts [folder of the built files, dist by default]
//
// Electron sets the oldest macOS in the app's Info.plist, as LSMinimumSystemVersion: macOS 13 since
// Electron 44. electron-builder leaves it out of the feed. electron-updater passes over an update
// whose feed names a newer system than the computer's, as minimumSystemVersion, but it compares
// that with os.release(), which on a Mac is Darwin's version, not macOS's. So the feed names
// Darwin's. A build without a download site has no feed, and is left as it is.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Darwin's version for each macOS the app may need, as os.release() gives it on that macOS. */
const DARWIN: Readonly<Record<string, string>> = {
  '12': '21.0.0',
  '13': '22.0.0',
  '14': '23.0.0',
  '15': '24.0.0',
};

const KEY = 'minimumSystemVersion';

const dist = process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url));
const feed = join(dist, 'latest-mac.yml');
const plist = join(dist, 'mac-universal', 'Factwright.app', 'Contents', 'Info.plist');

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!existsSync(feed)) {
  console.log('No update feed to name the oldest macOS in: this build has no download site.');
  process.exit(0);
}
if (!existsSync(plist)) stop(`No built app at ${plist} to read the oldest macOS it opens on from.`);

// electron-builder writes the Info.plist as XML.
const oldest = /<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(
  readFileSync(plist, 'utf8'),
)?.[1];
if (!oldest) stop(`${plist} doesn't say the oldest macOS the app opens on.`);
const major = /^(\d+)(?:\.0){0,2}$/.exec(oldest)?.[1];
const darwin = major ? DARWIN[major] : undefined;
if (!darwin) {
  stop(
    `The app opens on macOS ${oldest} or later, and the feed needs Darwin's version for it: add it to DARWIN in scripts/mac-feed.ts.`,
  );
}

// Right after the version, in place of any there already, so running this again changes nothing.
const lines = readFileSync(feed, 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith(`${KEY}:`));
const version = lines.findIndex((line) => line.startsWith('version:'));
if (version < 0) stop(`${feed} names no version.`);
lines.splice(version + 1, 0, `${KEY}: '${darwin}'`);
writeFileSync(feed, lines.join('\n'));
console.log(
  `latest-mac.yml names macOS ${major}, Darwin ${darwin}, as the oldest: a Mac on an older one keeps the version it has.`,
);
