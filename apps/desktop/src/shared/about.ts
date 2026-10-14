import { KIND_ID, type KindName, slug } from '@factwright/core';
import { TEMPLATE_ID } from '@factwright/engine/templates';

/**
 * What the user tells Factwright about themselves when they start, and can change later in
 * Profile: who they are, what they're looking for, how their resumes should look, and the files
 * they shared. It's kept in the workspace as about-me/answers.json, so Claude reads it, and so
 * it syncs to the user's other computers.
 */
export interface AboutYou {
  /** Who they are, as their resumes should show it. */
  you: Contact;
  /**
   * Job titles they want, such as "Product Designer". With more than one kind of job, these,
   * the kinds of work, levels and pay are the first kind's.
   */
  roles: string[];
  fields: Field[];
  levels: Level[];
  workplaces: Workplace[];
  /** Where they can work remotely from, such as "anywhere in the US". */
  remoteFrom: string;
  /** Cities for hybrid or on-site work. */
  places: string[];
  relocate: Relocate;
  companies: CompanyKind[];
  /** Industries they'd love to work in. */
  industries: string[];
  /** Industries they won't work in. */
  avoid: string[];
  employment: Employment[];
  /** The least base pay they'd take, as they say it, such as "$120,000". */
  minPay: string;
  targetPay: string;
  /** Whether jobs paying less than minPay are left out of searches. */
  payFilter: boolean;
  /** Whether they can work where the jobs are, such as "US citizen, no sponsorship needed". */
  authorization: string;
  /** When they can start, such as "two weeks' notice". */
  start: string;
  mustHaves: string;
  dealBreakers: string;
  /** They're employed, and their employer shouldn't find out they're looking. */
  quiet: boolean;
  /** The templates they picked, each for one kind of company or any job. */
  looks: Look[];
  /** At most how many pages, or null to go by their level. */
  pages: 1 | 2 | null;
  format: ResumeFiles;
  /** The files they shared, kept in about-me/files. */
  files: SharedFile[];
  /** The getting-started step they're on, to come back to. */
  step: number;
  /** The furthest getting-started step they've reached. */
  reached: number;
  /** When they handed their answers to Claude, as an ISO date, or null before then. */
  startedOn: string | null;
  /** They skipped getting started, for now. */
  skipped: boolean;
  /**
   * The first kind of job's id and name, once they want more than one kind, such as
   * "Developer" beside "Project manager". Its titles, kinds of work, levels and pay are the ones
   * above. Null with one kind.
   */
  firstKind: KindName | null;
  /** Each kind of job after the first, with its own titles, kinds of work, levels and pay. */
  otherKinds: JobKind[];
}

/**
 * A kind of job the user wants, such as "Project manager" beside "Developer": its own titles,
 * kinds of work, levels and pay. The rest of what they want is the same for every kind.
 */
export interface JobKind extends KindName {
  roles: string[];
  fields: Field[];
  levels: Level[];
  minPay: string;
  targetPay: string;
  payFilter: boolean;
}

/** What each kind of job has of its own. */
export const KIND_ANSWERS = [
  'roles',
  'fields',
  'levels',
  'minPay',
  'targetPay',
  'payFilter',
] as const satisfies readonly (keyof JobKind & keyof AboutYou)[];

type KindAnswerKey = (typeof KIND_ANSWERS)[number];

/** A kind of job's own answers, which each kind has apart from the others. */
export type KindAnswers = Pick<JobKind, KindAnswerKey>;

/** A change to a kind of job after the first, by its id: its name, or some of its own answers. */
export type KindChange = { id: string } & Partial<Pick<JobKind, 'name' | KindAnswerKey>>;

/**
 * Where the kinds of job are kept: the first one's name, and each other one's own answers. They
 * have a file of their own so a copy of the app from before them, which rewrites answers.json
 * with only what it knows, never drops them.
 */
export const KINDS_FILE = 'about-me/kinds-of-job.json';

export interface Contact {
  name: string;
  email: string;
  phone: string;
  /** Such as "Denver, CO". */
  location: string;
  linkedin: string;
  website: string;
}

export interface Look {
  /** The template's ID: one the app has, such as "classic", or one of the user's own. */
  layout: string;
  /** The kind of company it's for, or "any". */
  for: CompanyKind | 'any';
}

/** What a shared file is, which says how Claude reads it. */
export const FILE_KINDS = [
  'resume',
  'linkedin-profile',
  'linkedin-data',
  'screenshot',
  'document',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface SharedFile {
  /** Where it is in the workspace, such as "about-me/files/resume-2024.pdf". */
  path: string;
  /** Its name when the user chose it. */
  name: string;
  kind: FileKind;
  /** When it was added, as an ISO date. */
  added: string;
  /** The file beside it holding its text, read out of it for Claude, or null if it has none. */
  textFile: string | null;
}

/** The kinds of work, broad enough for anyone. */
export const FIELDS = [
  ['software', 'Software engineering'],
  ['data', 'Data and AI'],
  ['it', 'IT and security'],
  ['product', 'Product management'],
  ['design', 'Design and UX'],
  ['marketing', 'Marketing and communications'],
  ['sales', 'Sales and business development'],
  ['customer', 'Customer success and support'],
  ['operations', 'Operations and logistics'],
  ['finance', 'Finance and accounting'],
  ['people', 'HR and recruiting'],
  ['legal', 'Legal'],
  ['healthcare', 'Healthcare'],
  ['education', 'Teaching and education'],
  ['science', 'Science and research'],
  ['creative', 'Writing, media and the arts'],
  ['trades', 'Skilled trades and manufacturing'],
  ['other', 'Something else'],
] as const;
export type Field = (typeof FIELDS)[number][0];

export const LEVELS = [
  ['entry', 'Entry level'],
  ['mid', 'Mid level'],
  ['senior', 'Senior'],
  ['lead', 'Lead or principal'],
  ['manager', 'Manager'],
  ['director', 'Director'],
  ['executive', 'Executive'],
] as const;
export type Level = (typeof LEVELS)[number][0];

export const WORKPLACES = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
] as const;
export type Workplace = (typeof WORKPLACES)[number][0];

export const RELOCATE = [
  ['', 'Not sure yet'],
  ['no', 'No'],
  ['maybe', 'For the right job'],
  ['yes', 'Yes'],
] as const;
export type Relocate = (typeof RELOCATE)[number][0];

/**
 * The kinds of company, each with its own resume style: who reads the resume there, and what
 * they reward.
 */
export const COMPANY_KINDS = [
  ['startup', 'Startups', 'Early and growing companies, up to a few hundred people'],
  ['established', 'Established companies', 'Mid-size and large companies, and public companies'],
  ['public', 'Government, nonprofits and schools', 'Public service, charities and education'],
] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number][0];

/** The resume style in guide/styles for each kind of company. */
export const STYLE_OF: Readonly<Record<CompanyKind, string>> = {
  startup: 'startup',
  established: 'big-company',
  public: 'public-sector',
};

export const EMPLOYMENT = [
  ['full-time', 'Full-time'],
  ['part-time', 'Part-time'],
  ['contract', 'Contract'],
  ['freelance', 'Freelance'],
  ['internship', 'Internship'],
] as const;
export type Employment = (typeof EMPLOYMENT)[number][0];

export const RESUME_FILES = [
  ['pdf', 'PDF'],
  ['docx', 'Word'],
  ['both', 'Both'],
] as const;
export type ResumeFiles = (typeof RESUME_FILES)[number][0];

/** A list's labels by value, such as "Mid level" for "mid". */
export const labelOf = <T extends string>(
  list: readonly (readonly [T, string, ...string[]])[],
  value: T,
) => list.find(([each]) => each === value)?.[1] ?? value;

/** Nothing told yet. */
export const NO_ANSWERS: AboutYou = {
  you: { name: '', email: '', phone: '', location: '', linkedin: '', website: '' },
  roles: [],
  fields: [],
  levels: [],
  workplaces: [],
  remoteFrom: '',
  places: [],
  relocate: '',
  companies: [],
  industries: [],
  avoid: [],
  employment: [],
  minPay: '',
  targetPay: '',
  payFilter: false,
  authorization: '',
  start: '',
  mustHaves: '',
  dealBreakers: '',
  quiet: false,
  looks: [],
  pages: null,
  format: 'pdf',
  files: [],
  step: 0,
  reached: 0,
  startedOn: null,
  skipped: false,
  firstKind: null,
  otherKinds: [],
};

/** The longest text each answer takes, so a stray paste can't swell the file. */
export const ANSWER_LIMITS = {
  line: 200,
  entry: 120,
  entries: 30,
  text: 4000,
  files: 200,
  /** Kinds of job, the first included, and how long a kind's name runs. */
  kinds: 6,
  kindName: 60,
  /** The notes, kept in about-me/notes.md, can be long: that's the point of them. */
  notes: 200_000,
} as const;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const text = (value: unknown, max: number = ANSWER_LIMITS.line): string | undefined =>
  isText(value, max) ? value : undefined;

/** A list of short entries, trimmed, without blanks or repeats. */
function entries(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.entries) return undefined;
  const kept: string[] = [];
  for (const each of value) {
    if (!isText(each, ANSWER_LIMITS.entry)) return undefined;
    const entry = each.trim();
    if (entry && !kept.some((known) => known.toLowerCase() === entry.toLowerCase())) {
      kept.push(entry);
    }
  }
  return kept;
}

/** The values of a list that are among its options, in the options' order. */
function choices<T extends string>(
  value: unknown,
  options: readonly (readonly [T, ...string[]])[],
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = options.map(([each]) => each);
  return value.every((each) => known.includes(each))
    ? known.filter((each) => value.includes(each))
    : undefined;
}

function choice<T extends string>(
  value: unknown,
  options: readonly (readonly [T, ...string[]])[],
): T | undefined {
  return options.some(([each]) => each === value) ? (value as T) : undefined;
}

function contact(value: unknown): Contact | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const read: Partial<Contact> = {};
  for (const key of Object.keys(NO_ANSWERS.you) as (keyof Contact)[]) {
    const field = fields[key] ?? '';
    if (!isText(field, ANSWER_LIMITS.line)) return undefined;
    read[key] = field;
  }
  return read as Contact;
}

function looks(value: unknown): Look[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.entries) return undefined;
  const kept: Look[] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return undefined;
    const { layout, for: kind } = each as Record<string, unknown>;
    if (typeof layout !== 'string' || !TEMPLATE_ID.test(layout)) return undefined;
    if (kind !== 'any' && !choice(kind, COMPANY_KINDS)) return undefined;
    if (!kept.some((look) => look.layout === layout)) {
      kept.push({ layout, for: kind as Look['for'] });
    }
  }
  return kept;
}

/** Where shared files are kept, and the names the app gives them there. */
export const FILES_FOLDER = 'about-me/files';
const FILE_PATH = /^about-me\/files\/[a-z0-9][a-z0-9._-]{0,150}$/;

function files(value: unknown): SharedFile[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.files) return undefined;
  const kept: SharedFile[] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return undefined;
    const file = each as Record<string, unknown>;
    const kind = (FILE_KINDS as readonly unknown[]).includes(file.kind)
      ? (file.kind as FileKind)
      : null;
    const path = text(file.path);
    const textFile = file.textFile === null ? null : text(file.textFile);
    if (!kind || !path || !FILE_PATH.test(path) || textFile === undefined) return undefined;
    if (textFile !== null && !FILE_PATH.test(textFile)) return undefined;
    const name = text(file.name, ANSWER_LIMITS.entry) ?? path.slice(FILES_FOLDER.length + 1);
    const added = text(file.added) ?? '';
    kept.push({
      path,
      name,
      kind,
      added: /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : '',
      textFile,
    });
  }
  return kept;
}

/** A kind of job's name as it's kept: on one line, with single spaces. */
export const kindNameText = (name: string) => name.replace(/\s+/g, ' ').trim();

/** What kinds of job are told apart by: their names, kept as they're kept, in any case. */
export const kindNameKey = (name: string) => kindNameText(name).toLowerCase();

/** A kind of job's name, on one line, or nothing when it's blank or too long. */
function oneLine(value: unknown): string | undefined {
  const named = text(value, ANSWER_LIMITS.kindName);
  return named === undefined ? undefined : kindNameText(named) || undefined;
}

/** A kind of job's id and name, or nothing when either doesn't hold up. */
function kindName(value: unknown): KindName | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !KIND_ID.test(id)) return undefined;
  const named = oneLine(name);
  return named ? { id, name: named } : undefined;
}

/** Whether two kinds of job are the same one, by id or by name. */
export const sameKind = (a: KindName, b: KindName) =>
  a.id === b.id || kindNameKey(a.name) === kindNameKey(b.name);

/**
 * A kind of job, whole: its id, its name and its own answers. Each answer that doesn't hold up
 * falls back to nothing told, as the answers do, or when it's strict, the kind doesn't hold up.
 */
function jobKind(value: unknown, strict: boolean): JobKind | undefined {
  const named = kindName(value);
  if (!named) return undefined;
  const fields = value as Record<string, unknown>;
  const own: Record<string, unknown> = {};
  for (const key of KIND_ANSWERS) {
    const read = key in fields ? READERS[key](fields[key]) : NO_ANSWERS[key];
    if (read === undefined && strict) return undefined;
    own[key] = read ?? NO_ANSWERS[key];
  }
  return { ...named, ...own } as JobKind;
}

/**
 * The kinds of job after the first, as a file holds them. A kind without an id and a name is
 * left out, and so is a second one by the same id or name, or one past as many as the app keeps,
 * but the rest stay.
 */
function kinds(value: unknown): JobKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: JobKind[] = [];
  for (const each of value) {
    if (kept.length === ANSWER_LIMITS.kinds - 1) break;
    const kind = jobKind(each, false);
    if (kind && !kept.some((other) => sameKind(other, kind))) kept.push(kind);
  }
  return kept;
}

/** Kinds of job the window adds, each whole and its own, or none. */
function addedKinds(value: unknown): JobKind[] | undefined {
  if (!Array.isArray(value) || value.length >= ANSWER_LIMITS.kinds) return undefined;
  const kept: JobKind[] = [];
  for (const each of value) {
    const kind = jobKind(each, true);
    if (!kind || kept.some((other) => sameKind(other, kind))) return undefined;
    kept.push(kind);
  }
  return kept;
}

/** Kinds of job the window removes, by id, or none when any isn't one. */
function removedKinds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.entries) return undefined;
  return value.every((id) => typeof id === 'string' && KIND_ID.test(id))
    ? [...new Set(value as string[])]
    : undefined;
}

/** Changes to kinds of job after the first as the window sends them, each that holds up, or none. */
function kindChanges(value: unknown): KindChange[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.entries) return undefined;
  const kept: KindChange[] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null || Array.isArray(each)) return undefined;
    const { id, ...fields } = each as Record<string, unknown>;
    if (typeof id !== 'string' || !KIND_ID.test(id) || kept.some((other) => other.id === id)) {
      return undefined;
    }
    const change: Record<string, unknown> = { id };
    for (const [key, field] of Object.entries(fields)) {
      const read =
        key === 'name'
          ? oneLine(field)
          : (KIND_ANSWERS as readonly string[]).includes(key)
            ? READERS[key as KindAnswerKey](field)
            : undefined;
      if (read === undefined) return undefined;
      change[key] = read;
    }
    kept.push(change as KindChange);
  }
  return kept;
}

function stepNumber(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 20
    ? (value as number)
    : undefined;
}

const READERS: { [K in keyof AboutYou]: (value: unknown) => AboutYou[K] | undefined } = {
  you: contact,
  roles: entries,
  fields: (value) => choices(value, FIELDS),
  levels: (value) => choices(value, LEVELS),
  workplaces: (value) => choices(value, WORKPLACES),
  remoteFrom: (value) => text(value),
  places: entries,
  relocate: (value) => choice(value, RELOCATE),
  companies: (value) => choices(value, COMPANY_KINDS),
  industries: entries,
  avoid: entries,
  employment: (value) => choices(value, EMPLOYMENT),
  minPay: (value) => text(value, ANSWER_LIMITS.entry),
  targetPay: (value) => text(value, ANSWER_LIMITS.entry),
  payFilter: (value) => (typeof value === 'boolean' ? value : undefined),
  authorization: (value) => text(value),
  start: (value) => text(value),
  mustHaves: (value) => text(value, ANSWER_LIMITS.text),
  dealBreakers: (value) => text(value, ANSWER_LIMITS.text),
  quiet: (value) => (typeof value === 'boolean' ? value : undefined),
  looks,
  pages: (value) => (value === 1 || value === 2 || value === null ? value : undefined),
  format: (value) => choice(value, RESUME_FILES),
  files,
  step: stepNumber,
  reached: stepNumber,
  startedOn: (value) =>
    value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      ? value
      : undefined,
  skipped: (value) => (typeof value === 'boolean' ? value : undefined),
  firstKind: (value) => (value === null ? null : kindName(value)),
  otherKinds: kinds,
};

/**
 * Answers read from about-me/answers.json, which Claude may have edited too. Each answer that
 * doesn't hold up falls back to nothing told, so one bad edit never loses the rest.
 */
export function readAnswers(value: unknown): AboutYou {
  const fields =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const answers = { ...NO_ANSWERS } as Record<keyof AboutYou, unknown>;
  for (const [key, read] of Object.entries(READERS) as [
    keyof AboutYou,
    (value: unknown) => unknown,
  ][]) {
    const valid = key in fields ? read(fields[key]) : undefined;
    if (valid !== undefined) answers[key] = valid;
  }
  return withKinds(answers as AboutYou);
}

/**
 * The kinds of job as they can stand together: the first named whenever there are others, and
 * no other by the first one's id or name.
 */
function withKinds(answers: AboutYou): AboutYou {
  const first = answers.firstKind;
  const others = answers.otherKinds.filter(
    (kind) => kind.id !== first?.id && kind.name.toLowerCase() !== first?.name.toLowerCase(),
  );
  if (others.length === 0 || first) return { ...answers, otherKinds: others };
  // Others with no first named, as after a hand edit: the first is named for its titles.
  const name = answers.roles[0]?.slice(0, ANSWER_LIMITS.kindName) || 'Your first kind of job';
  const taken = others.map((kind) => kind.id);
  return { ...answers, firstKind: { id: kindIdFor(name, taken), name }, otherKinds: others };
}

/** An id for a new kind of job, from its name, that none of the others has. */
export function kindIdFor(name: string, taken: readonly string[]): string {
  const words = slug(name).slice(0, 32).replace(/-+$/, '') || 'kind';
  // A name Windows keeps for itself, such as "prn", can't name a folder in base/.
  const base = KIND_ID.test(words) ? words : `${words}-jobs`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The answers the window may change: each answer whole, and the kinds of job after the first by
 * their ids: those added, those removed, and changes to a field at a time. So changing one kind,
 * or adding or removing one, never undoes a change made to another meanwhile, such as by Claude
 * or on another computer. The files list changes only as files are added or removed.
 */
export type AnswerChanges = Partial<Omit<AboutYou, 'files' | 'startedOn' | 'otherKinds'>> & {
  addedKinds?: JobKind[];
  removedKinds?: string[];
  kindChanges?: KindChange[];
};

/** What the window sends about the kinds of job after the first, and how each is read. */
const KIND_CHANGES: Readonly<Record<string, (value: unknown) => unknown>> = {
  addedKinds,
  removedKinds,
  kindChanges,
};

/**
 * Changes from the window, checked one by one, or null if any doesn't hold up, so nothing is
 * half saved.
 */
export function parseAnswerChanges(value: unknown): AnswerChanges | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const changes: Record<string, unknown> = {};
  for (const [key, change] of Object.entries(value)) {
    const read = Object.hasOwn(KIND_CHANGES, key)
      ? KIND_CHANGES[key]
      : ['files', 'startedOn', 'otherKinds'].includes(key) || !Object.hasOwn(READERS, key)
        ? null
        : READERS[key as keyof AboutYou];
    const valid = read?.(change);
    if (valid === undefined) return null;
    changes[key] = valid;
  }
  return changes as AnswerChanges;
}

/**
 * The answers with changes made: each answer replaced, the kinds of job removed and added, and
 * each kind changed by its id. A change that would give two kinds one name or id, as when
 * another computer named a kind the same meanwhile, is left out, so the kinds always stand
 * together. A change to a kind that's gone does nothing.
 */
export function applyChanges(answers: AboutYou, changes: AnswerChanges): AboutYou {
  const {
    addedKinds: added = [],
    removedKinds: removed = [],
    kindChanges: changed = [],
    firstKind,
    ...rest
  } = changes;
  const others = answers.otherKinds.filter((kind) => !removed.includes(kind.id));
  const first = firstKind ?? answers.firstKind;
  const clashes = (kind: KindName, except?: string) =>
    (first !== null && first.id !== except && sameKind(first, kind)) ||
    others.some((other) => other.id !== except && sameKind(other, kind));
  for (const kind of added) if (!clashes(kind)) others.push(kind);
  const kinds = others.map((kind) => {
    const { name, ...own } = changed.find((each) => each.id === kind.id) ?? { id: kind.id };
    const renamed = name && !clashes({ id: kind.id, name }, kind.id) ? { name } : {};
    return { ...kind, ...own, ...renamed, id: kind.id };
  });
  // The first kind keeps its name when another kind already has the one it's given.
  const firstClashes =
    firstKind && kinds.some((kind) => kind.id !== firstKind.id && sameKind(kind, firstKind));
  return {
    ...answers,
    ...rest,
    firstKind: firstKind && !firstClashes ? firstKind : answers.firstKind,
    otherKinds: kinds,
  };
}

/**
 * Changes made one after another, as one: the later wins, changes to one kind join, and a kind
 * added and then removed again is as if it never was.
 */
export function mergeChanges(earlier: AnswerChanges, later: AnswerChanges): AnswerChanges {
  const removed = later.removedKinds ?? [];
  const added = earlier.addedKinds ?? [];
  // A kind added and removed again before either saved needs neither saving.
  const undone = added.filter((kind) => removed.includes(kind.id)).map((kind) => kind.id);
  const kept = [...added.filter((kind) => !undone.includes(kind.id)), ...(later.addedKinds ?? [])];
  const gone = [
    ...new Set([...(earlier.removedKinds ?? []), ...removed.filter((id) => !undone.includes(id))]),
  ];
  const changed = (earlier.kindChanges ?? []).filter((change) => !removed.includes(change.id));
  for (const change of later.kindChanges ?? []) {
    const at = changed.findIndex((each) => each.id === change.id);
    if (at < 0) changed.push(change);
    else changed[at] = { ...changed[at], ...change };
  }
  const rest = Object.fromEntries(
    Object.entries({ ...earlier, ...later }).filter(([key]) => !Object.hasOwn(KIND_CHANGES, key)),
  ) as AnswerChanges;
  return {
    ...rest,
    ...(kept.length > 0 && { addedKinds: kept }),
    ...(gone.length > 0 && { removedKinds: gone }),
    ...(changed.length > 0 && { kindChanges: changed }),
  };
}

/**
 * How long resumes should be: what the user chose, or by their levels when they haven't, every
 * kind of job's.
 */
export function pagesFor(answers: Pick<AboutYou, 'pages' | 'levels' | 'otherKinds'>): 1 | 2 {
  if (answers.pages) return answers.pages;
  const levels = [answers.levels, ...answers.otherKinds.map((kind) => kind.levels)].flat();
  const early = levels.length > 0 && levels.every((level) => level === 'entry' || level === 'mid');
  return early ? 1 : 2;
}

/** How many words the notes hold. */
export const wordCount = (notes: string) => notes.split(/\s+/).filter(Boolean).length;
