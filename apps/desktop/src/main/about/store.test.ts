import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KINDS_FILE } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { NO_ANSWERS } from '../../shared/about.ts';
import { BEYOND_FILE, newProject } from '../../shared/beyond.ts';
import { addKind, changeKind, removeKind } from '../../shared/kinds.ts';
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
  store = new AboutStore({
    workspace: workspace(),
    starterDir,
    trash,
    today: () => '2026-10-12',
    now: () => new Date('2026-10-12T15:00:00.000Z'),
  });
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
    store.saveAnswers({ levels: ['entry'], looks: [{ layout: 'minimal', for: 'any' }] });
    const started = store.start();
    expect(started.startedOn).toBe('2026-10-12');
    expect(read('guide/rules.md')).toBe('# Binding rules\n');
    expect(read('searches/criteria.md')).toContain('- **Level:** Entry level.');
    expect(read('guide/templates.md')).toContain('| Minimal | `minimal` | any job |');
    // The page count follows the user's level, beside the starter's other rules.
    expect(json('guide/lint.json')).toEqual({ banned: [], maxPages: 1 });

    store.saveAnswers({ pages: 2, levels: ['senior'] });
    expect(json('guide/lint.json').maxPages).toBe(2);
    expect(read('searches/criteria.md')).toContain('- **Level:** Senior.');
  });

  it('lists the user’s templates in the profile, and names their own in the templates guide', () => {
    const navy = {
      id: 'navy-sidebar',
      name: 'Navy Sidebar',
      look: 'A navy column down the left.',
      own: true,
      stamp: '1',
    };
    const own = new AboutStore({
      workspace: workspace(),
      starterDir: join(root, 'starter'),
      trash,
      today: () => '2026-10-12',
      templates: () => [navy],
    });
    expect(store.profile().templates.map((each) => each.id)).toEqual(['classic', 'minimal']);
    expect(own.profile().templates).toEqual([navy]);
    own.saveAnswers({ looks: [{ layout: 'navy-sidebar', for: 'startup' }] });
    own.start();
    expect(read('guide/templates.md')).toContain(
      '| Navy Sidebar | `navy-sidebar` | Startups (the startup style) |',
    );
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

  it('keeps the kinds of job in their own file, which an older app’s answers never drop', () => {
    store.saveAnswers({ roles: ['Staff Engineer'], levels: ['senior'] });
    // With one kind, nothing new is written.
    expect(existsSync(join(workspace(), KINDS_FILE))).toBe(false);
    const added = addKind(store.answers(), 'Project manager', 'Developer');
    if (!added.ok) throw new Error(added.message);
    store.saveAnswers(added.changes);
    store.saveAnswers(
      changeKind(store.answers(), 'project-manager', { roles: ['Program Manager'] }),
    );
    expect(json(KINDS_FILE)).toEqual({
      first: { id: 'developer', name: 'Developer' },
      others: [
        {
          id: 'project-manager',
          name: 'Project manager',
          roles: ['Program Manager'],
          fields: [],
          levels: [],
          minPay: '',
          targetPay: '',
          payFilter: false,
        },
      ],
    });
    // answers.json stays as it was, with the first kind's answers.
    const saved = json('about-me/answers.json');
    expect(saved.roles).toEqual(['Staff Engineer']);
    expect(saved).not.toHaveProperty('otherKinds');
    expect(saved).not.toHaveProperty('firstKind');
    // An older app rewrites answers.json with only what it knows, and the kinds stay.
    writeFileSync(
      join(workspace(), 'about-me', 'answers.json'),
      JSON.stringify({ ...saved, roles: ['Principal Engineer'] }),
    );
    expect(store.answers()).toMatchObject({
      roles: ['Principal Engineer'],
      firstKind: { id: 'developer', name: 'Developer' },
      otherKinds: [{ id: 'project-manager', roles: ['Program Manager'] }],
    });
    // Back to one kind, the first keeps its name and id for next time.
    store.saveAnswers(removeKind(store.answers(), 'project-manager'));
    expect(json(KINDS_FILE)).toEqual({ first: { id: 'developer', name: 'Developer' }, others: [] });
    expect(store.answers().otherKinds).toEqual([]);
  });

  it('keeps what it doesn’t know in the kinds file, as a later version or a hand edit left it', () => {
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    const file = {
      first: { id: 'developer', name: 'Developer', color: 'blue' },
      others: [
        { id: 'pm', name: 'Project manager', roles: ['TPM'], rate: 'hourly' },
        { id: 'qa', name: 'QA lead', levels: ['principal-plus'] },
        { id: 'Bad Id', name: 'Broken' },
        { id: 'pm-2', name: 'project manager' },
      ],
      version: 2,
    };
    writeFileSync(join(workspace(), KINDS_FILE), JSON.stringify(file));
    expect(store.answers().otherKinds.map((kind) => kind.id)).toEqual(['pm', 'qa']);
    // Saving another answer leaves the file as it was.
    const before = read(KINDS_FILE);
    store.saveAnswers({ quiet: true });
    expect(read(KINDS_FILE)).toBe(before);
    // Changing one kind writes only what changed, over what was there.
    store.saveAnswers(changeKind(store.answers(), 'pm', { levels: ['senior'] }));
    expect(json(KINDS_FILE)).toEqual({
      first: { id: 'developer', name: 'Developer', color: 'blue' },
      others: [
        { id: 'pm', name: 'Project manager', roles: ['TPM'], rate: 'hourly', levels: ['senior'] },
        { id: 'qa', name: 'QA lead', levels: ['principal-plus'] },
        { id: 'Bad Id', name: 'Broken' },
        { id: 'pm-2', name: 'project manager' },
      ],
      version: 2,
    });
    // Removing a kind it read takes it out, and leaves the rest.
    store.saveAnswers(removeKind(store.answers(), 'pm'));
    expect(json(KINDS_FILE).others).toEqual([
      { id: 'qa', name: 'QA lead', levels: ['principal-plus'] },
      { id: 'Bad Id', name: 'Broken' },
      { id: 'pm-2', name: 'project manager' },
    ]);
  });

  it('leaves a first kind it can’t read as it is, while another kind changes', () => {
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    const long = 'A name far longer than this version keeps for a kind of job, from a later one';
    writeFileSync(
      join(workspace(), KINDS_FILE),
      JSON.stringify({ first: { id: 'lead', name: long }, others: [{ id: 'pm', name: 'PM' }] }),
    );
    store.saveAnswers(changeKind(store.answers(), 'pm', { levels: ['senior'] }));
    expect(json(KINDS_FILE).first).toEqual({ id: 'lead', name: long });
    expect(json(KINDS_FILE).others).toEqual([{ id: 'pm', name: 'PM', levels: ['senior'] }]);
  });

  it('keeps a kinds file that doesn’t read, and puts it aside only once there are kinds to save', () => {
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    writeFileSync(join(workspace(), KINDS_FILE), '{ "first": oops');
    store.saveAnswers({ roles: ['Staff Engineer'] });
    expect(read(KINDS_FILE)).toBe('{ "first": oops');
    const added = addKind(store.answers(), 'Project manager', 'Developer');
    if (!added.ok) throw new Error(added.message);
    store.saveAnswers(added.changes);
    expect(read('about-me/kinds-of-job-before-2026-10-12.json')).toBe('{ "first": oops');
    expect(json(KINDS_FILE).first).toEqual({ id: 'developer', name: 'Developer' });
  });

  it('keeps Beyond work in its own file, which an older app’s answers never drop', () => {
    store.saveAnswers({ roles: ['Staff Engineer'] });
    // With nothing told, there's no file.
    expect(existsSync(join(workspace(), BEYOND_FILE))).toBe(false);
    store.saveAnswers({
      addedProjects: [{ ...newProject('trailhead'), name: 'Trailhead', kind: 'product' }],
      interests: ['Trail running'],
    });
    store.saveAnswers({ projectChanges: [{ id: 'trailhead', showing: 'feature' }] });
    expect(json(BEYOND_FILE)).toEqual({
      projects: [
        { ...newProject('trailhead'), name: 'Trailhead', kind: 'product', showing: 'feature' },
      ],
      interests: ['Trail running'],
      projectsChanged: '2026-10-12T15:00:00.000Z',
    });
    const saved = json('about-me/answers.json');
    expect(saved).not.toHaveProperty('projects');
    expect(saved).not.toHaveProperty('interests');
    // An older app rewrites answers.json with only what it knows, and Beyond work stays.
    writeFileSync(
      join(workspace(), 'about-me', 'answers.json'),
      JSON.stringify({ ...saved, roles: ['Principal Engineer'] }),
    );
    expect(store.answers()).toMatchObject({
      roles: ['Principal Engineer'],
      projects: [{ id: 'trailhead', name: 'Trailhead', showing: 'feature' }],
      interests: ['Trail running'],
    });
    // What answers.json says about Beyond work, as after a hand edit, doesn't count.
    writeFileSync(
      join(workspace(), 'about-me', 'answers.json'),
      JSON.stringify({ ...saved, interests: ['Chess'], projects: [] }),
    );
    expect(store.answers().interests).toEqual(['Trail running']);
    expect(store.answers().projects).toHaveLength(1);
  });

  it('keeps what it doesn’t know in Beyond work’s file, and notes only when the projects change', () => {
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    const file = {
      projects: [
        { id: 'trailhead', name: 'Trailhead', stars: 5, kind: 'a-later-kind' },
        { id: 'Bad Id', name: 'Broken' },
        { id: 'club', name: 'Code Club' },
      ],
      interests: ['Chess'],
      pets: ['A dog'],
      projectsChanged: '2026-10-01T09:00:00.000Z',
    };
    writeFileSync(join(workspace(), BEYOND_FILE), JSON.stringify(file));
    expect(store.answers().projects.map((project) => [project.id, project.kind])).toEqual([
      ['trailhead', 'side'],
      ['club', 'side'],
    ]);
    // Saving another answer leaves the file as it was.
    const before = read(BEYOND_FILE);
    store.saveAnswers({ quiet: true });
    expect(read(BEYOND_FILE)).toBe(before);
    // A change to what isn't a project goes over the file, and the projects' date stays.
    store.saveAnswers({ learning: ['Spanish'] });
    expect(json(BEYOND_FILE)).toEqual({ ...file, learning: ['Spanish'] });
    // Changing one project writes only what changed, over what was there.
    store.saveAnswers({ projectChanges: [{ id: 'trailhead', when: '2023 to now' }] });
    expect(json(BEYOND_FILE)).toEqual({
      ...file,
      learning: ['Spanish'],
      projects: [
        { id: 'trailhead', name: 'Trailhead', stars: 5, kind: 'a-later-kind', when: '2023 to now' },
        { id: 'club', name: 'Code Club' },
        { id: 'Bad Id', name: 'Broken' },
      ],
      projectsChanged: '2026-10-12T15:00:00.000Z',
    });
    // Removing a project it read takes it out, and leaves the one it couldn't read.
    store.saveAnswers({ removedProjects: ['club'] });
    expect(json(BEYOND_FILE).projects).toEqual([
      { id: 'trailhead', name: 'Trailhead', stars: 5, kind: 'a-later-kind', when: '2023 to now' },
      { id: 'Bad Id', name: 'Broken' },
    ]);
  });

  it('keeps a Beyond work file that doesn’t read, and puts it aside only once there’s a change', () => {
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    writeFileSync(join(workspace(), BEYOND_FILE), '{ "projects": oops');
    store.saveAnswers({ roles: ['Staff Engineer'] });
    expect(read(BEYOND_FILE)).toBe('{ "projects": oops');
    store.saveAnswers({ interests: ['Chess'] });
    expect(read('about-me/beyond-work-before-2026-10-12.json')).toBe('{ "projects": oops');
    expect(json(BEYOND_FILE)).toEqual({ interests: ['Chess'] });
  });

  it('sets the page count by every kind of job’s levels', () => {
    store.start();
    const added = addKind(store.answers(), 'Analyst', 'Engineer');
    if (!added.ok) throw new Error(added.message);
    store.saveAnswers(added.changes);
    store.saveAnswers(changeKind(store.answers(), 'analyst', { levels: ['entry'] }));
    expect(json('guide/lint.json').maxPages).toBe(1);
  });

  it('gives criteria.md a section for each kind of job', () => {
    store.start();
    store.saveAnswers({ roles: ['Staff Engineer'], levels: ['senior'], workplaces: ['remote'] });
    const added = addKind(store.answers(), 'Project manager', 'Developer');
    if (!added.ok) throw new Error(added.message);
    store.saveAnswers(added.changes);
    store.saveAnswers(
      changeKind(store.answers(), 'project-manager', {
        roles: ['Program Manager'],
        levels: ['lead'],
      }),
    );
    const criteria = read('searches/criteria.md');
    expect(criteria).toContain('### Developer (`developer`)\n- **Level:** Senior.');
    expect(criteria).toContain(
      '### Project manager (`project-manager`)\n- **Level:** Lead or principal.',
    );
    expect(criteria).toContain('- **Where:** Remote.');
  });

  it('leaves a page count set by hand alone, until the user picks one or their level says', () => {
    mkdirSync(join(workspace(), 'guide'));
    writeFileSync(join(workspace(), 'guide', 'lint.json'), '{ "maxPages": 1 }');
    store.start();
    store.saveAnswers({ roles: ['Designer'] });
    expect(read('guide/lint.json')).toBe('{ "maxPages": 1 }');
    store.saveAnswers({ levels: ['senior'] });
    expect(json('guide/lint.json').maxPages).toBe(2);
  });

  it('writes the user’s own rules again only when the page count changes', () => {
    mkdirSync(join(workspace(), 'guide'));
    const own = '{\n  "_comment": "mine",\n  "maxPages": 2,\n  "cardWords": [16, 26]\n}\n';
    writeFileSync(join(workspace(), 'guide', 'lint.json'), own);
    store.saveAnswers({ levels: ['senior'] });
    store.start();
    expect(read('guide/lint.json')).toBe(own);
    store.saveAnswers({ pages: 1 });
    expect(json('guide/lint.json')).toEqual({ _comment: 'mine', maxPages: 1, cardWords: [16, 26] });
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

  it('takes a file off the list after the trash, without undoing changes saved meanwhile', async () => {
    store.addFile(upload('One.pdf'));
    store.addFile(upload('Two.pdf', new TextEncoder().encode('%PDF-1.7 two'), null));
    let release = () => {};
    trash.mockImplementationOnce(
      (path) =>
        new Promise<void>((resolve) => {
          release = () => {
            rmSync(path);
            resolve();
          };
        }),
    );
    const removing = store.removeFile('about-me/files/2026-10-12-one.pdf');
    store.saveAnswers({ you: { ...NO_ANSWERS.you, name: 'Jordan Avery' } });
    await vi.waitFor(() => expect(trash).toHaveBeenCalled());
    release();
    const answers = await removing;
    expect(answers.you.name).toBe('Jordan Avery');
    expect(answers.files.map((file) => file.name)).toEqual(['Two.pdf']);
  });

  it('takes LinkedIn’s spreadsheets, connections included, along with its data', async () => {
    store.addLinkedIn({
      tables: [
        { name: 'Connections.csv', text: 'First Name,Last Name\nSam,Lee\n' },
        { name: 'Profile.csv', text: 'Headline\nPM\n' },
      ],
      summary: '# LinkedIn data\n',
    });
    writeFileSync(join(workspace(), 'linkedin', 'mine.txt'), 'kept');
    await store.removeFile('about-me/files/linkedin-data.md');
    expect(existsSync(join(workspace(), 'linkedin', 'Connections.csv'))).toBe(false);
    expect(existsSync(join(workspace(), 'linkedin', 'Profile.csv'))).toBe(false);
    expect(read('linkedin/mine.txt')).toBe('kept');
    expect(store.profile().status.connections).toBeNull();
  });

  it('keeps as many files as it can carry, and says so after', () => {
    const many = Array.from({ length: 200 }, (_, n) => ({
      path: `about-me/files/2026-10-12-file-${n}.pdf`,
      name: `file-${n}.pdf`,
      kind: 'resume',
      added: '2026-10-12',
      textFile: null,
    }));
    mkdirSync(join(workspace(), 'about-me'), { recursive: true });
    writeFileSync(join(workspace(), 'about-me', 'answers.json'), JSON.stringify({ files: many }));
    expect(store.addFile(upload('One more.pdf'))).toEqual({
      ok: false,
      message: 'That’s as many files as Factwright keeps. Remove some first.',
    });
    expect(store.answers().files).toHaveLength(200);
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

  it('adds and removes the confidential names the user changed, keeping any Claude added', () => {
    expect(store.changeConfidential({ add: ['Bluebird', 'Acme (US)'], remove: [] })).toEqual([
      'Bluebird',
      'Acme (US)',
    ]);
    expect(read('guide/confidential-terms.txt')).toMatch(/\nBluebird\nAcme \\\(US\\\)\n$/);
    // Claude adds one while the user's list on screen is older.
    writeFileSync(
      join(workspace(), 'guide', 'confidential-terms.txt'),
      `${read('guide/confidential-terms.txt')}Project Kite\n`,
    );
    expect(store.changeConfidential({ add: ['Tidewater'], remove: ['bluebird'] })).toEqual([
      'Acme (US)',
      'Project Kite',
      'Tidewater',
    ]);
  });
});
