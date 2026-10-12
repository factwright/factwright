import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInTemplate, type Template, templateFile } from '@factwright/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from './templates.ts';

let root: string;
let trash: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let library: TemplateLibrary;

const classic = builtInTemplate('classic') as Template;
const navy: Template = { ...classic, id: 'navy', name: 'Navy Sidebar', css: '.hdr{color:navy}' };
const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = bytes('%PDF-1.7 a resume someone liked');

function save(id: string, text: string) {
  mkdirSync(join(root, 'templates'), { recursive: true });
  writeFileSync(join(root, 'templates', `${id}.json`), text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-templates-'));
  trash = vi.fn(async (path: string) => rmSync(path));
  library = new TemplateLibrary({ workspace: root, trash, today: () => '2026-10-12' });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('TemplateLibrary', () => {
  it('lists the app’s templates, then the user’s own by name, leaving out any that can’t be used', () => {
    save('zebra', templateFile({ ...navy, name: 'Zebra' }));
    save('navy', templateFile(navy));
    save('broken', '{ nope');
    save('classic', templateFile({ ...navy, name: 'Not the real Classic' }));
    save('Bad Name', templateFile(navy));
    writeFileSync(join(root, 'templates', 'notes.md'), 'not a template');
    expect(library.list().map(({ id, name, own }) => [id, name, own])).toEqual([
      ['classic', 'Classic', false],
      ['minimal', 'Minimal', false],
      ['navy', 'Navy Sidebar', true],
      ['zebra', 'Zebra', true],
    ]);
  });

  it('finds a template by its ID, built in or the user’s, and says why one can’t be used', () => {
    save('navy', templateFile(navy));
    save('broken', '{ nope');
    expect(library.find('classic')).toEqual({ ok: true, template: classic, stamp: '' });
    const found = library.find('navy');
    expect(found.ok && found.template).toEqual(navy);
    expect(library.find('gone')).toEqual({
      ok: false,
      missing: true,
      message: 'There’s no template “gone”. The user’s templates are classic, minimal, navy.',
    });
    expect(library.find('broken')).toEqual({
      ok: false,
      missing: false,
      message: 'templates/broken.json can’t be used: It isn’t valid JSON.',
    });
    expect(library.find('../classic')).toMatchObject({ ok: false, missing: true });
  });

  it('reads a template again once its file changes', () => {
    save('navy', templateFile(navy));
    const before = library.find('navy');
    save('navy', templateFile({ ...navy, name: 'Navy Sidebar, wider' }));
    const after = library.find('navy');
    expect(after.ok && after.template.name).toBe('Navy Sidebar, wider');
    expect(before.ok && after.ok && before.stamp !== after.stamp).toBe(true);
  });

  describe('add', () => {
    it('adds a template file under an ID from its name, and knows one it has already', () => {
      expect(library.add({ name: 'shared.json', bytes: bytes(templateFile(navy)) })).toEqual({
        ok: true,
        kind: 'template',
        id: 'navy-sidebar',
        name: 'Navy Sidebar',
        already: false,
      });
      expect(readFileSync(join(root, 'templates', 'navy-sidebar.json'), 'utf8')).toBe(
        templateFile(navy),
      );
      expect(library.add({ name: 'again.json', bytes: bytes(templateFile(navy)) })).toEqual({
        ok: true,
        kind: 'template',
        id: 'navy-sidebar',
        name: 'Navy Sidebar',
        already: true,
      });
      const other = templateFile({ ...navy, css: '.hdr{color:teal}' });
      expect(library.add({ name: 'other.json', bytes: bytes(other) })).toMatchObject({
        id: 'navy-sidebar-2',
        already: false,
      });
      const named = templateFile({ ...navy, name: 'Classic' });
      expect(library.add({ name: 'c.json', bytes: bytes(named) })).toMatchObject({
        id: 'classic-2',
      });
    });

    it('says why a file isn’t a template it can use', () => {
      expect(library.add({ name: 'x.json', bytes: bytes('{ nope') })).toEqual({
        ok: false,
        message: 'x.json isn’t a template file: it isn’t JSON.',
      });
      expect(library.add({ name: 'x.json', bytes: bytes('{"name": "x"}') })).toEqual({
        ok: false,
        message:
          'x.json can’t be used as a template. This isn’t a Factwright resume template: it needs "factwright": "resume-template".',
      });
      const unsafe = templateFile({ ...navy, body: '<img src="x">{{name}}' });
      expect(library.add({ name: 'x.json', bytes: bytes(unsafe) })).toMatchObject({
        ok: false,
        message: expect.stringContaining('<img> isn’t allowed'),
      });
      expect(existsSync(join(root, 'templates'))).toBe(false);
    });

    it('keeps a resume to copy the look of, under a name of its own, for Claude to read', () => {
      expect(library.add({ name: 'Nice Resume.PDF', bytes: PDF })).toEqual({
        ok: true,
        kind: 'copy',
        source: '2026-10-12-1.pdf',
      });
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
      expect(library.add({ name: 'photo.jpeg', bytes: jpeg })).toEqual({
        ok: true,
        kind: 'copy',
        source: '2026-10-12-2.jpg',
      });
      expect(readFileSync(join(root, 'templates', 'sources', '2026-10-12-1.pdf'))).toEqual(
        Buffer.from(PDF),
      );
      expect(library.hasSource('2026-10-12-2.jpg')).toBe(true);
      expect(library.hasSource('2026-10-12-3.pdf')).toBe(false);
      expect(library.hasSource('../2026-10-12-1.pdf')).toBe(false);
    });

    it('says what to do with a file Claude can’t copy a look from', () => {
      expect(library.add({ name: 'resume.docx', bytes: bytes('PK') })).toEqual({
        ok: false,
        message:
          'That’s a Word file, which Claude can’t see the look of. Open it and save it as a PDF, then pick the PDF.',
      });
      expect(library.add({ name: 'notes.txt', bytes: bytes('hi') })).toEqual({
        ok: false,
        message:
          'notes.txt isn’t a type this takes. Pick a PDF or a picture of a resume (PNG, JPEG or WebP), or a template file (.json).',
      });
      expect(library.add({ name: 'fake.pdf', bytes: bytes('<html>') })).toEqual({
        ok: false,
        message: 'fake.pdf doesn’t look like a .pdf file inside. Try saving it again.',
      });
      expect(library.add({ name: 'empty.png', bytes: new Uint8Array() })).toEqual({
        ok: false,
        message: 'empty.png is empty.',
      });
      for (const upload of [null, { name: 'a.pdf' }, { name: '', bytes: PDF }]) {
        expect(library.add(upload)).toEqual({ ok: false, message: 'That file couldn’t be added.' });
      }
    });
  });

  describe('save', () => {
    const file = (template: Template) => JSON.parse(templateFile(template));

    it('saves a template that passes the checks, and replaces one only when asked', async () => {
      expect(await library.save(file(navy), 'navy', false)).toEqual({
        ok: true,
        template: navy,
        replaced: false,
      });
      expect(library.has('navy')).toBe(true);
      expect(await library.save(file(navy), 'navy', false)).toEqual({
        ok: false,
        problems: [
          'templates/navy.json is there already. Pick another ID, or save with replace when this is the template to change.',
        ],
      });
      expect(await library.save(file({ ...navy, name: 'Navy 2' }), 'navy', true)).toMatchObject({
        ok: true,
        replaced: true,
      });
      expect(trash).not.toHaveBeenCalled();
    });

    it('puts the one it replaces in the trash, when asked to keep it', async () => {
      await library.save(file(navy), 'navy', false);
      await library.save(file({ ...navy, name: 'Navy 2' }), 'navy', true, true);
      expect(trash).toHaveBeenCalledWith(join(root, 'templates', 'navy.json'));
      const found = library.find('navy');
      expect(found.ok && found.template.name).toBe('Navy 2');
    });

    it('never takes a built-in template’s ID, or one that can’t name a file', async () => {
      expect(await library.save(file(navy), 'minimal', true)).toEqual({
        ok: false,
        problems: ['minimal is one of the app’s own templates. Give yours an ID of its own.'],
      });
      expect(await library.save(file(navy), '../navy', true)).toEqual({
        ok: false,
        problems: [
          '“../navy” can’t be a template’s ID: lowercase letters, digits and hyphens only.',
        ],
      });
      expect(await library.save({ ...file(navy), css: '</style>' }, 'navy', false)).toMatchObject({
        ok: false,
      });
      expect(existsSync(join(root, 'templates', 'navy.json'))).toBe(false);
      expect(library.has('classic')).toBe(false);
    });
  });

  it('puts the user’s own templates in the trash, and never the app’s', async () => {
    save('navy', templateFile(navy));
    expect(await library.remove('navy')).toEqual({ ok: true });
    expect(trash).toHaveBeenCalledWith(join(root, 'templates', 'navy.json'));
    expect(library.find('navy')).toMatchObject({ ok: false, missing: true });
    for (const id of ['classic', '../navy', 7]) {
      expect(await library.remove(id)).toEqual({
        ok: false,
        message: 'That template can’t be removed.',
      });
    }
  });
});
