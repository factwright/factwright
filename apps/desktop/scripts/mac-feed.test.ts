import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('mac-feed.ts', import.meta.url));

/** A Mac update feed as electron-builder writes it, with the release's notes. */
const FEED = `version: 0.10.0
files:
  - url: Factwright-0.10.0-mac.zip
    sha512: zipzipzip==
    size: 210000000
  - url: Factwright-0.10.0.dmg
    sha512: dmgdmgdmg==
    size: 220000000
path: Factwright-0.10.0-mac.zip
sha512: zipzipzip==
releaseNotes: |
  ## What's new
  - Something new.
releaseDate: '2026-10-20T18:00:00.000Z'
`;

/** The built app's Info.plist, as electron-builder writes it, with the oldest macOS it opens on. */
function infoPlist(oldest: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleName</key>
    <string>Factwright</string>
    <key>LSMinimumSystemVersion</key>
    <string>${oldest}</string>
  </dict>
</plist>`;
}

let dist: string;

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'fw-mac-feed-'));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

/** Builds the folder electron-builder leaves: the app, and the feed if there's a download site. */
function built(oldest: string | null, feed: string | null = FEED): void {
  const contents = join(dist, 'mac-universal', 'Factwright.app', 'Contents');
  mkdirSync(contents, { recursive: true });
  if (oldest !== null) writeFileSync(join(contents, 'Info.plist'), infoPlist(oldest));
  if (feed !== null) writeFileSync(join(dist, 'latest-mac.yml'), feed);
}

function run() {
  const ran = spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' });
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
}

const feed = () => readFileSync(join(dist, 'latest-mac.yml'), 'utf8');

describe('mac-feed.ts', () => {
  it('names Darwin’s version of the oldest macOS the app opens on, after the feed’s version', () => {
    built('13.0');
    const ran = run();
    expect(ran.status, ran.output).toBe(0);
    expect(feed()).toBe(
      FEED.replace('version: 0.10.0\n', "version: 0.10.0\nminimumSystemVersion: '22.0.0'\n"),
    );
    expect(ran.output).toContain('names macOS 13, Darwin 22.0.0, as the oldest');
  });

  it('changes nothing run again, and takes the place of one there already', () => {
    built('14');
    expect(run().status).toBe(0);
    const once = feed();
    expect(once).toContain("minimumSystemVersion: '23.0.0'");
    expect(run().status).toBe(0);
    expect(feed()).toBe(once);

    built('13.0.0', once);
    expect(run().status).toBe(0);
    expect(feed()).toBe(once.replace("'23.0.0'", "'22.0.0'"));
  });

  it('leaves a build without a download site as it is, as it has no feed', () => {
    built('13.0', null);
    const ran = run();
    expect(ran.status, ran.output).toBe(0);
    expect(existsSync(join(dist, 'latest-mac.yml'))).toBe(false);
  });

  it('stops on a macOS it doesn’t know Darwin’s version of, leaving the feed as it was', () => {
    for (const oldest of ['16.0', '13.3', '']) {
      built(oldest);
      const ran = run();
      expect(ran.status, oldest).toBe(1);
      expect(feed()).toBe(FEED);
    }
    expect(run().output).toContain("doesn't say the oldest macOS");
  });

  it('stops without the built app to read the oldest macOS from', () => {
    built(null);
    const ran = run();
    expect(ran.status).toBe(1);
    expect(ran.output).toContain('No built app');
    expect(feed()).toBe(FEED);
  });
});
