import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { NO_ANSWERS } from '../../shared/about.ts';
import { AboutStore } from './store.ts';
import type { CheckedUpload } from './uploads.ts';

let root: string;
let store: AboutStore;
let trash: Mock<(path: string) => Promise<void>>;
const workspace = () => join(root, 'workspace');
const read = (path: string) => readFileSync(join(workspace(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path));

const PDF = new TextEncoder().encode('%PDF-1.7 a made-up resume');
const upload = (
  name: string,
  bytes = PDF,
  text: string | null = 'Jordan Avery',
): CheckedUpload => ({
  name,
  kind: 'resume',
  extension: name.split('.').at(-1) ?? '',
  bytes,
  text,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-about-'));
  const starterDir = join(root, 'starter');
  mkdirSync(join(starterDir, 'guide'), { recursive: true });
  writeFileSync(join(starterDir, 'guide', 'rules.md'), '# Binding rules\n');
  writeFileSync(join(starterDir, 'guide', 'lint.json'), '{ "banned": [] }\n');
  mkdirSync(workspace());
  trash = vi.fn(async (path: string) => {
    rmSync(path);
  });
  store = new AboutStore({ workspace: workspace(), starterDir, trash, today: () => '2026-10-12' });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('AboutStore', () => {
  it('saves the answers, and nothing built from them until Claude has them', () => {
    expect(store.answers()).toEqual(NO_ANSWERS);
    const answers = store.saveAnswers({ roles: ['Product Designer'], step: 2 });
    expect(answers.roles).toEqual(['Product Designer']);
    expect(json('about-me/answers.json').step).toBe(2);
    expect(existsSync(join(workspace(), 'searches', 'criteria.md'))).toBe(false);
  });

  it('gets the workspace ready for Claude, then keeps the files built from the answers in step', () => {
    store.saveAnswers({ levels: ['entry'], looks: [{ layout: 'compact', for: 'any' }] });
    const started = store.start();
    expect(started.startedOn).toBe('2026-10-12');
    expect(read('guide/rules.md')).toBe('# Binding rules\n');
    expect(read('searches/criteria.md')).toContain('- **Level:** Entry level.');
    expect(read('guide/templates.md')).toContain('| Compact | `compact` | any job |');
    // The page count follows the user's level, beside the starter's other rules.
    expect(json('guide/lint.json')).toEqual({ banned: [], maxPages: 1 });

    store.saveAnswers({ pages: 2, levels: ['senior'] });
    expect(json('guide/lint.json').maxPages).toBe(2);
    expect(read('searches/criteria.md')).toContain('- **Level:** Senior.');
  });

  it('leaves files someone changed by hand as they are, until the user picks their answers', () => {
    store.start();
    writeFileSync(join(workspace(), 'searches', 'criteria.md'), '# My own criteria\n');
    store.saveAnswers({ levels: ['senior'] });
    expect(read('searches/criteria.md')).toBe('# My own criteria\n');
    expect(store.profile().status.criteria).toBe('own');

    store.useAnswersForCriteria();
    expect(read('searches/criteria.md')).toContain('- **Level:** Senior.');
    expect(read('searches/criteria-before-2026-10-12.md')).toBe('# My own criteria\n');
    expect(store.profile().status.criteria).toBe('app');
  });

  it('leaves the user’s own rules be when they don’t parse', () => {
    mkdirSync(join(workspace(), 'guide'));
    writeFileSync(join(workspace(), 'guide', 'lint.json'), '{ not json');
    store.start();
    expect(read('guide/lint.json')).toBe('{ not json');
  });

  it('keeps the notes, up to their limit', () => {
    store.saveNotes('I lead the platform team.');
    expect(store.notes()).toBe('I lead the platform team.');
    expect(() => store.saveNotes('x'.repeat(200_001))).toThrow();
  });

  it('keeps each shared file once, with the text read out of it beside it', () => {
    const first = store.addFile(upload('Resume 2024.pdf'));
    expect(first).toEqual({
      ok: true,
      file: {
        path: 'about-me/files/2026-10-12-resume-2024.pdf',
        name: 'Resume 2024.pdf',
        kind: 'resume',
        added: '2026-10-12',
        textFile: 'about-me/files/2026-10-12-resume-2024.pdf.md',
      },
    });
    expect(read('about-me/files/2026-10-12-resume-2024.pdf.md')).toMatch(/Jordan Avery\n$/);
    // The same file again is the same file.
    expect(store.addFile(upload('Copy of resume.pdf'))).toEqual(first);
    // Another file by the same name gets its own.
    const other = store.addFile(
      upload('Resume 2024.pdf', new TextEncoder().encode('%PDF-1.7 another'), null),
    );
    expect(other).toMatchObject({
      ok: true,
      file: { path: 'about-me/files/2026-10-12-resume-2024-2.pdf', textFile: null },
    });
    expect(store.answers().files).toHaveLength(2);
  });

  it('moves a removed file and its text to the trash', async () => {
    store.addFile(upload('Resume.pdf'));
    const answers = await store.removeFile('about-me/files/2026-10-12-resume.pdf');
    expect(answers.files).toEqual([]);
    expect(trash).toHaveBeenCalledTimes(2);
    expect(existsSync(join(workspace(), 'about-me', 'files', '2026-10-12-resume.pdf'))).toBe(false);
    // A file that isn't on the list stays where it is.
    expect((await store.removeFile('facts/profile.md')).files).toEqual([]);
    expect(trash).toHaveBeenCalledTimes(2);
  });

  it('keeps LinkedIn’s spreadsheets in linkedin/, and one summary for Claude', () => {
    store.addLinkedIn({
      tables: [{ name: 'Connections.csv', text: 'First Name,Last Name\nSam,Lee\n' }],
      summary: '# LinkedIn data\n',
    });
    store.addLinkedIn({
      tables: [{ name: 'Connections.csv', text: 'First Name,Last Name\nSam,Lee\nAna,Diaz\n' }],
      summary: '# LinkedIn data, again\n',
    });
    expect(read('about-me/files/linkedin-data.md')).toBe('# LinkedIn data, again\n');
    expect(store.answers().files.filter((file) => file.kind === 'linkedin-data')).toHaveLength(1);
    expect(store.profile().status.connections).toEqual({ count: 2, added: '2026-10-12' });
  });

  it('saves the confidential names, keeping the patterns Claude wrote', () => {
    expect(store.saveConfidential(['Bluebird', 'Acme (US)'])).toEqual(['Bluebird', 'Acme (US)']);
    expect(read('guide/confidential-terms.txt')).toMatch(/\nBluebird\nAcme \\\(US\\\)\n$/);
  });
});
