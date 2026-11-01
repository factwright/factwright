import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isNewerVersion, shortNotesProblem } from '../src/shared/whats-new.ts';
import { fullNotesFile, notesProblem, shortNotesFile } from './release-notes.ts';

const NOTES = fileURLToPath(new URL('../release-notes', import.meta.url));
const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/** The last version released without short notes, as it came before them. */
const LAST_WITHOUT_SHORT_NOTES = '0.18.1';

describe('a version’s notes', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'factwright-notes-'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  const write = (name: string, text: string) => writeFileSync(join(folder, name), text);

  it('will do with both files', () => {
    write(fullNotesFile('0.19.0'), 'Everything that changed.\n\n- A long line.\n');
    write(shortNotesFile('0.19.0'), '- A plain line.\n');
    expect(notesProblem('0.19.0', folder)).toBeNull();
  });

  it('says to write the notes first', () => {
    write(shortNotesFile('0.19.0'), '- A plain line.\n');
    expect(notesProblem('0.19.0', folder)).toBe(
      "Say what's new in apps/desktop/release-notes/0.19.0.md first.",
    );
    write(fullNotesFile('0.19.0'), '  \n');
    expect(notesProblem('0.19.0', folder)).toBe(
      "Say what's new in apps/desktop/release-notes/0.19.0.md first.",
    );
  });

  it('says to write the short notes first', () => {
    write(fullNotesFile('0.19.0'), 'Everything that changed.\n');
    expect(notesProblem('0.19.0', folder)).toBe(
      "Say what's new in a few plain lines in apps/desktop/release-notes/0.19.0.short.md first.",
    );
    write(shortNotesFile('0.19.0'), '\n');
    expect(notesProblem('0.19.0', folder)).toBe(
      "Say what's new in a few plain lines in apps/desktop/release-notes/0.19.0.short.md first.",
    );
  });

  it('won’t do with short notes that aren’t short', () => {
    write(fullNotesFile('0.19.0'), 'Everything that changed.\n');
    write(shortNotesFile('0.19.0'), 'A summary, not a list.\n');
    expect(notesProblem('0.19.0', folder)).toMatch(
      /^apps\/desktop\/release-notes\/0\.19\.0\.short\.md won't do\. Every line starts with/,
    );
  });
});

describe('the app’s own notes', () => {
  it('are all short enough', () => {
    const short = readdirSync(NOTES).filter((name) => name.endsWith('.short.md'));
    expect(short).toContain('0.19.0.short.md');
    for (const name of short) {
      expect(shortNotesProblem(readFileSync(join(NOTES, name), 'utf8')), name).toBeNull();
    }
  });

  // The version in package.json is the one the next tag releases, so this says so on the pull
  // request that sets it, before a tag would.
  it.runIf(isNewerVersion(APP_VERSION, LAST_WITHOUT_SHORT_NOTES))(
    'are there for the app’s version',
    () => {
      expect(notesProblem(APP_VERSION, NOTES)).toBeNull();
    },
  );
});

describe('release-check', () => {
  const check = (tag: string) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('release-check.ts', import.meta.url)), tag],
      {
        encoding: 'utf8',
      },
    );

  it('refuses a tag that doesn’t name the app’s version', () => {
    const { status, stderr } = check('v0.0.1');
    expect(status).toBe(1);
    expect(stderr).toContain(`doesn't match the app's version, ${APP_VERSION}`);
  });

  it('says whether the app’s own version can go out', () => {
    const problem = notesProblem(APP_VERSION, NOTES);
    const { status, stdout, stderr } = check(`v${APP_VERSION}`);
    if (problem) {
      expect(status).toBe(1);
      expect(stderr).toContain(problem);
    } else {
      expect(status).toBe(0);
      expect(stdout).toContain(`Releasing Factwright ${APP_VERSION}.`);
    }
  });
});
