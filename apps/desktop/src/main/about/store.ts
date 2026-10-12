import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { localDate } from '@factwright/core';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  FILES_FOLDER,
  pagesFor,
  readAnswers,
  type SharedFile,
} from '../../shared/about.ts';
import { criteriaMarkdown } from '../../shared/criteria.ts';
import { templatesMarkdown } from '../../shared/looks.ts';
import type { AddFileResult, LinkedInUpload, Profile } from '../../shared/profile.ts';
import { untouched } from '../../shared/stamp.ts';
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

  constructor(deps: AboutStoreDeps) {
    this.workspace = deps.workspace;
    this.starterDir = deps.starterDir;
    this.trash = deps.trash ?? (async (path) => rmSync(path, { force: true }));
    this.today = deps.today ?? (() => localDate());
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

  answers(): AboutYou {
    const text = this.read(ABOUT.answers);
    if (text === null) return readAnswers({});
    try {
      return readAnswers(JSON.parse(text));
    } catch {
      return readAnswers({});
    }
  }

  private saveAll(answers: AboutYou): AboutYou {
    this.write(ABOUT.answers, `${JSON.stringify(answers, null, 2)}\n`);
    if (this.inUse(answers)) this.writeDerived(answers);
    return answers;
  }

  /** Saves the window's changes, already checked, and answers with all the answers. */
  saveAnswers(changes: AnswerChanges): AboutYou {
    return this.saveAll({ ...this.answers(), ...changes });
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

  /** Saves the user's list of confidential names, keeping every pattern Claude wrote as it was. */
  saveConfidential(names: readonly string[]): string[] {
    this.write(ABOUT.terms, withTerms(this.read(ABOUT.terms), names));
    return this.confidential();
  }

  /** Keeps a shared file, and the text read out of it, in about-me/files. Each file is kept once. */
  addFile(upload: CheckedUpload): AddFileResult {
    const answers = this.answers();
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

  /** Moves a shared file, and its text, to the trash, and takes it off the list. */
  async removeFile(path: string): Promise<AboutYou> {
    const answers = this.answers();
    const file = answers.files.find((each) => each.path === path);
    if (!file) return answers;
    for (const each of [file.path, file.textFile]) {
      if (each && this.read(each) !== null) await this.trash(this.path(each));
    }
    return this.saveAll({ ...answers, files: answers.files.filter((each) => each !== file) });
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
      this.write(ABOUT.templates, templatesMarkdown(answers));
    let lint: Record<string, unknown> = {};
    const text = this.read(ABOUT.lint);
    try {
      lint = text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      // The user's own rules don't parse; the resume check says so. Leave them be.
      return;
    }
    // The app owns the page count: the user sets it in the app, or it follows their level.
    this.write(
      ABOUT.lint,
      `${JSON.stringify({ ...lint, maxPages: pagesFor(answers) }, null, 2)}\n`,
    );
  }

  /** Replaces a criteria file the user or Claude wrote with one from the answers, keeping theirs. */
  useAnswersForCriteria(): void {
    const own = this.read(ABOUT.criteria);
    if (own !== null && !untouched(own)) {
      let name = `searches/criteria-before-${this.today()}.md`;
      for (let n = 2; this.read(name) !== null; n++)
        name = `searches/criteria-before-${this.today()}-${n}.md`;
      this.write(name, own);
    }
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
    };
  }
}
