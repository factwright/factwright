import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_ASK, INBOX_FOLDER, INBOX_JOB, INBOX_LIMIT, readSavedJob } from '@factwright/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProfile,
  chooseProfile,
  FIRST_PROFILE,
  noteStarting,
  profileToOpen,
} from '../profiles.ts';

// The helper the extension saves through on this computer (apps/desktop/helper), built for
// the tests, which give it a data folder of their own, then run as the browser runs it: a message
// on stdin, an answer on stdout.

const DESKTOP = fileURLToPath(new URL('../../../', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version;
const WINDOWS = process.platform === 'win32';

/** The C compilers the build script looks for on each kind of computer, in its order. */
const COMPILERS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['clang'],
  win32: ['clang', 'gcc', 'cl'],
};

/** The C compiler the build script will use here, if there's one on PATH. */
const compiler = (COMPILERS[process.platform] ?? ['cc']).find((name) =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .some((folder) => folder !== '' && existsSync(join(folder, WINDOWS ? `${name}.exe` : name))),
);

/** The longest message the helper takes: 1 MiB. */
const MESSAGE_LIMIT = 1_048_576;

/** A job as the extension sends it. */
const JOB = {
  type: 'save',
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  company: 'Harbor & Pine',
  role: 'Senior Product Manager, Data',
  pay: '$165k–$190k',
  posting: 'About the role\n\nLead the data platform’s roadmap.',
};

/** A JSON Unicode escape, as text: a backslash, u, then the character's code in hex. */
const unicodeEscape = (code: string) => `\\u${code}`;

/** The byte order mark some editors put at the start of a file, which JSON doesn't take. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const LATER = { ok: true, later: true };
/** The job waits for an app that's open, but didn't answer in time. */
const LATER_OPEN = { ok: true, later: true, open: true };
const refused = (reason: string) => ({ ok: false, reason });

/** The helper, built for the tests, and the folder it's built in. */
let helper = '';
let builds = '';

/** The app's data folder, as the helper finds it: the first profile's. */
let home = '';

/**
 * A message as the browser sends it: its length, in four bytes in this computer's byte order,
 * which is little-endian on every computer Factwright runs on, then the message. A length can be
 * given that isn't the message's own.
 */
function framed(message: string | Buffer, length?: number): Buffer {
  const body = typeof message === 'string' ? Buffer.from(message) : message;
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length ?? body.length);
  return Buffer.concat([header, body]);
}

/** What the helper did: its answer, read from its frame, or null for none, and how it stopped. */
interface Ran {
  answer: unknown;
  status: number | null;
}

/** The answer in what the helper wrote, which must be one frame and nothing more. */
function answerIn(output: Buffer): unknown {
  if (output.length === 0) return null;
  expect(output.length).toBeGreaterThanOrEqual(4);
  expect(output.readUInt32LE(0)).toBe(output.length - 4);
  return JSON.parse(output.subarray(4).toString('utf8'));
}

/** Runs the helper as the browser does, with the arguments a browser passes. */
function run(input: Buffer, folder = home, args: string[] = []): Ran {
  const ran = spawnSync(helper, args, {
    input,
    env: { ...process.env, FACTWRIGHT_HELPER_HOME: folder },
    timeout: 20_000,
  });
  if (ran.error) throw ran.error;
  return { answer: answerIn(ran.stdout), status: ran.status };
}

/** Runs the helper while this process carries on, as the open app's stand-in has to. */
function runAlongside(input: Buffer): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { env: { ...process.env, FACTWRIGHT_HELPER_HOME: home } });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        resolve({ answer: answerIn(Buffer.concat(output)), status });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

const save = (job: object = JOB, folder = home) => run(framed(JSON.stringify(job)), folder);

const inboxOf = (folder: string) => join(folder, INBOX_FOLDER);

/** What's in a profile's inbox, or nothing when it has none. */
const inboxFiles = (folder: string) =>
  existsSync(inboxOf(folder)) ? readdirSync(inboxOf(folder)).sort() : [];

/** The jobs waiting in a profile's inbox. */
const jobsIn = (folder: string) => inboxFiles(folder).filter((name) => INBOX_JOB.test(name));

/** An added profile, as the app makes one, under an ID with letters in it. */
function addedProfile(id = 'abcdef012345'): string {
  const dir = join(home, 'Profiles', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profile.json'), JSON.stringify({ name: 'Sam' }, null, 2));
  return dir;
}

/** A link to a folder: a junction on Windows, which needs no administrator to make. */
const linkFolder = (target: string, link: string) => symlinkSync(target, link, 'junction');

/** A job whose posting has these bytes in it, as they are. */
function jobWithBytes(bytes: number[]): Buffer {
  const [before, after] = JSON.stringify(JOB).split('About the role');
  return Buffer.concat([Buffer.from(before ?? ''), Buffer.from(bytes), Buffer.from(after ?? '')]);
}

/**
 * Stands in for the open app: it marks the inbox with this process's ID, as the app marks it with
 * its own, and answers each job that comes, as the app does: its answer beside it, written whole,
 * then the job removed. It stops when what it gives back is called.
 */
function openApp(answer: string): () => void {
  const inbox = inboxOf(home);
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, '.listening'), String(process.pid));
  const timer = setInterval(() => {
    for (const file of readdirSync(inbox).filter((name) => INBOX_JOB.test(name))) {
      const name = file.slice(0, -'.json'.length);
      const draft = join(inbox, `.${name}.done.tmp`);
      writeFileSync(draft, answer);
      renameSync(draft, join(inbox, `${name}.done`));
      rmSync(join(inbox, file));
    }
  }, 10);
  return () => clearInterval(timer);
}

/** An ask as the extension sends one, to fill a form: the ask itself, as JSON, inside. */
const ASK = {
  type: 'ask',
  request: JSON.stringify({
    ask: 'fill',
    url: 'https://jobs.lever.co/harborpine/4f1c2b7e/apply',
    title: 'Harbor & Pine - Senior Product Manager, Data',
    fields: [],
  }),
};

/**
 * Stands in for the open app, for asks: it marks the inbox as the app does, and answers each ask
 * that comes, as the app does: it takes the ask away, then writes its answer beside it, whole, a
 * while later when a test says. What it took is kept, to check. It stops when what it gives back
 * is called.
 */
function answerAsks(answer: string, after = 0): { took: string[]; close: () => void } {
  const inbox = inboxOf(home);
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, '.listening'), String(process.pid));
  const took: string[] = [];
  const later: ReturnType<typeof setTimeout>[] = [];
  const timer = setInterval(() => {
    for (const file of readdirSync(inbox).filter((name) => INBOX_ASK.test(name))) {
      const name = file.slice(0, -'.ask'.length);
      took.push(readFileSync(join(inbox, file), 'utf8'));
      rmSync(join(inbox, file));
      const reply = () => {
        const draft = join(inbox, `.${name}.done.tmp`);
        writeFileSync(draft, answer);
        renameSync(draft, join(inbox, `${name}.done`));
      };
      if (after > 0) later.push(setTimeout(reply, after));
      else reply();
    }
  }, 10);
  return {
    took,
    close: () => {
      clearInterval(timer);
      for (const each of later) clearTimeout(each);
    },
  };
}

describe.skipIf(!compiler)(
  compiler
    ? 'the save helper'
    : 'the save helper, skipped: no C compiler (clang, gcc, cl or cc) is on PATH',
  () => {
    beforeAll(() => {
      builds = mkdtempSync(join(tmpdir(), 'factwright-helper-build-'));
      helper = join(builds, WINDOWS ? 'factwright-save.exe' : 'factwright-save');
      const built = spawnSync(
        process.execPath,
        ['scripts/build-helper.ts', '--testing', '--out', helper],
        { cwd: DESKTOP, encoding: 'utf8' },
      );
      if (built.status !== 0) {
        throw new Error(`The helper didn't build:\n${built.stdout}${built.stderr}`);
      }
    }, 120_000);

    afterAll(() => {
      if (builds) rmSync(builds, { recursive: true, force: true });
    });

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'factwright-helper-home-'));
    });

    afterEach(() => {
      rmSync(home, { recursive: true, force: true });
    });

    describe('a hello', () => {
      it('is answered with the app’s version, whatever the browser passes, touching nothing', () => {
        writeFileSync(join(home, 'profiles.json'), '{"open":"first"}');
        const hello = framed('{"type":"hello"}');
        // Chrome passes the extension's address, and on Windows its window. Firefox passes its
        // registration's path and the extension's ID.
        const chrome = [
          'chrome-extension://gjhjddlohoonikgdbfcfnljeffilblai/',
          '--parent-window=0',
        ];
        expect(run(hello, home, chrome)).toEqual({
          answer: { ok: true, version: VERSION },
          status: 0,
        });
        const firefox = ['/Library/com.factwright.save.json', 'save@factwright.com'];
        expect(run(hello, home, firefox).answer).toEqual({ ok: true, version: VERSION });
        expect(readdirSync(home)).toEqual(['profiles.json']);
        // It doesn't look for the data folder at all.
        expect(run(hello, join(home, 'missing')).answer).toEqual({ ok: true, version: VERSION });
      });

      it('may have spaces between its parts, as JSON allows', () => {
        expect(run(framed(' \r\n\t{ "type" :\n"hello" } \n')).answer).toEqual({
          ok: true,
          version: VERSION,
        });
      });
    });

    describe('a job', () => {
      it('goes into the first profile’s inbox exactly as it came, at once while the app is closed', () => {
        const message = Buffer.from(
          '{\n  "posting": "Lead the roadmap.",\n  "pay": "",\n  "type": "save", "role": "Staff Engineer",' +
            ' "company": "Northwind",\n "site": "northwind.example", "url": "https://northwind.example/jobs/7"\n}\n',
        );
        const before = Date.now();
        expect(run(framed(message))).toEqual({ answer: LATER, status: 0 });
        const after = Date.now();
        expect(after - before).toBeLessThan(2000);
        const [file, ...others] = inboxFiles(home);
        expect(others).toEqual([]);
        expect(file).toMatch(INBOX_JOB);
        const came = Number(INBOX_JOB.exec(file ?? '')?.[1]);
        expect(came).toBeGreaterThanOrEqual(before);
        expect(came).toBeLessThanOrEqual(after);
        const written = readFileSync(join(inboxOf(home), file ?? ''));
        expect(written.equals(message)).toBe(true);
        expect(readSavedJob(written.toString('utf8'))?.company).toBe('Northwind');
        if (!WINDOWS) {
          // Only the user can read the inbox and what's in it.
          expect(statSync(inboxOf(home)).mode & 0o777).toBe(0o700);
          expect(statSync(join(inboxOf(home), file ?? '')).mode & 0o777).toBe(0o600);
        }
      });

      it('takes JSON’s escapes and any character, and keeps them as they came', () => {
        // A character cut in half, as the extension's cut at the end of a long posting can leave
        // one, is an escape on its own, as Firefox writes it.
        const message = String.raw`{"type":"save","url":"https:\/\/jobs.example.com\/7","site":"jobs.example.com","company":"Caf${unicodeEscape('00e9')} \"Fleur\" & Co","role":"Engineer ${unicodeEscape('d83d')}${unicodeEscape('de80')}","pay":"${unicodeEscape('20AC')}90k\t${unicodeEscape('2013')}\t${unicodeEscape('20ac')}110k","posting":"Line one\nLine two\r\n\b\f\\ é 🚀 ✓ ${unicodeEscape('2028')} cut short ${unicodeEscape('d83d')}"}`;
        expect(run(framed(message)).answer).toEqual(LATER);
        const [file] = jobsIn(home);
        const written = readFileSync(join(inboxOf(home), file ?? ''));
        expect(written.equals(Buffer.from(message))).toBe(true);
        expect(readSavedJob(written.toString('utf8'))).toMatchObject({
          url: 'https://jobs.example.com/7',
          company: 'Café "Fleur" & Co',
          role: 'Engineer 🚀',
          pay: '€90k\t–\t€110k',
        });
      });

      it('may be up to 1 MiB, and one longer is too big, refused without reading it', () => {
        const empty = Buffer.byteLength(JSON.stringify({ ...JOB, posting: '' }));
        const longest = JSON.stringify({ ...JOB, posting: 'P'.repeat(MESSAGE_LIMIT - empty) });
        expect(Buffer.byteLength(longest)).toBe(MESSAGE_LIMIT);
        expect(run(framed(longest)).answer).toEqual(LATER);
        const [file] = jobsIn(home);
        expect(statSync(join(inboxOf(home), file ?? '')).size).toBe(MESSAGE_LIMIT);
        // The browser would send the rest, but the helper answers before reading any of it.
        expect(run(framed('', MESSAGE_LIMIT + 1))).toEqual({
          answer: refused('too-big'),
          status: 0,
        });
        expect(run(framed('', 0xffffffff)).answer).toEqual(refused('too-big'));
        expect(jobsIn(home)).toEqual([file]);
      });

      it('gets no answer when it’s empty, or the browser stops short', () => {
        for (const input of [
          Buffer.alloc(0),
          Buffer.from([1, 0]),
          framed(''),
          framed('{"type":"hello"}', 100),
        ]) {
          expect(run(input)).toEqual({ answer: null, status: 1 });
        }
        expect(readdirSync(home)).toEqual([]);
      });
    });

    describe('anything else', () => {
      const job = JSON.stringify(JOB);
      it.each<[string, string | Buffer]>([
        ['words', 'hello'],
        ['a string', '"hello"'],
        ['an array', JSON.stringify([JOB])],
        ['null', 'null'],
        ['an empty object', '{}'],
        ['junk after the job', `${job}x`],
        ['a second object after the job', `${job} {}`],
        ['a byte order mark', `${BYTE_ORDER_MARK}${job}`],
        ['a number', JSON.stringify({ ...JOB, pay: 165000 })],
        ['true', JSON.stringify({ ...JOB, pay: true })],
        ['false', JSON.stringify({ ...JOB, pay: false })],
        ['a null', JSON.stringify({ ...JOB, pay: null })],
        ['an array in the job', JSON.stringify({ ...JOB, posting: ['About the role'] })],
        ['an object in the job', JSON.stringify({ ...JOB, posting: { text: 'nested' } })],
        ['a key it doesn’t know', JSON.stringify({ ...JOB, cookies: 'session=1' })],
        ['a key twice', job.replace('"url":', '"url":"https://elsewhere.example","url":')],
        ['a type twice', '{"type":"hello","type":"hello"}'],
        ['a hello with more', '{"type":"hello","url":"https://example.com"}'],
        ['a key missing', JSON.stringify({ ...JOB, posting: undefined })],
        ['no type', JSON.stringify({ ...JOB, type: undefined })],
        ['a type alone', '{"type":"save"}'],
        ['a key with an escape', `{"t${unicodeEscape('0079')}pe":"hello"}`],
        ['a key with a capital', '{"Type":"hello"}'],
        ['an empty key', '{"":"x","type":"hello"}'],
        ['a type with an escape', `{"type":"h${unicodeEscape('0065')}llo"}`],
        ['a type it doesn’t know', '{"type":"load"}'],
        ['a type with a capital', '{"type":"Hello"}'],
        ['a comma at the end', '{"type":"hello",}'],
        ['single quotes', "{'type':'hello'}"],
        ['an unclosed object', '{"type":"hello"'],
        ['an unclosed string', '{"type":"hello}'],
        ['a control character as it is', job.replace('About the role', 'About\u0001the role')],
        ['an escape JSON doesn’t have', job.replace('About the role', String.raw`About \x role`)],
        ['a short Unicode escape', job.replace('About the role', String.raw`About \u12 role`)],
        ['a byte that isn’t UTF-8', jobWithBytes([0xff])],
        ['a stray continuation byte', jobWithBytes([0x80])],
        ['an overlong slash', jobWithBytes([0xc0, 0xaf])],
        ['an overlong three-byte form', jobWithBytes([0xe0, 0x80, 0xaf])],
        ['an overlong four-byte form', jobWithBytes([0xf0, 0x80, 0x80, 0xaf])],
        ['a surrogate in UTF-8', jobWithBytes([0xed, 0xa0, 0x80])],
        ['a character past U+10FFFF', jobWithBytes([0xf4, 0x90, 0x80, 0x80])],
        ['a character cut short', jobWithBytes([0xe2, 0x82])],
        ['a NUL byte', jobWithBytes([0x00])],
        ['an ask without its request', '{"type":"ask"}'],
        ['an ask with a job’s keys', JSON.stringify({ ...JOB, type: 'ask' })],
        ['an ask with more', '{"type":"ask","request":"{}","url":"https://example.com"}'],
        ['an ask whose request isn’t a string', '{"type":"ask","request":{"ask":"fill"}}'],
        ['a request with a save', JSON.stringify({ ...JOB, request: '{}' })],
      ])('is refused and writes nothing: %s', (_, message) => {
        expect(run(framed(message))).toEqual({ answer: refused('bad-message'), status: 0 });
        expect(readdirSync(home)).toEqual([]);
      });
    });

    describe('the profile a job goes to', () => {
      it('is the one open last, as the app notes it', () => {
        const sam = addProfile(home, 'Sam');
        chooseProfile(home, sam.id);
        expect(save().answer).toEqual(LATER);
        // While it's starting, as the app notes until its window shows.
        noteStarting(home, sam);
        expect(save().answer).toEqual(LATER);
        expect(profileToOpen(home).id).toBe(sam.id);
        expect(jobsIn(sam.dir)).toHaveLength(2);
        expect(existsSync(inboxOf(home))).toBe(false);
      });

      it('is the one profiles.json names last, among anything else, as JSON.parse reads it', () => {
        const sam = addedProfile();
        for (const note of [
          '{"open":"abcdef012345"}',
          '{"open":"first","open":"abcdef012345"}',
          ' {\n "kept": {"count": 1, "at": -1.5e3, "list": [true, false, null, "}", {}]},\n "open" : "abcdef012345"\n}\n',
        ]) {
          writeFileSync(join(home, 'profiles.json'), note);
          expect(profileToOpen(home).dir, note).toBe(sam);
          expect(save().answer, note).toEqual(LATER);
        }
        expect(jobsIn(sam)).toHaveLength(3);
        expect(existsSync(inboxOf(home))).toBe(false);
      });

      it('is the first when profiles.json names no profile it can use, as the app opens then', () => {
        const sam = addedProfile();
        const notes = [
          '',
          'not json',
          '{"open":"abcdef012345"',
          '{"open":"abcdef012345",}',
          '{"open":"abcdef012345"} {}',
          '["abcdef012345"]',
          '{"open":42}',
          '{"open":null}',
          '{"open":["abcdef012345"]}',
          '{"open":{"id":"abcdef012345"}}',
          '{"open":"ABCDEF012345"}',
          '{"open":" abcdef012345"}',
          `{"open":"abcdef01234${unicodeEscape('0035')}"}`,
          '{"open":"../../elsewhere"}',
          '{"open":"0123456789ab"}',
          '{"open":"abcdef012345","open":"first"}',
          '{"open":"abcdef012345","open":7}',
          '{"profile":"abcdef012345"}',
          `${BYTE_ORDER_MARK}{"open":"abcdef012345"}`,
        ];
        for (const note of notes) {
          writeFileSync(join(home, 'profiles.json'), note);
          // The app opens the first profile too, except where it reads an escape the app never
          // writes.
          if (!note.includes('\\')) expect(profileToOpen(home).id, note).toBe(FIRST_PROFILE);
          expect(save().answer, note).toEqual(LATER);
        }
        expect(jobsIn(home)).toHaveLength(notes.length);
        expect(inboxFiles(sam)).toEqual([]);
      });

      it('is never a profile folder that’s a link to one elsewhere, or one never finished', () => {
        const elsewhere = mkdtempSync(join(tmpdir(), 'factwright-helper-elsewhere-'));
        try {
          writeFileSync(join(elsewhere, 'profile.json'), JSON.stringify({ name: 'Linked' }));
          mkdirSync(join(home, 'Profiles'));
          linkFolder(elsewhere, join(home, 'Profiles', 'abcdefabcdef'));
          chooseProfile(home, 'abcdefabcdef');
          expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
          expect(save().answer).toEqual(LATER);
          expect(readdirSync(elsewhere)).toEqual(['profile.json']);
          // A folder without its profile.json was never finished.
          mkdirSync(join(home, 'Profiles', '0123456789ab'));
          chooseProfile(home, '0123456789ab');
          expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
          expect(save().answer).toEqual(LATER);
          expect(readdirSync(join(home, 'Profiles', '0123456789ab'))).toEqual([]);
          expect(jobsIn(home)).toHaveLength(2);
        } finally {
          rmSync(elsewhere, { recursive: true, force: true });
        }
      });
    });

    describe('the inbox', () => {
      it('is never a link to a folder elsewhere: the job fails, and nothing is written', () => {
        const elsewhere = mkdtempSync(join(tmpdir(), 'factwright-helper-elsewhere-'));
        try {
          linkFolder(elsewhere, inboxOf(home));
          expect(save()).toEqual({ answer: refused('failed'), status: 0 });
          expect(readdirSync(elsewhere)).toEqual([]);
        } finally {
          rmSync(elsewhere, { recursive: true, force: true });
        }
      });

      it('is never a file: the job fails, and the file is left as it was', () => {
        writeFileSync(inboxOf(home), 'not a folder');
        expect(save().answer).toEqual(refused('failed'));
        expect(readFileSync(inboxOf(home), 'utf8')).toBe('not a folder');
      });

      it('holds at most 200 jobs: one more is turned away, and nothing is written', () => {
        mkdirSync(inboxOf(home));
        for (let at = 0; at < INBOX_LIMIT - 1; at++) {
          const name = `${1760745600000 + at}-${at.toString(16).padStart(16, '0')}.json`;
          writeFileSync(join(inboxOf(home), name), '{}');
        }
        // Half-written jobs, answers and the app's marker aren't jobs.
        writeFileSync(join(inboxOf(home), '.1760745600000-0000000000000000.tmp'), '{');
        writeFileSync(join(inboxOf(home), '1760745600000-0000000000000000.done'), '{}');
        writeFileSync(join(inboxOf(home), '.listening'), '');
        expect(save().answer).toEqual(LATER);
        expect(jobsIn(home)).toHaveLength(INBOX_LIMIT);
        const before = inboxFiles(home);
        expect(save()).toEqual({ answer: refused('full'), status: 0 });
        expect(inboxFiles(home)).toEqual(before);
      });

      it('is nowhere when the app’s data folder isn’t there: Factwright never ran', () => {
        expect(save(JOB, join(home, 'Factwright'))).toEqual({
          answer: refused('no-factwright'),
          status: 0,
        });
        writeFileSync(join(home, 'Factwright'), 'not a folder');
        expect(save(JOB, join(home, 'Factwright')).answer).toEqual(refused('no-factwright'));
        expect(readdirSync(home)).toEqual(['Factwright']);
      });
    });

    describe('the open app', () => {
      it('has its answer passed on, which is then removed', async () => {
        const answers = [
          {
            ok: true,
            id: 'harbor-pine--senior-product-manager-data',
            already: false,
            posting: 'saved',
          },
          { ok: false, reason: 'failed', message: 'The job hunt couldn’t be saved.' },
        ];
        for (const answer of answers) {
          const close = openApp(`${JSON.stringify(answer, null, 2)}\n`);
          try {
            expect(await runAlongside(framed(JSON.stringify(JOB)))).toEqual({ answer, status: 0 });
          } finally {
            close();
          }
          expect(inboxFiles(home)).toEqual(['.listening']);
        }
      });

      it('is taken not to have answered when its answer can’t be passed on: the job waits for it, open', async () => {
        for (const answer of ['not JSON', '[1]', '{"ok":true', `{"id":"${'x'.repeat(4096)}"}`]) {
          const close = openApp(answer);
          try {
            expect((await runAlongside(framed(JSON.stringify(JOB)))).answer, answer).toEqual(
              LATER_OPEN,
            );
          } finally {
            close();
          }
          expect(inboxFiles(home)).toEqual(['.listening']);
        }
      });

      it('is waited for 3 seconds, and then the job waits for it, open, as one busy starting', () => {
        mkdirSync(inboxOf(home));
        writeFileSync(join(inboxOf(home), '.listening'), String(process.pid));
        const started = Date.now();
        expect(save().answer).toEqual(LATER_OPEN);
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(2900);
        expect(waited).toBeLessThan(10_000);
        expect(jobsIn(home)).toHaveLength(1);
      }, 20_000);

      it('isn’t waited for when its marker names no process that’s running', () => {
        const gone = spawnSync(process.execPath, ['-e', '']).pid;
        mkdirSync(inboxOf(home));
        const markers = [
          String(gone),
          '0',
          '-1',
          '',
          'not a number',
          `${process.pid}x`,
          '9'.repeat(20),
        ];
        for (const marker of markers) {
          writeFileSync(join(inboxOf(home), '.listening'), marker);
          const started = Date.now();
          expect(save().answer, marker).toEqual(LATER);
          expect(Date.now() - started, marker).toBeLessThan(2000);
        }
        expect(jobsIn(home)).toHaveLength(markers.length);
      }, 30_000);
    });

    describe('an ask', () => {
      const asks = () => inboxFiles(home).filter((name) => INBOX_ASK.test(name));

      it('finds no app when Factwright is closed, at once, and writes nothing', () => {
        const started = Date.now();
        expect(run(framed(JSON.stringify(ASK)))).toEqual({ answer: refused('closed'), status: 0 });
        expect(Date.now() - started).toBeLessThan(2000);
        expect(inboxFiles(home)).toEqual([]);
        // Nor when Factwright never ran here.
        const nowhere = join(home, 'never-ran');
        expect(run(framed(JSON.stringify(ASK)), nowhere).answer).toEqual(refused('closed'));
        expect(existsSync(nowhere)).toBe(false);
      });

      it('goes to the open app as it came, and has the app’s answer passed on, up to a part of a file', async () => {
        const part = { ok: true, did: 'file', part: 0, parts: 1, base64: 'A'.repeat(900_000) };
        for (const answer of [{ ok: true, did: 'remember', saved: 1 }, part]) {
          const app = answerAsks(JSON.stringify(answer));
          try {
            expect(await runAlongside(framed(JSON.stringify(ASK)))).toEqual({ answer, status: 0 });
          } finally {
            app.close();
          }
          expect(app.took).toEqual([JSON.stringify(ASK)]);
          expect(inboxFiles(home)).toEqual(['.listening']);
        }
      });

      it('says the app was busy when its answer can’t be passed on, and so when it’s over 1 MB', async () => {
        for (const [answer, reason] of [
          ['not JSON', 'busy'],
          ['[1]', 'busy'],
          [JSON.stringify({ base64: 'A'.repeat(1_000_000) }), 'too-big'],
        ] as const) {
          const app = answerAsks(answer);
          try {
            expect((await runAlongside(framed(JSON.stringify(ASK)))).answer).toEqual(
              refused(reason),
            );
          } finally {
            app.close();
          }
          expect(inboxFiles(home)).toEqual(['.listening']);
        }
      });

      it('waits as long again for an ask the app took, so its answer is passed on', async () => {
        const answer = { ok: true, did: 'sent', recorded: 3 };
        // The testing build waits 3 seconds, then takes back an ask the app hasn't taken.
        const app = answerAsks(JSON.stringify(answer), 4000);
        try {
          expect(await runAlongside(framed(JSON.stringify(ASK)))).toEqual({ answer, status: 0 });
        } finally {
          app.close();
        }
        expect(inboxFiles(home)).toEqual(['.listening']);
      }, 20_000);

      it('is taken back when the app doesn’t answer in time, so the app never acts on it', () => {
        mkdirSync(inboxOf(home));
        writeFileSync(join(inboxOf(home), '.listening'), String(process.pid));
        const started = Date.now();
        expect(run(framed(JSON.stringify(ASK))).answer).toEqual(refused('busy'));
        expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
        expect(asks()).toEqual([]);
        expect(jobsIn(home)).toEqual([]);
      }, 20_000);

      it('never counts as a job, nor waits behind 200 of them', async () => {
        mkdirSync(inboxOf(home));
        for (let n = 0; n < INBOX_LIMIT; n++) {
          writeFileSync(
            join(inboxOf(home), `1760745600000-${String(n).padStart(16, '0')}.json`),
            '{}',
          );
        }
        const app = answerAsks(JSON.stringify({ ok: true, did: 'remember', saved: 0 }));
        try {
          expect((await runAlongside(framed(JSON.stringify(ASK)))).answer).toEqual({
            ok: true,
            did: 'remember',
            saved: 0,
          });
        } finally {
          app.close();
        }
        expect(jobsIn(home)).toHaveLength(INBOX_LIMIT);
      }, 20_000);
    });
  },
);
