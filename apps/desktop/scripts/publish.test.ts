import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PUBLISH = fileURLToPath(new URL('publish.sh', import.meta.url));

/**
 * A stand-in for the AWS CLI that keeps each uploaded file under $STORE, with the sha256 it was
 * uploaded with under $META, and logs each upload. An upload to $FAIL_ON fails, as a network
 * problem would partway through a publish, and $FEED_FAILS makes reading a file back fail.
 */
const AWS = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = "s3 cp" ] && [ "$4" = - ]; then
  key="\${3#s3://*/}"
  if [ -n "\${FEED_FAILS:-}" ]; then echo "An error occurred (500) when calling the GetObject operation: Internal Error" >&2; exit 1; fi
  if [ ! -f "$STORE/$key" ]; then echo "fatal error: An error occurred (404) when calling the HeadObject operation: Key "$key" does not exist" >&2; exit 1; fi
  cat "$STORE/$key"
elif [ "$1 $2" = "s3 cp" ]; then
  src="$3"; key="\${4#s3://*/}"; sum=""; shift 4
  while [ $# -gt 0 ]; do
    if [ "$1" = --metadata ]; then sum="\${2#sha256=}"; shift 2; else shift; fi
  done
  if [ "$key" = "\${FAIL_ON:-}" ]; then echo "upload failed: $key" >&2; exit 1; fi
  mkdir -p "$(dirname "$STORE/$key")" "$(dirname "$META/$key")"
  cp "$src" "$STORE/$key"
  printf '%s' "$sum" > "$META/$key"
  echo "$key" >> "$UPLOADS"
elif [ "$1 $2" = "s3api head-object" ]; then
  key=""
  while [ $# -gt 0 ]; do
    if [ "$1" = --key ]; then key="$2"; shift 2; else shift; fi
  done
  if [ -n "\${HEAD_FAILS:-}" ]; then echo "An error occurred (403) when calling the HeadObject operation: Forbidden" >&2; exit 254; fi
  if [ ! -f "$STORE/$key" ]; then echo "An error occurred (404) when calling the HeadObject operation: Not Found" >&2; exit 254; fi
  if [ -s "$META/$key" ]; then cat "$META/$key"; echo; else echo None; fi
else
  echo "aws, asked for something publish.sh doesn't do: $*" >&2; exit 2
fi
`;

/** A stand-in for curl that serves downloads.factwright.com from $STORE. */
const CURL = `#!/usr/bin/env bash
url="\${*: -1}"; path="\${url#https://downloads.factwright.com/}"; path="\${path%%\\?*}"
[ -f "$STORE/$path" ] || exit 22
cat "$STORE/$path"
`;

let root: string;
let store: string;
let dist: string;

/** Builds a computer's files for a version, as the release workflow's build hands them over. */
function build(version: string, contents = 'built'): void {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const file of [
    `Factwright-${version}.dmg`,
    `Factwright-${version}.dmg.blockmap`,
    `Factwright-${version}-mac.zip`,
    `Factwright-${version}-mac.zip.blockmap`,
  ]) {
    writeFileSync(join(dist, file), `${file}: ${contents}`);
  }
  writeFileSync(
    join(dist, 'latest-mac.yml'),
    `version: ${version}\npath: Factwright-${version}-mac.zip\n`,
  );
}

/** Runs publish.sh for the Mac, as the workflow's publish job does. */
function publish(version: string, env: Record<string, string> = {}) {
  const bin = join(root, 'bin');
  writeFileSync(join(root, 'uploads.log'), '');
  const run = spawnSync('bash', [PUBLISH, 'mac', version, dist], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STORE: store,
      META: join(root, 'meta'),
      UPLOADS: join(root, 'uploads.log'),
      BUCKET: 'factwright-downloads',
      ENDPOINT: 'https://r2.invalid',
      GITHUB_RUN_ID: '1',
      ...env,
    },
  });
  const uploads = readFileSync(join(root, 'uploads.log'), 'utf8').split('\n').filter(Boolean);
  return { status: run.status, output: `${run.stdout}${run.stderr}`, uploads };
}

const up = (key: string) => existsSync(join(store, key));
const live = () => readFileSync(join(store, 'latest-mac.yml'), 'utf8');

// publish.sh runs on Linux in the release workflow, and needs bash and the usual Unix tools.
describe.skipIf(process.platform === 'win32')('publish.sh', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factwright-publish-'));
    store = join(root, 'store');
    dist = join(root, 'dist');
    mkdirSync(join(root, 'bin'));
    mkdirSync(store);
    for (const [name, script] of [
      ['aws', AWS],
      ['curl', CURL],
    ] as const) {
      writeFileSync(join(root, 'bin', name), script);
      chmodSync(join(root, 'bin', name), 0o755);
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts a version out: its files with their sha256, its kept feed, the newest installer, then the feed', () => {
    build('0.1.2');
    const run = publish('0.1.2');
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('Factwright 0.1.2 for mac is out.');
    expect(run.uploads.slice(-3)).toEqual([
      'feeds/0.1.2/latest-mac.yml',
      'Factwright.dmg',
      'latest-mac.yml',
    ]);
    expect(live()).toContain('version: 0.1.2');
    const meta = readFileSync(join(root, 'meta', 'Factwright-0.1.2.dmg'), 'utf8');
    expect(meta).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has nothing to do once the feed names the version', () => {
    build('0.1.2');
    expect(publish('0.1.2').status).toBe(0);
    const again = publish('0.1.2');
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain('Factwright 0.1.2 for mac is out already.');
    expect(again.uploads).toEqual([]);
  });

  it.each([
    'Factwright-0.1.2-mac.zip',
    'Factwright-0.1.2-mac.zip.blockmap',
    'feeds/0.1.2/latest-mac.yml',
    'Factwright.dmg',
    'latest-mac.yml',
  ])('finishes when run again after an upload of %s failed', (failed) => {
    build('0.1.0');
    expect(publish('0.1.0').status).toBe(0);
    build('0.1.2');
    const stopped = publish('0.1.2', { FAIL_ON: failed });
    expect(stopped.status).not.toBe(0);
    expect(live()).toContain('version: 0.1.0');

    const again = publish('0.1.2');
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain('Factwright-0.1.2.dmg is up already.');
    expect(again.uploads).not.toContain('Factwright-0.1.2.dmg');
    expect(again.uploads.at(-1)).toBe('latest-mac.yml');
    expect(live()).toContain('version: 0.1.2');
  });

  it('refuses files that are up with other contents, before uploading any', () => {
    build('0.1.2', 'first build');
    publish('0.1.2', { FAIL_ON: 'latest-mac.yml' });
    build('0.1.2', 'second build');
    const run = publish('0.1.2');
    expect(run.status).toBe(1);
    expect(run.output).toContain('Factwright-0.1.2.dmg is up already, with other contents.');
    expect(run.uploads).toEqual([]);
  });

  it('refuses a file that went up without a sha256, as the first releases did', () => {
    build('0.1.2');
    mkdirSync(join(root, 'meta'), { recursive: true });
    writeFileSync(join(store, 'Factwright-0.1.2.dmg'), 'uploaded by an older publish.sh');
    writeFileSync(join(root, 'meta', 'Factwright-0.1.2.dmg'), '');
    const run = publish('0.1.2');
    expect(run.status).toBe(1);
    expect(run.output).toContain('Factwright-0.1.2.dmg is up already, with other contents.');
    expect(run.uploads).toEqual([]);
  });

  it('stops, rather than replacing a file, when it can’t check what’s up', () => {
    build('0.1.2');
    const run = publish('0.1.2', { HEAD_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Couldn't check whether Factwright-0.1.2.dmg is up");
    expect(run.uploads).toEqual([]);
  });

  it('stops, rather than guessing what’s out, when it can’t read the update feed', () => {
    build('0.1.2');
    const run = publish('0.1.2', { FEED_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Couldn't read latest-mac.yml to see what's out");
    expect(run.uploads).toEqual([]);
  });

  it('stops when the update feed names no version', () => {
    build('0.1.2');
    writeFileSync(join(store, 'latest-mac.yml'), '<html>Just a moment…</html>');
    const run = publish('0.1.2');
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('latest-mac.yml is up, but names no version.');
    expect(run.uploads).toEqual([]);
  });

  it('never puts an older version out over a newer one', () => {
    build('0.1.3');
    expect(publish('0.1.3').status).toBe(0);
    build('0.1.2');
    const run = publish('0.1.2');
    expect(run.status).toBe(1);
    expect(run.output).toContain(
      "Factwright 0.1.3 is out already, so 0.1.2 can't go out after it.",
    );
    expect(run.uploads).toEqual([]);
    expect(up('Factwright-0.1.2.dmg')).toBe(false);
  });
});
