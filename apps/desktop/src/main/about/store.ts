import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KINDS_FILE, type KindName, localDate } from '@factwright/core';
import { TEMPLATES } from '@factwright/engine';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  applyChanges,
  FILES_FOLDER,
  type JobKind,
  pagesFor,
  readAnswers,
  type SharedFile,
} from '../../shared/about.ts';
import {
  BEYOND_FILE,
  BEYOND_KEYS,
  type BeyondWork,
  beyondFileWith,
  beyondOf,
  localTime,
} from '../../shared/beyond.ts';
import { criteriaMarkdown } from '../../shared/criteria.ts';
import { templatesMarkdown } from '../../shared/looks.ts';
import {
  type AddFileResult,
  LINKEDIN_TABLES,
  type LinkedInUpload,
  type Profile,
  type TemplateInfo,
} from '../../shared/profile.ts';
import { untouched } from '../../shared/stamp.ts';
import { FactBankFiles } from './facts.ts';
import { copyStarter } from './starter.ts';
import { ABOUT, hasFactBank, profileStatus } from './status.ts';
import { termsIn, withTerms } from './terms.ts';
import { type CheckedUpload, fingerprint, keptName } from './uploads.ts';

export interface AboutStoreDeps {
  workspace: string;
  /** The plugin's starter files, which a new workspace starts with. */
  starterDir: string;
  /** Moves a file the user removed to the system's trash. Tests delete it instead. */
  trash?: (path: string) => Promise<void>;
  today?: () => string;
  /** Now, for noting when the projects changed. Tests pass their own. */
  now?: () => Date;
  /** The templates the user can pick, built in and their own. Without it, the built-in ones. */
  templates?: () => TemplateInfo[];
}

const BUILT_IN = (): TemplateInfo[] =>
  TEMPLATES.map(({ id, name, look }) => ({ id, name, look, own: false, stamp: '' }));

/** A JSON object's fields, or none for anything else. */
const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Whether two values say the same, as JSON. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A file's JSON object, or null when it isn't one. */
function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Where LinkedIn's spreadsheets are kept, and the summary Claude reads. */
const LINKEDIN_FOLDER = 'linkedin';
const LINKEDIN_SUMMARY = `${FILES_FOLDER}/linkedin-data.md`;

/**
 * What the user tells Factwright about themselves, kept in the workspace's about-me folder: their
 * answers, their notes and the files they share. Once Claude has their answers, the files built
 * from them follow every change: the search criteria, the resume templates and length, and the
 * confidential names.
 */
export class AboutStore {
  private readonly workspace: string;
  private readonly starterDir: string;
  private readonly trash: (path: string) => Promise<void>;
  private readonly today: () => string;
  private readonly now: () => Date;
  private readonly templates: () => TemplateInfo[];
  /** The fact bank's files, which the user reads and changes on its own page. */
  readonly facts: FactBankFiles;

  constructor(deps: AboutStoreDeps) {
    this.workspace = deps.workspace;
    this.starterDir = deps.starterDir;
    this.trash = deps.trash ?? (async (path) => rmSync(path, { force: true }));
    this.today = deps.today ?? (() => localDate());
    this.now = deps.now ?? (() => new Date());
    this.templates = deps.templates ?? BUILT_IN;
    this.facts = new FactBankFiles({
      workspace: this.workspace,
      name: () => this.answers().you.name,
      today: this.today,
    });
  }

  private path(file: string): string {
    return join(this.workspace, ...file.split('/'));
  }

  private read(file: string): string | null {
    try {
      return readFileSync(this.path(file), 'utf8');
    } catch {
      return null;
    }
  }

  /** Writes a file whole or not at all, and only when its contents change. */
  private write(file: string, contents: string | Uint8Array): void {
    const target = this.path(file);
    if (typeof contents === 'string' && this.read(file) === contents) return;
    mkdirSync(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
    writeFileSync(temporary, contents);
    renameSync(temporary, target);
  }

  /** A JSON file's object, or nothing when it's missing or doesn't parse. */
  private readJson(file: string): Record<string, unknown> {
    return jsonObject(this.read(file) ?? '{}') ?? {};
  }

  /** Keeps a file's old contents beside it, as <name>-before-<date>, numbered after the first. */
  private keepOld(file: string, contents: string): void {
    const dot = file.lastIndexOf('.');
    const stem = dot > file.lastIndexOf('/') ? file.slice(0, dot) : file;
    const extension = file.slice(stem.length);
    let name = `${stem}-before-${this.today()}${extension}`;
    for (let n = 2; this.read(name) !== null; n++) {
      name = `${stem}-before-${this.today()}-${n}${extension}`;
    }
    this.write(name, contents);
  }

  /** The answers, with the kinds of job and Beyond work from their own files. */
  answers(): AboutYou {
    const { first, others } = this.readJson(KINDS_FILE);
    const beyond = this.readJson(BEYOND_FILE);
    return readAnswers({
      ...this.readJson(ABOUT.answers),
      firstKind: first ?? null,
      otherKinds: others ?? [],
      // Only what Beyond work's file holds: none of it is kept in answers.json.
      ...Object.fromEntries(BEYOND_KEYS.map((key) => [key, beyond[key]])),
    });
  }

  private saveAll(answers: AboutYou): AboutYou {
    const { firstKind, otherKinds, ...rest } = answers;
    const kept = Object.fromEntries(
      Object.entries(rest).filter(([key]) => !(BEYOND_KEYS as readonly string[]).includes(key)),
    );
    this.write(ABOUT.answers, `${JSON.stringify(kept, null, 2)}\n`);
    this.saveKinds(firstKind, otherKinds);
    this.saveBeyond(beyondOf(answers));
    if (this.inUse(answers)) this.writeDerived(answers);
    return answers;
  }

  /**
   * Writes Beyond work to its file once there's something in it, and only when it changes, and
   * then only what changed goes over the file, so what this version doesn't know stays. A file
   * that doesn't read stays as it is until there's a change to save, and then it's kept beside it.
   */
  private saveBeyond(beyond: BeyondWork): void {
    const text = this.read(BEYOND_FILE);
    const raw = text === null ? {} : jsonObject(text);
    const before = beyondOf(this.answers());
    const file = beyondFileWith(raw ?? {}, before, beyond, localTime(this.now()));
    if (file === null) return;
    if (raw === null) this.keepOld(BEYOND_FILE, text as string);
    this.write(BEYOND_FILE, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * Writes the kinds of job to their file once there's a second kind, and keeps it after, so the
   * first's id holds steady for its jobs. It's written only when they change, and then only what
   * changed goes over the file, so what this version doesn't know stays: fields a later version
   * added, values it reads differently, and kinds it can't read, such as one past as many as it
   * keeps. A file that doesn't read stays as it is until there are kinds to save, and then it's
   * kept beside them.
   */
  private saveKinds(firstKind: KindName | null, otherKinds: readonly JobKind[]): void {
    const text = this.read(KINDS_FILE);
    if (text === null && !firstKind) return;
    // As this version read the file before the change.
    const before = this.answers();
    if (same(before.firstKind, firstKind) && same(before.otherKinds, otherKinds)) return;
    const raw = text === null ? {} : jsonObject(text);
    if (raw === null) this.keepOld(KINDS_FILE, text as string);
    const kept = raw ?? {};
    const rawOthers = Array.isArray(kept.others) ? (kept.others as unknown[]) : [];
    // Kinds this version read from the file: one of those left out was removed.
    const read = new Set(before.otherKinds.map((kind) => kind.id));
    const ours = new Set(otherKinds.map((kind) => kind.id));
    // What changed of a kind since it was read, all of it for a kind that's new.
    const changes = (kind: object, was: object | null | undefined) =>
      Object.fromEntries(
        Object.entries(kind).filter(
          ([key, value]) => !was || !same(value, (was as Record<string, unknown>)[key]),
        ),
      );
    const others = [
      ...otherKinds.map((kind) => ({
        ...fieldsOf(rawOthers.find((entry) => fieldsOf(entry).id === kind.id)),
        ...changes(
          kind,
          before.otherKinds.find((each) => each.id === kind.id),
        ),
        id: kind.id,
      })),
      ...rawOthers.filter((entry) => {
        const { id } = fieldsOf(entry);
        return !(typeof id === 'string' && (read.has(id) || ours.has(id)));
      }),
    ];
    // The first kind is left as the file has it unless it changed, as one this version can't
    // read stands in for while it reads the file.
    const first = !firstKind
      ? (kept.first ?? null)
      : same(before.firstKind, firstKind)
        ? (kept.first ?? firstKind)
        : { ...fieldsOf(kept.first), ...changes(firstKind, before.firstKind) };
    this.write(KINDS_FILE, `${JSON.stringify({ ...kept, first, others }, null, 2)}\n`);
  }

  /** Saves the window's changes, already checked, and answers with all the answers. */
  saveAnswers(changes: AnswerChanges): AboutYou {
    return this.saveAll(applyChanges(this.answers(), changes));
  }

  notes(): string {
    return this.read(ABOUT.notes) ?? '';
  }

  saveNotes(text: string): void {
    if (text.length > ANSWER_LIMITS.notes) throw new Error('Those notes are too long to save.');
    this.write(ABOUT.notes, text);
  }

  confidential(): string[] {
    return termsIn(this.read(ABOUT.terms));
  }

  /**
   * Adds and removes confidential names as the user changed them. Names Claude added since the
   * user's list was read stay, and every pattern Claude wrote keeps its exact line.
   */
  changeConfidential({
    add,
    remove,
  }: {
    add: readonly string[];
    remove: readonly string[];
  }): string[] {
    const gone = new Set(remove.map((name) => name.trim().toLowerCase()));
    const kept = this.confidential().filter((name) => !gone.has(name.toLowerCase()));
    this.write(ABOUT.terms, withTerms(this.read(ABOUT.terms), [...kept, ...add]));
    return this.confidential();
  }

  /** Keeps a shared file, and the text read out of it, in about-me/files. Each file is kept once. */
  addFile(upload: CheckedUpload): AddFileResult {
    const answers = this.answers();
    if (answers.files.length >= ANSWER_LIMITS.files) {
      return { ok: false, message: 'That’s as many files as Factwright keeps. Remove some first.' };
    }
    const print = fingerprint(upload.bytes);
    const same = answers.files.find((file) => {
      try {
        return fingerprint(readFileSync(this.path(file.path))) === print;
      } catch {
        return false;
      }
    });
    if (same) return { ok: true, file: same };
    const today = this.today();
    let name = keptName(upload.name, upload.extension, today);
    for (let n = 2; this.read(`${FILES_FOLDER}/${name}`) !== null; n++) {
      name = keptName(upload.name, upload.extension, today).replace(/(\.[a-z0-9]+)$/, `-${n}$1`);
    }
    const path = `${FILES_FOLDER}/${name}`;
    this.write(path, upload.bytes);
    const text = upload.text?.trim();
    const textFile = text ? `${path}.md` : null;
    if (textFile && text) {
      this.write(
        textFile,
        `<!-- The text of ${name}, read out of it on ${today}. The file itself is beside this one. -->\n\n${text}\n`,
      );
    }
    const file: SharedFile = { path, name: upload.name, kind: upload.kind, added: today, textFile };
    this.saveAll({ ...answers, files: [...answers.files, file] });
    return { ok: true, file };
  }

  /** Keeps a LinkedIn data export's spreadsheets in linkedin/, and its summary for Claude. */
  addLinkedIn(upload: LinkedInUpload): AddFileResult {
    for (const table of upload.tables) this.write(`${LINKEDIN_FOLDER}/${table.name}`, table.text);
    this.write(LINKEDIN_SUMMARY, upload.summary);
    const answers = this.answers();
    const file: SharedFile = {
      path: LINKEDIN_SUMMARY,
      name: 'LinkedIn data',
      kind: 'linkedin-data',
      added: this.today(),
      textFile: null,
    };
    const others = answers.files.filter((each) => each.path !== LINKEDIN_SUMMARY);
    this.saveAll({ ...answers, files: [...others, file] });
    return { ok: true, file };
  }

  /**
   * Moves a shared file, and its text, to the trash, and takes it off the list. LinkedIn data
   * takes its spreadsheets with it, connections included.
   */
  async removeFile(path: string): Promise<AboutYou> {
    const file = this.answers().files.find((each) => each.path === path);
    if (!file) return this.answers();
    const tables =
      file.kind === 'linkedin-data'
        ? LINKEDIN_TABLES.map((name) => `${LINKEDIN_FOLDER}/${name}`)
        : [];
    for (const each of [file.path, file.textFile, ...tables]) {
      if (each && this.read(each) !== null) await this.trash(this.path(each));
    }
    // Read again: other changes may have saved while the trash was busy.
    const answers = this.answers();
    return this.saveAll({ ...answers, files: answers.files.filter((each) => each.path !== path) });
  }

  /**
   * Whether the answers are in use, by Claude or by a fact bank, so the files built from them
   * should follow each change. Before that, they're only a draft.
   */
  private inUse(answers: AboutYou): boolean {
    return answers.startedOn !== null || hasFactBank(this.workspace);
  }

  /**
   * Writes the files built from the answers: the criteria and the templates, unless someone has
   * changed them by hand since, and the page count in guide/lint.json.
   */
  writeDerived(answers: AboutYou = this.answers()): void {
    if (untouched(this.read(ABOUT.criteria))) this.write(ABOUT.criteria, criteriaMarkdown(answers));
    if (untouched(this.read(ABOUT.templates)))
      this.write(ABOUT.templates, templatesMarkdown(answers, this.templates()));
    let lint: Record<string, unknown> = {};
    const text = this.read(ABOUT.lint);
    try {
      lint = text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      // The user's own rules don't parse; the resume check says so. Leave them be.
      return;
    }
    // The page count is the user's choice in the app, or follows their level. With neither
    // given, a count already there stays, such as one set by hand. The rest of the file is the
    // user's, so it's only written again when the count changes.
    const levels = [answers.levels, ...answers.otherKinds.map((kind) => kind.levels)].flat();
    const chosen = answers.pages !== null || levels.length > 0 ? pagesFor(answers) : null;
    if (chosen !== null && lint.maxPages !== chosen) {
      this.write(ABOUT.lint, `${JSON.stringify({ ...lint, maxPages: chosen }, null, 2)}\n`);
    }
  }

  /** Replaces a criteria file the user or Claude wrote with one from the answers, keeping theirs. */
  useAnswersForCriteria(): void {
    const own = this.read(ABOUT.criteria);
    if (own !== null && !untouched(own)) this.keepOld(ABOUT.criteria, own);
    this.write(ABOUT.criteria, criteriaMarkdown(this.answers()));
  }

  /**
   * Gets the workspace ready for Claude to get to know the user: the starter files it lacks,
   * and the files built from the answers, which are in use from now on.
   */
  start(): AboutYou {
    copyStarter(this.starterDir, this.workspace);
    return this.saveAll({ ...this.answers(), startedOn: this.today(), skipped: false });
  }

  profile(): Profile {
    const answers = this.answers();
    return {
      answers,
      notes: this.notes(),
      confidential: this.confidential(),
      status: profileStatus(this.workspace, answers),
      templates: this.templates(),
    };
  }
}
