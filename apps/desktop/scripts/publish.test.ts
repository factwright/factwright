import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
 * uploaded with under $META, and logs each upload with its headers. It answers only the calls
 * publish.sh makes, as publish.sh makes them. To act out what goes wrong:
 * - $FAIL_ON: uploading that key fails, as a network problem would partway through a publish.
 * - $FEED_FAILS: reading a file back fails.
 * - $HEAD_FAILS: asking about that key fails with something other than "not found".
 * - $EMPTY_META: asking about that key gets an empty answer.
 * - $MARKER_ON, $MARKER: uploading the first puts the second up, as a take-back during a publish.
 */
const AWS = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = "s3 cp" ] && [ "$4" = - ]; then
  key="\${3#s3://*/}"
  if [ -n "\${FEED_FAILS:-}" ]; then echo "An error occurred (500) when calling the GetObject operation: Internal Error" >&2; exit 1; fi
  if [ ! -f "$STORE/$key" ]; then echo "fatal error: An error occurred (404) when calling the HeadObject operation: Key \\"$key\\" does not exist" >&2; exit 1; fi
  cat "$STORE/$key"
elif [ "$1 $2" = "s3 cp" ]; then
  src="$3"; dest="\${4#s3://}"; bucket="\${dest%%/*}"; key="\${dest#*/}"; shift 4
  sum=""; cache=""; type=""; endpoint=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --metadata) sum="\${2#sha256=}"; shift 2 ;;
      --cache-control) cache="$2"; shift 2 ;;
      --content-type) type="$2"; shift 2 ;;
      --endpoint-url) endpoint="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ "$key" = "\${FAIL_ON:-}" ]; then echo "upload failed: $key" >&2; exit 1; fi
  mkdir -p "$(dirname "$STORE/$key")" "$(dirname "$META/$key")"
  cp "$src" "$STORE/$key"
  printf '%s' "$sum" > "$META/$key"
  printf '%s|%s|%s|%s|%s\\n' "$key" "$cache" "$type" "$endpoint" "$bucket" >> "$UPLOADS"
  if [ "$key" = "\${MARKER_ON:-}" ]; then
    mkdir -p "$(dirname "$STORE/$MARKER")" "$(dirname "$META/$MARKER")"
    echo "taken back" > "$STORE/$MARKER"; : > "$META/$MARKER"
  fi
elif [ "$1 $2" = "s3api head-object" ]; then
  case " $* " in
    *" --query Metadata.sha256 --output text "*) ;;
    *) echo "head-object, asked for something publish.sh doesn't ask: $*" >&2; exit 2 ;;
  esac
  key=""
  while [ $# -gt 0 ]; do
    if [ "$1" = --key ]; then key="$2"; shift 2; else shift; fi
  done
  if [ "$key" = "\${HEAD_FAILS:-}" ]; then echo "An error occurred (403) when calling the HeadObject operation: Forbidden" >&2; exit 254; fi
  if [ ! -f "$STORE/$key" ]; then echo "An error occurred (404) when calling the HeadObject operation: Not Found" >&2; exit 254; fi
  if [ "$key" = "\${EMPTY_META:-}" ]; then echo; exit 0; fi
  if [ -s "$META/$key" ]; then cat "$META/$key"; echo; else echo None; fi
else
  echo "aws, asked for something publish.sh doesn't do: $*" >&2; exit 2
fi
`;

/**
 * A stand-in for curl that serves downloads.factwright.com from $STORE, as Cloudflare does, or with
 * $STALE, the feed of an older version, as a cache that hasn't caught up would.
 */
const CURL = `#!/usr/bin/env bash
url="\${*: -1}"; path="\${url#https://downloads.factwright.com/}"; path="\${path%%\\?*}"
if [ -n "\${STALE:-}" ]; then printf 'version: 0.0.1\\n'; exit 0; fi
[ -f "$STORE/$path" ] || exit 22
cat "$STORE/$path"
`;

type Computer = 'mac' | 'windows';

/** Each computer's installer, other files and update feed, as the release workflow builds them. */
const FILES = {
  mac: (v: string) => ({
    installer: `Factwright-${v}.dmg`,
    others: [
      `Factwright-${v}.dmg.blockmap`,
      `Factwright-${v}-mac.zip`,
      `Factwright-${v}-mac.zip.blockmap`,
    ],
    feed: 'latest-mac.yml',
    newest: 'Factwright.dmg',
  }),
  windows: (v: string) => ({
    installer: `Factwright-Setup-${v}.exe`,
    others: [`Factwright-Setup-${v}.exe.blockmap`],
    feed: 'latest.yml',
    newest: 'Factwright-Setup.exe',
  }),
};

/** One upload, as the stand-in logged it. */
interface Upload {
  key: string;
  cache: string;
  type: string;
  endpoint: string;
  bucket: string;
}

let root: string;
let store: string;
let dist: string;

/** Builds a computer's files for a version, as the release workflow's build hands them over. */
function build(computer: Computer, version: string, contents = 'built'): void {
  const { installer, others, feed } = FILES[computer](version);
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const file of [installer, ...others])
    writeFileSync(join(dist, file), `${file}: ${contents}`);
  writeFileSync(join(dist, feed), `version: ${version}\npath: ${installer}\n`);
}

/** Runs publish.sh for a computer, as the workflow's publish job does. */
function publish(computer: Computer, version: string, env: Record<string, string> = {}) {
  writeFileSync(join(root, 'uploads.log'), '');
  const run = spawnSync('bash', [PUBLISH, computer, version, dist], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      STORE: store,
      META: join(root, 'meta'),
      UPLOADS: join(root, 'uploads.log'),
      BUCKET: 'factwright-downloads',
      ENDPOINT: 'https://r2.invalid',
      GITHUB_RUN_ID: '1',
      ...env,
    },
  });
  const log: Upload[] = readFileSync(join(root, 'uploads.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [key = '', cache = '', type = '', endpoint = '', bucket = ''] = line.split('|');
      return { key, cache, type, endpoint, bucket };
    });
  return {
    status: run.status,
    output: `${run.stdout}${run.stderr}`,
    log,
    uploads: log.map((upload) => upload.key),
  };
}

const up = (key: string) => existsSync(join(store, key));
const read = (path: string) => readFileSync(path, 'utf8');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Each of a version's files is up with the sha256 of its own bytes. */
function expectSums(computer: Computer, version: string): void {
  const { installer, others } = FILES[computer](version);
  for (const file of [installer, ...others]) {
    expect(read(join(root, 'meta', file)), file).toBe(sha256(join(dist, file)));
  }
}

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

  it.each(['mac', 'windows'] as const)(
    'puts a version out for %s: its files with their sha256, its kept feed, the newest installer, then the feed',
    (computer) => {
      const files = FILES[computer]('0.1.2');
      build(computer, '0.1.2');
      const run = publish(computer, '0.1.2');
      expect(run.status, run.output).toBe(0);
      expect(run.output).toContain(`Factwright 0.1.2 for ${computer} is out.`);
      expect(run.uploads.slice(-3)).toEqual([
        `feeds/0.1.2/${files.feed}`,
        files.newest,
        files.feed,
      ]);
      expect(read(join(store, files.feed))).toContain('version: 0.1.2');
      expect(read(join(store, files.newest))).toBe(read(join(dist, files.installer)));
      expectSums(computer, '0.1.2');
      for (const upload of run.log) {
        expect(upload.endpoint, upload.key).toBe('https://r2.invalid');
        expect(upload.bucket, upload.key).toBe('factwright-downloads');
        if (upload.key.endsWith('.yml')) {
          expect([upload.cache, upload.type], upload.key).toEqual(['no-cache', 'text/yaml']);
        } else if (upload.key === files.newest) {
          expect(upload.cache).toBe('no-cache');
        } else {
          expect(upload.cache, upload.key).toBe('public, max-age=31536000, immutable');
        }
      }
    },
  );

  it('has nothing to put up once the feed names the version, and checks what installed copies see', () => {
    build('mac', '0.1.2');
    expect(publish('mac', '0.1.2').status).toBe(0);
    const again = publish('mac', '0.1.2');
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain('Factwright 0.1.2 for mac is out already.');
    expect(again.uploads).toEqual([]);

    const stale = publish('mac', '0.1.2', { STALE: '1' });
    expect(stale.status).toBe(1);
    expect(stale.output).toContain("downloads.factwright.com doesn't give latest-mac.yml");
  });

  it.each([
    'Factwright-0.1.2-mac.zip',
    'Factwright-0.1.2-mac.zip.blockmap',
    'feeds/0.1.2/latest-mac.yml',
    'Factwright.dmg',
    'latest-mac.yml',
  ])('finishes when run again after an upload of %s failed', (failed) => {
    build('mac', '0.1.0');
    expect(publish('mac', '0.1.0').status).toBe(0);
    build('mac', '0.1.2');
    const stopped = publish('mac', '0.1.2', { FAIL_ON: failed });
    expect(stopped.status).not.toBe(0);
    expect(read(join(store, 'latest-mac.yml'))).toContain('version: 0.1.0');

    const again = publish('mac', '0.1.2');
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain('Factwright-0.1.2.dmg is up already.');
    expect(again.uploads).not.toContain('Factwright-0.1.2.dmg');
    expect(again.uploads.at(-1)).toBe('latest-mac.yml');
    expect(read(join(store, 'latest-mac.yml'))).toContain('version: 0.1.2');
    expectSums('mac', '0.1.2');
  });

  it('finishes for Windows too, after its feed failed to go up', () => {
    build('windows', '0.1.2');
    expect(publish('windows', '0.1.2', { FAIL_ON: 'latest.yml' }).status).not.toBe(0);
    const again = publish('windows', '0.1.2');
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain('Factwright-Setup-0.1.2.exe is up already.');
    expect(read(join(store, 'latest.yml'))).toContain('version: 0.1.2');
    expectSums('windows', '0.1.2');
  });

  it('checks every file before uploading any, and refuses one that’s up with other contents', () => {
    build('mac', '0.1.2', 'first build');
    publish('mac', '0.1.2', { FAIL_ON: 'latest-mac.yml' });
    // The installer, checked first, is missing, so only checking everything first uploads nothing.
    rmSync(join(store, 'Factwright-0.1.2.dmg'));
    build('mac', '0.1.2', 'second build');
    const run = publish('mac', '0.1.2');
    expect(run.status).toBe(1);
    expect(run.output).toContain('is up already, with other contents.');
    expect(run.uploads).toEqual([]);
  });

  it.each([
    ['no sha256', {}],
    ['an empty answer', { EMPTY_META: 'Factwright-0.1.2.dmg' }],
  ])('refuses a file that’s up with %s to check it by', (_, env) => {
    build('mac', '0.1.2');
    mkdirSync(join(root, 'meta'), { recursive: true });
    writeFileSync(join(store, 'Factwright-0.1.2.dmg'), 'uploaded by an older publish.sh');
    writeFileSync(join(root, 'meta', 'Factwright-0.1.2.dmg'), '');
    const run = publish('mac', '0.1.2', env);
    expect(run.status).toBe(1);
    expect(run.output).toContain(
      'Factwright-0.1.2.dmg is up already, without a sha256 to check it by.',
    );
    expect(run.uploads).toEqual([]);
  });

  it('never puts a version out again once it’s been taken back', () => {
    build('mac', '0.1.0');
    expect(publish('mac', '0.1.0').status).toBe(0);
    build('mac', '0.1.1');
    expect(publish('mac', '0.1.1').status).toBe(0);
    // Taken back, as docs/releasing.md says: the old feed and installer put back, and the marker.
    writeFileSync(join(store, 'latest-mac.yml'), read(join(store, 'feeds/0.1.0/latest-mac.yml')));
    writeFileSync(join(store, 'feeds/0.1.1/withdrawn'), 'taken back');
    const run = publish('mac', '0.1.1');
    expect(run.status).toBe(1);
    expect(run.output).toContain('Factwright 0.1.1 was taken back');
    expect(run.uploads).toEqual([]);
    expect(read(join(store, 'latest-mac.yml'))).toContain('version: 0.1.0');
  });

  it('refuses a taken-back version even while its feed is still out', () => {
    build('mac', '0.1.1');
    expect(publish('mac', '0.1.1').status).toBe(0);
    writeFileSync(join(store, 'feeds/0.1.1/withdrawn'), 'taken back');
    const run = publish('mac', '0.1.1');
    expect(run.status).toBe(1);
    expect(run.output).toContain('Factwright 0.1.1 was taken back');
    expect(run.output).not.toContain('is out already');
  });

  it('stops before putting the feed up when the version is taken back while it publishes', () => {
    build('mac', '0.1.0');
    expect(publish('mac', '0.1.0').status).toBe(0);
    build('mac', '0.1.2');
    const run = publish('mac', '0.1.2', {
      MARKER_ON: 'Factwright.dmg',
      MARKER: 'feeds/0.1.2/withdrawn',
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain('Factwright 0.1.2 was taken back');
    expect(run.uploads).not.toContain('latest-mac.yml');
    expect(read(join(store, 'latest-mac.yml'))).toContain('version: 0.1.0');
  });

  it('refuses a folder that doesn’t hold the version’s feed and installer', () => {
    build('mac', '0.1.1');
    const other = publish('mac', '0.1.2');
    expect(other.status).toBe(1);
    expect(other.output).toContain("doesn't hold Factwright 0.1.2's latest-mac.yml");
    expect(other.uploads).toEqual([]);

    // The installer is the version's, but the feed names another.
    build('mac', '0.1.2');
    writeFileSync(join(dist, 'latest-mac.yml'), 'version: 0.1.1\n');
    const mixed = publish('mac', '0.1.2');
    expect(mixed.status).toBe(1);
    expect(mixed.uploads).toEqual([]);

    // The feed is the version's, but its installer is missing.
    build('mac', '0.1.2');
    rmSync(join(dist, 'Factwright-0.1.2.dmg'));
    const missing = publish('mac', '0.1.2');
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("doesn't hold Factwright 0.1.2's latest-mac.yml");
    expect(missing.uploads).toEqual([]);
  });

  it.each(['feeds/0.1.2/withdrawn', 'Factwright-0.1.2.dmg'])(
    'stops, rather than taking %s for missing, when it can’t check whether it’s up',
    (key) => {
      build('mac', '0.1.2');
      const run = publish('mac', '0.1.2', { HEAD_FAILS: key });
      expect(run.status).not.toBe(0);
      expect(run.output).toContain(`Couldn't check whether ${key} is up`);
      expect(run.uploads).toEqual([]);
    },
  );

  it('stops, rather than guessing what’s out, when it can’t read the update feed', () => {
    build('mac', '0.1.2');
    const run = publish('mac', '0.1.2', { FEED_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Couldn't read latest-mac.yml to see what's out");
    expect(run.uploads).toEqual([]);
  });

  it('stops when the update feed names no version', () => {
    build('mac', '0.1.2');
    writeFileSync(join(store, 'latest-mac.yml'), '<html>Just a moment…</html>');
    const run = publish('mac', '0.1.2');
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('latest-mac.yml is up, but names no version.');
    expect(run.uploads).toEqual([]);
  });

  it('never puts an older version out over a newer one, whatever line endings the feed has', () => {
    build('mac', '0.1.3');
    expect(publish('mac', '0.1.3').status).toBe(0);
    writeFileSync(
      join(store, 'latest-mac.yml'),
      'version: 0.1.3\r\npath: Factwright-0.1.3-mac.zip\r\n',
    );
    build('mac', '0.1.2');
    const run = publish('mac', '0.1.2');
    expect(run.status).toBe(1);
    expect(run.output).toContain(
      "Factwright 0.1.3 is out already, so 0.1.2 can't go out after it.",
    );
    expect(run.uploads).toEqual([]);
    expect(up('Factwright-0.1.2.dmg')).toBe(false);
  });

  it('fails when the update feed installed copies read doesn’t name the version it put out', () => {
    build('mac', '0.1.2');
    const run = publish('mac', '0.1.2', { STALE: '1' });
    expect(run.status).toBe(1);
    expect(run.output).not.toContain('Factwright 0.1.2 for mac is out.');
  });
});
