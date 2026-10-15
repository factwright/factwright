import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { localDate, slug } from '@factwright/core';
import {
  builtInTemplate,
  MAX_TEMPLATE_BYTES,
  readTemplate,
  TEMPLATE_ID,
  TEMPLATES,
  type Template,
  templateFile,
} from '@factwright/engine';
import { LIMITS } from '@factwright/sync';
import type { EditResult } from '../../shared/api.ts';
import type { AddTemplateResult, TemplateInfo } from '../../shared/profile.ts';
import { TEMPLATE_SOURCE } from '../../shared/runs.ts';

/** Where the user's own templates are kept in the workspace: a file each, named by its ID. */
export const TEMPLATES_FOLDER = 'templates';

/** Where the resumes the user wants a template copied from are kept, for Claude to read. */
export const SOURCES_FOLDER = `${TEMPLATES_FOLDER}/sources`;

/** Where Claude's previews of a template are printed, for it to read. Hidden, so they don't sync. */
export const PREVIEWS_FOLDER = `${TEMPLATES_FOLDER}/.previews`;

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The kinds of file Claude can copy a look from, and how each one's bytes begin. */
const SOURCE_TYPES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  pdf: (b) => ascii(b, 0, 5) === '%PDF-',
  png: (b) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
};

/** Files people often have that Claude can't read, and what to do instead. */
const SAVE_AS: Readonly<Record<string, string>> = {
  docx: 'That’s a Word file, which Claude can’t see the look of. Open it and save it as a PDF, then pick the PDF.',
  doc: 'That’s a Word file, which Claude can’t see the look of. Open it and save it as a PDF, then pick the PDF.',
  pages: 'That’s a Pages file. In Pages, choose File → Export To → PDF, then pick the PDF.',
  heic: 'That’s an iPhone photo format. Save it as a JPEG or PNG, then pick that.',
};

type Read = { ok: true; template: Template } | { ok: false; problems: string[] };

export interface TemplateLibraryDeps {
  workspace: string;
  /** Moves a template the user removed to the system's trash. Tests delete it instead. */
  trash?: (path: string) => Promise<void>;
  today?: () => string;
}

/**
 * The templates a user can pick: the ones the app comes with, and their own, kept in the
 * workspace's templates folder, which syncs. Each of theirs is checked before it's used, since
 * it may have come from anywhere.
 */
export class TemplateLibrary {
  private readonly workspace: string;
  private readonly trash: (path: string) => Promise<void>;
  private readonly today: () => string;
  /** Each of the user's templates as last read, by ID, with the file's size and time. */
  private readonly reads = new Map<string, { stamp: string; read: Read }>();

  constructor(deps: TemplateLibraryDeps) {
    this.workspace = deps.workspace;
    this.trash = deps.trash ?? (async (path) => rmSync(path, { force: true }));
    this.today = deps.today ?? (() => localDate());
  }

  private file(id: string): string {
    return join(this.workspace, TEMPLATES_FOLDER, `${id}.json`);
  }

  /** Where Claude's preview of a template is printed, in the workspace. */
  previewPath(id: string): string {
    return `${PREVIEWS_FOLDER}/${id}.pdf`;
  }

  /** Where Claude's preview of a cover letter in a template is printed. No ID holds a dot. */
  letterPreviewPath(id: string): string {
    return `${PREVIEWS_FOLDER}/${id}.letter.pdf`;
  }

  /** The IDs of the user's own template files. None can take the ID of one the app has. */
  private ownIds(): string[] {
    let names: string[];
    try {
      names = readdirSync(join(this.workspace, TEMPLATES_FOLDER));
    } catch {
      return [];
    }
    return names
      .flatMap((name) => {
        const id = /^(.+)\.json$/.exec(name)?.[1];
        return id && TEMPLATE_ID.test(id) && !builtInTemplate(id) ? [id] : [];
      })
      .sort();
  }

  /** One of the user's templates from its file, read again only when the file changes. */
  private own(id: string): { stamp: string; read: Read } | null {
    const file = this.file(id);
    let stamp: string;
    try {
      const stats = statSync(file);
      if (!stats.isFile()) return null;
      stamp = `${Math.floor(stats.mtimeMs)}-${stats.size}`;
      if (stats.size > MAX_TEMPLATE_BYTES) {
        return { stamp, read: { ok: false, problems: ['It’s bigger than a template can be.'] } };
      }
    } catch {
      return null;
    }
    const known = this.reads.get(id);
    if (known?.stamp === stamp) return known;
    let read: Read;
    try {
      read = readTemplate(JSON.parse(readFileSync(file, 'utf8')), id);
    } catch {
      read = { ok: false, problems: ['It isn’t valid JSON.'] };
    }
    const entry = { stamp, read };
    this.reads.set(id, entry);
    return entry;
  }

  /** Every template the user can pick: the app's, then their own by name. */
  list(): TemplateInfo[] {
    const own = this.ownIds().flatMap((id): TemplateInfo[] => {
      const entry = this.own(id);
      if (!entry?.read.ok) return [];
      const { name, look } = entry.read.template;
      return [{ id, name, look, own: true, stamp: entry.stamp }];
    });
    return [
      ...TEMPLATES.map(({ id, name, look }) => ({ id, name, look, own: false, stamp: '' })),
      ...own.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    ];
  }

  /** A template by its ID, or why it can't be used, in words that say what to do. */
  find(
    id: string,
  ):
    | { ok: true; template: Template; stamp: string }
    | { ok: false; missing: boolean; message: string } {
    const builtIn = builtInTemplate(id);
    if (builtIn) return { ok: true, template: builtIn, stamp: '' };
    const entry = TEMPLATE_ID.test(id) ? this.own(id) : null;
    if (!entry) {
      const ids = this.list().map((each) => each.id);
      return {
        ok: false,
        missing: true,
        message: `There’s no template “${id}”. The user’s templates are ${ids.join(', ')}.`,
      };
    }
    if (!entry.read.ok) {
      return {
        ok: false,
        missing: false,
        message: `${TEMPLATES_FOLDER}/${id}.json can’t be used: ${entry.read.problems.join(' ')}`,
      };
    }
    return { ok: true, template: entry.read.template, stamp: entry.stamp };
  }

  /** A new template's ID, from its name: one no other template has. */
  private newId(name: string): string {
    const base = slug(name).slice(0, 40).replace(/-+$/, '') || 'template';
    const taken = new Set([...TEMPLATES.map((each) => each.id), ...this.ownIds()]);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** Writes a file whole or not at all. */
  private write(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    writeFileSync(temporary, contents);
    renameSync(temporary, path);
  }

  /**
   * Adds a file the user picked: a template file, added to their templates, or a resume whose
   * look they like, a PDF or a picture, kept for Claude to make a template from.
   */
  add(upload: unknown): AddTemplateResult {
    const refused = { ok: false, message: 'That file couldn’t be added.' } as const;
    if (typeof upload !== 'object' || upload === null) return refused;
    const { name, bytes } = upload as Record<string, unknown>;
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) return refused;
    if (!(bytes instanceof Uint8Array)) return refused;
    if (bytes.length === 0) return { ok: false, message: `${name} is empty.` };
    const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
    if (extension === 'json') return this.addTemplate(name, bytes);
    const instead = SAVE_AS[extension];
    if (instead) return { ok: false, message: instead };
    const looks = SOURCE_TYPES[extension];
    if (!looks) {
      return {
        ok: false,
        message: `${name} isn’t a type this takes. Pick a PDF or a picture of a resume (PNG, JPEG or WebP), or a template file (.json).`,
      };
    }
    if (bytes.length > LIMITS.fileBytes)
      return { ok: false, message: `${name} is bigger than 25 MB.` };
    if (!looks(bytes)) {
      return {
        ok: false,
        message: `${name} doesn’t look like a .${extension} file inside. Try saving it again.`,
      };
    }
    return this.addSource(extension === 'jpeg' ? 'jpg' : extension, bytes);
  }

  /** Adds a template file, unless the user has the same one already. */
  private addTemplate(name: string, bytes: Uint8Array): AddTemplateResult {
    if (bytes.length > MAX_TEMPLATE_BYTES) {
      return { ok: false, message: `${name} is bigger than a template can be: 2 MB.` };
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return { ok: false, message: `${name} isn’t a template file: it isn’t JSON.` };
    }
    const read = readTemplate(value, 'new');
    if (!read.ok) {
      return {
        ok: false,
        message: `${name} can’t be used as a template. ${read.problems.slice(0, 3).join(' ')}`,
      };
    }
    // A template's file leaves out its ID, so the same template reads the same under any.
    const text = templateFile(read.template);
    for (const id of this.ownIds()) {
      const entry = this.own(id);
      if (entry?.read.ok && templateFile(entry.read.template) === text) {
        return { ok: true, kind: 'template', id, name: entry.read.template.name, already: true };
      }
    }
    const id = this.newId(read.template.name);
    this.write(this.file(id), text);
    return { ok: true, kind: 'template', id, name: read.template.name, already: false };
  }

  /** Keeps a resume to copy the look of, under a name of the app's own. */
  private addSource(extension: string, bytes: Uint8Array): AddTemplateResult {
    const folder = join(this.workspace, ...SOURCES_FOLDER.split('/'));
    mkdirSync(folder, { recursive: true });
    // Numbered across file types, so each one's name says which it is on its own.
    const taken = new Set(readdirSync(folder).map((name) => name.replace(/\.[^.]*$/, '')));
    for (let n = 1; n < 1000; n++) {
      if (taken.has(`${this.today()}-${n}`)) continue;
      const source = `${this.today()}-${n}.${extension}`;
      try {
        writeFileSync(join(folder, source), bytes, { flag: 'wx' });
        return { ok: true, kind: 'copy', source };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return { ok: false, message: 'That file couldn’t be added. Try again.' };
  }

  /** Whether a resume to copy is in the workspace, by the name the app gave it. */
  hasSource(source: string): boolean {
    return (
      TEMPLATE_SOURCE.test(source) &&
      existsSync(join(this.workspace, ...SOURCES_FOLDER.split('/'), source))
    );
  }

  /** Whether the user has a template of their own by this ID. */
  has(id: string): boolean {
    return TEMPLATE_ID.test(id) && !builtInTemplate(id) && existsSync(this.file(id));
  }

  /**
   * Saves a template Claude made or changed, once it passes the checks. It never takes the ID
   * of one the app has, nor replaces one of the user's unless asked to. With keepOld, the one it
   * replaces goes to the trash, to restore.
   */
  async save(
    value: unknown,
    id: string,
    replace: boolean,
    keepOld = false,
  ): Promise<
    { ok: true; template: Template; replaced: boolean } | { ok: false; problems: string[] }
  > {
    if (!TEMPLATE_ID.test(id)) {
      return {
        ok: false,
        problems: [`“${id}” can’t be a template’s ID: lowercase letters, digits and hyphens only.`],
      };
    }
    if (builtInTemplate(id)) {
      return {
        ok: false,
        problems: [`${id} is one of the app’s own templates. Give yours an ID of its own.`],
      };
    }
    const there = existsSync(this.file(id));
    if (there && !replace) {
      return {
        ok: false,
        problems: [
          `${TEMPLATES_FOLDER}/${id}.json is there already. Pick another ID, or save with replace when this is the template to change.`,
        ],
      };
    }
    const read = readTemplate(value, id);
    if (!read.ok) return read;
    const text = templateFile(read.template);
    if (Buffer.byteLength(text) > MAX_TEMPLATE_BYTES) {
      return {
        ok: false,
        problems: ['It’s bigger than a template can be: 2 MB, with its pictures and fonts.'],
      };
    }
    if (there && keepOld) await this.trash(this.file(id));
    this.write(this.file(id), text);
    return { ok: true, template: read.template, replaced: there };
  }

  /** Puts one of the user's own templates in the trash. The app's own can't be removed. */
  async remove(id: unknown): Promise<EditResult> {
    if (typeof id !== 'string' || !TEMPLATE_ID.test(id) || builtInTemplate(id)) {
      return { ok: false, message: 'That template can’t be removed.' };
    }
    const file = this.file(id);
    if (existsSync(file)) await this.trash(file);
    this.reads.delete(id);
    return { ok: true };
  }
}
